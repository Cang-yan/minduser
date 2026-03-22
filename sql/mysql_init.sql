-- MindUser MySQL initialization script
-- Usage example:
--   mysql -h 127.0.0.1 -P 3306 -u <user> -p <database> < sql/mysql_init.sql

SET NAMES utf8mb4;
SET time_zone = '+08:00';

CREATE TABLE IF NOT EXISTS users (
  id                VARCHAR(64) PRIMARY KEY,
  service_key       VARCHAR(32) NOT NULL,
  username          VARCHAR(64) NOT NULL,
  email             VARCHAR(255) NULL,
  email_verified_at VARCHAR(40) NULL,
  password_hash     VARCHAR(255) NOT NULL,
  role              VARCHAR(32) NOT NULL DEFAULT 'user',
  account_status    VARCHAR(16) NOT NULL DEFAULT 'active',
  disabled_at       VARCHAR(40) NULL,
  credits_balance   DOUBLE NOT NULL DEFAULT 0,
  created_at        VARCHAR(40) NOT NULL,
  updated_at        VARCHAR(40) NOT NULL,
  UNIQUE KEY uq_users_service_username (service_key, username),
  UNIQUE KEY uq_users_service_email (service_key, email),
  KEY idx_users_service (service_key),
  KEY idx_users_service_status (service_key, account_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Backward-compatible补齐（老表没有邮箱列时）
SET @col_exists := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'users'
    AND COLUMN_NAME = 'email'
);
SET @ddl := IF(@col_exists = 0,
  'ALTER TABLE users ADD COLUMN email VARCHAR(255) NULL AFTER username',
  'SELECT 1'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @col_exists := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'users'
    AND COLUMN_NAME = 'email_verified_at'
);
SET @ddl := IF(@col_exists = 0,
  'ALTER TABLE users ADD COLUMN email_verified_at VARCHAR(40) NULL AFTER email',
  'SELECT 1'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @idx_exists := (
  SELECT COUNT(*)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'users'
    AND INDEX_NAME = 'uq_users_service_email'
);
SET @ddl := IF(@idx_exists = 0,
  'ALTER TABLE users ADD UNIQUE KEY uq_users_service_email (service_key, email)',
  'SELECT 1'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @col_exists := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'users'
    AND COLUMN_NAME = 'account_status'
);
SET @ddl := IF(@col_exists = 0,
  "ALTER TABLE users ADD COLUMN account_status VARCHAR(16) NOT NULL DEFAULT 'active' AFTER role",
  'SELECT 1'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @col_exists := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'users'
    AND COLUMN_NAME = 'disabled_at'
);
SET @ddl := IF(@col_exists = 0,
  'ALTER TABLE users ADD COLUMN disabled_at VARCHAR(40) NULL AFTER account_status',
  'SELECT 1'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @idx_exists := (
  SELECT COUNT(*)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'users'
    AND INDEX_NAME = 'idx_users_service_status'
);
SET @ddl := IF(@idx_exists = 0,
  'ALTER TABLE users ADD KEY idx_users_service_status (service_key, account_status)',
  'SELECT 1'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

UPDATE users
SET account_status = 'active'
WHERE account_status IS NULL OR account_status = '';

CREATE TABLE IF NOT EXISTS wallet_transactions (
  id                VARCHAR(64) PRIMARY KEY,
  service_key       VARCHAR(32) NOT NULL,
  user_id           VARCHAR(64) NOT NULL,
  change_amount     DOUBLE NOT NULL,
  balance_after     DOUBLE NOT NULL,
  reason            VARCHAR(64) NOT NULL,
  source_ref        VARCHAR(255) NULL,
  meta_json         LONGTEXT NULL,
  created_at        VARCHAR(40) NOT NULL,
  KEY idx_wallet_user (service_key, user_id, created_at),
  CONSTRAINT fk_wallet_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS user_recharge_records (
  id                VARCHAR(64) PRIMARY KEY,
  service_key       VARCHAR(32) NOT NULL,
  user_id           VARCHAR(64) NOT NULL,
  card_code         VARCHAR(255) NOT NULL,
  face_value        VARCHAR(255) NOT NULL,
  recharge_amount   DOUBLE NOT NULL,
  recharged_at      VARCHAR(40) NOT NULL,
  KEY idx_user_recharge_user (service_key, user_id, recharged_at),
  CONSTRAINT fk_user_recharge_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS admin_recharge_records (
  id                VARCHAR(64) PRIMARY KEY,
  service_key       VARCHAR(32) NOT NULL,
  user_id           VARCHAR(64) NOT NULL,
  username          VARCHAR(64) NOT NULL,
  card_code         VARCHAR(255) NOT NULL,
  face_value        VARCHAR(255) NOT NULL,
  sale_price        VARCHAR(64) NULL,
  valid_period      VARCHAR(255) NULL,
  batch_no          VARCHAR(128) NULL,
  recharge_amount   DOUBLE NOT NULL,
  recharged_at      VARCHAR(40) NOT NULL,
  payload_json      LONGTEXT NULL,
  created_at        VARCHAR(40) NOT NULL,
  UNIQUE KEY uq_admin_recharge_service_card (service_key, card_code),
  KEY idx_admin_recharge_service (service_key, recharged_at),
  CONSTRAINT fk_admin_recharge_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS email_verification_codes (
  id                VARCHAR(64) PRIMARY KEY,
  service_key       VARCHAR(32) NOT NULL,
  email             VARCHAR(255) NOT NULL,
  purpose           VARCHAR(32) NOT NULL,
  code_hash         VARCHAR(128) NOT NULL,
  expires_at        VARCHAR(40) NOT NULL,
  used_at           VARCHAR(40) NULL,
  created_at        VARCHAR(40) NOT NULL,
  KEY idx_email_codes_lookup (service_key, email, purpose, created_at),
  KEY idx_email_codes_expire (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
