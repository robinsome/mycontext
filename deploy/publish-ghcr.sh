#!/usr/bin/env bash
# 构建并推送 web-server 镜像到 GitHub Container Registry（Packages）。
# 用法（仓库根目录）：
#   ./deploy/publish-ghcr.sh
#   MYCONTEXT_IMAGE_TAG=0.1.1 ./deploy/publish-ghcr.sh
#
# 前置：gh auth 已登录且含 write:packages；首次需：
#   gh auth refresh -h github.com -s write:packages
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

OWNER="${MYCONTEXT_GHCR_OWNER:-robinsome}"
NAME="${MYCONTEXT_GHCR_NAME:-mycontext-web-server}"
TAG="${MYCONTEXT_IMAGE_TAG:-0.1.0}"
IMAGE="ghcr.io/${OWNER}/${NAME}"

echo "==> docker login ghcr.io as ${OWNER}"
echo "$(gh auth token)" | docker login ghcr.io -u "$OWNER" --password-stdin

PLATFORM="${MYCONTEXT_PLATFORM:-linux/amd64}"
echo "==> build ${IMAGE}:${TAG} (${PLATFORM})"
export MYCONTEXT_IMAGE_TAG="$TAG"
# Ubuntu/WSL 目标默认 amd64；本机 arm64 构建须显式跨平台
docker buildx build --platform "$PLATFORM" \
  -t "${IMAGE}:${TAG}" \
  -t "${IMAGE}:latest" \
  -f deploy/Dockerfile \
  --provenance=false --sbom=false \
  --push .

echo "==> done"
echo "Package: https://github.com/users/${OWNER}/packages/container/package/${NAME}"
echo "Pull:    docker pull ${IMAGE}:${TAG}"
echo "注意: 包默认 private；Ubuntu 拉取需 docker login ghcr.io（PAT 含 read:packages）。"
