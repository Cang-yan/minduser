# MindUser 部署、升级、运维手册

适用项目：`~/LINGINE/minduser`  
文档版本：`v1`  
更新时间：`2026-03-22`

## 1. 项目概览

MindUser 是一个 Node.js + Fastify + SQLite 的双服务会员系统，服务分区包括：

- `mindplus`
- `asloga`

核心能力：

- 用户注册/登录、管理员登录
- JWT 鉴权
- 10 位 UID 生成
- `credits` 钱包（充值、消耗、流水）
- CDKey 校验与兑换
- 后台统计、充值记录、Excel 导出
- 服务隔离（页面、数据、后台权限）

## 2. 运行环境要求

- OS：Linux（推荐 Ubuntu 22.04+）
- Node.js：`20.x` 或更高（推荐 LTS）
- npm：`10.x` 或更高
- 磁盘：建议至少 10GB 可用空间
- 内存：建议至少 1GB（生产建议 2GB+）

可选依赖（运维建议）：

- `nginx`（反向代理 + TLS）
- `sqlite3` CLI（便于一致性备份与排障）

## 3. 目录与关键文件

项目根目录：`/home/xx/LINGINE/minduser`

关键路径：

- 启动入口：`server/server.js`
- 配置：`server/config.js`
- 数据库：`server/data/minduser.db`
- 环境变量模板：`.env.example`
- API 路由：`server/routes/*.js`
- 前端静态页：`server/public/*`
- MindPlus 卡密目录（已迁入本项目）：`cardkey/`
- 接口文档：`docs/CREDITS_API.md`

## 4. 页面与接口清单

### 4.1 页面路由

用户侧：

- `/{service}/login`
- `/{service}/app`
- `/{service}/cdkey`
- `/{service}/credits`（cdkey 页面别名）

管理员侧（隐藏入口）：

- `/adminadmin/{service}/login`
- `/adminadmin/{service}`

兼容跳转：

- `/{service}/admin/login` -> 重定向到 `/adminadmin/{service}/login`
- `/{service}/admin` -> 重定向到 `/adminadmin/{service}`

### 4.2 核心 API

系统：

- `GET /health`
- `GET /api/services`

认证：

- `POST /api/:service/auth/register`
- `POST /api/:service/auth/login`
- `POST /api/:service/auth/admin-login`
- `GET /api/:service/auth/me`

钱包：

- `GET /api/:service/wallet/summary`
- `GET /api/:service/wallet/recharges`
- `GET /api/:service/wallet/consumptions`

CDKey：

- `POST /api/:service/credits/validate`
- `POST /api/:service/credits/redeem`
- `GET /api/:service/credits/redemptions`

开放充值接口：

- `POST /api/:service/open/recharge-card`
- `POST /api/:service/open/recharge`

开放扣减接口：

- `POST /api/:service/open/consume`
- `POST /api/:service/open/deduct`

后台：

- `GET /api/:service/admin/dashboard`
- `GET /api/:service/admin/users`
- `GET /api/:service/admin/recharges`
- `GET /api/:service/admin/recharges/export`

## 5. 环境变量说明

来源：`.env`（可由 `.env.example` 拷贝）

基础：

- `PORT`：监听端口（默认 `3100`）
- `HOST`：监听地址（默认 `0.0.0.0`）
- `DB_PATH`：SQLite 路径（默认 `./server/data/minduser.db`）

安全：

- `JWT_SECRET`：JWT 密钥（生产必须修改）
- `JWT_EXPIRY`：JWT 过期时间（默认 `7d`）
- `INTERNAL_RECHARGE_KEY`：开放写接口内部鉴权密钥（强烈建议生产配置）

CORS：

- `CORS_ORIGIN`：允许跨域来源（生产不要使用 `*`）

卡密路径覆盖（可选）：

- `MINDPLUS_CARDKEY_DIR`
- `ASLOGA_CARDKEY_DIR`
- `MINDPLUS_CREDITS_RECORD_FILE`
- `ASLOGA_CREDITS_RECORD_FILE`

功能首页跳转：

- `MINDPLUS_FEATURE_HOME_URL`
- `ASLOGA_FEATURE_HOME_URL`

管理员种子账号：

- `MINDPLUS_ADMIN_USERNAME` / `MINDPLUS_ADMIN_PASSWORD`
- `ASLOGA_ADMIN_USERNAME` / `ASLOGA_ADMIN_PASSWORD`

## 6. 首次部署（单机）

### 6.1 安装依赖

```bash
cd /home/xx/LINGINE/minduser
cp .env.example .env
npm install
```

### 6.2 配置 `.env`

至少修改：

- `JWT_SECRET`
- `MINDPLUS_ADMIN_PASSWORD`
- `ASLOGA_ADMIN_PASSWORD`
- `INTERNAL_RECHARGE_KEY`（建议）
- `CORS_ORIGIN`（生产按域名设置）

### 6.3 启动验证

开发模式：

```bash
npm run dev
```

生产模式：

```bash
npm start
```

健康检查：

```bash
curl -s http://127.0.0.1:3100/health
```

## 7. 生产托管（systemd 推荐）

### 7.1 systemd 服务文件

新建：`/etc/systemd/system/minduser.service`

```ini
[Unit]
Description=MindUser Membership Service
After=network.target

[Service]
Type=simple
User=xx
WorkingDirectory=/home/xx/LINGINE/minduser
Environment=NODE_ENV=production
ExecStart=/usr/bin/npm start
Restart=always
RestartSec=3
LimitNOFILE=65535

[Install]
WantedBy=multi-user.target
```

### 7.2 启停命令

```bash
sudo systemctl daemon-reload
sudo systemctl enable minduser
sudo systemctl start minduser
sudo systemctl status minduser
```

日志查看：

```bash
journalctl -u minduser -f
```

## 8. Nginx 反向代理（可选）

示例：

```nginx
server {
  listen 80;
  server_name your-domain.com;

  location / {
    proxy_pass http://127.0.0.1:3100;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

上线建议使用 HTTPS（Let's Encrypt + certbot）。

## 9. 日常运维手册

### 9.1 基础巡检

- 进程状态：`systemctl status minduser`
- 健康检查：`curl http://127.0.0.1:3100/health`
- 端口监听：`lsof -iTCP:3100 -sTCP:LISTEN -n -P`
- 接口可用性：`curl http://127.0.0.1:3100/api/services`

### 9.2 常见故障处理

端口占用（`EADDRINUSE`）：

```bash
lsof -tiTCP:3100 -sTCP:LISTEN | xargs -r kill -TERM
sleep 1
lsof -tiTCP:3100 -sTCP:LISTEN | xargs -r kill -9
```

登录失败（401）：

- 检查 `JWT_SECRET` 是否在重启后变化
- 检查 token 是否过期

CDKey 校验失败（500）：

- 检查 `cardkey` 目录是否存在
- 检查 `.cardkey_secret` 和 `batch_registry.json` 权限与内容

### 9.3 数据备份（SQLite + WAL）

推荐方式（服务不停机时使用 `sqlite3 .backup`）：

```bash
sqlite3 /home/xx/LINGINE/minduser/server/data/minduser.db \
  ".backup '/home/xx/backup/minduser_$(date +%F_%H%M%S).db'"
```

兜底方式（停服务后文件级备份）：

```bash
sudo systemctl stop minduser
cp /home/xx/LINGINE/minduser/server/data/minduser.db* /home/xx/backup/
sudo systemctl start minduser
```

同时备份关键配置：

- `/home/xx/LINGINE/minduser/.env`
- `/home/xx/LINGINE/minduser/cardkey/.cardkey_secret`
- `/home/xx/LINGINE/minduser/cardkey/batch_registry.json`

### 9.4 数据恢复

```bash
sudo systemctl stop minduser
cp /home/xx/backup/minduser_xxx.db /home/xx/LINGINE/minduser/server/data/minduser.db
sudo chown xx:xx /home/xx/LINGINE/minduser/server/data/minduser.db
sudo systemctl start minduser
```

恢复后检查：

- `/health`
- 管理后台统计页面
- 随机用户登录与余额查询

## 10. 升级流程（推荐）

### 10.1 升级前检查

- 记录当前版本（`git rev-parse --short HEAD`）
- 备份数据库与 `.env`
- 确认磁盘空间与权限

### 10.2 执行升级

```bash
cd /home/xx/LINGINE/minduser
git fetch --all
git checkout <target-branch-or-tag>
git pull
npm install --omit=dev
```

重启服务：

```bash
sudo systemctl restart minduser
```

### 10.3 升级后验证

- `curl /health`
- 用户登录与注册
- CDKey 校验与兑换
- 后台登录与导出
- 消耗接口与消耗记录展示

### 10.4 回滚

```bash
cd /home/xx/LINGINE/minduser
git checkout <previous-tag-or-commit>
npm install --omit=dev
sudo systemctl restart minduser
```

必要时恢复升级前数据库备份。

## 11. 安全与合规建议

- 强制修改默认管理员密码
- 配置 `INTERNAL_RECHARGE_KEY` 并仅开放内网调用开放写接口
- `CORS_ORIGIN` 改为明确域名，避免 `*`
- `.env` 权限设置为 `600`
- 数据目录权限最小化（仅运行用户可读写）
- 仅暴露 Nginx 端口，应用端口走本机回环
- 关键操作（充值/扣减）建议在调用侧实现签名与重试幂等

## 12. 运维检查清单（上线前）

- `.env` 已更新生产密钥
- 管理员账号非默认密码
- `/health` 正常
- 数据备份任务已验证
- 日志采集（journald 或其他）已接入
- 防火墙与 HTTPS 已配置
- 回滚方案已演练

