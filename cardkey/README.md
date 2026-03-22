# CardKey 脚本说明

目录：`/home/xx/LINGINE/minduser/cardkey`

## 文件结构

- `generate_cardkeys.py`：批量生成卡密并导出 CSV（`.csv`）
- `decode_cardkey.py`：单独的卡密解密/查询脚本
- `cardkey_core.py`：编码/解码核心逻辑
- `batch_registry.json`：批次与面值/有效期映射（生成后自动创建）
- `.cardkey_secret`：签名密钥（生成后自动创建，请妥善保管）

## 卡密格式

固定为：`XXXX-XXXX-XXXX-XXXX`

示例：`ABCD-EFGH-JKLM-NPQR`

## 生成卡密

```bash
cd /home/xx/LINGINE/minduser/cardkey
python3 generate_cardkeys.py \
  --count 102 \
  --face-value "100元" \
  --sale-price 60 \
  --valid-days 365 \
  --batch-no B20260317A
```

也支持交互模式：

```bash
python3 generate_cardkeys.py --interactive
```

## 导出 CSV 字段（按你的要求）

1. 卡密字符串
2. 对应面值/规格
3. 售价
4. 有效期（建议≥1 年）
5. 批次号（便于对账）

## 解密/查询卡密

```bash
cd /home/xx/LINGINE/minduser/cardkey
python3 decode_cardkey.py --card "ABCD-EFGH-JKLM-NPQR"
```

JSON 输出：

```bash
python3 decode_cardkey.py --card "ABCD-EFGH-JKLM-NPQR" --json
```

## 注意事项

- 如果你丢失 `.cardkey_secret`，将无法通过脚本校验历史卡密真伪。
- 如果你丢失 `batch_registry.json`，将无法从卡密映射出面值/售价/有效期等业务字段。
- 建议定期备份上述两个文件。
