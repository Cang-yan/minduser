'use strict'

const config = require('./config')

function getDbClient() {
  const client = String(config.dbClient || '').trim().toLowerCase()
  if (client === 'mysql') return 'mysql'
  throw new Error(`不支持的 DB_CLIENT: ${client || '(empty)'}，当前仅支持 mysql`)
}

getDbClient()
const adapter = require('./db/mysql')

module.exports = adapter
