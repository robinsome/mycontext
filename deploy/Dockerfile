# MyContext Web Service（Ubuntu MVP）
# 仅 web-server；不在镜像内安装或运行个人渠道 CLI（dws）。
FROM node:22-bookworm-slim

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@10.13.1 --activate

# 最小 workspace 切片：web-server + sync-contract
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web-server/package.json apps/web-server/
COPY packages/sync-contract/package.json packages/sync-contract/

RUN pnpm install --frozen-lockfile --filter @mycontext/web-server...

COPY apps/web-server ./apps/web-server
COPY packages/sync-contract ./packages/sync-contract

RUN npm install -g tsx@4.19.4

ENV NODE_ENV=production
ENV MYCONTEXT_HOST=0.0.0.0
ENV MYCONTEXT_PORT=8787

EXPOSE 8787

# MYCONTEXT_DATA_DIR 必填；MYCONTEXT_SYNC_TOKEN 可选（未设则首次启动写 dataDir/sync-token）
CMD ["tsx", "apps/web-server/src/index.ts"]
