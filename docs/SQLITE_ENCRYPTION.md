# MindUser SQLite 加密方案

> 说明：`minduser` 已于 2026-03-23 切换为 MySQL-only，本文件仅作历史归档参考，不再作为当前部署方案。

适用项目：`~/LINGINE/minduser`  
文档版本：`v1`  
更新时间：`2026-03-22`

## 1. 目标与约束

目标：

- 实现 SQLite 数据“静态加密（at-rest encryption）”
- 避免数据库文件泄露后可被直接读取
- 保持现有业务（认证、充值、扣减、后台统计）可用

当前项目约束：

- 代码使用 `node:sqlite`（`DatabaseSync`）
- 默认 SQLite 不支持 `PRAGMA key`，即不支持库级透明加密

结论：

- 若要“真正的 SQLite 库级加密”，需要引入 SQLCipher 方案
- 若暂不改代码，可先落地磁盘层加密（运维级）

## 2. 方案对比

### 方案 A（短期可快速上线）：磁盘层加密

实现方式：

- 使用 LUKS / dm-crypt 对数据盘或数据目录所在分区加密
- 应用层代码无需改动

优点：

- 上线快
- 不改 Node 代码
- 对性能影响可控

缺点：

- 系统挂载后，拥有主机权限的人仍可读明文 DB
- 无法细粒度控制“数据库级密钥轮换”

适用场景：

- 先满足合规“静态加密”要求
- 近期不希望动数据库驱动

### 方案 B（推荐中期目标）：SQLCipher 数据库级加密

实现方式：

- SQLite 引擎切换为 SQLCipher
- 应用启动时提供数据库密钥（`DB_KEY`）
- 使用 `PRAGMA key` 解密并读写

优点：

- 数据库文件单独泄露时仍无法直接读取
- 支持密钥轮换（`PRAGMA rekey`）

缺点：

- 需要改造当前数据库接入层
- 部署环境需要 SQLCipher 依赖

适用场景：

- 对数据库文件泄露风险敏感
- 需要明确的数据库密钥生命周期管理

## 3. 推荐落地路径（分阶段）

### Phase 0（立即执行）

- 先做备份加密与权限收敛：
- `.env` 权限 `600`
- 数据目录最小权限
- 备份文件使用 `age` 或 `gpg` 加密

### Phase 1（1-2 天）

- 上线磁盘层加密（方案 A）
- 完成恢复演练

### Phase 2（1-2 周）

- 实施 SQLCipher（方案 B）
- 进行停机迁移、验收与回滚预案

## 4. SQLCipher 改造设计（方案 B）

## 4.1 代码改造点

当前：`server/db.js` 使用 `node:sqlite`。

改造建议：

- 新增 `DB_KEY` 环境变量
- 数据库驱动替换为支持 SQLCipher 的实现（示例：`better-sqlite3` + SQLCipher 版本）
- 打开数据库后执行：
- `PRAGMA key = '...';`
- 必要时设置：
- `PRAGMA cipher_compatibility = 4;`

注意：

- 需要确保运行时使用的是 SQLCipher 版 SQLite，而非普通 SQLite

## 4.2 迁移步骤（明文 -> 加密）

假设当前明文库：

- `/home/xx/LINGINE/minduser/server/data/minduser.db`

迁移流程（维护窗口执行）：

1. 停服务

```bash
sudo systemctl stop minduser
```

2. 备份明文库

```bash
cp /home/xx/LINGINE/minduser/server/data/minduser.db \
  /home/xx/backup/minduser_plain_$(date +%F_%H%M%S).db
```

3. 使用 SQLCipher 导出加密库（示例）

```sql
ATTACH DATABASE '/home/xx/LINGINE/minduser/server/data/minduser_encrypted.db' AS encrypted KEY 'YourStrongDBKey';
SELECT sqlcipher_export('encrypted');
DETACH DATABASE encrypted;
```

4. 替换库文件并配置 `DB_KEY`

5. 启动服务并验证

```bash
sudo systemctl start minduser
curl -s http://127.0.0.1:3100/health
```

6. 抽样验证登录、充值、扣减、后台导出

## 4.3 密钥管理建议

- `DB_KEY` 不入库、不进 Git
- 优先使用：
- KMS / Vault / 密钥管理平台注入
- 退而求其次：`.env`（权限必须 `600`）
- 建议季度轮换一次

轮换命令（SQLCipher）：

```sql
PRAGMA rekey = 'NewStrongDBKey';
```

## 4.4 回滚预案

若 SQLCipher 迁移异常：

1. 停服务
2. 恢复明文备份库
3. 回退到旧版数据库接入代码
4. 启动并验证

## 5. 运维配套（无论 A/B 都建议）

- 备份文件必须加密存储
- 备份至少保留 7/30/90 天分层策略
- 每月演练一次恢复
- 对开放写接口（`/open/recharge*`、`/open/consume*`）加内网 ACL + 网关签名
- 对数据库目录做审计（权限、访问日志）

## 6. 建议你现在就执行的最小集

1. 立即设置并轮换：`JWT_SECRET`、`INTERNAL_RECHARGE_KEY`。
2. 落地备份加密（`age`/`gpg`）与恢复演练。
3. 先上磁盘层加密（方案 A）以快速达标。
4. 排期 SQLCipher 改造（方案 B），把 `DB_KEY` 纳入密钥管理系统。

---

如果你希望，我可以下一步直接给你一版“可落地到当前代码”的 SQLCipher 改造补丁清单（含依赖、`db.js` 改造示例、迁移脚本模板和回滚脚本模板）。
