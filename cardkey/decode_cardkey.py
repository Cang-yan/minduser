#!/usr/bin/env python3
"""Decode one card key and read its mapped face value / validity info."""

from __future__ import annotations

import argparse
import datetime as dt
import json
import sys
from pathlib import Path

from cardkey_core import (
    BASE_DIR,
    CardKeyError,
    decode_card,
    ensure_secret,
    load_registry,
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="解密并查询卡密信息")
    parser.add_argument("-c", "--card", required=True, help="卡密，例如 ABCD-EFGH-JKLM-NPQR")
    parser.add_argument("--registry", help="批次注册表路径，默认当前目录 batch_registry.json")
    parser.add_argument("--secret-file", help="密钥文件路径，默认当前目录 .cardkey_secret")
    parser.add_argument("--json", action="store_true", help="JSON 输出")
    return parser.parse_args()


def main() -> int:
    args = parse_args()

    registry_path = Path(args.registry).expanduser().resolve() if args.registry else BASE_DIR / "batch_registry.json"
    secret_path = Path(args.secret_file).expanduser().resolve() if args.secret_file else BASE_DIR / ".cardkey_secret"

    try:
        secret = ensure_secret(secret_path)
        registry = load_registry(registry_path)

        core = decode_card(args.card, secret)
        batch_id = int(core["batch_id"])

        batch = registry.get("batches", {}).get(str(batch_id))
        if not batch:
            raise CardKeyError(
                f"卡密校验通过，但找不到 batch_id={batch_id} 的业务配置。"
                "\n可能原因：注册表文件不一致或该批次尚未导入。"
            )

        expire_at = batch.get("expire_at")
        status = "未知"
        if expire_at:
            try:
                expire_date = dt.datetime.strptime(expire_at, "%Y-%m-%d").date()
                status = "有效" if dt.date.today() <= expire_date else "已过期"
            except ValueError:
                status = "有效期格式异常"

        result = {
            "card": core["card_normalized"],
            "batch_no": batch.get("batch_no"),
            "batch_id": batch_id,
            "serial": core.get("serial"),
            "face_value": batch.get("face_value"),
            "sale_price": batch.get("sale_price"),
            "start_date": batch.get("start_date"),
            "expire_at": batch.get("expire_at"),
            "valid_days": batch.get("valid_days"),
            "status": status,
            "registry": str(registry_path),
        }

        if args.json:
            print(json.dumps(result, ensure_ascii=False, indent=2))
            return 0

        print("=== 卡密解析结果 ===")
        print(f"卡密: {result['card']}")
        print(f"批次号: {result['batch_no']} (batch_id={result['batch_id']})")
        print(f"序列号: {result['serial']}")
        print(f"面值/规格: {result['face_value']}")
        print(f"售价: {result['sale_price']}")
        print(f"有效期: {result['start_date']} ~ {result['expire_at']} ({result['valid_days']}天)")
        print(f"当前状态: {result['status']}")
        print(f"注册表: {result['registry']}")
        return 0

    except CardKeyError as exc:
        print(f"[错误] {exc}", file=sys.stderr)
        return 2
    except KeyboardInterrupt:
        print("\n已取消。", file=sys.stderr)
        return 130


if __name__ == "__main__":
    raise SystemExit(main())
