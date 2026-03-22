'use strict'

require('dotenv').config()

const SUPPORTED_SERVICES = ['mindplus', 'asloga']

function parseEnabledServices(raw) {
  const text = String(raw || '')
  const list = text
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)

  const enabled = []
  for (const service of list) {
    if (!SUPPORTED_SERVICES.includes(service)) continue
    if (!enabled.includes(service)) enabled.push(service)
  }

  // Default to single-service mode (mindplus only).
  return enabled.length > 0 ? enabled : ['mindplus']
}

module.exports = {
  port: parseInt(process.env.PORT || '3100', 10),
  host: process.env.HOST || '0.0.0.0',
  jwtSecret: process.env.JWT_SECRET || 'change-this-secret-in-production',
  jwtExpiry: process.env.JWT_EXPIRY || '7d',
  dbPath: process.env.DB_PATH || './server/data/minduser.db',
  corsOrigin: process.env.CORS_ORIGIN || '*',
  services: parseEnabledServices(process.env.ENABLED_SERVICES || 'mindplus'),
  internalRechargeKey: process.env.INTERNAL_RECHARGE_KEY || '',
  featureHome: {
    mindplus: process.env.MINDPLUS_FEATURE_HOME_URL || 'http://127.0.0.1:5173/slide/',
    asloga: process.env.ASLOGA_FEATURE_HOME_URL || '',
  },
  adminSeed: {
    mindplus: {
      username: process.env.MINDPLUS_ADMIN_USERNAME || 'admin',
      password: process.env.MINDPLUS_ADMIN_PASSWORD || 'Admin@123',
    },
    asloga: {
      username: process.env.ASLOGA_ADMIN_USERNAME || 'admin',
      password: process.env.ASLOGA_ADMIN_PASSWORD || 'Admin@123',
    },
  },
}
