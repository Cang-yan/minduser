'use strict'

const config = require('../config')
const { ok, fail } = require('../db')
const { normalizeRechargePayload, rechargeWithPayload } = require('../recharge-core')
const { resolveServiceOrReply } = require('./_helpers')

module.exports = async function rechargeRoutes(fastify) {
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
      const data = rechargeWithPayload(serviceKey, payload)
      return ok(data, '充值成功')
    } catch (error) {
      const statusCode = Number(error.statusCode || 500)
      return reply.code(statusCode).send(fail(error.message || '充值失败', statusCode))
    }
  }

  fastify.post('/:service/open/recharge-card', rechargeHandler)
  fastify.post('/:service/open/recharge', rechargeHandler)
}
