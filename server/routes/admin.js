'use strict'

const XLSX = require('xlsx')
const { db, ok } = require('../db')
const { parsePage } = require('../service')
const {
  resolveServiceOrReply,
  ensureTokenMatchesService,
  ensureAdmin,
} = require('./_helpers')

function escapeLike(raw) {
  return String(raw || '').replace(/[\\%_]/g, '\\$&')
}

function resolveAdminService(req, reply) {
  const serviceKey = resolveServiceOrReply(req, reply)
  if (!serviceKey) return null
  if (!ensureTokenMatchesService(req, reply, serviceKey)) return null
  if (!ensureAdmin(req, reply)) return null
  return serviceKey
}

function buildRechargeWhere(serviceKey, query = {}) {
  const where = ['service_key = ?']
  const params = [serviceKey]

  if (query.uid) {
    where.push('user_id = ?')
    params.push(String(query.uid).trim())
  }

  if (query.username) {
    where.push('username LIKE ? ESCAPE "\\"')
    params.push(`%${escapeLike(String(query.username).trim())}%`)
  }

  if (query.card_code || query.card) {
    const card = String(query.card_code || query.card).trim()
    where.push('card_code LIKE ? ESCAPE "\\"')
    params.push(`%${escapeLike(card)}%`)
  }

  if (query.batch_no || query.batch) {
    const batchNo = String(query.batch_no || query.batch).trim()
    where.push('batch_no LIKE ? ESCAPE "\\"')
    params.push(`%${escapeLike(batchNo)}%`)
  }

  if (query.date_from) {
    where.push('recharged_at >= ?')
    params.push(String(query.date_from).trim())
  }

  if (query.date_to) {
    where.push('recharged_at <= ?')
    params.push(String(query.date_to).trim())
  }

  return { whereSql: where.join(' AND '), params }
}

module.exports = async function adminRoutes(fastify) {
  const auth = { preHandler: [fastify.authenticate] }

  fastify.get('/:service/admin/dashboard', auth, async (req, reply) => {
    const serviceKey = resolveAdminService(req, reply)
    if (!serviceKey) return

    const usersTotal = db.prepare(
      'SELECT COUNT(*) AS c FROM users WHERE service_key = ?'
    ).get(serviceKey)?.c || 0

    const activeUsers = db.prepare(
      `SELECT COUNT(*) AS c FROM users
       WHERE service_key = ? AND id IN (
         SELECT DISTINCT user_id FROM admin_recharge_records WHERE service_key = ?
       )`
    ).get(serviceKey, serviceKey)?.c || 0

    const creditsTotal = db.prepare(
      'SELECT COALESCE(SUM(credits_balance), 0) AS s FROM users WHERE service_key = ?'
    ).get(serviceKey)?.s || 0

    const rechargeStats = db.prepare(
      'SELECT COUNT(*) AS total, COALESCE(SUM(recharge_amount), 0) AS amount FROM admin_recharge_records WHERE service_key = ?'
    ).get(serviceKey) || { total: 0, amount: 0 }

    return ok({
      service_key: serviceKey,
      users_total: Number(usersTotal || 0),
      users_with_recharge: Number(activeUsers || 0),
      total_credits_balance: Number(creditsTotal || 0),
      recharge_total_count: Number(rechargeStats.total || 0),
      recharge_total_amount: Number(rechargeStats.amount || 0),
    })
  })

  fastify.get('/:service/admin/users', auth, async (req, reply) => {
    const serviceKey = resolveAdminService(req, reply)
    if (!serviceKey) return

    const { page, limit, offset } = parsePage(req.query)
    const keyword = String(req.query?.username || '').trim()

    const whereSql = keyword ? 'service_key = ? AND username LIKE ? ESCAPE "\\"' : 'service_key = ?'
    const whereParams = keyword
      ? [serviceKey, `%${escapeLike(keyword)}%`]
      : [serviceKey]

    const users = db.prepare(`
      SELECT
        u.id,
        u.username,
        u.role,
        u.credits_balance,
        u.created_at,
        (
          SELECT COUNT(*)
          FROM user_recharge_records r
          WHERE r.service_key = u.service_key AND r.user_id = u.id
        ) AS recharge_count
      FROM users u
      WHERE ${whereSql}
      ORDER BY u.created_at DESC
      LIMIT ? OFFSET ?
    `).all(...whereParams, limit, offset)

    const total = db.prepare(
      `SELECT COUNT(*) AS c FROM users WHERE ${whereSql}`
    ).get(...whereParams)?.c || 0

    return ok({
      list: users,
      total: Number(total || 0),
      page,
      limit,
    })
  })

  fastify.get('/:service/admin/recharges', auth, async (req, reply) => {
    const serviceKey = resolveAdminService(req, reply)
    if (!serviceKey) return

    const { page, limit, offset } = parsePage(req.query)
    const { whereSql, params } = buildRechargeWhere(serviceKey, req.query || {})

    const list = db.prepare(`
      SELECT
        id,
        user_id,
        username,
        card_code,
        face_value,
        recharge_amount,
        sale_price,
        valid_period,
        batch_no,
        recharged_at
      FROM admin_recharge_records
      WHERE ${whereSql}
      ORDER BY recharged_at DESC
      LIMIT ? OFFSET ?
    `).all(...params, limit, offset)

    const total = db.prepare(`
      SELECT COUNT(*) AS c FROM admin_recharge_records WHERE ${whereSql}
    `).get(...params)?.c || 0

    return ok({
      list,
      total: Number(total || 0),
      page,
      limit,
    })
  })

  fastify.get('/:service/admin/recharges/export', auth, async (req, reply) => {
    const serviceKey = resolveAdminService(req, reply)
    if (!serviceKey) return

    const { whereSql, params } = buildRechargeWhere(serviceKey, req.query || {})

    const list = db.prepare(`
      SELECT
        recharged_at,
        service_key,
        user_id,
        username,
        card_code,
        face_value,
        recharge_amount,
        sale_price,
        valid_period,
        batch_no
      FROM admin_recharge_records
      WHERE ${whereSql}
      ORDER BY recharged_at DESC
    `).all(...params)

    const rows = [
      ['充值时间', '服务', '用户UID', '用户名', '卡密字符串', '对应面值', '充值 credits', '售价', '有效期', '批次号'],
    ]

    for (const item of list) {
      rows.push([
        item.recharged_at,
        item.service_key,
        item.user_id,
        item.username,
        item.card_code,
        item.face_value,
        Number(item.recharge_amount || 0),
        item.sale_price || '',
        item.valid_period || '',
        item.batch_no || '',
      ])
    }

    const workbook = XLSX.utils.book_new()
    const sheet = XLSX.utils.aoa_to_sheet(rows)
    XLSX.utils.book_append_sheet(workbook, sheet, 'RechargeRecords')

    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' })
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const fileName = `${serviceKey}_recharge_records_${timestamp}.xlsx`

    reply.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    reply.header('Content-Disposition', `attachment; filename="${fileName}"`)
    reply.send(buffer)
  })
}
