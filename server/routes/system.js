'use strict'

const config = require('../config')
const { toIsoNow } = require('../service')

module.exports = async function systemRoutes(fastify) {
  fastify.get('/health', async () => ({
    status: 'ok',
    services: config.services,
    time: toIsoNow(),
  }))

  fastify.get('/api/services', async () => ({
    code: 200,
    data: config.services,
    message: 'success',
  }))
}
