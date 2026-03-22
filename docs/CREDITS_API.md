# Credits 接口文档（MindUser）

适用项目：`~/LINGINE/minduser`  
文档版本：`v2`  
更新时间：`2026-03-21`

## 1. 总览

本系统的 `credits` 相关能力采用服务分区模式：

- `mindplus`
- `asloga`

接口统一前缀：

- `/api/:service/...`

其中 `:service` 仅支持：`mindplus`、`asloga`。

统一返回结构：

```json
{
  "code": 200,
  "data": {},
  "message": "success"
}
```

## 2. 认证与权限

用户侧 `credits` 接口（校验/兑换/查询）均需要：

- `Authorization: Bearer <token>`

管理侧查询与导出接口需要：

- `Authorization: Bearer <token>`
- 且账号角色必须为 `admin`

开放回调充值写接口（`/open/recharge*`）：

- 默认可直接调用
- 若 `.env` 配置了 `INTERNAL_RECHARGE_KEY`，则必须携带：
- `x-internal-key: <INTERNAL_RECHARGE_KEY>`

## 3. 数据隔离规则

- 所有核心记录都带 `service_key`
- 请求路径中的 `:service` 必须与 token 中 `service_key` 一致
- 跨服务访问会返回 `403`

## 4. 卡密来源目录（只读）

默认映射：

- `mindplus`：
- `~/LINGINE/minduser/cardkey`
- `~/LINGINE/mindplus/credits/data/redemption_records.json`
- `asloga`：
- 优先 `~/LINGINE/mindvideo/*`
- 回退 `~/LINGINE/mindviedo/*`

可通过 `.env` 覆盖：

- `MINDPLUS_CARDKEY_DIR`
- `ASLOGA_CARDKEY_DIR`
- `MINDPLUS_CREDITS_RECORD_FILE`
- `ASLOGA_CREDITS_RECORD_FILE`

> 说明：系统会校验卡密签名、批次、有效期，并联合检查 `minduser` 数据库与 legacy `redemption_records.json`，避免重复兑换。

## 5. 接口清单（按 CRUD）

### 5.1 Create（新增）

#### 5.1.1 卡密校验

- `POST /api/:service/credits/validate`

权限：

- 登录用户（Bearer Token）

请求体：

```json
{
  "card": "XXXX-XXXX-XXXX-XXXX"
}
```

成功返回（示例）：

```json
{
  "code": 200,
  "message": "该卡密可兑换100元积分（1000 credits）",
  "data": {
    "card": "CV5C-6AAA-XXXX-XXXX",
    "can_redeem": true,
    "is_used": false,
    "is_expired": false,
    "used_by": null,
    "used_at": null,
    "used_source": null,
    "batch_id": 325166,
    "batch_no": "B20260317A",
    "face_value": "100元年卡",
    "sale_price": "79.90",
    "valid_days": 365,
    "start_date": "2026-03-17",
    "expire_at": "2027-03-17",
    "redeemable_yuan": 100,
    "redeemable_credits": 1000,
    "message": "该卡密可兑换100元积分（1000 credits）"
  }
}
```

常见错误：

- `400`：缺少 card、卡密格式非法、过期等
- `404`：service 不存在
- `500`：卡密目录/密钥/批次文件异常

---

#### 5.1.2 卡密兑换（入账）

- `POST /api/:service/credits/redeem`

权限：

- 登录用户（Bearer Token）

请求体：

```json
{
  "uid": "A7K3M9Q2TP",
  "card": "XXXX-XXXX-XXXX-XXXX"
}
```

说明：

- 普通用户 `uid` 只能填写本人 UID（否则 `403`）
- 管理员可通过 `uid` 指定目标用户充值

成功返回（示例）：

```json
{
  "code": 200,
  "message": "兑换成功",
  "data": {
    "account": "A7K3M9Q2TP",
    "uid": "A7K3M9Q2TP",
    "username": "alice",
    "card": "CV5C-6AAA-XXXX-XXXX",
    "batch_id": 325166,
    "batch_no": "B20260317A",
    "face_value": "100元年卡",
    "sale_price": "79.90",
    "valid_days": 365,
    "start_date": "2026-03-17",
    "expire_at": "2027-03-17",
    "redeemable_yuan": 100,
    "redeemable_credits": 1000,
    "redeemed_at": "2026-03-21T09:10:00.000Z",
    "credits_balance": 1260
  }
}
```

兑换成功会同时执行：

1. 用户钱包余额增加 `credits`
2. 写入 `wallet_transactions`
3. 写入 `user_recharge_records`（用户侧简版）
4. 写入 `admin_recharge_records`（后台全量）

常见错误：

- `400`：参数缺失、卡密过期、面值无法计算 credits
- `403`：普通用户尝试为他人 UID 兑换
- `409`：卡密已被使用

---

#### 5.1.3 开放回调充值（兼容接口）

- `POST /api/:service/open/recharge-card`
- `POST /api/:service/open/recharge`（别名）

用途：

- 供外部系统直接写入充值数据（无需卡密算法校验）
- 入账与记录规则与 `credits/redeem` 一致

请求体字段（兼容命名）：

- `uid` / `userId` / `user_id`：必填，用户 UID
- `cardString` / `card` / `cardCode` / `card_code` / `卡密字符串`：必填
- `faceValue` / `face_value` / `对应面值`：必填
- `creditsAmount` / `credits_amount` / `redeemable_credits` / `充值credits`：可选（优先入账）
- `salePrice` / `sale_price` / `售价`：可选
- `validPeriod` / `valid_days` / `expireAt` / `有效期` / `有效期（建议≥1 年）`：可选
- `batchNo` / `batch_no` / `批次号` / `批次号（便于对账）`：可选

### 5.2 Read（查询）

#### 5.2.1 当前用户钱包汇总

- `GET /api/:service/wallet/summary`

返回字段：

- `uid`
- `username`
- `credits`（当前余额）
- `recharge_count`
- `last_recharge`
- `created_at`

#### 5.2.2 当前用户充值记录（简版）

- `GET /api/:service/wallet/recharges?page=1&limit=50`

返回字段：

- `list[].card_code`
- `list[].face_value`
- `list[].recharge_amount`
- `list[].recharged_at`
- `total`
- `page`
- `limit`

#### 5.2.3 兑换记录查询（CDKey API）

- `GET /api/:service/credits/redemptions?page=1&limit=20`

查询参数：

- `page`：默认 `1`
- `limit`：默认 `20`，最大 `200`
- `account` / `uid`：可选

权限说明：

- 普通用户：只能查本人
- 管理员：可查指定 UID；不传 UID 时查看当前服务全量记录

返回字段：

- `list[].account`
- `list[].uid`
- `list[].username`
- `list[].card`
- `list[].batch_no`
- `list[].face_value`
- `list[].sale_price`
- `list[].valid_days`
- `list[].start_date`
- `list[].expire_at`
- `list[].redeemed_at`
- `total`
- `page`
- `limit`

#### 5.2.4 后台总览

- `GET /api/:service/admin/dashboard`

返回字段：

- `users_total`
- `users_with_recharge`
- `total_credits_balance`
- `recharge_total_count`
- `recharge_total_amount`

#### 5.2.5 后台用户列表

- `GET /api/:service/admin/users?page=1&limit=100&username=xxx`

返回字段：

- `list[].id`
- `list[].username`
- `list[].role`
- `list[].credits_balance`
- `list[].recharge_count`
- `list[].created_at`

#### 5.2.6 后台充值记录（全量）

- `GET /api/:service/admin/recharges?page=1&limit=100`

查询参数（全部可选）：

- `uid`
- `username`
- `card` / `card_code`
- `batch` / `batch_no`
- `date_from`
- `date_to`

返回字段：

- `list[].id`
- `list[].user_id`
- `list[].username`
- `list[].card_code`
- `list[].face_value`
- `list[].recharge_amount`
- `list[].sale_price`
- `list[].valid_period`
- `list[].batch_no`
- `list[].recharged_at`

#### 5.2.7 后台充值记录导出（Excel）

- `GET /api/:service/admin/recharges/export`

返回：

- `xlsx` 文件流
- 按筛选条件导出全量充值记录

### 5.3 Update（更新）

当前版本未开放 `credits` 更新接口。

### 5.4 Delete（删除）

当前版本未开放 `credits` 删除接口。
