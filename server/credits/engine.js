'use strict'

const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const PROJECT_ROOT = path.resolve(__dirname, '..', '..')
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const ALPHABET_MAP = new Map([...ALPHABET].map((ch, idx) => [ch, idx]))
const CARD_RAW_LEN = 16
const MAC_BITS = 20

const SOURCE_PATHS = {
  mindplus: {
    envCardkeyDir: 'MINDPLUS_CARDKEY_DIR',
    envLegacyRecordFile: 'MINDPLUS_CREDITS_RECORD_FILE',
    cardkeyDirCandidates: [
      '/home/xx/LINGINE/minduser/cardkey',
      path.resolve(PROJECT_ROOT, 'cardkey'),
    ],
    legacyRecordCandidates: [
      '/home/xx/LINGINE/mindplus/credits/data/redemption_records.json',
      path.resolve(PROJECT_ROOT, '../mindplus/credits/data/redemption_records.json'),
    ],
    requiredVersion: null,
    hmacContext: null,
  },
  asloga: {
    envCardkeyDir: 'ASLOGA_CARDKEY_DIR',
    envLegacyRecordFile: 'ASLOGA_CREDITS_RECORD_FILE',
    cardkeyDirCandidates: [
      '/home/xx/LINGINE/mindvideo/cardkey-asloga',
      '/home/xx/LINGINE/mindviedo/cardkey-asloga',
      path.resolve(PROJECT_ROOT, '../mindvideo/cardkey-asloga'),
      path.resolve(PROJECT_ROOT, '../mindviedo/cardkey-asloga'),
    ],
    legacyRecordCandidates: [
      '/home/xx/LINGINE/mindvideo/credits-asloga/data/redemption_records.json',
      '/home/xx/LINGINE/mindviedo/credits-asloga/data/redemption_records.json',
      path.resolve(PROJECT_ROOT, '../mindvideo/credits-asloga/data/redemption_records.json'),
      path.resolve(PROJECT_ROOT, '../mindviedo/credits-asloga/data/redemption_records.json'),
    ],
    requiredVersion: 2,
    hmacContext: Buffer.from('ASLOGA_CARDKEY_V1|', 'utf-8'),
  },
}

class CreditsApiError extends Error {
  constructor(message, statusCode = 400) {
    super(message)
    this.statusCode = statusCode
  }
}

function dedupePaths(paths) {
  const out = []
  const seen = new Set()
  for (const item of paths || []) {
    const text = String(item || '').trim()
    if (!text) continue
    if (seen.has(text)) continue
    seen.add(text)
    out.push(text)
  }
  return out
}

function resolveServiceSource(serviceKey) {
  const source = SOURCE_PATHS[serviceKey]
  if (!source) {
    throw new CreditsApiError(`不支持的服务分区: ${serviceKey}`, 404)
  }
  return source
}

function resolveExistingDirectory(paths) {
  for (const candidate of dedupePaths(paths)) {
    try {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
        return candidate
      }
    } catch {
      // skip unreadable candidate
    }
  }
  return null
}

function resolveExistingFile(paths) {
  for (const candidate of dedupePaths(paths)) {
    try {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        return candidate
      }
    } catch {
      // skip unreadable candidate
    }
  }
  return null
}

function resolveCardkeyDir(serviceKey) {
  const source = resolveServiceSource(serviceKey)
  const envPath = String(process.env[source.envCardkeyDir] || '').trim()
  const candidates = envPath
    ? [path.resolve(envPath)]
    : source.cardkeyDirCandidates.map((p) => path.resolve(p))

  const found = resolveExistingDirectory(candidates)
  if (!found) {
    throw new CreditsApiError(
      `找不到 ${serviceKey} 的 cardkey 目录，请检查 ${source.envCardkeyDir} 或默认路径配置`,
      500
    )
  }
  return found
}

function resolveLegacyRecordFile(serviceKey) {
  const source = resolveServiceSource(serviceKey)
  const envPath = String(process.env[source.envLegacyRecordFile] || '').trim()
  const candidates = envPath
    ? [path.resolve(envPath)]
    : source.legacyRecordCandidates.map((p) => path.resolve(p))
  return resolveExistingFile(candidates)
}

function loadSecretBuffer(secretPath) {
  const raw = fs.readFileSync(secretPath, 'utf-8').trim()
  if (!raw) {
    throw new CreditsApiError(`密钥文件为空: ${secretPath}`, 500)
  }
  if (!/^[0-9a-fA-F]+$/.test(raw) || raw.length % 2 !== 0) {
    throw new CreditsApiError(`密钥文件格式错误: ${secretPath}`, 500)
  }
  return Buffer.from(raw, 'hex')
}

function loadRegistry(registryPath) {
  let data = null
  try {
    const raw = fs.readFileSync(registryPath, 'utf-8')
    data = JSON.parse(raw)
  } catch {
    throw new CreditsApiError(`批次文件无法解析: ${registryPath}`, 500)
  }

  if (!data || typeof data !== 'object') {
    throw new CreditsApiError(`批次文件格式错误: ${registryPath}`, 500)
  }
  data.batches = data.batches || {}
  return data
}

function resolveServiceMaterials(serviceKey) {
  const source = resolveServiceSource(serviceKey)
  const cardkeyDir = resolveCardkeyDir(serviceKey)
  const secretPath = path.join(cardkeyDir, '.cardkey_secret')
  const registryPath = path.join(cardkeyDir, 'batch_registry.json')

  if (!fs.existsSync(secretPath)) {
    throw new CreditsApiError(`缺少密钥文件: ${secretPath}`, 500)
  }
  if (!fs.existsSync(registryPath)) {
    throw new CreditsApiError(`缺少批次配置: ${registryPath}`, 500)
  }

  return {
    source,
    cardkeyDir,
    secretPath,
    registryPath,
    legacyRecordPath: resolveLegacyRecordFile(serviceKey),
    secret: loadSecretBuffer(secretPath),
    registry: loadRegistry(registryPath),
  }
}

function normalizeCard(card) {
  const raw = String(card || '').trim().toUpperCase().replace(/-/g, '')
  if (raw.length !== CARD_RAW_LEN) {
    throw new CreditsApiError(`卡密长度必须为 ${CARD_RAW_LEN} 位（不含连字符）`)
  }
  for (const ch of raw) {
    if (!ALPHABET_MAP.has(ch)) {
      throw new CreditsApiError(`卡密包含非法字符: ${ch}`)
    }
  }
  return raw
}

function formatCard(raw16) {
  return `${raw16.slice(0, 4)}-${raw16.slice(4, 8)}-${raw16.slice(8, 12)}-${raw16.slice(12, 16)}`
}

function fromBase32Fixed(raw) {
  let value = 0n
  for (const ch of raw) {
    value = (value << 5n) | BigInt(ALPHABET_MAP.get(ch))
  }
  return value
}

function bigIntToBuffer(value, length) {
  const buf = Buffer.alloc(length)
  let temp = value
  for (let i = length - 1; i >= 0; i -= 1) {
    buf[i] = Number(temp & 0xffn)
    temp >>= 8n
  }
  if (temp !== 0n) {
    throw new CreditsApiError('数值超出缓冲区长度')
  }
  return buf
}

function hmac20(secret, payload60, contextBuffer) {
  const payloadBytes = bigIntToBuffer(payload60, 8)
  const hmac = crypto.createHmac('sha256', secret)
  if (contextBuffer) {
    hmac.update(contextBuffer)
  }
  hmac.update(payloadBytes)
  const digest = hmac.digest()
  const first32 = BigInt(digest.readUInt32BE(0))
  const mask = (1n << 20n) - 1n
  return Number((first32 >> BigInt(32 - MAC_BITS)) & mask)
}

function decodeCard(serviceKey, card) {
  const materials = resolveServiceMaterials(serviceKey)
  const raw = normalizeCard(card)
  const full80 = fromBase32Fixed(raw)

  const mask20 = (1n << 20n) - 1n
  const mac = Number(full80 & mask20)
  const payload = full80 >> 20n

  const expected = hmac20(materials.secret, payload, materials.source.hmacContext)
  if (mac !== expected) {
    throw new CreditsApiError('卡密签名校验失败（无效卡密或密钥不匹配）')
  }

  const version = Number((payload >> 56n) & 0xfn)
  if (materials.source.requiredVersion !== null && version !== materials.source.requiredVersion) {
    throw new CreditsApiError(
      `卡密版本不匹配（当前服务支持 v${materials.source.requiredVersion}）`
    )
  }

  const batchId = Number((payload >> 36n) & ((1n << 20n) - 1n))
  const serial = Number((payload >> 16n) & ((1n << 20n) - 1n))
  const nonce = Number(payload & 0xffffn)

  return {
    materials,
    version,
    batch_id: batchId,
    serial,
    nonce,
    card_normalized: formatCard(raw),
  }
}

function parseDate(dateStr) {
  const matched = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr || ''))
  if (!matched) {
    throw new CreditsApiError('卡密有效期格式异常，请检查批次配置')
  }
  const year = Number(matched[1])
  const month = Number(matched[2])
  const day = Number(matched[3])
  return new Date(year, month - 1, day)
}

function isExpired(expireAt) {
  const expireDate = parseDate(expireAt)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return today > expireDate
}

function parseFaceValueAmount(faceValue) {
  const text = String(faceValue || '')
  const matched = /(\d+(?:\.\d+)?)/.exec(text)
  if (!matched) {
    return null
  }
  const value = Number(matched[1])
  return Number.isFinite(value) ? value : null
}

function formatAmount(value) {
  if (!Number.isFinite(value)) {
    return ''
  }
  return Number.isInteger(value) ? String(value) : value.toFixed(2)
}

function buildRedeemMeta(batch) {
  const yuan = parseFaceValueAmount(batch.face_value)
  if (yuan === null) {
    return {
      redeemable_yuan: null,
      redeemable_credits: null,
      redeem_hint: '该卡密校验通过，可进行兑换',
    }
  }

  const credits = yuan * 10
  return {
    redeemable_yuan: yuan,
    redeemable_credits: credits,
    redeem_hint: `该卡密可兑换${formatAmount(yuan)}元积分（${formatAmount(credits)} credits）`,
  }
}

function buildCardDetail(serviceKey, card) {
  const decoded = decodeCard(serviceKey, card)
  const batches = decoded.materials.registry.batches || {}
  const batch = batches[String(decoded.batch_id)]
  if (!batch) {
    throw new CreditsApiError(
      `卡密校验通过，但找不到 batch_id=${decoded.batch_id} 的业务配置。请确认 batch_registry.json 与密钥文件来自同一套环境。`
    )
  }

  const expired = isExpired(String(batch.expire_at || ''))
  const redeemMeta = buildRedeemMeta(batch)

  return {
    service_key: serviceKey,
    card: decoded.card_normalized,
    version: decoded.version,
    batch_id: decoded.batch_id,
    batch_no: batch.batch_no,
    face_value: batch.face_value,
    sale_price: batch.sale_price,
    valid_days: batch.valid_days,
    start_date: batch.start_date,
    expire_at: batch.expire_at,
    serial: decoded.serial,
    nonce: decoded.nonce,
    is_expired: expired,
    redeemable_yuan: redeemMeta.redeemable_yuan,
    redeemable_credits: redeemMeta.redeemable_credits,
    redeem_hint: redeemMeta.redeem_hint,
    legacy_record_file: decoded.materials.legacyRecordPath || null,
  }
}

function buildUsedInfoFromLegacy(record) {
  if (!record || typeof record !== 'object') return null
  const usedBy = String(record.account || record.user_id || '').trim()
  const usedAt = String(record.redeemed_at || record.recharged_at || '').trim()
  if (!usedBy && !usedAt) return null
  return {
    source: 'legacy',
    used_by: usedBy || null,
    used_at: usedAt || null,
    raw: record,
  }
}

function loadLegacyRecords(filePath) {
  if (!filePath) return null
  try {
    const raw = fs.readFileSync(filePath, 'utf-8').trim()
    if (!raw) return null
    const data = JSON.parse(raw)
    if (!data || typeof data !== 'object') return null
    data.cards = data.cards || {}
    return data
  } catch {
    return null
  }
}

function findLegacyRedemption(serviceKey, card) {
  const materials = resolveServiceMaterials(serviceKey)
  const recordFile = materials.legacyRecordPath
  if (!recordFile) return null

  const records = loadLegacyRecords(recordFile)
  if (!records || !records.cards) return null

  const cardNormalized = formatCard(normalizeCard(card))
  const record = records.cards[cardNormalized] || null
  const usedInfo = buildUsedInfoFromLegacy(record)
  if (!usedInfo) return null
  return {
    ...usedInfo,
    card: cardNormalized,
  }
}

function buildValidationResult(cardDetail, usedInfo) {
  const used = usedInfo || null
  const canRedeem = !used && !cardDetail.is_expired

  let message = ''
  if (used) {
    message = `该卡密已被账号 ${used.used_by || '-'} 于 ${used.used_at || '-'} 兑换`
  } else if (cardDetail.is_expired) {
    message = `该卡密已过期（到期日：${cardDetail.expire_at}）`
  } else {
    message = cardDetail.redeem_hint
  }

  return {
    card: cardDetail.card,
    can_redeem: canRedeem,
    is_used: Boolean(used),
    is_expired: Boolean(cardDetail.is_expired),
    used_by: used ? used.used_by : null,
    used_at: used ? used.used_at : null,
    used_source: used ? used.source : null,
    batch_id: cardDetail.batch_id,
    batch_no: cardDetail.batch_no,
    face_value: cardDetail.face_value,
    sale_price: cardDetail.sale_price,
    valid_days: cardDetail.valid_days,
    start_date: cardDetail.start_date,
    expire_at: cardDetail.expire_at,
    redeemable_yuan: cardDetail.redeemable_yuan,
    redeemable_credits: cardDetail.redeemable_credits,
    message,
  }
}

module.exports = {
  CreditsApiError,
  buildCardDetail,
  findLegacyRedemption,
  buildValidationResult,
  resolveCardkeyDir,
}
