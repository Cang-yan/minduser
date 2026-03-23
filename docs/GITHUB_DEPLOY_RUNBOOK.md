# MindUser GitHub 更新与部署方案

适用项目：`/home/xx/LINGINE/minduser`  
更新时间：`2026-03-23`  
参考来源：`/home/xx/LINGINE/mindplus/DEPLOY_OPS_RUNBOOK.md`

## 1. 目标

通过 GitHub 直接在服务器更新代码并部署，不再依赖手工打包上传。

适用场景：
- 服务器可直接访问 GitHub
- 已使用 `systemd` 托管 `minduser` 服务
- 数据库为 MySQL（`minduser` 库）

## 2. 一次性准备

### 2.1 服务器目录初始化（首次）

```bash
mkdir -p /home/xx/LINGINE
cd /home/xx/LINGINE
git clone <YOUR_GITHUB_REPO_URL> minduser
cd /home/xx/LINGINE/minduser
```

### 2.2 依赖与环境文件

```bash
cp .env.example .env
npm ci
```

至少检查 `.env`：
- `PORT`
- `HOST`
- `JWT_SECRET`
- `DB_CLIENT=mysql`
- `DATABASE_URL=mysql://...`
- `INTERNAL_RECHARGE_KEY`
- `MINDPLUS_ADMIN_PASSWORD`

### 2.3 初始化数据库（首次）

```bash
cd /home/xx/LINGINE/minduser
mysql -h 127.0.0.1 -P 3306 -u <user> -p < sql/mysql_init.sql
#注入管理员用户
npm run db:init:seed
npm run db:check
```

### 2.4 systemd 托管（首次）

`/etc/systemd/system/minduser.service`：

```ini
[Unit]
Description=MindUser Service
After=network.target

[Service]
Type=simple
User=xx
WorkingDirectory=/home/xx/LINGINE/minduser
Environment=NODE_ENV=production
EnvironmentFile=/home/xx/LINGINE/minduser/.env
ExecStart=/usr/bin/npm start
Restart=always
RestartSec=3
LimitNOFILE=65535

[Install]
WantedBy=multi-user.target
```

启用：

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now minduser
sudo systemctl status minduser --no-pager
```

## 3. 日常发布流程（GitHub 更新）

下面流程适用于每次发版，建议按顺序执行。

### 3.1 发布前备份（必须）

```bash
mkdir -p /home/xx/backup

# 1) 备份数据库
mysqldump -h 127.0.0.1 -P 3306 -u <user> -p \
  --single-transaction --default-character-set=utf8mb4 \
  minduser > /home/xx/backup/minduser_$(date +%F_%H%M%S).sql

# 2) 备份环境变量
cp /home/xx/LINGINE/minduser/.env /home/xx/backup/minduser_env_$(date +%F_%H%M%S).bak
```

### 3.2 获取目标版本

```bash
cd /home/xx/LINGINE/minduser
git fetch --all --tags
git status --short
```

选择一种方式：

方式 A（发布分支）：

```bash
git checkout main
git pull --ff-only origin main
```

方式 B（发布 tag）：

```bash
git checkout tags/<release-tag>
```

建议记录发布前后版本：

```bash
git rev-parse --short HEAD
```

### 3.3 安装依赖与数据库幂等升级

```bash
cd /home/xx/LINGINE/minduser
npm ci --omit=dev
mysql -h 127.0.0.1 -P 3306 -u <user> -p < sql/mysql_init.sql
npm run db:init:seed
npm run db:check
```

说明：
- `sql/mysql_init.sql` 设计为幂等，可重复执行
- `db:init:seed` 仅补齐管理员账号，不会重置业务数据

### 3.4 重启服务

```bash
sudo systemctl restart minduser
sudo systemctl status minduser --no-pager
```

### 3.5 发布后验收

```bash
curl -s http://127.0.0.1:3100/health
curl -s http://127.0.0.1:3100/api/services
```

业务验收建议：
- 用户注册（含邮箱去重）
- 用户登录（用户名与邮箱各测一次）
- CDKey 校验与兑换
- 管理后台登录与充值记录导出

## 4. 快速回滚方案

### 4.1 代码回滚

```bash
cd /home/xx/LINGINE/minduser
git reflog --date=local -n 20
git checkout <previous-commit-or-tag>
npm ci --omit=dev
sudo systemctl restart minduser
```

### 4.2 数据回滚（必要时）

```bash
mysql -h 127.0.0.1 -P 3306 -u <user> -p minduser < /home/xx/backup/<backup-file>.sql
sudo systemctl restart minduser
```

## 5. 常用排障命令

```bash
journalctl -u minduser -f
journalctl -u minduser -n 200 --no-pager
ss -ltnp | rg ':3100'
```

## 6. 建议的 GitHub 发布规范

- 使用受保护分支（`main`）
- 每次上线打 tag（如 `minduser-v2026.03.23-1`）
- PR 合并后再执行服务器更新
- 生产发布固定使用 `git pull --ff-only`，避免意外 merge commit
