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

function parseBool(raw, fallback = false) {
  const value = String(raw || '').trim().toLowerCase()
  if (!value) return fallback
  return ['1', 'true', 'yes', 'on'].includes(value)
}

function parseIntSafe(raw, fallback) {
  const n = Number.parseInt(String(raw || ''), 10)
  if (!Number.isFinite(n)) return fallback
  return n
}

function parseDbClient() {
  const explicit = String(process.env.DB_CLIENT || '').trim().toLowerCase()
  if (!explicit) return 'mysql'
  if (explicit === 'mysql') return 'mysql'
  throw new Error(`不支持的 DB_CLIENT: ${explicit}，当前仅支持 mysql`)
}

module.exports = {
  port: parseInt(process.env.PORT || '3100', 10),
  host: process.env.HOST || '0.0.0.0',
  jwtSecret: process.env.JWT_SECRET || 'change-this-secret-in-production',
  jwtExpiry: process.env.JWT_EXPIRY || '7d',
  dbClient: parseDbClient(),
  databaseUrl: String(process.env.DATABASE_URL || '').trim(),
  corsOrigin: process.env.CORS_ORIGIN || '*',
  services: parseEnabledServices(process.env.ENABLED_SERVICES || 'mindplus'),
  internalRechargeKey: process.env.INTERNAL_RECHARGE_KEY || '',
  email: {
    enabled: parseBool(process.env.EMAIL_VERIFICATION_ENABLED, false),
    smtpHost: String(process.env.SMTP_HOST || '').trim(),
    smtpPort: parseIntSafe(process.env.SMTP_PORT, 465),
    smtpSecure: parseBool(process.env.SMTP_SECURE, true),
    smtpUser: String(process.env.SMTP_USER || '').trim(),
    smtpPass: String(process.env.SMTP_PASS || ''),
    smtpFrom: String(process.env.SMTP_FROM || '').trim(),
    smtpReplyTo: String(process.env.SMTP_REPLY_TO || '').trim(),
    verifyCodeTtlSeconds: Math.max(parseIntSafe(process.env.EMAIL_CODE_TTL_SECONDS, 600), 60),
    verifyCodeResendSeconds: Math.max(parseIntSafe(process.env.EMAIL_CODE_RESEND_SECONDS, 60), 10),
    verifyCodeSecret: String(process.env.EMAIL_CODE_SECRET || process.env.JWT_SECRET || 'minduser-email-code-secret'),
  },
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
