# 规格补丁：服务端 per-user dws sidecar（B1）

**状态：** 设计已确认（2026-08-30）；**B1 spike 已通过**（同日，见 §4.3）  
**父规格：** [2026-08-30-enterprise-openapi-collector-design.md](./2026-08-30-enterprise-openapi-collector-design.md)  
**鉴权选择：** **B1** — 注入浏览器 OAuth 的用户 `userAccessToken` / refresh；允许 `dws auth login --token <userAccessToken>`（官方「直接提供 Token」），**禁止**容器内 `--device` / 浏览器 Loopback 再授权

本补丁**修订**父规格中「服务器不按用户起 dws / 本机不装 dws 即可采会话」的缺口方案：会话等 MCP 能力改由服务端短生命周期容器内的官方 CLI 执行；已 mapped 的 OpenAPI 仍走 `callMapped`。

---

## 1. 相对父规格的变更

| 父规格原文（废止/收窄） | 本补丁 |
|---|---|
| 「本机不安装 dws；不在服务器上按用户起 dws 进程」 | 本机仍不装 dws；**允许**按 `vaultId` 起短生命周期 dws sidecar 容器 |
| 「采集只走对照表已映射 OpenAPI」 | **仍优先** mapped OpenAPI；对照表中 `deferred` 且已证实仅 MCP/dws 可达的命令，改由 sidecar 内白名单 `dws` 执行 |
| 「明确不做：服务器上跑个人 dws」 | 改为：允许 **per-user 隔离容器** 内跑官方 CLI；禁止共享一个 dws 给多用户；禁止拷贝开发者 `~/.dws` 进仓/进镜像 |

未改动的硬约束（继承父规格）：密钥不进 git；保密群 `unreadable`；不超引导范围；分页抽干；禁止 App token 冒充用户读个人会话；PII 花名册不进白名单。

---

## 2. 目标

- 浏览器 OAuth 登录后，用户点采集 → 服务端为该用户确保一个 dws sidecar（或复用未过期的）。
- 将 session 中的**用户** access/refresh token（及 sidecar 所需的最小 App 凭证，若 CLI 强制要求成对）注入仅该容器可见的配置。
- 容器内只跑 `DWS_COMMAND_ALLOWLIST` 只读命令；产物写入该用户 `exports/dws` 四件套。
- 本机**不再**依赖下载的 collect-from-dws 脚本作为主路径（可保留调试说明）。

---

## 3. 架构

```
[浏览器 OAuth] → web-server session（userAccessToken + refresh）
                         │
                         ▼ 采集触发（按 vaultId）
              ┌──────────────────────────┐
              │ sidecar: node:22-*        │
              │ + dingtalk-workspace-cli  │
              │ DWS_CONFIG_DIR=per-vault  │
              │ 注入用户 token（B1）       │
              └────────────┬─────────────┘
                           │ 白名单 dws 只读
                           ▼
              vaults/<vaultId>/exports/dws → ingest / graph/build
```

- **Mapped OpenAPI**：继续 `callMapped`（如 `contact/users/me`），不必进 sidecar。
- **Sidecar**：补齐对照表中无 OpenAPI、但 dws/MCP 可完成的只读项（首波：会话列表 + 消息 list-all 等，以 spike 与矩阵为准）。

---

## 4. B1 鉴权与 Spike 门禁

### 4.1 注入

- 来源：web-server session 已有的用户 token（与 `/api/v1/auth/*` 同源），**不是**开发者本机 `dws auth export`。
- 落点：仅挂载到该 vault 的 sidecar 配置目录（0600）；日志只打前缀掩码。
- 禁止：把 refresh/access 写进镜像层、git、CI 日志全文。

### 4.2 Spike（实现编排前必须通过）

在隔离的 `DWS_CONFIG_DIR`（一次性目录或 sidecar 卷）中，**不**执行 `--device` / 浏览器 Loopback；用网页 OAuth 用户 token 走 `dws auth login --token …`（+ 若 CLI 硬性要求则同一企业应用的 client id/secret），验证：

1. `dws contact user get-self -f json` 成功且可解析（假 ID 断言形状）。
2. `dws chat list-all-conversations --limit 1 -f json` 成功（证明 MCP 路径吃该 token）。

**失败则停止本补丁实现**，回退 B2（容器内设备码）或放弃 sidecar，并更新本文件状态为「spike 未通过」。

### 4.3 Spike 实测记录（2026-08-30）

环境：部署机 `wsl-dev`；token 来源为 web-server `/data/sessions` 中已有浏览器 OAuth `accessToken`（与 OpenAPI `GET /v1.0/contact/users/me` HTTP 200 同源）；`dingtalk-workspace-cli@1.0.60`；`DWS_CONFIG_DIR` 指向 `$HOME/mycontext-web/.b1-*` 临时目录；**未**使用 `--device`；日志只保留退出码与 JSON 键/success，无 token、无会话正文入库。

| 步骤 | 退出码 | 断言（无 PII） |
|---|---|---|
| `dws auth login --token <session.accessToken> -y` | 0 | `success=true`，`token_valid=true` |
| `dws contact user get-self -f json` | 0 | `success=true`，`result` 为 length=1 的 list |
| `dws chat list-all-conversations --limit 1 -f json` | 0 | `success=true`，`result.conversations` length=1，含 `hasMore` |

运维注记：该机 snap Docker **拉不到** Docker Hub `node:*`（超时）；业务镜像需预构建/离线 load。snap Docker **看不到**宿主机 `/tmp` 挂载，卷路径须在 `$HOME` 下。sidecar 镜像构建需含 `unzip`（CLI postinstall 解压 skills）。编排器可挂 `docker.sock`；**业务 sidecar 容器本身不挂**。

**结论：B1 门禁通过，允许进入编排实现。**

---

## 5. 容器与运维

- **镜像**：构建期预装 `dingtalk-workspace-cli@1.0.60`（钉版本随仓库策略升）；启动时禁止再 `npm i`。
- **体积**：目标尽量接近最小 Node 22 基础镜像；以实测为准写入部署文档，不把「40MB」当硬门禁。
- **键与卷**：`vaultId`；`.../vaults/<vaultId>/dws-home` + export 目录。
- **生命周期**：采集时确保运行；空闲超时停止；全局限流（最大并发 sidecar 数）。
- **安全**：业务 sidecar **不**挂载 docker.sock；网络默认出站（能收紧到钉钉相关域名则收紧）；用户间目录不可互读。

---

## 6. 产品与矩阵

- Web UI：「运行采集」触发 OpenAPI mapped + 必要时调度 sidecar；去掉「本机必须下载 dws 脚本」作为主说明。
- `openapi-capability-matrix`：对 sidecar 执行的命令增加状态例如 `sidecar`（或 `mapped` 且 `runtime: dws-sidecar`），与纯 HTTP `mapped` 区分，避免调度歧义。
- 进度 API：sidecar 失败要显式错误，禁止「0 条 + 成功」。

---

## 7. MVP 验收（本补丁）

1. B1 spike 有实测记录（命令、退出码、是否含 `auth login`；无真实 token/聊天正文入库）。
2. 登录用户触发采集后，会话列表能写入该用户 export（或明确失败原因）。
3. 两用户（或两 vault）目录与容器配置隔离（测试可用假 vaultId）。
4. 部署文档：镜像构建、并发/回收、禁止本机 dws 作为主路径。

### 7.1 部署机烟测（2026-08-30，wsl-dev）

| 项 | 结果 |
|---|---|
| 镜像 load | `mycontext-web-server:0.1.5` + `mycontext-dws-sidecar:0.1.0`（Mac build amd64 → scp → load） |
| compose | docker.sock + snap docker CLI bind mount；`MYCONTEXT_HOST_DATA_DIR` 对齐命名卷 mountpoint |
| `GET /health` | HTTP 200 |
| `GET /api/v1/auth/me`（session 存在） | HTTP 200 |
| `POST /api/v1/collect/run` | HTTP 200 |
| `collect-progress` → `chat list-all-conversations` | **error**（显式 `TOKEN_VERIFIED_FAILED`；**非** deferred） |
| sidecar 内 `auth login --token` | success=true（同次 sidecar 运行） |
| `chat/scopes.jsonl` 行数 | 0（token 失效，未写入会话） |
| 双 vault `dws-home` 目录 mode | 700 / 700（假 vault 烟测） |

勾选：

- [x] 1. B1 spike（§4.3）
- [ ] 2. 会话列表写入 export（烟测 token 失效，需用户经 ssh 隧道重新 OAuth）
- [x] 3. per-vault 目录隔离（mode 700；sidecar 仅挂本 vault `dws-home`）
- [x] 4. 部署文档（`docs/deploy/ubuntu-web.md` + compose/env 示例）

**运维注记：** snap 环境 web-server 容器内需 bind mount 宿主机 `docker` 二进制；须设 `MYCONTEXT_HOST_DATA_DIR` 且 compose 同路径 bind（使 `--env-file` 宿主机路径在容器内可见）；sidecar token 经 vault 目录下 0600 env 文件注入（**禁止** `-e DWS_ACCESS_TOKEN`）。

---

## 8. 明确不做（本补丁范围）

- B2 容器内扫码 / device login（除非 B1 spike 失败另开补丁）
- 多用户共享一个 dws 进程或同一 `DWS_CONFIG_DIR`
- 发送类、PII 花名册、扩大 CLI 白名单前缀
- 本机 Electron 采集回归为主路径
