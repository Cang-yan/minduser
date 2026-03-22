'use strict'

require('dotenv').config()

function hasFlag(name) {
  return process.argv.includes(name)
}

async function main() {
  const withSeedAdmin = hasFlag('--seed-admin') || hasFlag('--seed')

  if (!withSeedAdmin) {
    console.log('[db-init] MySQL schema init is now SQL-first.')
    console.log('[db-init] Please run the SQL manually:')
    console.log('  mysql -h 127.0.0.1 -P 3306 -u <user> -p <database> < sql/mysql_init.sql')
    console.log('[db-init] You can view the SQL with: npm run db:init:sql')
    console.log('[db-init] Then seed admin users with: npm run db:init:seed')
    return
  }

  const { db } = require('../server/db')
  const { seedAdminUsers } = require('../server/seed')
  const info = await db.ready()
  console.log(`[db-init] backend ready: ${info.mode}`)

  await seedAdminUsers(console)
  console.log('[db-init] admin seed completed')
}

main().catch((error) => {
  console.error('[db-init] failed:', error && error.message ? error.message : error)
  process.exit(1)
})
