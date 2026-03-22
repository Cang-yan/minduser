#!/usr/bin/env python3
"""Batch-generate card keys and export to CSV (.csv).

Columns exported:
1. 卡密字符串
2. 对应面值/规格
3. 售价
4. 有效期（建议≥1 年）
5. 批次号（便于对账）
"""

from __future__ import annotations

import argparse
import csv
import datetime as dt
import re
import secrets
import sys
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import List, Sequence

from cardkey_core import (
    BASE_DIR,
    CardKeyError,
    build_validity_text,
    date_to_str,
    ensure_secret,
    encode_card,
    get_or_create_batch,
    load_registry,
    now_local,
    parse_date,
    save_registry,
)

HEADERS = [
    "卡密字符串",
    "对应面值/规格",
    "售价",
    "有效期（建议≥1 年）",
    "批次号（便于对账）",
]


def write_csv(path: Path, headers: Sequence[str], rows: Sequence[Sequence[str]]) -> None:
    # utf-8-sig improves Chinese display compatibility when opened directly in Excel.
    with path.open("w", encoding="utf-8-sig", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(headers)
        writer.writerows(rows)


def clean_filename(text: str) -> str:
    s = re.sub(r"[^0-9A-Za-z._-]+", "_", text.strip())
    return s or "batch"


def parse_sale_price(v: str) -> str:
    try:
        d = Decimal(v)
    except InvalidOperation as exc:
        raise CardKeyError(f"售价格式不合法: {v}") from exc
    if d < 0:
        raise CardKeyError("售价不能为负数")
    return f"{d.quantize(Decimal('0.01'))}"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="批量生成卡密并导出 CSV")
    parser.add_argument("-n", "--count", type=int, help="生成数量，例如 100")
    parser.add_argument("--face-value", help="面值/规格，例如 100元月卡")
    parser.add_argument("--sale-price", help="售价，例如 79.90")
    parser.add_argument("--valid-days", type=int, help="有效期天数，建议 >= 365")
    parser.add_argument("--batch-no", help="批次号，例如 B20260317A")
    parser.add_argument("--start-date", help="生效起始日期 YYYY-MM-DD，默认今天")
    parser.add_argument("--output", help="输出 csv 文件名或路径")
    parser.add_argument("--registry", help="批次注册表路径，默认当前目录 batch_registry.json")
    parser.add_argument("--secret-file", help="密钥文件路径，默认当前目录 .cardkey_secret")
    parser.add_argument("--interactive", action="store_true", help="交互式输入缺失参数")
    return parser.parse_args()


def ask_if_missing(value: str | int | None, prompt: str, cast=str):
    if value is not None:
        return value
    while True:
        raw = input(prompt).strip()
        if not raw:
            print("输入不能为空，请重试。")
            continue
        try:
            return cast(raw)
        except Exception as exc:
            print(f"输入不合法: {exc}")


def main() -> int:
    args = parse_args()

    need_interactive = args.interactive or any(
        x is None for x in [args.count, args.face_value, args.sale_price, args.valid_days, args.batch_no]
    )

    count = args.count
    face_value = args.face_value
    sale_price_raw = args.sale_price
    valid_days = args.valid_days
    batch_no = args.batch_no

    if need_interactive:
        print("=== 卡密批量生成（交互模式）===")
        count = ask_if_missing(count, "生成数量: ", int)
        face_value = ask_if_missing(face_value, "面值/规格: ", str)
        sale_price_raw = ask_if_missing(sale_price_raw, "售价: ", str)
        valid_days = ask_if_missing(valid_days, "有效期天数(建议>=365): ", int)
        batch_no = ask_if_missing(batch_no, "批次号: ", str)

    try:
        if count is None or count <= 0:
            raise CardKeyError("生成数量必须为正整数")
        if valid_days is None or valid_days <= 0:
            raise CardKeyError("有效期天数必须为正整数")

        sale_price = parse_sale_price(str(sale_price_raw))

        if args.start_date:
            start_date = parse_date(args.start_date)
        else:
            start_date = dt.date.today()

        if valid_days < 365:
            print("[提示] 你设置的有效期 < 365 天。通常建议 >= 1 年。")

        registry_path = Path(args.registry).expanduser().resolve() if args.registry else BASE_DIR / "batch_registry.json"
        secret_path = Path(args.secret_file).expanduser().resolve() if args.secret_file else BASE_DIR / ".cardkey_secret"

        secret = ensure_secret(secret_path)
        registry = load_registry(registry_path)

        batch = get_or_create_batch(
            registry=registry,
            batch_no=str(batch_no),
            face_value=str(face_value),
            sale_price=sale_price,
            valid_days=int(valid_days),
            start_date=start_date,
        )

        batch_id = int(batch["batch_id"])
        start_serial = int(batch.get("last_serial", 0))

        if start_serial + int(count) >= (1 << 20):
            raise CardKeyError("该批次可用序列号不足（单批次上限约 100 万）")

        generated_rows: List[List[str]] = []
        generated_set = set()

        validity_text = build_validity_text(start_date, int(valid_days))
        for i in range(1, int(count) + 1):
            serial = start_serial + i
            nonce = secrets.randbelow(1 << 16)
            card = encode_card(batch_id=batch_id, serial=serial, nonce=nonce, secret=secret)
            if card in generated_set:
                # 极低概率，仅做稳妥保护
                nonce = secrets.randbelow(1 << 16)
                card = encode_card(batch_id=batch_id, serial=serial, nonce=nonce, secret=secret)
            generated_set.add(card)

            generated_rows.append([
                card,
                str(face_value),
                sale_price,
                validity_text,
                str(batch_no),
            ])

        batch["last_serial"] = start_serial + int(count)
        batch["total_generated"] = int(batch.get("total_generated", 0)) + int(count)
        batch["updated_at"] = now_local().strftime("%Y-%m-%d %H:%M:%S")

        save_registry(registry, registry_path)

        if args.output:
            out_path = Path(args.output).expanduser()
            if not out_path.is_absolute():
                out_path = BASE_DIR / out_path
            if out_path.suffix.lower() != ".csv":
                out_path = out_path.with_suffix(".csv")
        else:
            ts = now_local().strftime("%Y%m%d_%H%M%S")
            out_path = BASE_DIR / f"cardkeys_{clean_filename(str(batch_no))}_{ts}.csv"

        out_path.parent.mkdir(parents=True, exist_ok=True)
        write_csv(out_path, HEADERS, generated_rows)

        print("\n=== 生成完成 ===")
        print(f"输出文件: {out_path}")
        print(f"批次号: {batch_no}")
        print(f"批次ID: {batch_id}")
        print(f"生成数量: {count}")
        print(f"面值/规格: {face_value}")
        print(f"售价: {sale_price}")
        print(f"有效期: {validity_text}")
        print(f"注册表: {registry_path}")
        print(f"密钥文件: {secret_path}")

        preview = generated_rows[:3]
        if preview:
            print("\n示例卡密:")
            for row in preview:
                print(f"- {row[0]}")

        return 0

    except CardKeyError as exc:
        print(f"[错误] {exc}", file=sys.stderr)
        return 2
    except KeyboardInterrupt:
        print("\n已取消。", file=sys.stderr)
        return 130


if __name__ == "__main__":
    raise SystemExit(main())
