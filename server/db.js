'use strict'

const { DatabaseSync } = require('node:sqlite')
const path = require('path')
const fs = require('fs')
const config = require('./config')

const dbFile = path.resolve(config.dbPath)
const dbDir = path.dirname(dbFile)
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true })

const sqlite = new DatabaseSync(dbFile)

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
    password_hash     TEXT NOT NULL,
    role              TEXT NOT NULL DEFAULT 'user',
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

  CREATE INDEX IF NOT EXISTS idx_users_service ON users(service_key);
  CREATE INDEX IF NOT EXISTS idx_wallet_user ON wallet_transactions(service_key, user_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_user_recharge_user ON user_recharge_records(service_key, user_id, recharged_at DESC);
  CREATE INDEX IF NOT EXISTS idx_admin_recharge_service ON admin_recharge_records(service_key, recharged_at DESC);
`)

const db = {
  prepare(sql) {
    const stmt = sqlite.prepare(sql)
    return {
      run(...args) {
        return stmt.run(...spreadArgs(args))
      },
      get(...args) {
        return stmt.get(...spreadArgs(args)) ?? null
      },
      all(...args) {
        return stmt.all(...spreadArgs(args))
      },
    }
  },
  exec(sql) {
    return sqlite.exec(sql)
  },
  transaction(fn) {
    return (...args) => {
      sqlite.exec('BEGIN')
      try {
        const result = fn(...args)
        sqlite.exec('COMMIT')
        return result
      } catch (error) {
        sqlite.exec('ROLLBACK')
        throw error
      }
    }
  },
}

function spreadArgs(args) {
  if (args.length === 1 && Array.isArray(args[0])) return args[0]
  return args
}

const ok = (data, message = 'success') => ({ code: 200, data, message })
const fail = (message, code = 400) => ({ code, data: null, message })

module.exports = { db, ok, fail }
