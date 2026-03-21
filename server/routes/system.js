'use strict'

const config = require('../config')

module.exports = async function systemRoutes(fastify) {
  fastify.get('/health', async () => ({
    status: 'ok',
    services: config.services,
    time: new Date().toISOString(),
  }))

  fastify.get('/api/services', async () => ({
    code: 200,
    data: config.services,
    message: 'success',
  }))
}
