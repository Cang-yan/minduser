'use strict'

const bcrypt = require('bcryptjs')
const { randomUUID } = require('node:crypto')
const { db, ok, fail } = require('../db')
const {
  sanitizeUsername,
  sanitizePassword,
  sanitizeEmail,
  generateShortUid,
  toIsoNow,
} = require('../service')
const {
  resolveServiceOrReply,
  ensureTokenMatchesService,
} = require('./_helpers')

const REGISTER_GIFT_CREDITS = 50
const REGISTER_GIFT_LABEL = '新用户注册'
const REGISTER_GIFT_BATCH_NO = 'REGISTER_BONUS'

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

async function createUniqueUserId() {
  for (let i = 0; i < 12; i += 1) {
    const id = generateShortUid(10)
    const exists = await db.prepare('SELECT id FROM users WHERE id = ?').get(id)
    if (!exists) return id
  }
  throw new Error('UID 生成失败，请重试')
}

function createHttpError(message, statusCode = 400) {
  const error = new Error(message)
  error.statusCode = statusCode
  return error
}

function isMysqlDuplicateError(error) {
  return Boolean(
    error &&
    (error.code === 'ER_DUP_ENTRY' || Number(error.errno) === 1062)
  )
}

function mapRegisterDbError(error) {
  if (!isMysqlDuplicateError(error)) return null
  const raw = String(error.sqlMessage || error.message || '')
  if (raw.includes('uq_users_service_email')) {
    return createHttpError('该邮箱已被注册')
  }
  if (raw.includes('uq_users_service_username')) {
    return createHttpError('该用户名已被注册')
  }
  return createHttpError('该用户名或邮箱已被注册')
}

function isUserDisabled(user) {
  return String(user?.account_status || 'active') === 'disabled'
}

module.exports = async function authRoutes(fastify) {
  fastify.post('/:service/auth/send-register-code', async (req, reply) => {
    const serviceKey = resolveServiceOrReply(req, reply)
    if (!serviceKey) return

    return reply.code(410).send(fail('当前已切换为邮箱直注册，不再发送验证码', 410))
  })

  fastify.post('/:service/auth/register', async (req, reply) => {
    const serviceKey = resolveServiceOrReply(req, reply)
    if (!serviceKey) return

    const username = sanitizeUsername(req.body?.username)
    const password = sanitizePassword(req.body?.password)
    const email = sanitizeEmail(req.body?.email)

    if (!username || !password) {
      return reply.code(400).send(fail('用户名或密码不合法（用户名3-32位，密码6-64位）'))
    }
    if (!email) {
      return reply.code(400).send(fail('邮箱格式不正确'))
    }

    const now = toIsoNow()
    const passwordHash = await bcrypt.hash(password, 10)

    try {
      const user = await db.transaction(async () => {
        const existingByUsername = await db.prepare(
          'SELECT id FROM users WHERE service_key = ? AND username = ?'
        ).get(serviceKey, username)
        if (existingByUsername) {
          throw createHttpError('该用户名已被注册')
        }

        const existingByEmail = await db.prepare(
          'SELECT id FROM users WHERE service_key = ? AND email = ?'
        ).get(serviceKey, email)
        if (existingByEmail) {
          throw createHttpError('该邮箱已被注册')
        }

        const id = await createUniqueUserId()
        await db.prepare(`
          INSERT INTO users (
            id, service_key, username, email,
            password_hash, role, credits_balance, created_at, updated_at
          )
          VALUES (?, ?, ?, ?, ?, 'user', ?, ?, ?)
        `).run(
          id,
          serviceKey,
          username,
          email,
          passwordHash,
          REGISTER_GIFT_CREDITS,
          now,
          now
        )

        // 注册赠送 50 credits：写钱包流水
        await db.prepare(`
          INSERT INTO wallet_transactions (
            id, service_key, user_id, change_amount, balance_after, reason, source_ref, meta_json, created_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          randomUUID(),
          serviceKey,
          id,
          REGISTER_GIFT_CREDITS,
          REGISTER_GIFT_CREDITS,
          'register_bonus',
          REGISTER_GIFT_LABEL,
          JSON.stringify({
            source: 'register_bonus',
            note: REGISTER_GIFT_LABEL,
            credits: REGISTER_GIFT_CREDITS,
          }),
          now
        )

        // 用户侧充值记录：展示“新用户注册”
        await db.prepare(`
          INSERT INTO user_recharge_records (
            id, service_key, user_id, card_code, face_value, recharge_amount, recharged_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(
          randomUUID(),
          serviceKey,
          id,
          REGISTER_GIFT_LABEL,
          REGISTER_GIFT_LABEL,
          REGISTER_GIFT_CREDITS,
          now
        )

        // 后台全量充值记录：卡密字段需唯一，附加 UID 防止唯一索引冲突
        await db.prepare(`
          INSERT INTO admin_recharge_records (
            id, service_key, user_id, username, card_code, face_value, sale_price, valid_period, batch_no,
            recharge_amount, recharged_at, payload_json, created_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          randomUUID(),
          serviceKey,
          id,
          username,
          `${REGISTER_GIFT_LABEL}#${id}`,
          REGISTER_GIFT_LABEL,
          '0',
          '',
          REGISTER_GIFT_BATCH_NO,
          REGISTER_GIFT_CREDITS,
          now,
          JSON.stringify({
            source: 'register_bonus',
            note: REGISTER_GIFT_LABEL,
            credits: REGISTER_GIFT_CREDITS,
            uid: id,
          }),
          now
        )

        return {
          id,
          uid: id,
          username,
          email,
          role: 'user',
          service_key: serviceKey,
          credits_balance: REGISTER_GIFT_CREDITS,
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
      const mappedError = mapRegisterDbError(error)
      if (mappedError) {
        return reply.code(mappedError.statusCode).send(fail(mappedError.message, mappedError.statusCode))
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
      user = await db.prepare(
        'SELECT * FROM users WHERE service_key = ? AND email = ?'
      ).get(serviceKey, email)
    } else {
      user = await db.prepare(
        'SELECT * FROM users WHERE service_key = ? AND username = ?'
      ).get(serviceKey, username)
    }

    if (!user) {
      return reply.code(401).send(fail('用户未注册，请先注册', 401))
    }

    if (isUserDisabled(user)) {
      return reply.code(403).send(fail('账号已停用，请联系管理员', 403))
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

    const user = await db.prepare(
      "SELECT * FROM users WHERE service_key = ? AND username = ? AND role = 'admin'"
    ).get(serviceKey, username)

    if (!user) {
      return reply.code(401).send(fail('管理员用户名或密码错误', 401))
    }

    if (isUserDisabled(user)) {
      return reply.code(403).send(fail('账号已停用，请联系管理员', 403))
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

    const user = await db.prepare(`
      SELECT id, service_key, username, email, role, credits_balance, created_at, updated_at
      FROM users
      WHERE id = ? AND service_key = ?
    `).get(req.user.id, serviceKey)

    if (!user) {
      return reply.code(404).send(fail('用户未注册，请先注册', 404))
    }

    if (isUserDisabled(user)) {
      return reply.code(403).send(fail('账号已停用，请联系管理员', 403))
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
