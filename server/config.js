'use strict'

require('dotenv').config()

module.exports = {
  port: parseInt(process.env.PORT || '3100', 10),
  host: process.env.HOST || '0.0.0.0',
  jwtSecret: process.env.JWT_SECRET || 'change-this-secret-in-production',
  jwtExpiry: process.env.JWT_EXPIRY || '7d',
  dbPath: process.env.DB_PATH || './server/data/minduser.db',
  corsOrigin: process.env.CORS_ORIGIN || '*',
  services: ['mindplus', 'asloga'],
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
