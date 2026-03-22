'use strict'

const { AsyncLocalStorage } = require('node:async_hooks')
const config = require('../config')

const txStorage = new AsyncLocalStorage()

const runtime = {
  adapter: null,
  pool: null,
}

const readyPromise = initialize()

async function initialize() {
  const mysql = getMysqlPromise()
  if (!mysql) {
    throw new Error('当前配置使用 MySQL，但未安装 mysql2 依赖，请先执行 npm install')
  }
  if (!config.databaseUrl) {
    throw new Error('当前配置使用 MySQL，但 DATABASE_URL 为空')
  }

  const pool = mysql.createPool({
    uri: config.databaseUrl,
    waitForConnections: true,
    connectionLimit: Number.parseInt(process.env.DB_POOL_SIZE || '10', 10) || 10,
    queueLimit: 0,
  })

  runtime.pool = pool
  runtime.adapter = createMysqlAdapter(pool)

  await ensureMysqlSchema(pool)
}

function getMysqlPromise() {
  try {
    return require('mysql2/promise')
  } catch {
    return null
  }
}

function normalizeParams(args) {
  if (args.length === 1 && Array.isArray(args[0])) return args[0]
  return args
}

function currentAdapter() {
  const tx = txStorage.getStore()
  return (tx && tx.adapter) || runtime.adapter
}

function createMysqlAdapter(queryable) {
  return {
    async run(sql, params = []) {
      const [result] = await queryable.execute(sql, params)
      return result
    },
    async get(sql, params = []) {
      const [rows] = await queryable.execute(sql, params)
      return rows && rows[0] ? rows[0] : null
    },
    async all(sql, params = []) {
      const [rows] = await queryable.execute(sql, params)
      return rows || []
    },
    async exec(sql) {
      return queryable.query(sql)
    },
  }
}

async function mysqlColumnExists(connection, tableName, columnName) {
  const [rows] = await connection.execute(
    `
      SELECT 1
      FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = ?
        AND COLUMN_NAME = ?
      LIMIT 1
    `,
    [tableName, columnName]
  )
  return Array.isArray(rows) && rows.length > 0
}

async function mysqlIndexExists(connection, tableName, indexName) {
  const [rows] = await connection.execute(
    `
      SELECT 1
      FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = ?
        AND INDEX_NAME = ?
      LIMIT 1
    `,
    [tableName, indexName]
  )
  return Array.isArray(rows) && rows.length > 0
}

async function ensureMysqlSchema(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id                VARCHAR(64) PRIMARY KEY,
      service_key       VARCHAR(32) NOT NULL,
      username          VARCHAR(64) NOT NULL,
      email             VARCHAR(255) NULL,
      email_verified_at VARCHAR(40) NULL,
      password_hash     VARCHAR(255) NOT NULL,
      role              VARCHAR(32) NOT NULL DEFAULT 'user',
      account_status    VARCHAR(16) NOT NULL DEFAULT 'active',
      disabled_at       VARCHAR(40) NULL,
      credits_balance   DOUBLE NOT NULL DEFAULT 0,
      created_at        VARCHAR(40) NOT NULL,
      updated_at        VARCHAR(40) NOT NULL,
      UNIQUE KEY uq_users_service_username (service_key, username),
      UNIQUE KEY uq_users_service_email (service_key, email),
      KEY idx_users_service (service_key),
      KEY idx_users_service_status (service_key, account_status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `)

  const connection = await pool.getConnection()
  try {
    if (!(await mysqlColumnExists(connection, 'users', 'email'))) {
      await connection.query('ALTER TABLE users ADD COLUMN email VARCHAR(255) NULL AFTER username')
    }
    if (!(await mysqlColumnExists(connection, 'users', 'email_verified_at'))) {
      await connection.query('ALTER TABLE users ADD COLUMN email_verified_at VARCHAR(40) NULL AFTER email')
    }
    if (!(await mysqlColumnExists(connection, 'users', 'account_status'))) {
      await connection.query(
        "ALTER TABLE users ADD COLUMN account_status VARCHAR(16) NOT NULL DEFAULT 'active' AFTER role"
      )
    }
    if (!(await mysqlColumnExists(connection, 'users', 'disabled_at'))) {
      await connection.query('ALTER TABLE users ADD COLUMN disabled_at VARCHAR(40) NULL AFTER account_status')
    }
    if (!(await mysqlIndexExists(connection, 'users', 'uq_users_service_email'))) {
      await connection.query('CREATE UNIQUE INDEX uq_users_service_email ON users(service_key, email)')
    }
    if (!(await mysqlIndexExists(connection, 'users', 'idx_users_service_status'))) {
      await connection.query('CREATE INDEX idx_users_service_status ON users(service_key, account_status)')
    }
    await connection.query(
      "UPDATE users SET account_status = 'active' WHERE account_status IS NULL OR account_status = ''"
    )
  } finally {
    connection.release()
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS wallet_transactions (
      id                VARCHAR(64) PRIMARY KEY,
      service_key       VARCHAR(32) NOT NULL,
      user_id           VARCHAR(64) NOT NULL,
      change_amount     DOUBLE NOT NULL,
      balance_after     DOUBLE NOT NULL,
      reason            VARCHAR(64) NOT NULL,
      source_ref        VARCHAR(255) NULL,
      meta_json         LONGTEXT NULL,
      created_at        VARCHAR(40) NOT NULL,
      KEY idx_wallet_user (service_key, user_id, created_at),
      CONSTRAINT fk_wallet_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_recharge_records (
      id                VARCHAR(64) PRIMARY KEY,
      service_key       VARCHAR(32) NOT NULL,
      user_id           VARCHAR(64) NOT NULL,
      card_code         VARCHAR(255) NOT NULL,
      face_value        VARCHAR(255) NOT NULL,
      recharge_amount   DOUBLE NOT NULL,
      recharged_at      VARCHAR(40) NOT NULL,
      KEY idx_user_recharge_user (service_key, user_id, recharged_at),
      CONSTRAINT fk_user_recharge_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS admin_recharge_records (
      id                VARCHAR(64) PRIMARY KEY,
      service_key       VARCHAR(32) NOT NULL,
      user_id           VARCHAR(64) NOT NULL,
      username          VARCHAR(64) NOT NULL,
      card_code         VARCHAR(255) NOT NULL,
      face_value        VARCHAR(255) NOT NULL,
      sale_price        VARCHAR(64) NULL,
      valid_period      VARCHAR(255) NULL,
      batch_no          VARCHAR(128) NULL,
      recharge_amount   DOUBLE NOT NULL,
      recharged_at      VARCHAR(40) NOT NULL,
      payload_json      LONGTEXT NULL,
      created_at        VARCHAR(40) NOT NULL,
      UNIQUE KEY uq_admin_recharge_service_card (service_key, card_code),
      KEY idx_admin_recharge_service (service_key, recharged_at),
      CONSTRAINT fk_admin_recharge_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS email_verification_codes (
      id                VARCHAR(64) PRIMARY KEY,
      service_key       VARCHAR(32) NOT NULL,
      email             VARCHAR(255) NOT NULL,
      purpose           VARCHAR(32) NOT NULL,
      code_hash         VARCHAR(128) NOT NULL,
      expires_at        VARCHAR(40) NOT NULL,
      used_at           VARCHAR(40) NULL,
      created_at        VARCHAR(40) NOT NULL,
      KEY idx_email_codes_lookup (service_key, email, purpose, created_at),
      KEY idx_email_codes_expire (expires_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `)
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

      const connection = await runtime.pool.getConnection()
      const adapter = createMysqlAdapter(connection)
      try {
        await connection.beginTransaction()
        const result = await txStorage.run({ adapter }, async () => fn(...args))
        await connection.commit()
        return result
      } catch (error) {
        try {
          await connection.rollback()
        } catch {
          // ignore rollback error
        }
        throw error
      } finally {
        connection.release()
      }
    }
  },
  async ready() {
    await readyPromise
    return { mode: 'mysql' }
  },
}

const ok = (data, message = 'success') => ({ code: 200, data, message })
const fail = (message, code = 400) => ({ code, data: null, message })

module.exports = { db, ok, fail }
