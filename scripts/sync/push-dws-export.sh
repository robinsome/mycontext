#!/usr/bin/env bash
# 本机 → Ubuntu：把 exports/dws 四件套 POST 到 Web Service。
# 只依赖 PATH 上的 dws（live 模式）与 curl、python3；不跑 MyContext agent。
set -euo pipefail

SCRIPT_NAME="$(basename "$0")"

usage() {
  cat <<EOF
用法: ${SCRIPT_NAME} [--fixture] [--export-dir DIR] [--vault-id ID]

环境变量:
  MYCONTEXT_SYNC_URL     POST 地址（例: http://127.0.0.1:8787/api/v1/channel-sync）
  MYCONTEXT_SYNC_TOKEN   Bearer token
  MYCONTEXT_EXPORT_DIR   四件套根目录（含 chat/、minutes/）
  MYCONTEXT_VAULT_ID     目标 vaultId（live 模式必填）
  MYCONTEXT_SYNC_FIXTURE  设为 1 等同 --fixture（无需 dws 登录）

模式:
  --fixture              推送合成假数据（vault-fake-001），用于本地测通
  --export-dir DIR       live：从已有 export 目录打包推送
  --vault-id ID          live：manifest.vaultId

live 模式会在推送前执行白名单只读探活: dws contact user get-self
EOF
}

FIXTURE=0
EXPORT_DIR=""
VAULT_ID=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --fixture)
      FIXTURE=1
      shift
      ;;
    --export-dir)
      EXPORT_DIR="${2:-}"
      shift 2
      ;;
    --vault-id)
      VAULT_ID="${2:-}"
      shift 2
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      echo "未知参数: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if [[ -n "${MYCONTEXT_SYNC_FIXTURE:-}" && "${MYCONTEXT_SYNC_FIXTURE}" != "0" ]]; then
  FIXTURE=1
fi
EXPORT_DIR="${EXPORT_DIR:-${MYCONTEXT_EXPORT_DIR:-}}"
VAULT_ID="${VAULT_ID:-${MYCONTEXT_VAULT_ID:-}}"

SYNC_URL="${MYCONTEXT_SYNC_URL:-}"
SYNC_TOKEN="${MYCONTEXT_SYNC_TOKEN:-}"

if [[ -z "$SYNC_URL" || -z "$SYNC_TOKEN" ]]; then
  echo "错误: MYCONTEXT_SYNC_URL 与 MYCONTEXT_SYNC_TOKEN 必填" >&2
  exit 1
fi

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "错误: 未找到命令 $1" >&2
    exit 1
  fi
}

require_cmd curl
require_cmd python3

TMP_PAYLOAD="$(mktemp "${TMPDIR:-/tmp}/mycontext-sync-payload-XXXXXX")"
cleanup() {
  rm -f "$TMP_PAYLOAD"
}
trap cleanup EXIT

dws_smoke() {
  require_cmd dws
  echo "探活: dws contact user get-self …" >&2
  if ! dws contact user get-self >/dev/null 2>&1; then
    echo "错误: dws 探活失败（需已安装 dws 且 dws auth login）" >&2
    exit 1
  fi
}

build_fixture_payload() {
  python3 - "$TMP_PAYLOAD" <<'PY'
import json
import sys

out = sys.argv[1]
exported_at = 1_785_000_000_000
chat_manifest = {
    "source": "mycontext",
    "dataset": "chat",
    "scope_types": ["workspace", "chat"],
    "record_types": ["message"],
    "resource_kinds": [],
    "counts": {"scopes": 1, "records": 0, "resources": 0},
    "exported_at": exported_at,
}
scope_line = {
    "id": "cidFAKE0001==",
    "type": "chat",
    "parent_id": "workspace:ali-ding",
    "data": {"title": "示例群", "member_count": 2},
}
payload = {
    "manifest": {
        "vaultId": "vault-fake-001",
        "channelId": "dingtalk",
        "exportedAt": exported_at,
        "sources": ["chat"],
    },
    "files": {
        "chat/manifest.json": json.dumps(chat_manifest, ensure_ascii=False, indent=2) + "\n",
        "chat/scopes.jsonl": json.dumps(scope_line, ensure_ascii=False) + "\n",
        "chat/records.jsonl": "",
        "chat/resources.jsonl": "",
    },
}
with open(out, "w", encoding="utf-8") as fh:
    json.dump(payload, fh, ensure_ascii=False)
PY
}

build_export_payload() {
  local export_root="$1"
  local vault_id="$2"
  if [[ ! -d "$export_root" ]]; then
    echo "错误: 导出目录不存在: $export_root" >&2
    exit 1
  fi
  if [[ -z "$vault_id" ]]; then
    echo "错误: live 模式需要 --vault-id 或 MYCONTEXT_VAULT_ID" >&2
    exit 1
  fi
  python3 - "$export_root" "$vault_id" "$TMP_PAYLOAD" <<'PY'
import json
import os
import sys
import time

export_root = os.path.abspath(sys.argv[1])
vault_id = sys.argv[2]
out = sys.argv[3]
four = ("manifest.json", "scopes.jsonl", "records.jsonl", "resources.jsonl")
sources = []
files = {}
exported_at = 0

for source in ("chat", "minutes"):
    src_dir = os.path.join(export_root, source)
    if not os.path.isdir(src_dir):
        continue
    missing = [name for name in four if not os.path.isfile(os.path.join(src_dir, name))]
    if missing:
        print(f"跳过不完整 source {source}（缺 {', '.join(missing)}）", file=sys.stderr)
        continue
    sources.append(source)
    for name in four:
        key = f"{source}/{name}"
        with open(os.path.join(src_dir, name), encoding="utf-8") as fh:
            files[key] = fh.read()
        if name == "manifest.json":
            try:
                meta = json.loads(files[key])
                ts = int(meta.get("exported_at") or 0)
                exported_at = max(exported_at, ts)
            except (json.JSONDecodeError, TypeError, ValueError):
                pass

if not sources:
    print("错误: 未找到含四件套的 chat/ 或 minutes/ 目录", file=sys.stderr)
    sys.exit(1)

if exported_at <= 0:
    exported_at = int(time.time() * 1000)

payload = {
    "manifest": {
        "vaultId": vault_id,
        "channelId": "dingtalk",
        "exportedAt": exported_at,
        "sources": sources,
    },
    "files": files,
}
with open(out, "w", encoding="utf-8") as fh:
    json.dump(payload, fh, ensure_ascii=False)
PY
}

post_payload() {
  local http_code response_file
  response_file="$(mktemp "${TMPDIR:-/tmp}/mycontext-sync-response-XXXXXX")"
  http_code="$(
    curl -sS -o "$response_file" -w "%{http_code}" \
      -X POST "$SYNC_URL" \
      -H "Authorization: Bearer ${SYNC_TOKEN}" \
      -H "Content-Type: application/json" \
      --data-binary "@${TMP_PAYLOAD}"
  )"
  if [[ "$http_code" == "200" ]]; then
    cat "$response_file" >&2
  else
    echo "响应体:" >&2
    cat "$response_file" >&2 || true
  fi
  rm -f "$response_file"
  echo "HTTP ${http_code}" >&2
  if [[ "$http_code" != "200" ]]; then
    echo "错误: 同步失败（HTTP ${http_code}）" >&2
    exit 1
  fi
  echo "同步成功" >&2
}

if [[ "$FIXTURE" -eq 1 ]]; then
  echo "模式: fixture（合成假数据，跳过 dws 探活）" >&2
  build_fixture_payload
else
  dws_smoke
  echo "模式: live（打包 export 目录）" >&2
  build_export_payload "$EXPORT_DIR" "$VAULT_ID"
fi

post_payload
