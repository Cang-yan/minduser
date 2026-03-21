'use strict'

const { randomUUID } = require('node:crypto')
const config = require('../config')
const { db, ok, fail } = require('../db')
const { parseCreditsAmount, toIsoNow } = require('../service')
const { resolveServiceOrReply } = require('./_helpers')

function pick(obj, keys) {
  for (const key of keys) {
    if (obj && Object.prototype.hasOwnProperty.call(obj, key)) {
      return obj[key]
    }
  }
  return undefined
}

function normalizeRechargePayload(body = {}) {
  const uid = String(pick(body, ['uid', 'userId', 'user_id']) || '').trim()
  const cardCode = String(
    pick(body, ['cardString', 'card', 'cardCode', 'card_code', '卡密字符串']) || ''
  ).trim()

  const faceValueRaw = pick(body, ['faceValue', 'face_value', '对应面值'])
  const creditsRaw = pick(body, ['creditsAmount', 'credits_amount', 'redeemable_credits', '充值credits'])
  const salePrice = String(pick(body, ['salePrice', 'sale_price', '售价']) || '').trim()
  const validPeriod = String(
    pick(body, ['validPeriod', 'valid_days', 'expireAt', '有效期', '有效期（建议≥1 年）']) || ''
  ).trim()
  const batchNo = String(pick(body, ['batchNo', 'batch_no', '批次号', '批次号（便于对账）']) || '').trim()

  return {
    uid,
    cardCode,
    faceValueRaw,
    creditsRaw,
    faceValueText: String(faceValueRaw ?? '').trim(),
    salePrice,
    validPeriod,
    batchNo,
    raw: body,
  }
}

module.exports = async function rechargeRoutes(fastify) {
  const doRecharge = db.transaction((serviceKey, payload) => {
    const user = db.prepare(
      'SELECT id, username, credits_balance FROM users WHERE id = ? AND service_key = ?'
    ).get(payload.uid, serviceKey)

    if (!user) {
      const error = new Error('用户不存在')
      error.statusCode = 404
      throw error
    }

    const duplicate = db.prepare(
      'SELECT id FROM admin_recharge_records WHERE service_key = ? AND card_code = ?'
    ).get(serviceKey, payload.cardCode)

    if (duplicate) {
      const error = new Error('该卡密已充值，不能重复入账')
      error.statusCode = 409
      throw error
    }

    // Priority: explicit credits field from upstream service, fallback to parsing face value text.
    const amount = parseCreditsAmount(
      payload.creditsRaw === undefined || payload.creditsRaw === null
        ? payload.faceValueRaw
        : payload.creditsRaw
    )
    if (!amount || amount <= 0) {
      const error = new Error('面值无法解析为有效 credits 数值')
      error.statusCode = 400
      throw error
    }

    const now = toIsoNow()
    const nextBalance = Number(user.credits_balance || 0) + amount

    db.prepare(
      'UPDATE users SET credits_balance = ?, updated_at = ? WHERE id = ? AND service_key = ?'
    ).run(nextBalance, now, user.id, serviceKey)

    db.prepare(`
      INSERT INTO wallet_transactions (id, service_key, user_id, change_amount, balance_after, reason, source_ref, meta_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      randomUUID(),
      serviceKey,
      user.id,
      amount,
      nextBalance,
      'recharge_card',
      payload.cardCode,
      JSON.stringify(payload.raw || {}),
      now
    )

    db.prepare(`
      INSERT INTO user_recharge_records (id, service_key, user_id, card_code, face_value, recharge_amount, recharged_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      randomUUID(),
      serviceKey,
      user.id,
      payload.cardCode,
      payload.faceValueText,
      amount,
      now
    )

    db.prepare(`
      INSERT INTO admin_recharge_records (
        id, service_key, user_id, username, card_code, face_value, sale_price, valid_period, batch_no,
        recharge_amount, recharged_at, payload_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      randomUUID(),
      serviceKey,
      user.id,
      user.username,
      payload.cardCode,
      payload.faceValueText,
      payload.salePrice,
      payload.validPeriod,
      payload.batchNo,
      amount,
      now,
      JSON.stringify(payload.raw || {}),
      now
    )

    return {
      uid: user.id,
      username: user.username,
      service_key: serviceKey,
      card_code: payload.cardCode,
      face_value: payload.faceValueText,
      recharge_amount: amount,
      sale_price: payload.salePrice,
      valid_period: payload.validPeriod,
      batch_no: payload.batchNo,
      recharged_at: now,
      credits_balance: nextBalance,
    }
  })

  async function rechargeHandler(req, reply) {
    const serviceKey = resolveServiceOrReply(req, reply)
    if (!serviceKey) return

    if (config.internalRechargeKey) {
      const incoming = String(req.headers['x-internal-key'] || '')
      if (incoming !== config.internalRechargeKey) {
        return reply.code(401).send(fail('无效的内部调用凭证', 401))
      }
    }

    const payload = normalizeRechargePayload(req.body || {})

    if (!payload.uid) {
      return reply.code(400).send(fail('uid 不能为空'))
    }
    if (!payload.cardCode) {
      return reply.code(400).send(fail('卡密字符串不能为空'))
    }
    if (!payload.faceValueText) {
      return reply.code(400).send(fail('对应面值不能为空'))
    }

    try {
      const data = doRecharge(serviceKey, payload)
      return ok(data, '充值成功')
    } catch (error) {
      const statusCode = Number(error.statusCode || 500)
      return reply.code(statusCode).send(fail(error.message || '充值失败', statusCode))
    }
  }

  fastify.post('/:service/open/recharge-card', rechargeHandler)
  fastify.post('/:service/open/recharge', rechargeHandler)
}
