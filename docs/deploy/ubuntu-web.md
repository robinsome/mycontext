# Ubuntu Web Service 部署指南

本文说明在 **Ubuntu** 上运行 MyContext Web Service（浏览器 UI + HTTP API + 数据卷）。

**正式主路径（2026-08-30）：** 企业内部应用 + 浏览器 OAuth + 用户 token 采集；会话等 MCP 能力由 **服务端 per-vault dws sidecar** 执行（**禁止**把本机个人 `dws` 当主路径）。  
规格：[`docs/superpowers/specs/2026-08-30-enterprise-openapi-collector-design.md`](../superpowers/specs/2026-08-30-enterprise-openapi-collector-design.md)；sidecar 补丁：[`2026-08-30-per-user-dws-sidecar-b1.md`](../superpowers/specs/2026-08-30-per-user-dws-sidecar-b1.md)。

本机 `dws` 推送（[`scripts/sync/`](../../scripts/sync/README.md)）已标 **deprecated**，仅作过渡/调试。

## 架构（正式）

```
[浏览器 OAuth] ⇄ HTTPS ⇄ [Ubuntu: Web UI + API + 每用户 vault + 采集器]
                                      │
                                      │ docker.sock（仅 web-server）
                                      ▼
                            [短生命周期 dws sidecar 容器 / vault]
                                      │
                                      ▼
                            vaults/<vaultId>/exports/dws → ingest / graph
```

- **Mapped OpenAPI**（如 `contact/users/me`）仍由 web-server 直接 HTTP 调用。
- **Sidecar 命令**（如 `chat list-all-conversations`）由 web-server 按 vault 隔离 spawn；sidecar **不**挂载 `docker.sock`。
- **禁止**把开发者本机 `~/.dws` 或 Win/mac 个人登录态当作正式采集主路径。

## OAuth 环境变量（正式路径）

| 变量 | 说明 |
| --- | --- |
| `DINGTALK_CLIENT_ID` | 企业内部应用 Client ID |
| `DINGTALK_CLIENT_SECRET` | Client Secret（勿提交 git） |
| `DINGTALK_CORP_ID` | 固定单企业 corpId |
| `OAUTH_REDIRECT_URI` | 须与开放平台回调一致，如 `https://example.com/api/v1/auth/callback` |

登录入口：`GET /api/v1/auth/login`。采集：`POST /api/v1/collect/run`（需 session cookie）。能力表：`GET /api/v1/capabilities`。

### dws sidecar 环境变量（正式采集）

| 变量 | 必填 | 说明 |
| --- | --- | --- |
| `MYCONTEXT_DWS_SIDECAR_IMAGE` | **是**（启用 sidecar 采集时） | 预构建镜像名，如 `mycontext-dws-sidecar:0.1.0`；web-server 通过 `docker run` 按 vault 拉起 |
| `MYCONTEXT_DWS_SIDECAR_MAX_CONCURRENT` | 否 | 同时运行的 sidecar 容器上限，默认 `2` |

Compose 已在 **web-server** 挂载 `/var/run/docker.sock`（仅编排器用）。sidecar 容器只挂载该 vault 的 `dws-home` 目录，**不得**把 sock 传进 sidecar。

**snap Docker 注意：** snap 版 Docker **看不到**宿主机 `/tmp` 挂载；数据卷、sidecar 临时 env 文件、B1 spike 目录须放在 **`$HOME/...`** 或 Compose 命名卷（如 `mycontext-data`）下，勿依赖 `/tmp`。部分 snap 环境还**拉不到** Docker Hub 的 `node:*` 基础镜像 —— 须在可联网机器预构建 sidecar 后 `docker save` / scp / `docker load`（见下文）。

## 构建 dws sidecar 镜像

在**能访问 Docker Hub** 的机器（仓库根目录）：

```bash
docker build -f deploy/Dockerfile.dws-sidecar -t mycontext-dws-sidecar:0.1.0 .
# 或跨平台：
docker buildx build --platform linux/amd64 -t mycontext-dws-sidecar:0.1.0 \
  -f deploy/Dockerfile.dws-sidecar --load .
```

镜像预装 `dingtalk-workspace-cli@1.0.60` 与 `unzip`（CLI postinstall 解压 skills）。默认 `ENTRYPOINT` 为 `dws`；运行时由 web-server 传入 `bash -lc` 脚本完成 `auth login --token` 与白名单命令。

离线带到 Ubuntu：

```bash
docker save mycontext-dws-sidecar:0.1.0 | gzip -c > mycontext-dws-sidecar-0.1.0.tar.gz
# Ubuntu 上：
docker load -i mycontext-dws-sidecar-0.1.0.tar.gz
```

在 `deploy/.env` 设置 `MYCONTEXT_DWS_SIDECAR_IMAGE=mycontext-dws-sidecar:0.1.0` 后重启 compose。

## 架构（过渡：本机 dws 推送）

```
[浏览器] ⇄ HTTPS ⇄ [Ubuntu: Web UI + API + SQLite/导出目录]
                              ↑
                    Bearer token + JSON 四件套
                              ↑
[Win/mac: 渠道 CLI（dws）] ── sync 脚本 ──┘
```

**过渡约束：**

- 个人身份的 `dws` **必须在已登录钉钉的本机**运行；Ubuntu 容器/进程**不能**替代本机登录态。
- 同步方向仅为 **本机 → 服务器**（push）。
- 聊天原文落在运营者控制的 Ubuntu 磁盘；**不得**把真实聊天、真实 openId 或本机用户名路径写进 git / issue。

当前 `deploy/docker-compose.yml` **仅包含 web-server**（sidecar 由 web-server 动态 `docker run`，非 compose 常驻服务）。`kl-server` 建图需**同机另起**（或后续 sidecar）；未就绪时 `POST /api/v1/graph/build` 会失败，但 OAuth 登录与 OpenAPI/sidecar 采集仍可用。

---

## 前置条件

| 项 | 说明 |
| --- | --- |
| 系统 | Ubuntu 22.04 LTS 或更新（其他 Linux 发行版可参考，未逐台验证） |
| 容器 | Docker Engine 24+ 与 Compose 插件（`docker compose version`） |
| 网络 | 公网访问建议绑定域名；API **仅经 HTTPS** 对外（见下文反代） |
| 磁盘 | 为命名卷或 bind mount 预留足够空间；建议启用磁盘加密（LUKS 或云盘加密） |

---

## 快速启动（Docker Compose）

在**仓库根目录**执行：

```bash
cp deploy/.env.example deploy/.env
# 编辑 deploy/.env：DINGTALK_*、OAUTH_REDIRECT_URI、MYCONTEXT_DWS_SIDECAR_IMAGE
# 生产默认 MYCONTEXT_PUBLISH_BIND=127.0.0.1（仅本机反代可达，勿把 8787 裸奔到公网）

# 先构建/加载 sidecar 镜像（见上文），再：
docker compose -f deploy/docker-compose.yml up -d --build
```

### GitHub Packages（GHCR，推荐）

镜像：`ghcr.io/robinsome/mycontext-web-server:0.1.0`（另有 `:latest`）  
包页：https://github.com/users/robinsome/packages/container/package/mycontext-web-server  

本机发布：

```bash
./deploy/publish-ghcr.sh
```

Ubuntu 拉取（包默认 **private**，需先登录）：

```bash
echo "$GITHUB_TOKEN" | docker login ghcr.io -u USERNAME --password-stdin
# TOKEN 需含 read:packages
cp deploy/.env.example deploy/.env   # 填 OAuth / token
docker compose -f deploy/docker-compose.yml pull
docker compose -f deploy/docker-compose.yml up -d
```

### 离线镜像包（本机打包 → Ubuntu `docker load`）

```bash
./deploy/pack-ubuntu-release.sh
# 产物：dist/ubuntu-release/
#   mycontext-web-server-<tag>-<stamp>.tar.gz
#   mycontext-dws-sidecar-<tag>-<stamp>.tar.gz
#   以及同目录 docker-compose.yml、.env.example、README-LOAD.txt
```

Ubuntu 上：**两个** tar.gz 都要 `docker load -i …`，再配 `.env` 并 `docker compose up -d`。

**重要：** `docker load` 后的本地镜像名为 `mycontext-web-server:<tag>`，而 compose 默认拉 GHCR。离线部署须在 `deploy/.env` 显式设置：

```bash
MYCONTEXT_IMAGE=mycontext-web-server
MYCONTEXT_PULL_POLICY=missing
MYCONTEXT_DWS_SIDECAR_IMAGE=mycontext-dws-sidecar:0.1.0
```

`MYCONTEXT_IMAGE_TAG` 须与 load 的 tag 一致（默认 `0.1.0`）。详见同目录 `README-LOAD.txt`。
验证（默认绑定回环，须在 Ubuntu 本机或经 SSH 隧道执行）：

```bash
curl -sS http://127.0.0.1:8787/health
# 期望：{"ok":true}
```

浏览器：生产经 **HTTPS 域名**（反代到 `127.0.0.1:8787`）打开 `/`；勿依赖公网直连 `:8787`。
仅在局域网调试且已知情风险时，可在 `deploy/.env` 设 `MYCONTEXT_PUBLISH_BIND=0.0.0.0`。

### 环境变量

| 变量 | 必填 | 说明 |
| --- | --- | --- |
| `MYCONTEXT_DATA_DIR` | 是（compose 已设为 `/data`） | vault、导出、`sync-token` 根目录 |
| `MYCONTEXT_SYNC_TOKEN` | 推荐 | 与 Win/mac 推送脚本一致的 Bearer；**留空**则首次启动在数据卷生成 token |
| `MYCONTEXT_PORT` | 否 | 容器内监听端口，默认 `8787` |
| `MYCONTEXT_HOST` | 否 | 默认 `0.0.0.0` |
| `KL_SERVER_PORT` | 否 | 同机 kl-server 端口，默认 `8200`（kl 未部署时可忽略） |
| `MYCONTEXT_DWS_SIDECAR_IMAGE` | sidecar 采集时必填 | 如 `mycontext-dws-sidecar:0.1.0` |
| `MYCONTEXT_DWS_SIDECAR_MAX_CONCURRENT` | 否 | sidecar 并发上限，默认 `2` |

Compose 额外变量（写在 `deploy/.env`）：

| 变量 | 说明 |
| --- | --- |
| `MYCONTEXT_PUBLISH_BIND` | 宿主机绑定地址，**生产默认 `127.0.0.1`**（仅本机反代）；局域网调试可设 `0.0.0.0` |
| `MYCONTEXT_PUBLISH_PORT` | 宿主机映射端口，默认 `8787` |

---

## 同步 Token

1. **推荐：** 在 `deploy/.env` 设置 `MYCONTEXT_SYNC_TOKEN`，与 Win/mac 推送环境变量一致。
2. **备选：** 留空 token，启动后打开 Web UI 设置页查看/轮换（写入数据卷 `sync-token`）。
3. 轮换后须**同步更新**本机 `MYCONTEXT_SYNC_TOKEN`，否则推送返回 HTTP 401。

Token 应视为**可吊销的短时凭据**（定期轮换；泄露后立即轮换并作废旧值）。

---

## 防火墙

**生产：** 仅对公网开放 **443**（HTTPS 反代）；**不要**把 `8787` 直接暴露到互联网。

```bash
# 示例：UFW 仅允许 SSH + HTTPS
sudo ufw allow OpenSSH
sudo ufw allow 443/tcp
sudo ufw enable
```

若仅在局域网调试、暂不用反代，可临时放行映射端口：

```bash
sudo ufw allow 8787/tcp
```

---

## HTTPS 反向代理（概要）

Web Service 本身不提供 TLS。在 Ubuntu 上用 Caddy 或 nginx 终结 HTTPS，反代到 `127.0.0.1:8787`。

### Caddy（示例）

```caddy
your-domain.example {
    reverse_proxy 127.0.0.1:8787
}
```

Caddy 默认自动申请证书。仓库 compose **默认** `"127.0.0.1:8787:8787"`（`MYCONTEXT_PUBLISH_BIND`），反代只需连本机回环。

### nginx（示例）

```nginx
server {
    listen 443 ssl http2;
    server_name your-domain.example;

    ssl_certificate     /etc/ssl/certs/your-domain.fullchain.pem;
    ssl_certificate_key /etc/ssl/private/your-domain.key;

    location / {
        proxy_pass http://127.0.0.1:8787;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        client_max_body_size 64m;
    }
}
```

本机推送 URL 示例：

```bash
export MYCONTEXT_SYNC_URL="https://your-domain.example/api/v1/channel-sync"
```

---

## 数据卷备份

所有 vault 与导出位于 Compose 命名卷 `mycontext-data`（容器内 `/data`）。

**备份（示例）：**

```bash
docker run --rm \
  -v deploy_mycontext-data:/data:ro \
  -v /var/backups/mycontext:/backup \
  alpine tar czf /backup/mycontext-data-$(date +%Y%m%d).tar.gz -C / data
```

**恢复：** 在**停服**后解压到新卷或 bind mount，再启动 compose。

运维建议：

- 定期离线备份；备份介质访问控制与磁盘加密；
- 限制 SSH / 反代管理面权限；
- 日志不打印消息正文（应用侧已避免；运维侧勿开启含 body 的全量 access log）。

---

## 本机渠道 CLI（Windows / macOS）

Win/mac **不安装 MyContext 桌面 agent**；只装官方渠道 CLI，用仓库脚本推送。

**安装、登录、环境变量与排错** 见：[scripts/sync/README.md](../../scripts/sync/README.md)

摘要：

```bash
# 需 Node.js LTS
npm install -g dingtalk-workspace-cli@1.0.60
dws auth login

export MYCONTEXT_SYNC_URL="https://your-domain.example/api/v1/channel-sync"
export MYCONTEXT_SYNC_TOKEN="<与服务端一致>"
./scripts/sync/push-dws-export.sh --fixture   # 无登录烟测
```

---

## kl-server（同机，MVP 可选）

`POST /api/v1/graph/build` 会向 **`http://127.0.0.1:${KL_SERVER_PORT}/ingest`** 发起请求（默认端口 `8200`）。

**容器网络要点：** bridge 网络里，容器内的 `127.0.0.1` **不是** Ubuntu 宿主机。kl 若跑在宿主机而 web-server 在默认 bridge 容器内，建图会连到容器自身而非 kl。

MVP compose **未**打包 kl-server。同机 kl 就绪后，任选其一（二选一即可）：

### 方案 A：`network_mode: host`（与当前代码最省事）

web-server 与宿主机共享网络栈，容器内 `127.0.0.1:8200` 即宿主机 kl。在 `deploy/docker-compose.yml` 的 `web-server` 下增加 `network_mode: host`，并**去掉** `ports` 映射（host 模式下无效）：

```yaml
services:
  web-server:
    network_mode: host
    # ports:  # host 模式下删除
    environment:
      MYCONTEXT_PORT: "8787"
      KL_SERVER_PORT: "8200"
```

宿主机上先启动 kl（监听 `127.0.0.1:8200`），再 `docker compose up`。

### 方案 B：bridge + `host.docker.internal`（需后续支持 kl 主机名）

若坚持 bridge 网络，须让 ingest 目标指向宿主机而非容器回环。Linux Compose 可预留：

```yaml
services:
  web-server:
    extra_hosts:
      - "host.docker.internal:host-gateway"
```

**当前实现** ingest URL 仍写死 `127.0.0.1`，此方案**尚不可用**，除非后续增加 `KL_SERVER_HOST=host.docker.internal`（或等价配置）。MVP+ 同机 kl 请优先用方案 A。

后续可将 kl 作为 sidecar 纳入 compose；当前以「web-server 先通、kl 后接」为验收顺序。

---

## MVP 验收清单

与设计 [web-service-ubuntu-dws-push.md](../design/web-service-ubuntu-dws-push.md) 对齐，逐项勾选：

- [ ] **Ubuntu：** `docker compose -f deploy/docker-compose.yml up` 后，`curl /health` 返回 `ok: true`
- [ ] **浏览器：** 打开 `/` 可见设置/同步状态骨架页
- [ ] **Token：** 已配置 `MYCONTEXT_SYNC_TOKEN`（或数据卷内 token 与 UI 一致）
- [ ] **HTTPS：** 公网仅 443 可达；`MYCONTEXT_SYNC_URL` 使用 `https://` 前缀
- [ ] **Win 或 mac：** 已装渠道 CLI（`dws`），`dws auth login` 成功（live 模式）
- [ ] **推送：** 运行 `scripts/sync/push-dws-export.sh`（`--fixture` 或 live 四件套）得到 HTTP 200
- [ ] **落盘：** `GET /api/v1/sync/status?vaultId=...` 返回 `hasExport: true`
- [ ] **建图（可选 MVP+）：** 同机 kl-server 就绪后，`POST /api/v1/graph/build` 成功
- [ ] **文档：** 本机 `MYCONTEXT_SYNC_URL` + token 已交给使用者；备份策略已记录

---

## 排错

| 现象 | 处理 |
| --- | --- |
| 容器启动即退出 | 查看 `docker compose logs`；确认数据卷可写 |
| `curl /health` 连接拒绝 | 检查 `MYCONTEXT_PUBLISH_PORT`、防火墙、compose 是否 `up` |
| 推送 HTTP 401 | 本机 `MYCONTEXT_SYNC_TOKEN` 与服务端不一致 |
| 推送 HTTP 404 | `MYCONTEXT_SYNC_URL` 路径应为 `.../api/v1/channel-sync` |
| 建图失败 / kl 相关 | kl 是否在**宿主机** `127.0.0.1:8200`？bridge 容器内 `127.0.0.1` 连不到宿主机 kl → 改用 `network_mode: host`；MVP 可仅验收到「有导出」 |
| 采集报 sidecar 未配置 | `deploy/.env` 是否设置 `MYCONTEXT_DWS_SIDECAR_IMAGE` 且镜像已 `docker load` |
| sidecar spawn 失败 | web-server 是否挂载 `docker.sock`；snap Docker 时数据目录是否在 `$HOME` 而非 `/tmp` |
| `dws 探活失败`（过渡推送） | 本机执行 `dws auth login`；或先用 `--fixture` 验 API |

---

## 相关文档

- 设计说明：[docs/design/web-service-ubuntu-dws-push.md](../design/web-service-ubuntu-dws-push.md)
- 本机 sync 脚本：[scripts/sync/README.md](../../scripts/sync/README.md)
- Compose 文件：[deploy/docker-compose.yml](../../deploy/docker-compose.yml)
