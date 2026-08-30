#!/usr/bin/env bash
# 在仓库根目录构建 web-server + dws-sidecar 镜像并导出为 Ubuntu 可加载的 tar.gz。
# 用法：
#   ./deploy/pack-ubuntu-release.sh
#   MYCONTEXT_IMAGE_TAG=0.1.1 ./deploy/pack-ubuntu-release.sh
#
# 产物目录默认：dist/ubuntu-release/（已在 .gitignore）
# Ubuntu 侧：
#   docker load -i mycontext-web-server-<tag>.tar.gz
#   docker load -i mycontext-dws-sidecar-<tag>.tar.gz
#   或解包后 docker compose -f deploy/docker-compose.yml up -d
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

TAG="${MYCONTEXT_IMAGE_TAG:-0.1.0}"
WEB_IMAGE="mycontext-web-server:${TAG}"
SIDECAR_IMAGE="mycontext-dws-sidecar:${TAG}"
OUT_DIR="${MYCONTEXT_RELEASE_DIR:-$ROOT/dist/ubuntu-release}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
WEB_ARCHIVE="${OUT_DIR}/mycontext-web-server-${TAG}-${STAMP}.tar.gz"
SIDECAR_ARCHIVE="${OUT_DIR}/mycontext-dws-sidecar-${TAG}-${STAMP}.tar.gz"

mkdir -p "$OUT_DIR"

PLATFORM="${MYCONTEXT_PLATFORM:-linux/amd64}"

echo "==> build ${WEB_IMAGE} (${PLATFORM})"
docker buildx build --platform "$PLATFORM" \
  -t "$WEB_IMAGE" \
  -f deploy/Dockerfile \
  --provenance=false --sbom=false \
  --load .

echo "==> build ${SIDECAR_IMAGE} (${PLATFORM})"
docker buildx build --platform "$PLATFORM" \
  -t "$SIDECAR_IMAGE" \
  -f deploy/Dockerfile.dws-sidecar \
  --provenance=false --sbom=false \
  --load .

echo "==> save ${WEB_IMAGE} -> ${WEB_ARCHIVE}"
docker save "$WEB_IMAGE" | gzip -c >"$WEB_ARCHIVE"

echo "==> save ${SIDECAR_IMAGE} -> ${SIDECAR_ARCHIVE}"
docker save "$SIDECAR_IMAGE" | gzip -c >"$SIDECAR_ARCHIVE"

# 附带部署清单（不含密钥）
cp deploy/docker-compose.yml "$OUT_DIR/docker-compose.yml"
cp deploy/.env.example "$OUT_DIR/.env.example"
cat >"$OUT_DIR/README-LOAD.txt" <<EOF
MyContext Web Service — Ubuntu 镜像包
web-server 镜像: ${WEB_IMAGE}
dws-sidecar 镜像: ${SIDECAR_IMAGE}
web-server 归档: $(basename "$WEB_ARCHIVE")
dws-sidecar 归档: $(basename "$SIDECAR_ARCHIVE")
构建 UTC: ${STAMP}

1) 加载镜像（两个都要 load）
   docker load -i $(basename "$WEB_ARCHIVE")
   docker load -i $(basename "$SIDECAR_ARCHIVE")

2) 配置环境（勿提交真实 Secret）
   cp .env.example .env
   # 离线 load 后 compose 默认指向 GHCR，须改本地镜像名：
   #   MYCONTEXT_IMAGE=mycontext-web-server
   #   MYCONTEXT_PULL_POLICY=missing
   # 编辑 DINGTALK_* / OAUTH_REDIRECT_URI / MYCONTEXT_SYNC_TOKEN
   # 设置 MYCONTEXT_DWS_SIDECAR_IMAGE=${SIDECAR_IMAGE}

3) 启动（本目录需有 docker-compose.yml；或回到仓库根用 deploy/ 路径）
   docker compose -f docker-compose.yml up -d

4) 健康检查（默认仅绑定 127.0.0.1）
   curl -sS http://127.0.0.1:8787/health

完整说明见仓库 docs/deploy/ubuntu-web.md
EOF

# 固定「最新」软链，便于脚本引用
ln -sfn "$(basename "$WEB_ARCHIVE")" "$OUT_DIR/mycontext-web-server-latest.tar.gz"
ln -sfn "$(basename "$SIDECAR_ARCHIVE")" "$OUT_DIR/mycontext-dws-sidecar-latest.tar.gz"

echo "==> done"
ls -lh "$WEB_ARCHIVE" "$SIDECAR_ARCHIVE" \
  "$OUT_DIR/mycontext-web-server-latest.tar.gz" \
  "$OUT_DIR/mycontext-dws-sidecar-latest.tar.gz"
echo "$WEB_ARCHIVE"
echo "$SIDECAR_ARCHIVE"
