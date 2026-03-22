'use strict'

const { db, ok, fail } = require('../db')
const { parsePage } = require('../service')
const { normalizeRechargePayload, rechargeWithPayload } = require('../recharge-core')
const {
  CreditsApiError,
  buildCardDetail,
  findLegacyRedemption,
  buildValidationResult,
} = require('../credits/engine')
const { resolveServiceOrReply, ensureTokenMatchesService } = require('./_helpers')

function getCardInput(body = {}) {
  return String(body.card || body.card_code || body.cardCode || '').trim()
}

function findUsedCardInMindUser(serviceKey, cardFormatted) {
  const compact = String(cardFormatted || '').replace(/-/g, '').toUpperCase()
  if (!compact) return null
  const record = db.prepare(`
    SELECT user_id, username, recharged_at
    FROM admin_recharge_records
    WHERE service_key = ?
      AND UPPER(REPLACE(card_code, '-', '')) = ?
    ORDER BY recharged_at DESC
    LIMIT 1
  `).get(serviceKey, compact)

  if (!record) return null
  return {
    source: 'minduser',
    used_by: record.user_id,
    used_at: record.recharged_at,
    raw: record,
  }
}

function resolveUsedCardInfo(serviceKey, cardFormatted) {
  const minduserUsed = findUsedCardInMindUser(serviceKey, cardFormatted)
  if (minduserUsed) return minduserUsed
  return findLegacyRedemption(serviceKey, cardFormatted)
}

function formatValidPeriod(cardDetail) {
  const start = String(cardDetail.start_date || '').trim()
  const end = String(cardDetail.expire_at || '').trim()
  const validDays = cardDetail.valid_days
  if (start && end && validDays !== undefined && validDays !== null && validDays !== '') {
    return `${start} ~ ${end}（${validDays}天）`
  }
  if (start && end) return `${start} ~ ${end}`
  if (end) return end
  return ''
}

function parsePayloadJson(raw) {
  if (!raw) return null
  try {
    const data = JSON.parse(raw)
    if (!data || typeof data !== 'object') return null
    return data
  } catch {
    return null
  }
}

module.exports = async function creditsRoutes(fastify) {
  const auth = { preHandler: [fastify.authenticate] }

  fastify.post('/:service/credits/validate', auth, async (req, reply) => {
    const serviceKey = resolveServiceOrReply(req, reply)
    if (!serviceKey) return
    if (!ensureTokenMatchesService(req, reply, serviceKey)) return

    const card = getCardInput(req.body || {})
    if (!card) {
      return reply.code(400).send(fail('缺少 card'))
    }

    try {
      const cardDetail = buildCardDetail(serviceKey, card)
      const usedInfo = resolveUsedCardInfo(serviceKey, cardDetail.card)
      const data = buildValidationResult(cardDetail, usedInfo)
      return ok(data, data.message)
    } catch (error) {
      if (error instanceof CreditsApiError) {
        return reply.code(error.statusCode || 400).send(fail(error.message, error.statusCode || 400))
      }
      req.log.error({ err: error }, 'credits validate failed')
      return reply.code(500).send(fail('卡密校验失败，请稍后重试', 500))
    }
  })

  fastify.post('/:service/credits/redeem', auth, async (req, reply) => {
    const serviceKey = resolveServiceOrReply(req, reply)
    if (!serviceKey) return
    if (!ensureTokenMatchesService(req, reply, serviceKey)) return

    const card = getCardInput(req.body || {})
    if (!card) {
      return reply.code(400).send(fail('缺少 card'))
    }

    const requestedUid = String(req.body?.uid || req.body?.account || '').trim()
    let targetUid = req.user.id
    if (req.user.role === 'admin' && requestedUid) {
      targetUid = requestedUid
    } else if (requestedUid && requestedUid !== req.user.id) {
      return reply.code(403).send(fail('普通用户仅可为本人 UID 充值', 403))
    }

    try {
      const cardDetail = buildCardDetail(serviceKey, card)
      const usedInfo = resolveUsedCardInfo(serviceKey, cardDetail.card)
      const validation = buildValidationResult(cardDetail, usedInfo)

      if (validation.is_used) {
        return reply.code(409).send(fail(validation.message, 409))
      }
      if (validation.is_expired) {
        return reply.code(400).send(fail(validation.message, 400))
      }
      if (
        validation.redeemable_credits === null ||
        validation.redeemable_credits === undefined ||
        Number(validation.redeemable_credits) <= 0
      ) {
        return reply
          .code(400)
          .send(fail('该卡密批次面值无法计算可兑换 credits，请检查批次配置', 400))
      }

      const payload = normalizeRechargePayload(
        {
          uid: targetUid,
          cardString: validation.card,
          faceValue: validation.face_value,
          creditsAmount: validation.redeemable_credits,
          salePrice: validation.sale_price,
          validPeriod: formatValidPeriod(validation),
          batchNo: validation.batch_no,
        },
        {
          uid: targetUid,
          cardCode: validation.card,
          faceValueRaw: validation.face_value,
          faceValueText: String(validation.face_value || ''),
          creditsRaw: validation.redeemable_credits,
          salePrice: String(validation.sale_price || ''),
          validPeriod: formatValidPeriod(validation),
          batchNo: String(validation.batch_no || ''),
          raw: {
            source: 'cdkey_redeem',
            service_key: serviceKey,
            uid: targetUid,
            card: validation.card,
            request_body: req.body || {},
            card_validation: validation,
          },
        }
      )

      const recharge = rechargeWithPayload(serviceKey, payload)
      return ok(
        {
          account: recharge.uid,
          uid: recharge.uid,
          username: recharge.username,
          card: validation.card,
          batch_id: validation.batch_id,
          batch_no: validation.batch_no,
          face_value: validation.face_value,
          sale_price: validation.sale_price,
          valid_days: validation.valid_days,
          start_date: validation.start_date,
          expire_at: validation.expire_at,
          redeemable_yuan: validation.redeemable_yuan,
          redeemable_credits: recharge.recharge_amount,
          redeemed_at: recharge.recharged_at,
          credits_balance: recharge.credits_balance,
        },
        '兑换成功'
      )
    } catch (error) {
      if (error instanceof CreditsApiError) {
        return reply.code(error.statusCode || 400).send(fail(error.message, error.statusCode || 400))
      }
      const statusCode = Number(error.statusCode || 500)
      return reply.code(statusCode).send(fail(error.message || '兑换失败，请稍后重试', statusCode))
    }
  })

  fastify.get('/:service/credits/redemptions', auth, async (req, reply) => {
    const serviceKey = resolveServiceOrReply(req, reply)
    if (!serviceKey) return
    if (!ensureTokenMatchesService(req, reply, serviceKey)) return

    const { page, limit, offset } = parsePage(req.query)
    const requestedUid = String(req.query?.account || req.query?.uid || '').trim()
    let targetUid = requestedUid

    if (req.user.role !== 'admin') {
      if (requestedUid && requestedUid !== req.user.id) {
        return reply.code(403).send(fail('无权查看其他用户兑换记录', 403))
      }
      targetUid = req.user.id
    }

    const where = ['service_key = ?']
    const params = [serviceKey]
    if (targetUid) {
      where.push('user_id = ?')
      params.push(targetUid)
    }

    const whereSql = where.join(' AND ')
    const list = db.prepare(`
      SELECT
        user_id,
        username,
        card_code,
        face_value,
        sale_price,
        batch_no,
        recharged_at,
        payload_json
      FROM admin_recharge_records
      WHERE ${whereSql}
      ORDER BY recharged_at DESC
      LIMIT ? OFFSET ?
    `).all(...params, limit, offset)

    const total = db.prepare(`
      SELECT COUNT(*) AS c
      FROM admin_recharge_records
      WHERE ${whereSql}
    `).get(...params)?.c || 0

    const mapped = list.map((item) => {
      const payload = parsePayloadJson(item.payload_json)
      const cv = payload && payload.card_validation ? payload.card_validation : null
      return {
        account: item.user_id,
        uid: item.user_id,
        username: item.username,
        card: item.card_code,
        batch_no: item.batch_no,
        face_value: item.face_value,
        sale_price: item.sale_price,
        valid_days: cv ? cv.valid_days : null,
        start_date: cv ? cv.start_date : null,
        expire_at: cv ? cv.expire_at : null,
        redeemed_at: item.recharged_at,
      }
    })

    return ok({
      list: mapped,
      total: Number(total || 0),
      page,
      limit,
    })
  })
}
