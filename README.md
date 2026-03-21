# MindUser 会员系统（Node.js）

目录：`~/LINGINE/minduser`

本项目实现了双子服务会员系统：
- `mindplus`
- `asloga`

核心能力：
- 登录/注册（用户名+密码）
- JWT 鉴权
- 注册后自动生成 10 位 UID 作为系统唯一标识
- 钱包代币单位固定为 `credits`
- 预留卡密充值接口（支持自动入账与记录）
- 管理后台（用户量、充值记录、Excel 导出）
- 服务隔离（页面隔离 + 数据隔离 + 后台隔离）

## 启动

```bash
cd ~/LINGINE/minduser
cp .env.example .env
npm install
npm run dev
```

默认地址：`http://127.0.0.1:3100`

## 页面路由

用户端：
- `/{service}/login`
- `/{service}/app`

后台：
- `/{service}/admin/login`
- `/{service}/admin`

其中 `{service}` 仅支持：`mindplus` 或 `asloga`。

示例：
- `http://127.0.0.1:3100/mindplus/login`
- `http://127.0.0.1:3100/asloga/login`

## API（返回格式）

统一返回：

```json
{
  "code": 200,
  "data": {},
  "message": "success"
}
```

### 认证

- `POST /api/:service/auth/register`
- `POST /api/:service/auth/login`
- `POST /api/:service/auth/admin-login`
- `GET /api/:service/auth/me`（Bearer Token）

### 钱包

- `GET /api/:service/wallet/summary`（Bearer Token）
- `GET /api/:service/wallet/recharges?page=1&limit=50`（Bearer Token）

### 预留充值接口（供卡密系统回调）

- `POST /api/:service/open/recharge-card`
- `POST /api/:service/open/recharge`（别名）

请求体支持字段（兼容中英文字段名）：
- `uid` / `userId`
- `cardString` / `card` / `card_code` / `卡密字符串`
- `faceValue` / `face_value` / `对应面值`
- `creditsAmount` / `credits_amount` / `redeemable_credits`（可选，优先作为入账 credits）
- `salePrice` / `sale_price` / `售价`
- `validPeriod` / `有效期（建议≥1 年）`
- `batchNo` / `batch_no` / `批次号（便于对账）`

示例：

```json
{
  "uid": "A7K3M9Q2TP",
  "cardString": "ABCD-EFGH-JKLM-NPQR",
  "faceValue": "100元年卡",
  "salePrice": "79.90",
  "validPeriod": "365天",
  "batchNo": "B20260317A"
}
```

充值接口会执行：
1. 给用户钱包充值对应 credits
2. 写入用户侧简版记录：卡密字符串、面值、充值时间
3. 写入后台全量记录：卡密、用户、时间、批次号、售价、有效期等

> 可选：设置 `INTERNAL_RECHARGE_KEY` 后，调用方需在 Header 带 `x-internal-key`。

### 后台

- `GET /api/:service/admin/dashboard`
- `GET /api/:service/admin/users?page=1&limit=100`
- `GET /api/:service/admin/recharges?page=1&limit=100`
- `GET /api/:service/admin/recharges/export`（Excel 导出）

所有后台接口都需要：
- Bearer Token
- 管理员角色（`role=admin`）
- 服务隔离校验

## 服务隔离策略

- 页面隔离：按 `/mindplus/*` 与 `/asloga/*` 独立访问
- 数据隔离：所有核心数据表带 `service_key` 并强制过滤
- 后台隔离：管理员只能看到当前 service 的数据
- 本地存储隔离：token/uid 采用 `minduser_{service}_*` 命名

## 默认管理员

启动时会按 `.env` 自动种子管理员：
- `MINDPLUS_ADMIN_USERNAME` / `MINDPLUS_ADMIN_PASSWORD`
- `ASLOGA_ADMIN_USERNAME` / `ASLOGA_ADMIN_PASSWORD`

生产环境请务必修改默认密码。
