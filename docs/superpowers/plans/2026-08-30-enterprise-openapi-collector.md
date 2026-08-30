# 企业开放平台采集实施计划（参考 dingtalk skills）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 单企业开放平台 + 浏览器 OAuth + 用户 token HTTP 采集，取代本机个人 `dws`；复用 Web Service / vault / 四件套 / 建图。

**Architecture:** skills + `READ_COMMANDS` 定能力语义；`open.dingtalk.com` 实测定 HTTP；对照表驱动采集器。

**Tech Stack:** 现有 `@mycontext/web-server` / `@mycontext/channels` / vault / knowledge-feed；开放平台 OAuth + HTTP。

**Spec:** `docs/superpowers/specs/2026-08-30-enterprise-openapi-collector-design.md`

## Global Constraints

- AppSecret / user token 不进 git；日志无正文与真实 ID 全文。
- 只走对照表 `mapped`；`unsupported` / `unreadable` 明示；不换接口试探。
- 不用 App token 读个人聊天。
- 分页抽干；遵守引导范围。
- 提交仅在用户要求时做（本计划执行期 feature 分支可按 Task 提交）。
- skills（`~/.dws/skills/multi`）只作 CLI 语义参考，**不是** OpenAPI path 说明书。

## File map

| 路径 | 职责 |
|---|---|
| `packages/channels/src/plugins/dingtalk/openapi-capability-matrix.ts` | dws 命令 ↔ skillRef ↔ openApi/status |
| `tests/unit/channels/openapi-capability-matrix.test.ts` | 与 `READ_COMMANDS` 一一锁表 |
| `apps/web-server` | OAuth、采集调度、进度 API（Task 1+） |
| `docs/deploy/ubuntu-web.md` | 企业应用权限清单（Task 3） |

---

### Task 0: 对照表模块

**Files:**
- Create: `packages/channels/.../openapi-capability-matrix.ts`
- Test: `tests/unit/channels/openapi-capability-matrix.test.ts`
- Export from channels package index if needed

- [x] **Step 1:** 写单测：每个 `DWS_COMMAND_ALLOWLIST.read` 条目恰好一行矩阵；禁止遗漏/重复
- [x] **Step 2:** 跑测确认失败
- [x] **Step 3:** 实现矩阵（MVP：消息/会话/get-self → deferred 或 mapped 占位；event/doc 第二波 deferred；PII/send 不在 READ 表故不出现）
- [x] **Step 4:** 跑测通过
- [ ] **Step 5:** 提交（若用户要求）

---

### Task 1: 浏览器 OAuth + session/vault

（细节见 Cursor plan；本文件 Task 0 落地后再展开勾选。）

---

### Task 2: 用户 token 采集 → 四件套 → graph/build

---

### Task 3: UI / 文档 / deprecated sync 脚本

---

### Task 4: MVP 验收与实测笔记
