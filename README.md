# MindUser 会员系统（Node.js）

目录：`~/LINGINE/minduser`

本项目当前按单服务模式运行：`mindplus`。

说明：
- `asloga` 相关代码仍保留在仓库中
- 默认不启用、不对外暴露路由
- 如未来需要，可通过环境变量重新启用

核心能力：
- 登录/注册（注册需邮箱，登录支持用户名或邮箱）
- JWT 鉴权
- 注册后自动生成 10 位 UID 作为系统唯一标识
- 钱包代币单位固定为 `credits`
- CDKey 充值页面与接口（卡密校验 + 兑换入账）
- 兼容保留开放回调充值接口（支持自动入账与记录）
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

## 修改端口

项目默认端口来自环境变量 `PORT`（默认 `3100`）。可按以下方式修改：

1. 持久修改（推荐）

编辑 `.env`：

```bash
PORT=3200
```

然后重启服务：

```bash
npm run dev
# 或
npm start
```

2. 单次临时修改（只对当前命令生效）

```bash
PORT=3200 npm run dev
# 或
PORT=3200 npm start
```

3. systemd 部署修改（生产常见）

在 service 文件中增加或修改：

```ini
Environment=PORT=3200
```

保存后执行：

```bash
sudo systemctl daemon-reload
sudo systemctl restart minduser
```

如果修改端口后无法访问，请同步检查：
- 防火墙/安全组是否放行新端口
- 反向代理（Nginx/Caddy）上游端口是否同步更新

## 服务开关

通过 `.env` 的 `ENABLED_SERVICES` 控制启用的服务分区（逗号分隔）：

```bash
ENABLED_SERVICES=mindplus
```

当前默认仅启用 `mindplus`。如果后续要恢复多服务，可改为：

```bash
ENABLED_SERVICES=mindplus,asloga
```

## 数据库配置（MySQL）

项目当前仅支持 `mysql`。

`.env` 关键字段：

```bash
DB_CLIENT=mysql
DATABASE_URL=mysql://user:password@127.0.0.1:3306/minduser?charset=utf8mb4
DB_POOL_SIZE=10
```

说明：
- 推荐先手动执行 `sql/mysql_init.sql` 完成建表/补齐
- `npm run db:init` 仅输出手工初始化指引，不直接改库
- `npm run db:init:sql` 可直接查看初始化 SQL 内容
- `npm run db:init:seed` 仅负责写入默认管理员账号

可单独执行初始化脚本：

```bash
# 输出手工初始化指引（含 mysql 命令示例）
npm run db:init

# 查看完整初始化 SQL
npm run db:init:sql

# 写入默认管理员（需先完成建表）
npm run db:init:seed
```

手工执行 SQL 示例：

```bash
mysql -h 127.0.0.1 -P 3306 -u <user> -p <database> < sql/mysql_init.sql
```

## 文档索引

- Credits 接口文档：`docs/CREDITS_API.md`
- 部署/升级/运维手册：`docs/DEPLOY_UPGRADE_OPS.md`
- GitHub 更新部署手册：`docs/GITHUB_DEPLOY_RUNBOOK.md`
- MySQL 落库配置：`docs/MYSQL_SETUP.md`
- 邮箱验证码配置文档：`docs/EMAIL_AUTH_SETUP.md`

## 页面路由

用户端：
- `/{service}/login`
- `/{service}/app`
- `/{service}/cdkey`（CDKey 充值）
- `/{service}/credits`（CDKey 页面别名）

后台：
- `/adminadmin/{service}/login`
- `/adminadmin/{service}`

其中 `{service}` 默认仅支持：`mindplus`（由 `ENABLED_SERVICES` 控制）。

示例：
- `http://127.0.0.1:3100/mindplus/login`

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

- `POST /api/:service/auth/send-register-code`
- `POST /api/:service/auth/register`
- `POST /api/:service/auth/login`
- `POST /api/:service/auth/admin-login`
- `GET /api/:service/auth/me`（Bearer Token）

说明：
- `send-register-code`：已废弃，接口固定返回 410（当前改为邮箱直注册）
- `register`：需提交 `username`、`password`、`email`
- `login`：支持 `account` 字段（用户名或邮箱）

### 钱包

- `GET /api/:service/wallet/summary`（Bearer Token）
- `GET /api/:service/wallet/recharges?page=1&limit=50`（Bearer Token）
- `GET /api/:service/wallet/consumptions?page=1&limit=50`（Bearer Token）

### CDKey 充值接口（用户端）

- `POST /api/:service/credits/validate`（Bearer Token）
- `POST /api/:service/credits/redeem`（Bearer Token）
- `GET /api/:service/credits/redemptions`（Bearer Token）

说明：
- `/validate`：校验卡密签名、批次、过期状态与是否已兑换
- `/redeem`：完成兑换并自动写入钱包流水、用户简版记录、后台全量记录
- `/redemptions`：查询兑换记录（普通用户仅可查看自己，管理员可按 `account`/`uid` 查看）

### 开放充值回调接口（供外部系统直接入账）

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

### 开放消耗扣减接口（供业务系统记账）

- `POST /api/:service/open/consume`
- `POST /api/:service/open/deduct`（别名）

请求体示例：

```json
{
  "uid": "A7K3M9Q2TP",
  "amount": 35,
  "reason": "video_render",
  "sourceRef": "order_20260321_001"
}
```

## 外部目录默认映射（只读）

- `mindplus`（默认启用）：
  - `~/LINGINE/minduser/cardkey`
  - `~/LINGINE/mindplus/credits/data/redemption_records.json`
- `asloga`（默认关闭，代码保留）：
  - 优先 `~/LINGINE/mindvideo/*`
  - 若不存在则回退 `~/LINGINE/mindviedo/*`

可通过 `.env` 覆盖路径：
- `MINDPLUS_CARDKEY_DIR`
- `ASLOGA_CARDKEY_DIR`
- `MINDPLUS_CREDITS_RECORD_FILE`
- `ASLOGA_CREDITS_RECORD_FILE`

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

- 页面隔离：当前默认仅开放 `/mindplus/*`
- 数据隔离：所有核心数据表带 `service_key` 并强制过滤
- 后台隔离：管理员只能看到当前 service 的数据
- 本地存储隔离：token/uid 采用 `minduser_{service}_*` 命名

## 默认管理员

启动时会按 `.env` 自动种子管理员：
- `MINDPLUS_ADMIN_USERNAME` / `MINDPLUS_ADMIN_PASSWORD`（默认启用）
- `ASLOGA_ADMIN_USERNAME` / `ASLOGA_ADMIN_PASSWORD`（仅在启用 `asloga` 时生效）

生产环境请务必修改默认密码。
