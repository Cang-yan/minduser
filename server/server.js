'use strict'

require('dotenv').config()
const path = require('path')
const fs = require('fs')
const Fastify = require('fastify')
const config = require('./config')
const { fail } = require('./db')
const { normalizeServiceKey } = require('./service')
const { seedAdminUsers } = require('./seed')

const publicDir = path.resolve(__dirname, 'public')
const hasPinoPretty = (() => {
  try {
    require.resolve('pino-pretty')
    return true
  } catch {
    return false
  }
})()

const fastify = Fastify({
  logger: {
    level: process.env.LOG_LEVEL || 'info',
    transport:
      process.env.NODE_ENV !== 'production' && hasPinoPretty
        ? { target: 'pino-pretty', options: { colorize: true } }
        : undefined,
  },
  trustProxy: true,
  bodyLimit: 2 * 1024 * 1024,
})

fastify.register(require('@fastify/cors'), {
  origin: config.corsOrigin === '*' ? true : config.corsOrigin.split(',').map((s) => s.trim()),
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
})

fastify.register(require('@fastify/jwt'), {
  secret: config.jwtSecret,
  sign: { expiresIn: config.jwtExpiry },
})

fastify.register(require('@fastify/static'), {
  root: publicDir,
  prefix: '/static/',
})

fastify.decorate('authenticate', async (req, reply) => {
  try {
    await req.jwtVerify()
  } catch {
    reply.code(401).send(fail('未登录或 token 已过期', 401))
  }
})

const htmlCache = new Map()

function loadHtml(fileName) {
  if (htmlCache.has(fileName)) return htmlCache.get(fileName)
  const filePath = path.join(publicDir, fileName)
  const html = fs.readFileSync(filePath, 'utf8')
  htmlCache.set(fileName, html)
  return html
}

function sendHtml(reply, fileName) {
  reply.type('text/html; charset=utf-8').send(loadHtml(fileName))
}

function buildRuntimeConfigScript() {
  const payload = {
    featureHomeMap: config.featureHome || {},
    enabledServices: config.services || [],
  }
  return `window.__MINDUSER_RUNTIME__ = ${JSON.stringify(payload)};\n`
}

function ensureServiceOr404(req, reply) {
  const serviceKey = normalizeServiceKey(req.params.service)
  if (!serviceKey) {
    const supported = (config.services || []).join(' / ') || 'mindplus'
    reply.code(404).send(fail(`服务不存在，仅支持 ${supported}`, 404))
    return null
  }
  return serviceKey
}

fastify.get('/', async (req, reply) => {
  reply.redirect('/mindplus/login')
})

fastify.get('/:service', async (req, reply) => {
  const serviceKey = ensureServiceOr404(req, reply)
  if (!serviceKey) return
  reply.redirect(`/${serviceKey}/login`)
})

fastify.get('/:service/login', async (req, reply) => {
  const serviceKey = ensureServiceOr404(req, reply)
  if (!serviceKey) return
  sendHtml(reply, 'login.html')
})

fastify.get('/:service/app', async (req, reply) => {
  const serviceKey = ensureServiceOr404(req, reply)
  if (!serviceKey) return
  sendHtml(reply, 'app.html')
})

fastify.get('/:service/cdkey', async (req, reply) => {
  const serviceKey = ensureServiceOr404(req, reply)
  if (!serviceKey) return
  sendHtml(reply, 'cdkey.html')
})

fastify.get('/:service/credits', async (req, reply) => {
  const serviceKey = ensureServiceOr404(req, reply)
  if (!serviceKey) return
  sendHtml(reply, 'cdkey.html')
})

fastify.get('/adminadmin/:service/login', async (req, reply) => {
  const serviceKey = ensureServiceOr404(req, reply)
  if (!serviceKey) return
  sendHtml(reply, 'admin-login.html')
})

fastify.get('/adminadmin/:service', async (req, reply) => {
  const serviceKey = ensureServiceOr404(req, reply)
  if (!serviceKey) return
  sendHtml(reply, 'admin.html')
})

fastify.get('/api/runtime-config.js', async (req, reply) => {
  reply
    .type('application/javascript; charset=utf-8')
    .header('Cache-Control', 'no-store')
    .send(buildRuntimeConfigScript())
})

fastify.register(require('./routes/system'))
fastify.register(require('./routes/auth'), { prefix: '/api' })
fastify.register(require('./routes/wallet'), { prefix: '/api' })
fastify.register(require('./routes/recharge'), { prefix: '/api' })
fastify.register(require('./routes/consume'), { prefix: '/api' })
fastify.register(require('./routes/credits'), { prefix: '/api' })
fastify.register(require('./routes/admin'), { prefix: '/api' })

fastify.setErrorHandler((err, req, reply) => {
  fastify.log.error({ err, url: req.url }, 'Unhandled error')
  if (err.validation) {
    return reply.code(400).send(fail(err.message, 400))
  }
  const statusCode = err.statusCode || 500
  reply.code(statusCode).send(fail(err.message || '服务器内部错误', statusCode))
})

fastify.setNotFoundHandler((req, reply) => {
  if (req.url.startsWith('/api/') || req.url === '/health') {
    return reply.code(404).send(fail(`接口不存在: ${req.method} ${req.url}`, 404))
  }
  return reply.redirect('/mindplus/login')
})

async function start() {
  await seedAdminUsers(fastify.log)
  await fastify.listen({ port: config.port, host: config.host })
  fastify.log.info(`MindUser server running at http://${config.host}:${config.port}`)
}

start().catch((error) => {
  fastify.log.error(error)
  process.exit(1)
})

let isShuttingDown = false

async function shutdown(reason, exitCode = 0) {
  if (isShuttingDown) return
  isShuttingDown = true
  try {
    await fastify.close()
  } catch (err) {
    fastify.log.error({ err, reason }, 'Failed to close Fastify during shutdown')
    if (exitCode === 0) exitCode = 1
  }
  process.exit(exitCode)
}

process.once('SIGTERM', () => {
  shutdown('SIGTERM')
})

process.once('SIGINT', () => {
  shutdown('SIGINT')
})

// When started via `node --watch`, the app process is a child process.
// If user Ctrl-C exits the watcher parent first, this handler ensures child exits too.
if (typeof process.send === 'function') {
  process.once('disconnect', () => {
    shutdown('parent-disconnect')
  })
}

// Fallback: in dev watch mode, exit if process becomes orphaned.
if (process.env.MINDUSER_DEV_WATCH === '1') {
  const orphanGuard = setInterval(() => {
    if (process.ppid === 1) {
      shutdown('orphan-guard')
    }
  }, 2000)
  orphanGuard.unref()
}
