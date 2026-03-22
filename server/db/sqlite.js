'use strict'

const fs = require('fs')
const path = require('path')
const { AsyncLocalStorage } = require('node:async_hooks')
const { DatabaseSync } = require('node:sqlite')
const config = require('../config')

const txStorage = new AsyncLocalStorage()

const runtime = {
  sqlite: null,
  adapter: null,
}

const readyPromise = initialize()

function initialize() {
  const dbFile = path.resolve(config.dbPath)
  const dbDir = path.dirname(dbFile)
  if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true })

  const sqlite = new DatabaseSync(dbFile)
  runtime.sqlite = sqlite

  sqlite.exec('PRAGMA journal_mode = WAL')
  sqlite.exec('PRAGMA foreign_keys = ON')
  sqlite.exec('PRAGMA synchronous = NORMAL')
  sqlite.exec('PRAGMA cache_size = -32000')
  sqlite.exec('PRAGMA temp_store = MEMORY')

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id                TEXT PRIMARY KEY,
      service_key       TEXT NOT NULL,
      username          TEXT NOT NULL,
      email             TEXT,
      email_verified_at TEXT,
      password_hash     TEXT NOT NULL,
      role              TEXT NOT NULL DEFAULT 'user',
      account_status    TEXT NOT NULL DEFAULT 'active',
      disabled_at       TEXT,
      credits_balance   REAL NOT NULL DEFAULT 0,
      created_at        TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at        TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(service_key, username)
    );

    CREATE TABLE IF NOT EXISTS wallet_transactions (
      id                TEXT PRIMARY KEY,
      service_key       TEXT NOT NULL,
      user_id           TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      change_amount     REAL NOT NULL,
      balance_after     REAL NOT NULL,
      reason            TEXT NOT NULL,
      source_ref        TEXT,
      meta_json         TEXT,
      created_at        TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS user_recharge_records (
      id                TEXT PRIMARY KEY,
      service_key       TEXT NOT NULL,
      user_id           TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      card_code         TEXT NOT NULL,
      face_value        TEXT NOT NULL,
      recharge_amount   REAL NOT NULL,
      recharged_at      TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS admin_recharge_records (
      id                TEXT PRIMARY KEY,
      service_key       TEXT NOT NULL,
      user_id           TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      username          TEXT NOT NULL,
      card_code         TEXT NOT NULL,
      face_value        TEXT NOT NULL,
      sale_price        TEXT,
      valid_period      TEXT,
      batch_no          TEXT,
      recharge_amount   REAL NOT NULL,
      recharged_at      TEXT NOT NULL,
      payload_json      TEXT,
      created_at        TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(service_key, card_code)
    );

    CREATE TABLE IF NOT EXISTS email_verification_codes (
      id                TEXT PRIMARY KEY,
      service_key       TEXT NOT NULL,
      email             TEXT NOT NULL,
      purpose           TEXT NOT NULL,
      code_hash         TEXT NOT NULL,
      expires_at        TEXT NOT NULL,
      used_at           TEXT,
      created_at        TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_users_service ON users(service_key);
    CREATE INDEX IF NOT EXISTS idx_users_service_status ON users(service_key, account_status);
    CREATE INDEX IF NOT EXISTS idx_wallet_user ON wallet_transactions(service_key, user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_user_recharge_user ON user_recharge_records(service_key, user_id, recharged_at DESC);
    CREATE INDEX IF NOT EXISTS idx_admin_recharge_service ON admin_recharge_records(service_key, recharged_at DESC);
    CREATE INDEX IF NOT EXISTS idx_email_codes_lookup
      ON email_verification_codes(service_key, email, purpose, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_email_codes_expire
      ON email_verification_codes(expires_at);
  `)

  ensureUsersColumns(sqlite)
  sqlite.exec('CREATE UNIQUE INDEX IF NOT EXISTS uq_users_service_email ON users(service_key, email) WHERE email IS NOT NULL')

  runtime.adapter = createSqliteAdapter(sqlite)
}

function ensureUsersColumns(sqlite) {
  const rows = sqlite.prepare('PRAGMA table_info(users)').all()
  const columns = new Set(rows.map((item) => item.name))

  if (!columns.has('email')) {
    sqlite.exec('ALTER TABLE users ADD COLUMN email TEXT')
  }
  if (!columns.has('email_verified_at')) {
    sqlite.exec('ALTER TABLE users ADD COLUMN email_verified_at TEXT')
  }
  if (!columns.has('account_status')) {
    sqlite.exec("ALTER TABLE users ADD COLUMN account_status TEXT NOT NULL DEFAULT 'active'")
  }
  if (!columns.has('disabled_at')) {
    sqlite.exec('ALTER TABLE users ADD COLUMN disabled_at TEXT')
  }
  sqlite.exec("UPDATE users SET account_status = 'active' WHERE account_status IS NULL OR account_status = ''")
}

function normalizeParams(args) {
  if (args.length === 1 && Array.isArray(args[0])) return args[0]
  return args
}

function currentAdapter() {
  const tx = txStorage.getStore()
  return (tx && tx.adapter) || runtime.adapter
}

function createSqliteAdapter(sqlite) {
  return {
    async run(sql, params = []) {
      const stmt = sqlite.prepare(sql)
      return stmt.run(...params)
    },
    async get(sql, params = []) {
      const stmt = sqlite.prepare(sql)
      return stmt.get(...params) ?? null
    },
    async all(sql, params = []) {
      const stmt = sqlite.prepare(sql)
      return stmt.all(...params)
    },
    async exec(sql) {
      return sqlite.exec(sql)
    },
  }
}

const db = {
  prepare(sql) {
    return {
      async run(...args) {
        await readyPromise
        return currentAdapter().run(sql, normalizeParams(args))
      },
      async get(...args) {
        await readyPromise
        return currentAdapter().get(sql, normalizeParams(args))
      },
      async all(...args) {
        await readyPromise
        return currentAdapter().all(sql, normalizeParams(args))
      },
    }
  },
  async exec(sql) {
    await readyPromise
    return currentAdapter().exec(sql)
  },
  transaction(fn) {
    return async (...args) => {
      await readyPromise

      const parentTx = txStorage.getStore()
      if (parentTx) {
        return fn(...args)
      }

      const adapter = runtime.adapter
      await adapter.exec('BEGIN')
      try {
        const result = await txStorage.run({ adapter }, async () => fn(...args))
        await adapter.exec('COMMIT')
        return result
      } catch (error) {
        try {
          await adapter.exec('ROLLBACK')
        } catch {
          // ignore rollback error
        }
        throw error
      }
    }
  },
  async ready() {
    await readyPromise
    return { mode: 'sqlite' }
  },
}

const ok = (data, message = 'success') => ({ code: 200, data, message })
const fail = (message, code = 400) => ({ code, data: null, message })

module.exports = { db, ok, fail }
