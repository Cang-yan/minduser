'use strict'

const { randomInt } = require('node:crypto')
const config = require('./config')

function normalizeServiceKey(raw) {
  const value = String(raw || '').trim().toLowerCase()
  if (!config.services.includes(value)) return null
  return value
}

function parsePage(query = {}) {
  const page = Math.max(parseInt(query.page || '1', 10), 1)
  const limit = Math.min(Math.max(parseInt(query.limit || '20', 10), 1), 200)
  const offset = (page - 1) * limit
  return { page, limit, offset }
}

function toIsoNow() {
  return new Date().toISOString()
}

function parseCreditsAmount(faceValue) {
  if (typeof faceValue === 'number' && Number.isFinite(faceValue)) {
    return Number(faceValue)
  }
  const text = String(faceValue || '')
  const match = text.match(/(\d+(?:\.\d+)?)/)
  if (!match) {
    return null
  }
  const value = Number(match[1])
  if (!Number.isFinite(value)) return null
  return value
}

function sanitizeUsername(raw) {
  const value = String(raw || '').trim()
  if (!value) return null
  if (value.length < 3 || value.length > 32) return null
  if (!/^[A-Za-z0-9_\-.]+$/.test(value)) return null
  return value
}

function sanitizePassword(raw) {
  const value = String(raw || '')
  if (value.length < 6 || value.length > 64) return null
  return value
}

function sanitizeEmail(raw) {
  const value = String(raw || '').trim().toLowerCase()
  if (!value) return null
  if (value.length > 254) return null
  // Practical email validation for registration/login.
  if (!/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/.test(value)) {
    return null
  }
  return value
}

function sanitizeEmailCode(raw) {
  const value = String(raw || '').trim()
  if (!/^\d{6}$/.test(value)) return null
  return value
}

const UID_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

function generateShortUid(length = 10) {
  const size = Math.max(Number.parseInt(length, 10) || 10, 1)
  let out = ''
  for (let i = 0; i < size; i += 1) {
    out += UID_ALPHABET[randomInt(0, UID_ALPHABET.length)]
  }
  return out
}

module.exports = {
  normalizeServiceKey,
  parsePage,
  toIsoNow,
  parseCreditsAmount,
  sanitizeUsername,
  sanitizePassword,
  sanitizeEmail,
  sanitizeEmailCode,
  generateShortUid,
}
