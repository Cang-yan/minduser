'use strict'

const { randomUUID } = require('node:crypto')
const { db } = require('./db')
const { parseCreditsAmount, toIsoNow } = require('./service')

function pick(obj, keys) {
  for (const key of keys) {
    if (obj && Object.prototype.hasOwnProperty.call(obj, key)) {
      return obj[key]
    }
  }
  return undefined
}

function normalizeRechargePayload(body = {}, overrides = {}) {
  const uid = String(
    overrides.uid ?? pick(body, ['uid', 'userId', 'user_id']) ?? ''
  ).trim()

  const cardCode = String(
    overrides.cardCode ??
      pick(body, ['cardString', 'card', 'cardCode', 'card_code', '卡密字符串']) ??
      ''
  ).trim()

  const faceValueRaw =
    overrides.faceValueRaw !== undefined
      ? overrides.faceValueRaw
      : pick(body, ['faceValue', 'face_value', '对应面值'])
  const creditsRaw =
    overrides.creditsRaw !== undefined
      ? overrides.creditsRaw
      : pick(body, ['creditsAmount', 'credits_amount', 'redeemable_credits', '充值credits'])

  const salePrice = String(
    overrides.salePrice ?? pick(body, ['salePrice', 'sale_price', '售价']) ?? ''
  ).trim()
  const validPeriod = String(
    overrides.validPeriod ??
      pick(body, ['validPeriod', 'valid_days', 'expireAt', '有效期', '有效期（建议≥1 年）']) ??
      ''
  ).trim()
  const batchNo = String(
    overrides.batchNo ??
      pick(body, ['batchNo', 'batch_no', '批次号', '批次号（便于对账）']) ??
      ''
  ).trim()

  const faceValueText = String(
    overrides.faceValueText !== undefined ? overrides.faceValueText : faceValueRaw ?? ''
  ).trim()

  const rawPayload = overrides.raw !== undefined ? overrides.raw : body

  return {
    uid,
    cardCode,
    faceValueRaw,
    creditsRaw,
    faceValueText,
    salePrice,
    validPeriod,
    batchNo,
    raw: rawPayload,
  }
}

const doRecharge = db.transaction(async (serviceKey, payload) => {
  const user = await db.prepare(
    'SELECT id, username, credits_balance, account_status FROM users WHERE id = ? AND service_key = ?'
  ).get(payload.uid, serviceKey)

  if (!user) {
    const error = new Error('用户未注册，请先注册')
    error.statusCode = 404
    throw error
  }

  if (String(user.account_status || 'active') === 'disabled') {
    const error = new Error('账号已停用，请联系管理员')
    error.statusCode = 403
    throw error
  }

  const duplicate = await db.prepare(
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

  await db.prepare(
    'UPDATE users SET credits_balance = ?, updated_at = ? WHERE id = ? AND service_key = ?'
  ).run(nextBalance, now, user.id, serviceKey)

  await db.prepare(`
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

  await db.prepare(`
    INSERT INTO user_recharge_records (id, service_key, user_id, card_code, face_value, recharge_amount, recharged_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(randomUUID(), serviceKey, user.id, payload.cardCode, payload.faceValueText, amount, now)

  await db.prepare(`
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

async function rechargeWithPayload(serviceKey, payload) {
  if (!serviceKey) {
    const error = new Error('service_key 不能为空')
    error.statusCode = 400
    throw error
  }
  if (!payload || !payload.uid || !payload.cardCode || !payload.faceValueText) {
    const error = new Error('充值参数不完整')
    error.statusCode = 400
    throw error
  }
  return doRecharge(serviceKey, payload)
}

module.exports = {
  pick,
  normalizeRechargePayload,
  rechargeWithPayload,
}
