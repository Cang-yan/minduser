'use strict'

const fs = require('node:fs/promises')
const path = require('node:path')
const { execFile } = require('node:child_process')
const { promisify } = require('node:util')
const XLSX = require('xlsx')
const { randomUUID } = require('node:crypto')
const { db, ok, fail } = require('../db')
const { parsePage, toIsoNow } = require('../service')
const { resolveCardkeyDir } = require('../credits/engine')
const {
  resolveServiceOrReply,
  ensureTokenMatchesService,
  ensureAdmin,
} = require('./_helpers')

const runExecFile = promisify(execFile)
const TMP_EXPORT_DIR = '/tmp/minduser'
const USER_STATUS_ACTIVE = 'active'
const USER_STATUS_DISABLED = 'disabled'

function escapeLike(raw) {
  return String(raw || '').replace(/[\\%_]/g, '\\$&')
}

function sanitizeFileToken(raw) {
  const text = String(raw || '').trim()
  const out = text.replace(/[^0-9A-Za-z._-]+/g, '_')
  return out || 'batch'
}

function parsePositiveInt(raw, field, min, max) {
  const n = Number.parseInt(String(raw ?? ''), 10)
  if (!Number.isFinite(n) || n < min || n > max) {
    throw new Error(`${field} 必须是 ${min}-${max} 的整数`)
  }
  return n
}

function parseUserStatusAction(body = {}) {
  const raw = String(body.action ?? body.status ?? '').trim().toLowerCase()
  if (
    raw === USER_STATUS_DISABLED ||
    raw === 'disable' ||
    raw === 'stop' ||
    raw === 'ban'
  ) {
    return USER_STATUS_DISABLED
  }
  if (
    raw === USER_STATUS_ACTIVE ||
    raw === 'enable' ||
    raw === 'resume'
  ) {
    return USER_STATUS_ACTIVE
  }
  throw new Error('action 仅支持 disable / enable')
}

function parseCardkeyGeneratePayload(body = {}) {
  const payload = body || {}
  const count = parsePositiveInt(
    payload.count ?? payload.quantity ?? payload.num,
    'count',
    1,
    200000
  )
  const validDays = parsePositiveInt(
    payload.validDays ?? payload.valid_days,
    'validDays',
    1,
    36500
  )

  const faceValue = String(payload.faceValue ?? payload.face_value ?? '').trim()
  const salePrice = String(payload.salePrice ?? payload.sale_price ?? '').trim()
  const batchNo = String(payload.batchNo ?? payload.batch_no ?? '').trim()
  const startDate = String(payload.startDate ?? payload.start_date ?? '').trim()

  if (!faceValue) throw new Error('faceValue 不能为空')
  if (faceValue.length > 128) throw new Error('faceValue 长度不能超过 128')
  if (!salePrice) throw new Error('salePrice 不能为空')
  if (!batchNo) throw new Error('batchNo 不能为空')
  if (!/^[0-9A-Za-z._-]{2,64}$/.test(batchNo)) {
    throw new Error('batchNo 仅支持字母/数字/._-，长度 2-64')
  }
  if (startDate && !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
    throw new Error('startDate 格式必须为 YYYY-MM-DD')
  }

  return {
    count,
    faceValue,
    salePrice,
    validDays,
    batchNo,
    startDate: startDate || null,
  }
}

async function generateCardkeyCsv(serviceKey, payload) {
  const cardkeyDir = resolveCardkeyDir(serviceKey)
  const scriptPath = path.join(cardkeyDir, 'generate_cardkeys.py')
  await fs.access(scriptPath)

  await fs.mkdir(TMP_EXPORT_DIR, { recursive: true })
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const outputFileName = `${serviceKey}_cardkeys_${sanitizeFileToken(payload.batchNo)}_${ts}_${randomUUID().slice(0, 8)}.csv`
  const outputPath = path.join(TMP_EXPORT_DIR, outputFileName)

  const args = [
    scriptPath,
    '--count', String(payload.count),
    '--face-value', payload.faceValue,
    '--sale-price', payload.salePrice,
    '--valid-days', String(payload.validDays),
    '--batch-no', payload.batchNo,
  ]
  if (payload.startDate) {
    args.push('--start-date', payload.startDate)
  }
  args.push('--output', outputPath)

  try {
    await runExecFile('python3', args, {
      cwd: cardkeyDir,
      timeout: 120000,
      maxBuffer: 10 * 1024 * 1024,
    })
  } catch (error) {
    const stderr = String(error && error.stderr ? error.stderr : '').trim()
    const stdout = String(error && error.stdout ? error.stdout : '').trim()
    const detail = stderr || stdout || (error && error.message ? error.message : '')
    const e = new Error(`卡密生成失败: ${detail || '请检查 cardkey 脚本环境'}`)
    e.statusCode = 500
    throw e
  }

  let buffer = null
  try {
    buffer = await fs.readFile(outputPath)
  } finally {
    await fs.unlink(outputPath).catch(() => {})
  }

  const downloadName = `${serviceKey}_cardkeys_${sanitizeFileToken(payload.batchNo)}_${ts}.csv`
  return { buffer, fileName: downloadName }
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

  fastify.post('/:service/admin/cardkeys/generate', auth, async (req, reply) => {
    const serviceKey = resolveAdminService(req, reply)
    if (!serviceKey) return

    let payload = null
    try {
      payload = parseCardkeyGeneratePayload(req.body || {})
    } catch (error) {
      return reply.code(400).send(fail(error.message || '请求参数不合法', 400))
    }

    try {
      const result = await generateCardkeyCsv(serviceKey, payload)
      reply.header('Content-Type', 'text/csv; charset=utf-8')
      reply.header('Content-Disposition', `attachment; filename="${result.fileName}"`)
      return reply.send(result.buffer)
    } catch (error) {
      req.log.error({ err: error, serviceKey, payload }, 'cardkey generate failed')
      const statusCode = Number(error.statusCode || 500)
      return reply.code(statusCode).send(fail(error.message || '生成卡密失败', statusCode))
    }
  })

  fastify.get('/:service/admin/dashboard', auth, async (req, reply) => {
    const serviceKey = resolveAdminService(req, reply)
    if (!serviceKey) return

    const usersTotal = (await db.prepare(
      'SELECT COUNT(*) AS c FROM users WHERE service_key = ?'
    ).get(serviceKey))?.c || 0

    const activeUsers = (await db.prepare(
      `SELECT COUNT(*) AS c FROM users
       WHERE service_key = ? AND id IN (
         SELECT DISTINCT user_id FROM admin_recharge_records WHERE service_key = ?
       )`
    ).get(serviceKey, serviceKey))?.c || 0

    const creditsTotal = (await db.prepare(
      'SELECT COALESCE(SUM(credits_balance), 0) AS s FROM users WHERE service_key = ?'
    ).get(serviceKey))?.s || 0

    const rechargeStats = await db.prepare(
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

    const users = await db.prepare(`
      SELECT
        u.id,
        u.username,
        u.email,
        u.role,
        u.account_status,
        u.disabled_at,
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
      LIMIT ${limit} OFFSET ${offset}
    `).all(...whereParams)

    const total = (await db.prepare(
      `SELECT COUNT(*) AS c FROM users WHERE ${whereSql}`
    ).get(...whereParams))?.c || 0

    return ok({
      list: users,
      total: Number(total || 0),
      page,
      limit,
    })
  })

  fastify.patch('/:service/admin/users/:uid/status', auth, async (req, reply) => {
    const serviceKey = resolveAdminService(req, reply)
    if (!serviceKey) return

    const uid = String(req.params?.uid || '').trim()
    if (!uid) {
      return reply.code(400).send(fail('uid 不能为空', 400))
    }

    let nextStatus = null
    try {
      nextStatus = parseUserStatusAction(req.body || {})
    } catch (error) {
      return reply.code(400).send(fail(error.message || '状态参数不合法', 400))
    }

    const user = await db.prepare(`
      SELECT id, username, role, account_status
      FROM users
      WHERE id = ? AND service_key = ?
      LIMIT 1
    `).get(uid, serviceKey)

    if (!user) {
      return reply.code(404).send(fail('用户不存在或已删除', 404))
    }

    if (user.role === 'admin' && nextStatus === USER_STATUS_DISABLED) {
      return reply.code(400).send(fail('管理员账号不允许停用', 400))
    }

    if (req.user.id === uid && nextStatus === USER_STATUS_DISABLED) {
      return reply.code(400).send(fail('不能停用当前登录管理员账号', 400))
    }

    const currentStatus = String(user.account_status || USER_STATUS_ACTIVE)
    const now = toIsoNow()

    if (currentStatus !== nextStatus) {
      await db.prepare(`
        UPDATE users
        SET account_status = ?, disabled_at = ?, updated_at = ?
        WHERE id = ? AND service_key = ?
      `).run(
        nextStatus,
        nextStatus === USER_STATUS_DISABLED ? now : null,
        now,
        uid,
        serviceKey
      )
    }

    return ok({
      uid,
      username: user.username,
      account_status: nextStatus,
      updated_at: now,
    }, nextStatus === USER_STATUS_DISABLED ? '用户已停用' : '用户已启用')
  })

  fastify.delete('/:service/admin/users/:uid', auth, async (req, reply) => {
    const serviceKey = resolveAdminService(req, reply)
    if (!serviceKey) return

    const uid = String(req.params?.uid || '').trim()
    if (!uid) {
      return reply.code(400).send(fail('uid 不能为空', 400))
    }

    const user = await db.prepare(`
      SELECT id, username, role
      FROM users
      WHERE id = ? AND service_key = ?
      LIMIT 1
    `).get(uid, serviceKey)

    if (!user) {
      return reply.code(404).send(fail('用户未注册或已删除', 404))
    }

    if (user.role === 'admin') {
      return reply.code(400).send(fail('管理员账号不允许删除', 400))
    }

    if (req.user.id === uid) {
      return reply.code(400).send(fail('不能删除当前登录管理员账号', 400))
    }

    await db.transaction(async () => {
      // 显式删除关联数据，确保在无外键级联的历史库中也能完整清理。
      await db.prepare(`
        DELETE FROM wallet_transactions
        WHERE service_key = ? AND user_id = ?
      `).run(serviceKey, uid)

      await db.prepare(`
        DELETE FROM user_recharge_records
        WHERE service_key = ? AND user_id = ?
      `).run(serviceKey, uid)

      await db.prepare(`
        DELETE FROM admin_recharge_records
        WHERE service_key = ? AND user_id = ?
      `).run(serviceKey, uid)

      await db.prepare(`
        DELETE FROM users
        WHERE id = ? AND service_key = ?
      `).run(uid, serviceKey)
    })()

    return ok({
      uid,
      username: user.username,
      deleted: true,
    }, '用户已删除')
  })

  fastify.get('/:service/admin/recharges', auth, async (req, reply) => {
    const serviceKey = resolveAdminService(req, reply)
    if (!serviceKey) return

    const { page, limit, offset } = parsePage(req.query)
    const { whereSql, params } = buildRechargeWhere(serviceKey, req.query || {})

    const list = await db.prepare(`
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
      LIMIT ${limit} OFFSET ${offset}
    `).all(...params)

    const total = (await db.prepare(`
      SELECT COUNT(*) AS c FROM admin_recharge_records WHERE ${whereSql}
    `).get(...params))?.c || 0

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

    const list = await db.prepare(`
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
