'use strict'

const config = require('./config')

function getDbClient() {
  const client = String(config.dbClient || '').trim().toLowerCase()
  if (client === 'mysql') return 'mysql'
  if (client === 'sqlite') return 'sqlite'
  throw new Error(`不支持的 DB_CLIENT: ${client || '(empty)'}，仅支持 mysql / sqlite`)
}

const client = getDbClient()
const adapter = client === 'mysql'
  ? require('./db/mysql')
  : require('./db/sqlite')

module.exports = adapter
