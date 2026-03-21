'use strict'

const bcrypt = require('bcryptjs')
const { db, ok, fail } = require('../db')
const { sanitizeUsername, sanitizePassword, generateShortUid } = require('../service')
const {
  resolveServiceOrReply,
  ensureTokenMatchesService,
} = require('./_helpers')

function authPayload(user, token) {
  const userInfo = {
    id: user.id,
    uid: user.id,
    username: user.username,
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

module.exports = async function authRoutes(fastify) {
  fastify.post('/:service/auth/register', async (req, reply) => {
    const serviceKey = resolveServiceOrReply(req, reply)
    if (!serviceKey) return

    const username = sanitizeUsername(req.body?.username)
    const password = sanitizePassword(req.body?.password)

    if (!username || !password) {
      return reply.code(400).send(fail('用户名或密码不合法（用户名3-32位，密码6-64位）'))
    }

    const existing = db.prepare(
      'SELECT id FROM users WHERE service_key = ? AND username = ?'
    ).get(serviceKey, username)

    if (existing) {
      return reply.code(400).send(fail('该用户名已被注册'))
    }

    const id = createUniqueUserId()
    const passwordHash = await bcrypt.hash(password, 10)
    const now = new Date().toISOString()

    db.prepare(`
      INSERT INTO users (id, service_key, username, password_hash, role, credits_balance, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'user', 0, ?, ?)
    `).run(id, serviceKey, username, passwordHash, now, now)

    const token = fastify.jwt.sign({
      id,
      uid: id,
      username,
      role: 'user',
      service_key: serviceKey,
    })

    return ok(
      authPayload({ id, username, role: 'user', service_key: serviceKey, credits_balance: 0 }, token),
      '注册成功'
    )
  })

  fastify.post('/:service/auth/login', async (req, reply) => {
    const serviceKey = resolveServiceOrReply(req, reply)
    if (!serviceKey) return

    const username = sanitizeUsername(req.body?.username)
    const password = sanitizePassword(req.body?.password)

    if (!username || !password) {
      return reply.code(400).send(fail('用户名或密码不合法'))
    }

    const user = db.prepare(
      'SELECT * FROM users WHERE service_key = ? AND username = ?'
    ).get(serviceKey, username)

    if (!user) {
      return reply.code(401).send(fail('用户名或密码错误', 401))
    }

    const valid = await bcrypt.compare(password, user.password_hash || '')
    if (!valid) {
      return reply.code(401).send(fail('用户名或密码错误', 401))
    }

    const token = fastify.jwt.sign({
      id: user.id,
      uid: user.id,
      username: user.username,
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
      SELECT id, service_key, username, role, credits_balance, created_at, updated_at
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
      role: user.role,
      service_key: user.service_key,
      credits: Number(user.credits_balance || 0),
      created_at: user.created_at,
      updated_at: user.updated_at,
    })
  })
}
