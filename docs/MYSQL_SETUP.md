# MySQL 落库配置说明

## 目标

将 `minduser` 的实际数据存储从 SQLite 切换为 MySQL，以提升并发写入场景下的稳定性。

## 一、安装依赖

项目已引入 `mysql2`，常规执行：

```bash
cd ~/LINGINE/minduser
npm install
```

## 二、准备 MySQL 数据库

示例（MySQL 8）：

```sql
CREATE DATABASE minduser
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;
```

## 三、配置 `.env`

```env
DB_CLIENT=mysql
DATABASE_URL=mysql://user:password@127.0.0.1:3306/minduser?charset=utf8mb4
DB_POOL_SIZE=10
```

字段说明：
- `DB_CLIENT`：数据库后端，`mysql` 或 `sqlite`
- `DATABASE_URL`：MySQL 连接串
- `DB_POOL_SIZE`：连接池大小（默认 10）

SQLite 回退配置：

```env
DB_CLIENT=sqlite
DB_PATH=./server/data/minduser.db
```

## 四、手动初始化表结构（推荐）

1. 执行初始化 SQL（推荐直接手动跑）：

```bash
mysql -h 127.0.0.1 -P 3306 -u <user> -p <database> < sql/mysql_init.sql
```

2. 如需先查看脚本内容：

```bash
npm run db:init:sql
```

3. 如需命令提示（不改库）：

```bash
npm run db:init
```

4. 建表完成后，写入默认管理员（按 `.env` 中账号配置）：

```bash
npm run db:init:seed
```

## 五、启动服务

```bash
npm run dev
# 或
npm start
```

说明：
- 服务端仍保留了启动时的兼容性建表/补齐逻辑，但推荐将初始化固定为手工执行 `sql/mysql_init.sql`，便于环境一致性与运维审计。

## 六、验证是否生效

可通过日志或运行时检查当前模式：

```bash
node -e "const {db}=require('./server/db'); db.ready().then((r)=>console.log(r.mode))"
```

输出 `mysql` 即表示已切换成功。

## 七、注意事项

- 数据库实现已按文件拆分：
  - `server/db/mysql.js`
  - `server/db/sqlite.js`
  - `server/db.js` 仅做分发
- 邮箱验证码、用户、钱包、充值、后台记录都走同一个主库（即当前 `DB_CLIENT` 指向的库）。
- 如果 `DB_CLIENT=mysql` 但 `DATABASE_URL` 为空，服务会启动失败并给出明确错误。
- 如果你只在低并发场景使用，`sqlite` 仍然可用；生产高并发推荐 `mysql`。
