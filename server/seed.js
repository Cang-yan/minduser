'use strict'

const bcrypt = require('bcryptjs')
const config = require('./config')
const { db } = require('./db')
const { generateShortUid } = require('./service')

function createUniqueUserId() {
  for (let i = 0; i < 12; i += 1) {
    const id = generateShortUid(10)
    const exists = db.prepare('SELECT id FROM users WHERE id = ?').get(id)
    if (!exists) return id
  }
  throw new Error('Seed admin UID generation failed')
}

async function seedAdminUsers(logger) {
  for (const serviceKey of config.services) {
    const seed = config.adminSeed[serviceKey]
    if (!seed || !seed.username || !seed.password) continue

    const existing = db.prepare('SELECT id FROM users WHERE service_key = ? AND username = ?').get(serviceKey, seed.username)
    if (existing) continue

    const id = createUniqueUserId()
    const hash = await bcrypt.hash(seed.password, 10)
    db.prepare(`
      INSERT INTO users (id, service_key, username, password_hash, role, credits_balance)
      VALUES (?, ?, ?, ?, 'admin', 0)
    `).run(id, serviceKey, seed.username, hash)

    if (logger) {
      logger.info(`Seeded admin for ${serviceKey}: ${seed.username}`)
    }
  }
}

module.exports = { seedAdminUsers }
