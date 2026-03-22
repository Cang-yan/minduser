'use strict'

const { randomUUID } = require('node:crypto')
const { db } = require('./db')
const { toIsoNow } = require('./service')

function pick(obj, keys) {
  for (const key of keys) {
    if (obj && Object.prototype.hasOwnProperty.call(obj, key)) {
      return obj[key]
    }
  }
  return undefined
}

function parsePositiveAmount(raw) {
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return raw > 0 ? raw : null
  }
  const text = String(raw || '').trim()
  if (!text) return null
  const value = Number(text)
  if (!Number.isFinite(value) || value <= 0) return null
  return value
}

function normalizeConsumePayload(body = {}, overrides = {}) {
  const uid = String(overrides.uid ?? pick(body, ['uid', 'userId', 'user_id']) ?? '').trim()
  const amountRaw =
    overrides.amountRaw !== undefined
      ? overrides.amountRaw
      : pick(body, [
        'amount',
        'consumeAmount',
        'consume_amount',
        'credits',
        'cost',
        'usedCredits',
        'used_credits',
        '扣减credits',
      ])

  const reason = String(
    overrides.reason ??
      pick(body, ['reason', 'consumeReason', 'consume_reason', '业务场景']) ??
      'consume'
  ).trim()

  const sourceRef = String(
    overrides.sourceRef ??
      pick(body, ['sourceRef', 'source_ref', 'orderId', 'order_id', '订单号']) ??
      ''
  ).trim()

  const meta = overrides.meta !== undefined ? overrides.meta : body

  return {
    uid,
    amount: parsePositiveAmount(amountRaw),
    reason: reason || 'consume',
    sourceRef,
    meta,
  }
}

const doConsume = db.transaction(async (serviceKey, payload) => {
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

  const amount = Number(payload.amount || 0)
  if (!Number.isFinite(amount) || amount <= 0) {
    const error = new Error('扣减 credits 必须为正数')
    error.statusCode = 400
    throw error
  }

  const balance = Number(user.credits_balance || 0)
  if (balance < amount) {
    const error = new Error('余额不足，无法扣减')
    error.statusCode = 400
    throw error
  }

  const now = toIsoNow()
  const nextBalance = balance - amount

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
    -amount,
    nextBalance,
    payload.reason || 'consume',
    payload.sourceRef || null,
    JSON.stringify(payload.meta || {}),
    now
  )

  return {
    uid: user.id,
    username: user.username,
    service_key: serviceKey,
    consume_amount: amount,
    reason: payload.reason || 'consume',
    source_ref: payload.sourceRef || '',
    consumed_at: now,
    credits_balance: nextBalance,
  }
})

async function consumeWithPayload(serviceKey, payload) {
  if (!serviceKey) {
    const error = new Error('service_key 不能为空')
    error.statusCode = 400
    throw error
  }
  if (!payload || !payload.uid || !payload.amount) {
    const error = new Error('扣减参数不完整')
    error.statusCode = 400
    throw error
  }
  return doConsume(serviceKey, payload)
}

module.exports = {
  pick,
  normalizeConsumePayload,
  consumeWithPayload,
}
