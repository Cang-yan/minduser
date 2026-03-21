'use strict'

const { fail } = require('../db')
const { normalizeServiceKey } = require('../service')

function resolveServiceOrReply(req, reply) {
  const serviceKey = normalizeServiceKey(req.params.service)
  if (!serviceKey) {
    reply.code(404).send(fail('服务不存在，仅支持 mindplus / asloga', 404))
    return null
  }
  return serviceKey
}

function ensureTokenMatchesService(req, reply, serviceKey) {
  if (!req.user || req.user.service_key !== serviceKey) {
    reply.code(403).send(fail('无权访问该服务的数据', 403))
    return false
  }
  return true
}

function ensureAdmin(req, reply) {
  if (!req.user || req.user.role !== 'admin') {
    reply.code(403).send(fail('需要管理员权限', 403))
    return false
  }
  return true
}

module.exports = {
  resolveServiceOrReply,
  ensureTokenMatchesService,
  ensureAdmin,
}
