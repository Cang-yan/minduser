'use strict'

const bcrypt = require('bcryptjs')
const { randomUUID, randomInt, createHmac } = require('node:crypto')
const config = require('../config')
const { db, ok, fail } = require('../db')
const {
  sanitizeUsername,
  sanitizePassword,
  sanitizeEmail,
  sanitizeEmailCode,
  generateShortUid,
} = require('../service')
const { sendRegisterVerifyCode } = require('../email')
const {
  resolveServiceOrReply,
  ensureTokenMatchesService,
} = require('./_helpers')

const CODE_PURPOSE_REGISTER = 'register'

function authPayload(user, token) {
  const userInfo = {
    id: user.id,
    uid: user.id,
    username: user.username,
    email: user.email || '',
    role: user.role,
    service_key: user.service_key,
    credits: Number(user.credits_balance || 0),
  }
  return {
    token,
    user: userInfo,
    user_info: userInfo,
  }
}

function createUniqueUserId() {
  for (let i = 0; i < 12; i += 1) {
    const id = generateShortUid(10)
    const exists = db.prepare('SELECT id FROM users WHERE id = ?').get(id)
    if (!exists) return id
  }
  throw new Error('UID 生成失败，请重试')
}

function createHttpError(message, statusCode = 400) {
  const error = new Error(message)
  error.statusCode = statusCode
  return error
}

function generateVerifyCode() {
  return String(randomInt(0, 1000000)).padStart(6, '0')
}

function hashVerifyCode(email, code) {
  return createHmac('sha256', config.email.verifyCodeSecret)
    .update(`${email}#${code}`)
    .digest('hex')
}

function getLatestRegisterCode(serviceKey, email) {
  return db.prepare(`
    SELECT id, code_hash, expires_at, created_at
    FROM email_verification_codes
    WHERE service_key = ? AND email = ? AND purpose = ? AND used_at IS NULL
    ORDER BY created_at DESC
    LIMIT 1
  `).get(serviceKey, email, CODE_PURPOSE_REGISTER)
}

function secondsBetweenNow(iso) {
  const at = Date.parse(String(iso || ''))
  if (!Number.isFinite(at)) return 0
  return Math.floor((Date.now() - at) / 1000)
}

module.exports = async function authRoutes(fastify) {
  fastify.post('/:service/auth/send-register-code', async (req, reply) => {
    const serviceKey = resolveServiceOrReply(req, reply)
    if (!serviceKey) return

    const email = sanitizeEmail(req.body?.email)
    if (!email) {
      return reply.code(400).send(fail('邮箱格式不正确'))
    }

    const existingByEmail = db.prepare(
      'SELECT id FROM users WHERE service_key = ? AND email = ?'
    ).get(serviceKey, email)
    if (existingByEmail) {
      return reply.code(400).send(fail('该邮箱已被注册'))
    }

    const latest = getLatestRegisterCode(serviceKey, email)
    if (latest) {
      const elapsed = secondsBetweenNow(latest.created_at)
      const waitSeconds = config.email.verifyCodeResendSeconds - elapsed
      if (waitSeconds > 0) {
        return reply
          .code(429)
          .send(fail(`发送过于频繁，请 ${waitSeconds} 秒后重试`, 429))
      }
    }

    const code = generateVerifyCode()
    const now = new Date().toISOString()
    const expiresAt = new Date(Date.now() + config.email.verifyCodeTtlSeconds * 1000).toISOString()
    const codeHash = hashVerifyCode(email, code)

    try {
      await sendRegisterVerifyCode(serviceKey, email, code)
    } catch (error) {
      req.log.error({ err: error, email, serviceKey }, 'Send email verify code failed')
      const message = error && error.message ? error.message : '验证码发送失败，请稍后重试'
      const statusCode =
        message.includes('未启用') || message.includes('配置不完整')
          ? 400
          : 500
      return reply.code(statusCode).send(fail(message, statusCode))
    }

    db.prepare(`
      INSERT INTO email_verification_codes (id, service_key, email, purpose, code_hash, expires_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(randomUUID(), serviceKey, email, CODE_PURPOSE_REGISTER, codeHash, expiresAt, now)

    return ok({
      email,
      expires_in_seconds: config.email.verifyCodeTtlSeconds,
      retry_after_seconds: config.email.verifyCodeResendSeconds,
    }, '验证码已发送，请查收邮箱')
  })

  fastify.post('/:service/auth/register', async (req, reply) => {
    const serviceKey = resolveServiceOrReply(req, reply)
    if (!serviceKey) return

    const username = sanitizeUsername(req.body?.username)
    const password = sanitizePassword(req.body?.password)
    const email = sanitizeEmail(req.body?.email)
    const emailCode = sanitizeEmailCode(req.body?.emailCode)

    if (!username || !password) {
      return reply.code(400).send(fail('用户名或密码不合法（用户名3-32位，密码6-64位）'))
    }
    if (!email) {
      return reply.code(400).send(fail('邮箱格式不正确'))
    }
    if (!emailCode) {
      return reply.code(400).send(fail('邮箱验证码格式不正确，应为6位数字'))
    }

    const passwordHash = await bcrypt.hash(password, 10)
    const now = new Date().toISOString()

    try {
      const user = db.transaction(() => {
        const existingByUsername = db.prepare(
          'SELECT id FROM users WHERE service_key = ? AND username = ?'
        ).get(serviceKey, username)
        if (existingByUsername) {
          throw createHttpError('该用户名已被注册')
        }

        const existingByEmail = db.prepare(
          'SELECT id FROM users WHERE service_key = ? AND email = ?'
        ).get(serviceKey, email)
        if (existingByEmail) {
          throw createHttpError('该邮箱已被注册')
        }

        const latestCode = getLatestRegisterCode(serviceKey, email)
        if (!latestCode) {
          throw createHttpError('请先获取邮箱验证码')
        }

        const expiresAtMs = Date.parse(String(latestCode.expires_at || ''))
        if (!Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now()) {
          throw createHttpError('邮箱验证码已过期，请重新获取')
        }

        const expectedHash = hashVerifyCode(email, emailCode)
        if (expectedHash !== latestCode.code_hash) {
          throw createHttpError('邮箱验证码错误')
        }

        const id = createUniqueUserId()
        db.prepare(`
          INSERT INTO users (
            id, service_key, username, email, email_verified_at,
            password_hash, role, credits_balance, created_at, updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, 'user', 0, ?, ?)
        `).run(id, serviceKey, username, email, now, passwordHash, now, now)

        db.prepare(`
          UPDATE email_verification_codes
          SET used_at = ?
          WHERE service_key = ? AND email = ? AND purpose = ? AND used_at IS NULL
        `).run(now, serviceKey, email, CODE_PURPOSE_REGISTER)

        return {
          id,
          uid: id,
          username,
          email,
          role: 'user',
          service_key: serviceKey,
          credits_balance: 0,
        }
      })()

      const token = fastify.jwt.sign({
        id: user.id,
        uid: user.id,
        username: user.username,
        email: user.email,
        role: 'user',
        service_key: serviceKey,
      })

      return ok(authPayload(user, token), '注册成功')
    } catch (error) {
      if (error && error.statusCode) {
        return reply.code(error.statusCode).send(fail(error.message, error.statusCode))
      }
      req.log.error({ err: error }, 'Register failed')
      return reply.code(500).send(fail('注册失败，请稍后重试', 500))
    }
  })

  fastify.post('/:service/auth/login', async (req, reply) => {
    const serviceKey = resolveServiceOrReply(req, reply)
    if (!serviceKey) return

    const rawAccount = String(
      req.body?.account ?? req.body?.username ?? req.body?.email ?? ''
    ).trim()
    const password = sanitizePassword(req.body?.password)
    const username = sanitizeUsername(rawAccount)
    const email = sanitizeEmail(rawAccount)

    if ((!username && !email) || !password) {
      return reply.code(400).send(fail('账号或密码不合法'))
    }

    let user = null
    if (email) {
      user = db.prepare(
        'SELECT * FROM users WHERE service_key = ? AND email = ?'
      ).get(serviceKey, email)
    } else {
      user = db.prepare(
        'SELECT * FROM users WHERE service_key = ? AND username = ?'
      ).get(serviceKey, username)
    }

    if (!user) {
      return reply.code(401).send(fail('账号或密码错误', 401))
    }

    const valid = await bcrypt.compare(password, user.password_hash || '')
    if (!valid) {
      return reply.code(401).send(fail('账号或密码错误', 401))
    }

    const token = fastify.jwt.sign({
      id: user.id,
      uid: user.id,
      username: user.username,
      email: user.email || '',
      role: user.role,
      service_key: serviceKey,
    })

    return ok(authPayload(user, token), '登录成功')
  })

  fastify.post('/:service/auth/admin-login', async (req, reply) => {
    const serviceKey = resolveServiceOrReply(req, reply)
    if (!serviceKey) return

    const username = sanitizeUsername(req.body?.username)
    const password = sanitizePassword(req.body?.password)

    if (!username || !password) {
      return reply.code(400).send(fail('用户名或密码不合法'))
    }

    const user = db.prepare(
      "SELECT * FROM users WHERE service_key = ? AND username = ? AND role = 'admin'"
    ).get(serviceKey, username)

    if (!user) {
      return reply.code(401).send(fail('管理员用户名或密码错误', 401))
    }

    const valid = await bcrypt.compare(password, user.password_hash || '')
    if (!valid) {
      return reply.code(401).send(fail('管理员用户名或密码错误', 401))
    }

    const token = fastify.jwt.sign({
      id: user.id,
      uid: user.id,
      username: user.username,
      email: user.email || '',
      role: user.role,
      service_key: serviceKey,
    })

    return ok(authPayload(user, token), '管理员登录成功')
  })

  fastify.get('/:service/auth/me', { preHandler: [fastify.authenticate] }, async (req, reply) => {
    const serviceKey = resolveServiceOrReply(req, reply)
    if (!serviceKey) return
    if (!ensureTokenMatchesService(req, reply, serviceKey)) return

    const user = db.prepare(`
      SELECT id, service_key, username, email, role, credits_balance, created_at, updated_at
      FROM users
      WHERE id = ? AND service_key = ?
    `).get(req.user.id, serviceKey)

    if (!user) {
      return reply.code(404).send(fail('用户不存在', 404))
    }

    return ok({
      id: user.id,
      uid: user.id,
      username: user.username,
      email: user.email || '',
      role: user.role,
      service_key: user.service_key,
      credits: Number(user.credits_balance || 0),
      created_at: user.created_at,
      updated_at: user.updated_at,
    })
  })
}
