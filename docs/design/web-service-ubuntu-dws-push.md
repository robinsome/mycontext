# Web Service（Ubuntu）+ 本机仅 dws 推送

**状态：** 已确认（2026-08-30）  
**选择：** 1B 数据落 Ubuntu；Win/mac **只装官方 DingTalk Workspace CLI（`dws`）**，不做 MyContext 本机 agent 包。

## 目标

把 MyContext 从「Electron 本机全栈」改成：

- **Ubuntu**：纯 Web Service（浏览器 UI + HTTP API + vault/SQLite + kl-server + 建图/蒸馏）
- **Windows / macOS**：用户只安装官方 `dws` 二进制；用文档化脚本把渠道导出 **推送** 到服务器

## 硬约束

1. 个人身份的 `dws` **必须在已登录钉钉的本机**跑；Ubuntu 进程不能替代本机登录态。
2. 不发 Electron / MyContext agent 安装包作为主形态（开发态 Electron 可暂时保留）。
3. 同步方向只能是 **本机 → 服务器**（push）；不做服务端反向遥控本机。
4. 继续遵守仓库隐私门禁：日志/issue/fixture 不得含真实聊天与真实 ID；服务器上的真实数据不进 git。
5. 渠道命令白名单（`packages/channels/.../cli.ts`）边界不变；推送脚本只调用已允许的只读导出类命令。

## 架构

```
[浏览器] ⇄ HTTPS ⇄ [Ubuntu: Web UI + API + control/vault SQLite + kl + distill]
                              ↑
                    Bearer token + multipart/JSON 导出
                              ↑
[Win/mac: 仅官方 dws] ── sync 脚本（curl/powershell）──┘
```

### Ubuntu 服务职责

- 会话鉴权（先做单用户 / 自建 token；多租户后置）
- 接收本机推送的渠道导出（对齐现有 `exports/dws` 目录形状）
- 触发/调度已有 ingest → graph-export → kl 建图链路（改为读服务器上的导出，而不是主进程 `spawn dws`）
- 提供现有 renderer 所需的 HTTP 映射（替代 Electron IPC）

### 本机职责

- 安装官方 `dws`（`dingtalk-workspace-cli` / 发行说明中的二进制）
- `dws auth login`（本机浏览器）
- 运行仓库提供的 **sync 脚本**（非独立产品安装包）：调用白名单内 dws 命令 → `POST /api/v1/channel-sync`

## 明确不做（本阶段）

- 本机常驻中继 / 反向隧道 / 实时 `dws event` 长连进服务器
- 在 Ubuntu 上跑个人 `dws`
- 多组织复杂 RBAC
- 一次砍掉整个 Electron（可并行保留 `pnpm dev`）

## 隐私与运维

- 聊天原文落在运营者控制的 Ubuntu 磁盘；部署文档必须写清备份、磁盘加密、访问控制。
- API 仅 HTTPS；sync 使用短时或可吊销的 token。
- 日志不打印消息正文与真实 openId。

## 验收（MVP）

1. Ubuntu 上容器或 systemd 拉起 Web + API，浏览器可打开设置/仪表盘骨架。
2. Win 或 mac 仅装 `dws` 后，跑 sync 脚本能把一份脱敏/真实自有数据推到服务器。
3. 服务器上能看到导出落盘，并能触发既有建图路径（至少「有导出 → kl ingest」通一条）。
4. 文档：安装 dws、登录、配置 `MYCONTEXT_SYNC_URL` + token、排错。
