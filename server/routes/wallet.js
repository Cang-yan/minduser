'use strict'

const { db, ok, fail } = require('../db')
const { parsePage } = require('../service')
const {
  resolveServiceOrReply,
  ensureTokenMatchesService,
} = require('./_helpers')

module.exports = async function walletRoutes(fastify) {
  const auth = { preHandler: [fastify.authenticate] }

  fastify.get('/:service/wallet/summary', auth, async (req, reply) => {
    const serviceKey = resolveServiceOrReply(req, reply)
    if (!serviceKey) return
    if (!ensureTokenMatchesService(req, reply, serviceKey)) return

    const user = db.prepare(`
      SELECT id, username, credits_balance, created_at
      FROM users
      WHERE id = ? AND service_key = ?
    `).get(req.user.id, serviceKey)

    if (!user) {
      return reply.code(404).send(fail('用户不存在', 404))
    }

    const rechargeCount = db.prepare(
      'SELECT COUNT(*) AS c FROM user_recharge_records WHERE service_key = ? AND user_id = ?'
    ).get(serviceKey, req.user.id)?.c || 0

    const lastRecharge = db.prepare(`
      SELECT card_code, face_value, recharge_amount, recharged_at
      FROM user_recharge_records
      WHERE service_key = ? AND user_id = ?
      ORDER BY recharged_at DESC
      LIMIT 1
    `).get(serviceKey, req.user.id)

    const consumptionCount = db.prepare(
      'SELECT COUNT(*) AS c FROM wallet_transactions WHERE service_key = ? AND user_id = ? AND change_amount < 0'
    ).get(serviceKey, req.user.id)?.c || 0

    const totalConsumed = db.prepare(
      'SELECT COALESCE(SUM(ABS(change_amount)), 0) AS s FROM wallet_transactions WHERE service_key = ? AND user_id = ? AND change_amount < 0'
    ).get(serviceKey, req.user.id)?.s || 0

    const lastConsumption = db.prepare(`
      SELECT reason, source_ref, ABS(change_amount) AS consume_amount, balance_after, created_at AS consumed_at
      FROM wallet_transactions
      WHERE service_key = ? AND user_id = ? AND change_amount < 0
      ORDER BY created_at DESC
      LIMIT 1
    `).get(serviceKey, req.user.id)

    return ok({
      uid: user.id,
      username: user.username,
      credits: Number(user.credits_balance || 0),
      recharge_count: Number(rechargeCount || 0),
      last_recharge: lastRecharge || null,
      consumption_count: Number(consumptionCount || 0),
      consumed_total: Number(totalConsumed || 0),
      last_consumption: lastConsumption || null,
      created_at: user.created_at,
    })
  })

  fastify.get('/:service/wallet/recharges', auth, async (req, reply) => {
    const serviceKey = resolveServiceOrReply(req, reply)
    if (!serviceKey) return
    if (!ensureTokenMatchesService(req, reply, serviceKey)) return

    const { page, limit, offset } = parsePage(req.query)

    const records = db.prepare(`
      SELECT card_code, face_value, recharge_amount, recharged_at
      FROM user_recharge_records
      WHERE service_key = ? AND user_id = ?
      ORDER BY recharged_at DESC
      LIMIT ? OFFSET ?
    `).all(serviceKey, req.user.id, limit, offset)

    const total = db.prepare(
      'SELECT COUNT(*) AS c FROM user_recharge_records WHERE service_key = ? AND user_id = ?'
    ).get(serviceKey, req.user.id)?.c || 0

    return ok({
      list: records,
      total: Number(total || 0),
      page,
      limit,
    })
  })

  fastify.get('/:service/wallet/consumptions', auth, async (req, reply) => {
    const serviceKey = resolveServiceOrReply(req, reply)
    if (!serviceKey) return
    if (!ensureTokenMatchesService(req, reply, serviceKey)) return

    const { page, limit, offset } = parsePage(req.query)

    const records = db.prepare(`
      SELECT
        reason,
        source_ref,
        ABS(change_amount) AS consume_amount,
        balance_after,
        created_at AS consumed_at
      FROM wallet_transactions
      WHERE service_key = ? AND user_id = ? AND change_amount < 0
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `).all(serviceKey, req.user.id, limit, offset)

    const total = db.prepare(
      'SELECT COUNT(*) AS c FROM wallet_transactions WHERE service_key = ? AND user_id = ? AND change_amount < 0'
    ).get(serviceKey, req.user.id)?.c || 0

    return ok({
      list: records,
      total: Number(total || 0),
      page,
      limit,
    })
  })
}
