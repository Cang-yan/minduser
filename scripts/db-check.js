'use strict'

require('dotenv').config()

const config = require('../server/config')
const { db } = require('../server/db')

async function getDbInfo() {
  if (config.dbClient !== 'mysql') {
    throw new Error(`DB_CLIENT=${config.dbClient} 非法，当前仅支持 mysql`)
  }

  const current = await db.prepare('SELECT DATABASE() AS db_name').get()
  const tables = await db.prepare(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = DATABASE()
    ORDER BY table_name
  `).all()

  return {
    mode: 'mysql',
    database: current && current.db_name ? current.db_name : '(unknown)',
    tables: (tables || []).map((r) => r.table_name),
  }
}

async function main() {
  const info = await db.ready()
  const dbInfo = await getDbInfo()

  const usersTotal = (await db.prepare('SELECT COUNT(*) AS c FROM users').get())?.c || 0
  const adminsTotal = (await db.prepare("SELECT COUNT(*) AS c FROM users WHERE role = 'admin'").get())?.c || 0
  const mindplusAdmins = (await db.prepare(
    "SELECT COUNT(*) AS c FROM users WHERE role = 'admin' AND service_key = 'mindplus'"
  ).get())?.c || 0

  console.log(`[db-check] backend=${info.mode}`)
  console.log(`[db-check] database=${dbInfo.database}`)
  console.log(`[db-check] tables=${dbInfo.tables.length}`)
  if (dbInfo.tables.length > 0) {
    console.log(`[db-check] table-list=${dbInfo.tables.join(', ')}`)
  }
  console.log(`[db-check] users_total=${Number(usersTotal || 0)}`)
  console.log(`[db-check] admins_total=${Number(adminsTotal || 0)}`)
  console.log(`[db-check] mindplus_admins=${Number(mindplusAdmins || 0)}`)
}

main().catch((error) => {
  console.error('[db-check] failed:', error && error.message ? error.message : error)
  process.exit(1)
})
