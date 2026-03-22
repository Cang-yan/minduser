'use strict'

const config = require('./config')

function getNodemailer() {
  try {
    // Optional dependency loaded lazily to avoid startup crash before installation.
    return require('nodemailer')
  } catch {
    return null
  }
}

function assertEmailConfig() {
  if (!config.email?.enabled) {
    throw new Error('邮箱验证码功能未启用，请设置 EMAIL_VERIFICATION_ENABLED=1')
  }

  const required = [
    ['SMTP_HOST', config.email.smtpHost],
    ['SMTP_PORT', config.email.smtpPort],
    ['SMTP_USER', config.email.smtpUser],
    ['SMTP_PASS', config.email.smtpPass],
    ['SMTP_FROM', config.email.smtpFrom],
  ]

  const missing = required.filter((item) => !item[1]).map((item) => item[0])
  if (missing.length > 0) {
    throw new Error(`邮件服务配置不完整，请补充：${missing.join(', ')}`)
  }
}

async function sendRegisterVerifyCode(serviceKey, email, code) {
  assertEmailConfig()

  const nodemailer = getNodemailer()
  if (!nodemailer) {
    throw new Error('未安装 nodemailer，请先执行 npm install')
  }

  const transporter = nodemailer.createTransport({
    host: config.email.smtpHost,
    port: config.email.smtpPort,
    secure: !!config.email.smtpSecure,
    auth: {
      user: config.email.smtpUser,
      pass: config.email.smtpPass,
    },
  })

  const upperService = String(serviceKey || '').toUpperCase()
  const subject = `[${upperService}] 注册验证码`
  const text = `您的注册验证码为：${code}。${config.email.verifyCodeTtlSeconds} 秒内有效。`
  const html = `
    <div style="font-family:Arial,'PingFang SC','Microsoft YaHei',sans-serif;font-size:14px;color:#0f172a;">
      <p>您好，</p>
      <p>您正在注册 <strong>${upperService}</strong> 账号。</p>
      <p>本次验证码为：<strong style="font-size:22px;letter-spacing:3px;">${code}</strong></p>
      <p>验证码 ${config.email.verifyCodeTtlSeconds} 秒内有效，请勿泄露给他人。</p>
    </div>
  `

  await transporter.sendMail({
    from: config.email.smtpFrom,
    to: email,
    replyTo: config.email.smtpReplyTo || undefined,
    subject,
    text,
    html,
  })
}

module.exports = {
  sendRegisterVerifyCode,
}
