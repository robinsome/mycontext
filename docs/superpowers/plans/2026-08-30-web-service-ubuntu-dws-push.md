# Web Service（Ubuntu）+ 本机 dws Push 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Ubuntu 部署纯 Web Service；Win/mac 只装官方 `dws`，用脚本把渠道导出推到服务器并触发建图消费。

**Architecture:** 服务器持有 vault/API/UI/kl；本机不装 MyContext agent，仅 `dws` + sync 脚本 push。不反向遥控本机。

**Tech Stack:** Node（现有 monorepo packages）+ 轻量 HTTP（先 `node:http` 或现有风格，避免新框架爆炸）+ 现有 `kl-graph` + 官方 `dws` + Docker/systemd。

**Spec:** `docs/design/web-service-ubuntu-dws-push.md`

## Global Constraints

- 数据在 Ubuntu（1B）；本机只装官方 dws；同步仅 push。
- 不新增 MyContext 本机 agent 安装包；sync 以脚本形式存在于 `scripts/sync/`。
- 真实聊天/ID 不进 git；fixture 用假值。
- 渠道命令仍受 `DWS_COMMAND_ALLOWLIST` 约束（脚本侧只调只读导出命令）。
- 提交仅在用户要求时做；中文 commit message。
- 回复与文档面向用户用简体中文。

## File map（锁定分解）

| 路径 | 职责 |
|---|---|
| `apps/web-server/` | Ubuntu 上的 HTTP 入口：静态 UI + `/api/v1/*` |
| `packages/sync-contract/`（或先放 `ipc-contract` 旁的 zod） | 推送包形状、鉴权头、错误码 |
| `scripts/sync/push-dws-export.sh` + `.ps1` | 本机：调 dws 导出并 POST |
| `docs/deploy/ubuntu-web.md` | 部署与本机 dws 安装说明 |
| `apps/desktop/...` | **本阶段不删**；ingest 消费路径抽出可被 web-server 复用的函数 |

---

### Task 1: Sync 契约 + 接收 API 骨架

**Files:**
- Create: `packages/sync-contract/src/channel-sync.ts`（zod：manifest、文件列表元数据、错误码）
- Create: `apps/web-server/src/index.ts`（listen、健康检查）
- Create: `apps/web-server/src/routes/channel-sync.ts`（`POST /api/v1/channel-sync`）
- Create: `apps/web-server/package.json`
- Test: `tests/unit/web-server/channel-sync.test.ts`

**Interfaces:**
- Consumes: 无
- Produces: `ChannelSyncManifest`；`POST` 校验 Bearer；落盘到 `dataDir/vaults/<id>/exports/dws/`（形状对齐现有 export）

- [ ] **Step 1: 写失败单测** — 无 token → 401；坏 JSON → 400
- [ ] **Step 2: 跑测确认失败**
- [ ] **Step 3: 最小实现** — `node:http` + zod；token 来自 env `MYCONTEXT_SYNC_TOKEN`
- [ ] **Step 4: 跑测通过**
- [ ] **Step 5: 提交**（若用户要求）

---

### Task 2: 本机 sync 脚本（只依赖 dws）

**Files:**
- Create: `scripts/sync/push-dws-export.sh`（mac/Linux）
- Create: `scripts/sync/push-dws-export.ps1`（Windows）
- Create: `scripts/sync/README.md`（安装 dws、login、环境变量）

**Interfaces:**
- Consumes: `MYCONTEXT_SYNC_URL`、`MYCONTEXT_SYNC_TOKEN`；本机 `dws` on PATH
- Produces: 对 Task 1 的 `POST`；本地临时目录不进 git

- [ ] **Step 1: 脚本调用白名单内只读导出**（与现有 export 目录结构一致；无真实 ID 写进示例）
- [ ] **Step 2: 在有 dws 的机器上 dry-run / 对本地 web-server 测通**
- [ ] **Step 3: README 写清 Win/mac 安装官方二进制步骤**

---

### Task 3: 服务器消费导出 → 建图入口

**Files:**
- Modify: 抽出 desktop `KlServerService` / graph-sync 触发中可复用的「对已有 exportDir 建图」调用
- Create: `apps/web-server/src/routes/graph-build.ts`（`POST /api/v1/graph/build`）
- Test: `tests/unit/web-server/graph-build-trigger.test.ts`（mock kl）

**Interfaces:**
- Consumes: Task 1 落盘的 `exports/dws`
- Produces: 与现有 kl ingest 相同的输入约定（`KL_DWS_EXPORT_DIR`）

- [ ] **Step 1: 单测** — 无导出 → 明确错误；有导出 → 调用建图端口
- [ ] **Step 2: 实现最小触发**（可先同步调起 kl-server 子进程，后置优化）
- [ ] **Step 3: 与 Task 2 联调一条「推送 → 建图」路径

---

### Task 4: 浏览器 UI 挂到 web-server

**Files:**
- Create: `apps/web-server` 托管 `apps/desktop` renderer 的 vite build，或新建薄 `apps/web-ui`
- Modify: 将关键 IPC 调用改为 `fetch('/api/v1/...')` 的适配层（先覆盖：runtime config 读、建图状态、同步状态）

**Interfaces:**
- Consumes: Task 1–3 API
- Produces: 浏览器可打开的设置/仪表盘最小可用面

- [ ] **Step 1: 静态资源挂载 + 一条「同步状态」页**
- [ ] **Step 2: 设置里展示 sync token 重置（服务端生成，不回显全文）
- [ ] **Step 3: 烟测：浏览器打开 → 见状态 → 本机脚本推送后状态更新

---

### Task 5: Ubuntu 部署文档与容器

**Files:**
- Create: `docs/deploy/ubuntu-web.md`
- Create: `deploy/docker-compose.yml`（web-server + 数据卷；kl 同机或 sidecar）

- [ ] **Step 1: compose 一键起 API + 数据卷**
- [ ] **Step 2: 文档：防火墙、HTTPS（反代）、备份、`dws` 本机安装链接**
- [ ] **Step 3: 验收清单勾选 spec MVP**

---

## 建议执行方式

用 **subagent-driven-development** 按 Task 1 → 2 → 3 竖切；Task 4–5 在竖切通后再做。  
每个 Task 结束应有可运行证据（命令输出），再进入下一 Task。
