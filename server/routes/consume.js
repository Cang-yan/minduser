'use strict'

const config = require('../config')
const { ok, fail } = require('../db')
const { normalizeConsumePayload, consumeWithPayload } = require('../consume-core')
const { resolveServiceOrReply } = require('./_helpers')

module.exports = async function consumeRoutes(fastify) {
  async function consumeHandler(req, reply) {
    const serviceKey = resolveServiceOrReply(req, reply)
    if (!serviceKey) return

    if (config.internalRechargeKey) {
      const incoming = String(req.headers['x-internal-key'] || '')
      if (incoming !== config.internalRechargeKey) {
        return reply.code(401).send(fail('无效的内部调用凭证', 401))
      }
    }

    const payload = normalizeConsumePayload(req.body || {})
    if (!payload.uid) {
      return reply.code(400).send(fail('uid 不能为空'))
    }
    if (!payload.amount) {
      return reply.code(400).send(fail('consume amount 不能为空，且必须为正数'))
    }

    try {
      const data = consumeWithPayload(serviceKey, payload)
      return ok(data, '扣减成功')
    } catch (error) {
      const statusCode = Number(error.statusCode || 500)
      return reply.code(statusCode).send(fail(error.message || '扣减失败', statusCode))
    }
  }

  fastify.post('/:service/open/consume', consumeHandler)
  fastify.post('/:service/open/deduct', consumeHandler)
}
