#!/usr/bin/env python3
"""Card key core utilities.

- Card format: XXXX-XXXX-XXXX-XXXX (16 chars + 3 hyphens)
- Internal encoding: 80 bits
  - payload 60 bits:
      version(4) + batch_id(20) + serial(20) + nonce(16)
  - mac 20 bits: truncated HMAC-SHA256(payload)
"""

from __future__ import annotations

import datetime as dt
import hashlib
import hmac
import json
import os
import secrets
from pathlib import Path
from typing import Any, Dict, List, Tuple

ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # 32 chars
ALPHABET_MAP = {ch: i for i, ch in enumerate(ALPHABET)}
CARD_RAW_LEN = 16
CARD_GROUP = 4

VERSION = 1
PAYLOAD_BITS = 60
MAC_BITS = 20
TOTAL_BITS = 80

BASE_DIR = Path(__file__).resolve().parent
DEFAULT_REGISTRY_PATH = BASE_DIR / "batch_registry.json"
DEFAULT_SECRET_PATH = BASE_DIR / ".cardkey_secret"


class CardKeyError(Exception):
    """Card-key domain error."""


def now_local() -> dt.datetime:
    return dt.datetime.now().replace(microsecond=0)


def today_local() -> dt.date:
    return dt.date.today()


def parse_date(date_str: str) -> dt.date:
    return dt.datetime.strptime(date_str, "%Y-%m-%d").date()


def date_to_str(d: dt.date) -> str:
    return d.strftime("%Y-%m-%d")


def dt_to_str(v: dt.datetime) -> str:
    return v.strftime("%Y-%m-%d %H:%M:%S")


def ensure_secret(secret_path: Path = DEFAULT_SECRET_PATH) -> bytes:
    """Load existing secret or create one."""
    if secret_path.exists():
        raw = secret_path.read_text(encoding="utf-8").strip()
        if not raw:
            raise CardKeyError(f"Secret file is empty: {secret_path}")
        return bytes.fromhex(raw)

    key = secrets.token_bytes(32)
    secret_path.write_text(key.hex(), encoding="utf-8")
    try:
        os.chmod(secret_path, 0o600)
    except OSError:
        pass
    return key


def load_registry(registry_path: Path = DEFAULT_REGISTRY_PATH) -> Dict[str, Any]:
    if not registry_path.exists():
        return {"version": 1, "batches": {}, "batch_no_to_id": {}}

    try:
        data = json.loads(registry_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise CardKeyError(f"Registry JSON invalid: {registry_path}\n{exc}") from exc

    if not isinstance(data, dict):
        raise CardKeyError(f"Registry format invalid: {registry_path}")

    data.setdefault("version", 1)
    data.setdefault("batches", {})
    data.setdefault("batch_no_to_id", {})
    return data


def save_registry(data: Dict[str, Any], registry_path: Path = DEFAULT_REGISTRY_PATH) -> None:
    registry_path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def _to_base32_fixed(value: int, length: int = CARD_RAW_LEN) -> str:
    if value < 0:
        raise ValueError("value must be non-negative")
    chars: List[str] = []
    for _ in range(length):
        chars.append(ALPHABET[value & 31])
        value >>= 5
    if value:
        raise ValueError("value overflow for fixed base32 length")
    return "".join(reversed(chars))


def _from_base32_fixed(text: str) -> int:
    value = 0
    for ch in text:
        if ch not in ALPHABET_MAP:
            raise CardKeyError(f"Invalid card character: {ch}")
        value = (value << 5) | ALPHABET_MAP[ch]
    return value


def _format_card(raw16: str) -> str:
    return "-".join(raw16[i : i + CARD_GROUP] for i in range(0, CARD_RAW_LEN, CARD_GROUP))


def normalize_card(card: str) -> str:
    raw = card.strip().upper().replace("-", "")
    if len(raw) != CARD_RAW_LEN:
        raise CardKeyError(f"Card length must be {CARD_RAW_LEN} chars (without hyphens)")
    for ch in raw:
        if ch not in ALPHABET_MAP:
            raise CardKeyError(f"Card contains invalid char: {ch}")
    return raw


def _hmac_20bits(secret: bytes, payload60: int) -> int:
    payload_bytes = payload60.to_bytes(8, "big")  # top 4 bits are 0
    digest = hmac.new(secret, payload_bytes, hashlib.sha256).digest()
    full = int.from_bytes(digest[:4], "big")
    return (full >> (32 - MAC_BITS)) & ((1 << MAC_BITS) - 1)


def encode_card(batch_id: int, serial: int, nonce: int, secret: bytes, version: int = VERSION) -> str:
    if not (0 <= version < (1 << 4)):
        raise CardKeyError("version out of range")
    if not (0 <= batch_id < (1 << 20)):
        raise CardKeyError("batch_id out of range [0, 2^20)")
    if not (0 <= serial < (1 << 20)):
        raise CardKeyError("serial out of range [0, 2^20)")
    if not (0 <= nonce < (1 << 16)):
        raise CardKeyError("nonce out of range [0, 2^16)")

    payload = (version << 56) | (batch_id << 36) | (serial << 16) | nonce
    mac = _hmac_20bits(secret, payload)
    full80 = (payload << MAC_BITS) | mac

    raw16 = _to_base32_fixed(full80, CARD_RAW_LEN)
    return _format_card(raw16)


def decode_card(card: str, secret: bytes) -> Dict[str, int]:
    raw = normalize_card(card)
    full80 = _from_base32_fixed(raw)

    mac = full80 & ((1 << MAC_BITS) - 1)
    payload = full80 >> MAC_BITS
    expected = _hmac_20bits(secret, payload)

    if mac != expected:
        raise CardKeyError("Card MAC check failed (card invalid or secret mismatch)")

    version = (payload >> 56) & 0xF
    batch_id = (payload >> 36) & ((1 << 20) - 1)
    serial = (payload >> 16) & ((1 << 20) - 1)
    nonce = payload & 0xFFFF

    return {
        "version": version,
        "batch_id": batch_id,
        "serial": serial,
        "nonce": nonce,
        "card_normalized": _format_card(raw),
    }


def generate_unique_batch_id(existing_ids: List[int]) -> int:
    used = set(existing_ids)
    for _ in range(100000):
        candidate = secrets.randbelow(1 << 20)
        if candidate not in used:
            return candidate
    raise CardKeyError("Failed to allocate unique batch_id")


def get_or_create_batch(
    registry: Dict[str, Any],
    batch_no: str,
    face_value: str,
    sale_price: str,
    valid_days: int,
    start_date: dt.date,
) -> Dict[str, Any]:
    batch_no = batch_no.strip()
    if not batch_no:
        raise CardKeyError("batch_no cannot be empty")

    batch_no_to_id = registry.setdefault("batch_no_to_id", {})
    batches = registry.setdefault("batches", {})

    if batch_no in batch_no_to_id:
        batch_id = int(batch_no_to_id[batch_no])
        key = str(batch_id)
        if key not in batches:
            raise CardKeyError(f"Registry inconsistent: batch_no {batch_no} points to missing batch_id {batch_id}")

        meta = batches[key]

        # 如果已有批次，允许续发，但关键配置必须一致
        mismatches = []
        if str(meta.get("face_value")) != str(face_value):
            mismatches.append("face_value")
        if str(meta.get("sale_price")) != str(sale_price):
            mismatches.append("sale_price")
        if int(meta.get("valid_days", -1)) != int(valid_days):
            mismatches.append("valid_days")
        if str(meta.get("start_date")) != date_to_str(start_date):
            mismatches.append("start_date")

        if mismatches:
            raise CardKeyError(
                f"Existing batch_no '{batch_no}' has different config fields: {', '.join(mismatches)}"
            )

        return meta

    existing_ids = [int(x) for x in batches.keys()]
    batch_id = generate_unique_batch_id(existing_ids)
    expire_at = start_date + dt.timedelta(days=valid_days)

    meta = {
        "batch_id": batch_id,
        "batch_no": batch_no,
        "face_value": str(face_value),
        "sale_price": str(sale_price),
        "valid_days": int(valid_days),
        "start_date": date_to_str(start_date),
        "expire_at": date_to_str(expire_at),
        "created_at": dt_to_str(now_local()),
        "last_serial": 0,
        "total_generated": 0,
    }

    batch_no_to_id[batch_no] = batch_id
    batches[str(batch_id)] = meta
    return meta


def build_validity_text(start_date: dt.date, valid_days: int) -> str:
    expire_at = start_date + dt.timedelta(days=valid_days)
    return f"{date_to_str(start_date)} ~ {date_to_str(expire_at)}（{valid_days}天）"
