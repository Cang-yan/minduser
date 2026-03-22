# 邮箱注册与验证码配置指南

本文档对应 `minduser` 当前实现：
- 保留用户名登录
- 支持邮箱登录（与用户名共用登录接口）
- 注册必须通过邮箱验证码校验

## 功能清单

- 新增接口：`POST /api/:service/auth/send-register-code`
- 注册接口：`POST /api/:service/auth/register`（新增 `email`、`emailCode`）
- 登录接口：`POST /api/:service/auth/login`（支持 `account=用户名或邮箱`）

## 一、环境变量配置

在 `.env` 中配置以下字段：

```env
# 开启邮箱验证码
EMAIL_VERIFICATION_ENABLED=1

# 验证码时效和发送频率
EMAIL_CODE_TTL_SECONDS=600
EMAIL_CODE_RESEND_SECONDS=60

# 建议设置独立密钥（不设置会回退到 JWT_SECRET）
EMAIL_CODE_SECRET=replace-this-secret

# SMTP 服务配置
SMTP_HOST=smtp.example.com
SMTP_PORT=465
SMTP_SECURE=1
SMTP_USER=no-reply@example.com
SMTP_PASS=your-smtp-password-or-app-password
SMTP_FROM="MindUser <no-reply@example.com>"
SMTP_REPLY_TO=support@example.com
```

字段说明：
- `EMAIL_VERIFICATION_ENABLED`：`1` 开启，`0` 关闭
- `EMAIL_CODE_TTL_SECONDS`：验证码有效期（秒）
- `EMAIL_CODE_RESEND_SECONDS`：同一邮箱重新发送最小间隔（秒）
- `EMAIL_CODE_SECRET`：验证码哈希密钥，建议独立设置
- `SMTP_SECURE`：`465` 端口通常为 `1`，`587` 通常为 `0`

## 二、依赖安装

邮箱发送依赖 `nodemailer`：

```bash
cd ~/LINGINE/minduser
npm install
```

## 三、接口用法

1) 发送验证码

```bash
curl -X POST "http://127.0.0.1:3100/api/mindplus/auth/send-register-code" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com"
  }'
```

2) 注册

```bash
curl -X POST "http://127.0.0.1:3100/api/mindplus/auth/register" \
  -H "Content-Type: application/json" \
  -d '{
    "username": "demo_user",
    "email": "user@example.com",
    "emailCode": "123456",
    "password": "Demo@123456"
  }'
```

3) 登录（用户名或邮箱）

```bash
curl -X POST "http://127.0.0.1:3100/api/mindplus/auth/login" \
  -H "Content-Type: application/json" \
  -d '{
    "account": "demo_user",
    "password": "Demo@123456"
  }'
```

或：

```bash
curl -X POST "http://127.0.0.1:3100/api/mindplus/auth/login" \
  -H "Content-Type: application/json" \
  -d '{
    "account": "user@example.com",
    "password": "Demo@123456"
  }'
```

## 四、数据库变化

`users` 表新增字段：
- `email`
- `email_verified_at`

新增表：`email_verification_codes`
- `service_key`
- `email`
- `purpose`（当前使用 `register`）
- `code_hash`
- `expires_at`
- `used_at`

说明：
- 验证码仅存哈希，不存明文
- 注册成功后，同邮箱未使用验证码会被标记为已使用

## 五、常见问题

1. 提示“邮箱验证码功能未启用”
- 检查 `EMAIL_VERIFICATION_ENABLED=1`

2. 提示“邮件服务配置不完整”
- 检查 `SMTP_HOST/PORT/USER/PASS/FROM`

3. 提示“发送过于频繁”
- 等待 `EMAIL_CODE_RESEND_SECONDS` 后重试

4. 提示“验证码已过期”
- 重新发送验证码并使用最新验证码
