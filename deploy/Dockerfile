# MyContext Web Service（Ubuntu）
# 仅 web-server + workspace 依赖；不在镜像内安装或运行个人渠道 CLI（dws）。
FROM node:22-bookworm-slim

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@10.13.1 --activate

# 最小 workspace 切片：web-server → sync-contract / channels → kernel / runtime-env
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web-server/package.json apps/web-server/
COPY packages/sync-contract/package.json packages/sync-contract/
COPY packages/channels/package.json packages/channels/
COPY packages/kernel/package.json packages/kernel/
COPY packages/runtime-env/package.json packages/runtime-env/

# 根 package.json 含桌面/渠道 CLI 依赖（electron、@larksuite/cli 等），其 postinstall
# 需要 curl/本机二进制，与 web-server 无关。忽略脚本即可；web-server 运行时只用 zod + 源码。
RUN printf 'ignore-scripts=true\n' > .npmrc \
  && pnpm install --frozen-lockfile --filter @mycontext/web-server...

COPY apps/web-server ./apps/web-server
COPY packages/sync-contract ./packages/sync-contract
COPY packages/channels ./packages/channels
COPY packages/kernel ./packages/kernel
COPY packages/runtime-env ./packages/runtime-env

RUN npm install -g tsx@4.19.4

ENV NODE_ENV=production
ENV MYCONTEXT_HOST=0.0.0.0
ENV MYCONTEXT_PORT=8787

# GHCR 自动关联仓库（push 后 Packages 页可连到 fork）
LABEL org.opencontainers.image.source="https://github.com/robinsome/mycontext" \
      org.opencontainers.image.title="mycontext-web-server" \
      org.opencontainers.image.description="MyContext Ubuntu Web Service" \
      org.opencontainers.image.licenses="Elastic-2.0"

EXPOSE 8787

# MYCONTEXT_DATA_DIR 必填；OAuth / sync token 经 compose 环境变量注入
CMD ["tsx", "apps/web-server/src/index.ts"]
