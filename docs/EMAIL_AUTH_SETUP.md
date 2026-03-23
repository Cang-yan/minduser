# 邮箱登录与注册说明（当前实现）

本文档对应当前 `minduser` 行为（2026-03-23）：
- 注册为邮箱直注册：`username + email + password`
- 登录支持用户名或邮箱（同一接口）
- 数据库固定使用 MySQL（不再支持 SQLite）

## 1. 接口清单

- `POST /api/:service/auth/register`
- `POST /api/:service/auth/login`
- `GET /api/:service/auth/me`
- `POST /api/:service/auth/send-register-code`（已废弃，固定返回 `410`）

## 2. 注册请求示例

```bash
curl -X POST "http://127.0.0.1:3100/api/mindplus/auth/register" \
  -H "Content-Type: application/json" \
  -d '{
    "username": "demo_user",
    "email": "user@example.com",
    "password": "Demo@123456"
  }'
```

说明：
- 同服务内用户名不能重复
- 同服务内邮箱不能重复
- 重复邮箱时返回：`该邮箱已被注册`

## 3. 登录请求示例

用户名登录：

```bash
curl -X POST "http://127.0.0.1:3100/api/mindplus/auth/login" \
  -H "Content-Type: application/json" \
  -d '{
    "account": "demo_user",
    "password": "Demo@123456"
  }'
```

邮箱登录：

```bash
curl -X POST "http://127.0.0.1:3100/api/mindplus/auth/login" \
  -H "Content-Type: application/json" \
  -d '{
    "account": "user@example.com",
    "password": "Demo@123456"
  }'
```

## 4. 相关环境变量

当前登录/注册主流程不依赖邮箱验证码。SMTP 配置仅保留为未来扩展预留项，不影响现有注册登录：

```env
EMAIL_VERIFICATION_ENABLED=0
SMTP_HOST=
SMTP_PORT=465
SMTP_SECURE=1
SMTP_USER=
SMTP_PASS=
SMTP_FROM=
SMTP_REPLY_TO=
```
