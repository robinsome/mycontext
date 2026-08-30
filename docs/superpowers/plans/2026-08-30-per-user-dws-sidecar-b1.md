# Per-user dws Sidecar（B1）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 浏览器 OAuth 登录后，服务端按 vault 隔离注入用户 token，用短生命周期 dws sidecar 采出会话列表（及后续白名单只读命令），写入该用户 `exports/dws`；mapped OpenAPI 仍走 HTTP。

**Architecture:** 对照表新增 `sidecar` 状态；web-server 采集时对 `sidecar` 行调用 `SidecarRunner`（`docker run --rm` 预构建镜像，或测试注入的假 runner）；容器内 `DWS_CONFIG_DIR` + `dws auth login --token`（B1，已 spike）；产物进 vault 目录。编排器可挂 docker.sock；业务 sidecar **不**挂 sock。

**Tech Stack:** 现有 `@mycontext/web-server` / `@mycontext/channels`；Docker；`dingtalk-workspace-cli@1.0.60`；Node 22。

**Spec:** `docs/superpowers/specs/2026-08-30-per-user-dws-sidecar-b1.md`（spike §4.3 已通过）

## Global Constraints

- AppSecret / user token / 真实会话正文与真实 ID **不进 git**；日志只打前缀掩码或长度。
- 禁止 `--device` / 浏览器 Loopback 再授权；只用 session 用户 token + `dws auth login --token`。
- 禁止共享一个 `DWS_CONFIG_DIR` / 一个 dws 进程给多用户；禁止拷贝开发者 `~/.dws`。
- 禁止 App token / `qyapi_chat_*` 冒充用户读个人会话。
- 保密群 / 无权限 → `unreadable`，不绕过；分页抽干；不超引导范围。
- PII 花名册 / 发送类命令不进 sidecar 白名单。
- 提交仅在用户明确要求时做。
- 部署卷路径须在 Docker（含 snap）可见处（优先 `$MYCONTEXT_DATA_DIR`，勿依赖宿主机 `/tmp`）。
- sidecar 镜像构建须含 `unzip`（CLI postinstall）。

## File map

| 路径 | 职责 |
|---|---|
| `packages/channels/.../openapi-capability-matrix.ts` | 增加 `sidecar` 状态；首波标记 `chat list-all-conversations` |
| `apps/web-server/src/collector/sidecar-runner.ts` | 注入 token、跑白名单 dws、解析 JSON、错误显式化 |
| `apps/web-server/src/collector/run-collect.ts` | mapped → HTTP；sidecar → runner；其余 deferred |
| `apps/web-server/src/collector/sidecar-export.ts` | 将会话列表写入 chat 四件套 scopes（及 progress） |
| `deploy/Dockerfile.dws-sidecar` | 预装 CLI + unzip 的 Node 22 镜像 |
| `deploy/docker-compose.yml` / `docs/deploy/ubuntu-web.md` | sock、镜像名、并发/回收环境变量 |
| `apps/web-server/public/{index.html,app.js}` | 主路径改为服务端采集；客户端脚本降为调试 |
| `tests/unit/web-server/sidecar-*.test.ts` | runner / collect 接线单测（假 runner） |

---

### Task 1: 对照表增加 `sidecar` 状态

**Files:**
- Modify: `packages/channels/src/plugins/dingtalk/openapi-capability-matrix.ts`
- Modify: `tests/unit/channels/openapi-capability-matrix.test.ts`（若有状态枚举断言）
- Modify: 任何 `OpenApiCapabilityStatus` 穷尽 switch（`run-collect.ts` 等）使 typecheck 通过

**Interfaces:**
- Produces: `OpenApiCapabilityStatus = "mapped" | "sidecar" | "deferred" | "unsupported"`
- `chat list-all-conversations` → `status: "sidecar"`，`openApi: null`，notes 引用 B1 spike + MCP

- [ ] **Step 1: 写/改单测**

```ts
import { OPENAPI_CAPABILITY_MATRIX, dwsCommandKey } from "@mycontext/channels"

it("list-all-conversations is sidecar (not mapped HTTP)", () => {
  const row = OPENAPI_CAPABILITY_MATRIX.find(
    (r) => dwsCommandKey(r.dwsCommand) === "chat list-all-conversations",
  )
  expect(row?.status).toBe("sidecar")
  expect(row?.openApi).toBeNull()
})
```

- [ ] **Step 2: 跑测确认失败**

Run: `pnpm exec vitest run tests/unit/channels/openapi-capability-matrix.test.ts`
Expected: FAIL（当前仍为 `deferred`）

- [ ] **Step 3: 改矩阵类型与该行 status**

```ts
export type OpenApiCapabilityStatus = "mapped" | "sidecar" | "deferred" | "unsupported"
// ...
{
  dwsCommand: ["chat", "list-all-conversations"],
  status: "sidecar",
  openApi: null,
  notes:
    "B1 spike 2026-08-30：网页 OAuth userAccessToken + dws auth login --token 可走 MCP list_all_conversations。" +
    "无公开用户 token HTTP path；由 dws-sidecar 执行，禁止 App token / qyapi_chat_*。",
},
```

- [ ] **Step 4: 跑测 + typecheck 相关包**

Run: `pnpm exec vitest run tests/unit/channels/openapi-capability-matrix.test.ts && pnpm --filter @mycontext/channels typecheck && pnpm --filter @mycontext/web-server typecheck`

- [ ] **Step 5: Commit**（仅当用户要求）

---

### Task 2: `SidecarRunner` 接口 + 内存假实现单测

**Files:**
- Create: `apps/web-server/src/collector/sidecar-runner.ts`
- Create: `tests/unit/web-server/sidecar-runner.test.ts`

**Interfaces:**
- Consumes: `accessToken: string`；`vaultId: string`；`dwsArgs: readonly string[]`（已是白名单完整命令 argv，不含 `dws` 二进制名）
- Produces:

```ts
export interface SidecarRunRequest {
  vaultId: string
  accessToken: string
  /** 例如 ["chat","list-all-conversations","--limit","1","-f","json"] */
  dwsArgs: readonly string[]
  /** 该 vault 的 DWS_CONFIG_DIR（宿主机/卷绝对路径） */
  configDir: string
  /** 可选：刷新 token；B1 MVP 可先不写 refresh 文件 */
  refreshToken?: string
}

export interface SidecarRunResult {
  exitCode: number
  /** 解析后的顶层 JSON；失败时为 null */
  json: unknown | null
  /** 已红acted 的 stderr/stdout 摘要，禁止含 token 原文 */
  detail: string
}

export type SidecarRunner = (req: SidecarRunRequest) => Promise<SidecarRunResult>

export function assertAllowlistedDwsArgs(dwsArgs: readonly string[]): void
export function createDockerSidecarRunner(options: {
  image: string
  /** 默认 docker */
  dockerBin?: string
  maxConcurrent?: number
}): SidecarRunner
```

- [ ] **Step 1: 失败单测（白名单拒绝）**

```ts
import { assertAllowlistedDwsArgs } from "../../../apps/web-server/src/collector/sidecar-runner.js"

it("rejects non-allowlisted argv", () => {
  expect(() => assertAllowlistedDwsArgs(["chat", "message", "send", "--to", "x"])).toThrow(
    /allowlist/i,
  )
})
```

- [ ] **Step 2: 跑测 FAIL（模块不存在）**

Run: `pnpm exec vitest run tests/unit/web-server/sidecar-runner.test.ts`

- [ ] **Step 3: 实现 `assertAllowlistedDwsArgs` + 可注入假 runner 工厂**

白名单首波（完整 argv 前缀匹配到矩阵 `sidecar` 行的 `dwsCommand`，再允许尾部 flags）：

- `chat list-all-conversations`
- （可选同测）`contact user get-self` —— 生产仍优先 OpenAPI mapped，可不进 sidecar 调度

`createDockerSidecarRunner` MVP 行为：

1. 信号量限制 `maxConcurrent`（默认 2）
2. `mkdir` configDir mode 0o700
3. `docker run --rm -e DWS_CONFIG_DIR=/dws-home -v configDir:/dws-home <image> dws auth login --token "$TOKEN" -y` 然后同一容器生命周期内执行业务命令（**一次 docker run 内 bash -lc 串起来**，避免二次 login）
4. 解析最后一条命令的 stdout JSON；`success===false` 或非 0 exit → `json:null` + detail
5. **永不**把 token 写入 detail；env 用 `--env-file` 临时文件（0600，跑完 `rm -f`），路径在 `configDir` 旁而非 `/tmp`（snap Docker）

- [ ] **Step 4: 单测用假 runner 测 allowlist + success 解析（不真起 docker）**

```ts
it("parses success json from fake runner", async () => {
  const runner: SidecarRunner = async () => ({
    exitCode: 0,
    json: { success: true, result: { conversations: [{ id: "cidFAKE0001==" }], hasMore: false } },
    detail: "ok",
  })
  const r = await runner({
    vaultId: "vault_fake",
    accessToken: "uat-fake",
    dwsArgs: ["chat", "list-all-conversations", "--limit", "1", "-f", "json"],
    configDir: "/tmp/fake-dws-home",
  })
  expect(r.exitCode).toBe(0)
  expect((r.json as { success: boolean }).success).toBe(true)
})
```

- [ ] **Step 5: Commit**（若用户要求）

---

### Task 3: 会话列表 → 四件套 scopes

**Files:**
- Create: `apps/web-server/src/collector/sidecar-export.ts`
- Create: `tests/unit/web-server/sidecar-export.test.ts`

**Interfaces:**
- Consumes: sidecar `list-all-conversations` JSON；`exportRoot`
- Produces: 更新 `chat/scopes.jsonl`（+ 保持空 `records.jsonl` / `resources.jsonl` / 更新 `manifest.json` note）

形状对齐 `export-materializer` 的 scope 最小字段（假 ID 测）：

```ts
export function writeConversationsToChatExport(
  exportRoot: string,
  payload: unknown,
): { written: number; hasMore: boolean }
```

从 `payload.result.conversations`（或实测等价路径）映射：

- `id` / `scope_id`：可用 `conversation:<externalId>` 哈希或现有 `scopeIdFor` 若可安全复用（**不要**把 channels 重依赖硬拉进 web-server 若会循环；宁可在 sidecar-export 内复制最小 `scopeIdFor`）
- `data.openConversationId`：来自上游字段（fixture 用 `cidFAKE0001==`）
- 标题字段：有则写，无则空字符串
- `hasMore===true` 时函数仍返回 `hasMore:true`；**调用方必须继续翻页**（Task 4 分页）

- [ ] **Step 1: 单测 fixture（假 ID）**
- [ ] **Step 2: FAIL**
- [ ] **Step 3: 实现写盘**
- [ ] **Step 4: PASS**
- [ ] **Step 5: Commit**（若用户要求）

---

### Task 4: `runCapabilityCollect` 接线 sidecar + 分页

**Files:**
- Modify: `apps/web-server/src/collector/run-collect.ts`
- Modify: `apps/web-server/src/routes/collect.ts`（传入 runner / image env）
- Modify: `tests/unit/web-server/oauth-collect.test.ts`（或新建 collect-sidecar.test.ts）

**Interfaces:**
- `CollectRunInput` 增加可选 `sidecarRunner?: SidecarRunner`；`sidecarConfigRoot?: string`（默认 `join(dataDir,"vaults",vaultId,"dws-home")`）
- 对 `row.status==="sidecar"`：拼 argv（含分页 `--limit`/`--cursor` 以实测 dws help 为准），循环直到 `hasMore!==true` 或达安全上限（例如 100 页），每页 `writeConversationsToChatExport` **追加** scopes
- 失败：`status:"error"` + detail；**禁止** `ok` + 0 条假装成功
- `contact user get-self` 保持 `mapped` HTTP，不改走 sidecar

- [ ] **Step 1: 单测** — 注入假 runner 返回一页 `hasMore:false`，collect 结果含 `chat list-all-conversations` → `ok`，且 scopes.jsonl 行数=1（假 cid）
- [ ] **Step 2: FAIL**
- [ ] **Step 3: 实现接线**
- [ ] **Step 4: PASS + typecheck**
- [ ] **Step 5: Commit**（若用户要求）

---

### Task 5: `Dockerfile.dws-sidecar` + compose / 文档

**Files:**
- Create: `deploy/Dockerfile.dws-sidecar`
- Modify: `deploy/docker-compose.yml`（web-server 挂 docker.sock；环境变量 `MYCONTEXT_DWS_SIDECAR_IMAGE`；可选 `MYCONTEXT_DWS_SIDECAR_MAX_CONCURRENT`）
- Modify: `deploy/pack-ubuntu-release.sh`（若有打包脚本则一并 build sidecar）
- Modify: `docs/deploy/ubuntu-web.md`

Dockerfile 要点：

```dockerfile
FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates unzip \
  && rm -rf /var/lib/apt/lists/* \
  && npm install -g dingtalk-workspace-cli@1.0.60
ENV DWS_CONFIG_DIR=/dws-home
WORKDIR /work
# 默认入口不 login；由编排器传入 bash -lc 脚本
ENTRYPOINT ["dws"]
```

Compose：web-server `volumes` 增加 `/var/run/docker.sock:/var/run/docker.sock`（编排器用）；**不要**把 sock 传进 dws sidecar。文档写明：snap Docker 下数据与 spike 目录须在 `$HOME/...`；离线 `docker load` sidecar 镜像。

- [ ] **Step 1: 本地/CI 能 `docker build -f deploy/Dockerfile.dws-sidecar`**（在可拉 Docker Hub 的机器上）
- [ ] **Step 2: 文档写清 build/load/环境变量与「禁止本机 dws 主路径」**
- [ ] **Step 3: Commit**（若用户要求）

---

### Task 6: UI 降级客户端下载说明

**Files:**
- Modify: `apps/web-server/public/index.html`
- Modify: `apps/web-server/public/app.js`
- Modify: `tests/unit/web-server/browser-ui.test.ts`

- [ ] **Step 1: 改文案** — 「运行采集」为主路径（OpenAPI + 服务端 sidecar）；客户端 dws 脚本标为调试/应急
- [ ] **Step 2: 单测断言主文案不再要求本机必须装 dws**
- [ ] **Step 3: Commit**（若用户要求）

---

### Task 7: 部署机烟测（证据门禁）

**在 wsl-dev（或等价）上，不把真实 JSON 拉回 git：**

1. 构建/load `mycontext-dws-sidecar:0.1.0`（若 Hub 不可达，在可构建机 build + `docker save` + scp + `docker load`）
2. 更新 web-server 镜像含 Task 1–4 代码；挂上 docker.sock
3. 浏览器已登录用户点「运行采集」
4. 断言（只记）：
   - `collect-progress.json` 中 `chat list-all-conversations` 为 `ok` 或显式 `error`（不得 `deferred` 假成功）
   - `chat/scopes.jsonl` 行数 ≥ 1（只报行数，不报标题/ID）
5. 第二 vault（或第二假 configDir）目录不可读到第一 vault 的 `dws-home`

- [ ] **Step 1: 执行烟测并记录退出码/行数**
- [ ] **Step 2: 更新 B1 规格 §7 验收勾选（无密钥/PII）**

---

## Spec coverage

| 规格要求 | Task |
|---|---|
| B1 `--token` 注入，禁 device | 2, 5（spike 已证） |
| per-vault `DWS_CONFIG_DIR` | 2, 4 |
| 白名单只读 | 2 |
| 矩阵 `sidecar` | 1 |
| mapped 仍 HTTP | 4 |
| 会话写入 export | 3, 4 |
| 失败显式 | 4 |
| 镜像预装 CLI、含 unzip | 5 |
| 并发/回收（MVP：`--rm` + maxConcurrent；空闲长驻可后置） | 2, 5 |
| UI 非本机 dws 主路径 | 6 |
| 双 vault 隔离烟测 | 7 |
| 分页抽干 | 4 |

## Placeholder scan

无 TBD；空闲「长驻复用」明确后置，MVP 用每次采集 `docker run --rm`。

## Type consistency

- `SidecarRunner` / `SidecarRunRequest` / `SidecarRunResult` 命名贯穿 Task 2–4
- 矩阵状态字面量 `"sidecar"` 与 collect outcome 的 `ok`/`error`/`deferred` 区分：outcome 不引入 `"sidecar"` 字符串，成功仍为 `ok`
