# 本机 sync 脚本（**已 deprecated**）

> **正式主路径**已改为 Ubuntu 上企业内部应用 + 浏览器 OAuth 采集。  
> 规格：`docs/superpowers/specs/2026-08-30-enterprise-openapi-collector-design.md`  
> 本目录脚本仅作过渡：Win/mac 仍可用官方 `dws` 把四件套 **推送** 到服务器。
>
> **推荐入口（TS）：** `npx tsx scripts/sync/push-dws-export-entry.ts`  
> （支持 `--from-dws` 本机导出；bash/ps1 仅保留打包推送，不再扩展。）

Win / mac 用户若仍走过渡路径：**不安装 MyContext agent**，只装官方渠道 CLI（`dws`），用本目录脚本把
`exports/dws` 四件套 **推送** 到 Ubuntu 上的 Web Service。

## 推荐：npx tsx 推送

在仓库根目录（需已 `pnpm install`，且本机有 Node ≥ 22）：

```bash
export MYCONTEXT_SYNC_URL="http://127.0.0.1:8787/api/v1/channel-sync"
export MYCONTEXT_SYNC_TOKEN="your-sync-token"

# 假数据烟测（无需 dws）
npx tsx scripts/sync/push-dws-export-entry.ts --fixture

# 本机 dws → 会话列表 + 近 24h 消息 → 推送到 OAuth 同名 vault
# vaultId 取浏览器登录后 GET /api/v1/auth/me 的 vaultId
dws auth login   # 若尚未登录
export MYCONTEXT_VAULT_ID="u…"   # 与 /auth/me 一致；勿把真实 ID 写进 git
npx tsx scripts/sync/push-dws-export-entry.ts --from-dws --vault-id "$MYCONTEXT_VAULT_ID"
# 只导会话、不拉消息：加 --hours 0

# 已有四件套目录时
npx tsx scripts/sync/push-dws-export-entry.ts \
  --export-dir "$HOME/Library/Application Support/MyContext/vaults/<vaultId>/exports/dws" \
  --vault-id "<vaultId>"
```

`--from-dws` 会走仓库内已有的会话三路合并（`list-all-conversations` + 群分页）与
`chat message list-all` 分页抽干；保密群记为不可读并跳过。服务器**不**安装 dws。

## 安装 dws（macOS / Windows）

本机**推荐用 npm** 安装渠道 Workspace CLI（可执行文件名 `dws`），版本钉 **1.0.60**。

### 前置：Node.js（含 npm / npx）

未安装时先装 [Node.js LTS](https://nodejs.org/)（安装后终端里应有 `node`、`npm`、`npx`）。

### 推荐：npm 全局安装

```bash
npm install -g dingtalk-workspace-cli@1.0.60
```

Windows PowerShell 同样执行上述命令。然后验证：

```bash
dws --help
```

上游发行说明：https://github.com/DingTalk-Real-AI/dingtalk-workspace-cli/releases/tag/v1.0.60

### 备选：下载平台二进制

不便使用 npm 时，从同一发行页下载匹配资产，用同页 `checksums.txt` 校验 sha256 后将 `dws` 加入 `PATH`：

| 平台 | 资产文件名 |
| --- | --- |
| macOS Apple Silicon | `dws-darwin-arm64.tar.gz` |
| macOS Intel | `dws-darwin-amd64.tar.gz` |
| Windows x64 | `dws-windows-amd64.zip` |
| Windows ARM64 | `dws-windows-arm64.zip` |
| Linux x64 | `dws-linux-amd64.tar.gz` |
| Linux ARM64 | `dws-linux-arm64.tar.gz` |

### Windows 推送脚本

`push-dws-export.ps1` 与 bash 版逻辑对称，**尚未在 Windows 主机上实测**。在 Win 上使用前请自行跑 `-Fixture` 烟测；本仓库 CI 仅在 mac/Linux 上验证 `.sh`。

## 登录（live 模式）

```bash
dws auth login
```

浏览器完成授权后，脚本会在推送前执行白名单内只读探活：

```bash
dws contact user get-self
```

未登录时 live 模式会失败；**fixture 模式不需要登录**。

## 环境变量

| 变量 | 必填 | 说明 |
| --- | --- | --- |
| `MYCONTEXT_SYNC_URL` | 是 | 同步端点，例 `http://127.0.0.1:8787/api/v1/channel-sync` |
| `MYCONTEXT_SYNC_TOKEN` | 可选* | 与服务端一致的 Bearer；**推荐**钉钉扫码后由浏览器自动领取（见下方） |
| `MYCONTEXT_EXPORT_DIR` | export-dir | 四件套根目录（含 `chat/`、`minutes/` 子目录） |
| `MYCONTEXT_VAULT_ID` | from-dws / export-dir | 服务端 vault 目录名（与 `/auth/me` 对齐） |
| `MYCONTEXT_HOURS` | from-dws | 消息回看小时，默认 24；`0` = 只导会话 |
| `MYCONTEXT_DWS_BIN` | from-dws | 覆盖 dws 可执行文件路径 |

\* 服务端 **未** 设置 `MYCONTEXT_SYNC_TOKEN`（file-backed）时：浏览器扫码登录后会
`GET /api/v1/sync/token` 自动写入页面 sessionStorage。CLI 若仍要推送，可从设置页
「生成新 Sync Token」复制，或读服务器数据卷 `sync-token` 文件。部署用 env 锁定时
浏览器 **不能** 回显，须在部署配置中读取。

| `MYCONTEXT_SYNC_FIXTURE` | 否 | 设为 `1` 时使用合成假数据 |

临时文件写在 `/tmp`（mac/Linux）或 `%TEMP%`（Windows），**不要**把导出物提交进 git。

## fixture 干跑（本地测通）

无需 dws 登录，向正在运行的 Web Service 推送假数据（`vault-fake-001` / `cidFAKE0001==`）：

```bash
export MYCONTEXT_SYNC_URL="http://127.0.0.1:8787/api/v1/channel-sync"
export MYCONTEXT_SYNC_TOKEN="your-sync-token"

# 推荐
npx tsx scripts/sync/push-dws-export-entry.ts --fixture

# 兼容：bash / PowerShell
./scripts/sync/push-dws-export.sh --fixture
.\scripts\sync\push-dws-export.ps1 -Fixture
```

服务端需已设置 `MYCONTEXT_DATA_DIR` 与相同 token。开发机上可在仓库根目录用全局 `tsx` 启动（`npm install -g tsx`）：

```bash
export MYCONTEXT_DATA_DIR=/tmp/mycontext-data
export MYCONTEXT_SYNC_TOKEN=your-sync-token
export MYCONTEXT_PORT=8787
mkdir -p "$MYCONTEXT_DATA_DIR"
tsx apps/web-server/src/index.ts
```

生产/Ubuntu 侧按后续 Web Service 部署文档启动；fixture 也可对已在运行的远程实例推送。

成功时脚本 stderr 打印 `HTTP 200` 与 `同步成功`。

## live 推送（已有 export 目录）

当你已在别处（桌面版 ExportMaterializer 等）生成四件套时，指定目录与 vaultId：

```bash
export MYCONTEXT_SYNC_URL="https://your-server/api/v1/channel-sync"
export MYCONTEXT_SYNC_TOKEN="your-sync-token"
export MYCONTEXT_EXPORT_DIR="$HOME/Library/Application Support/MyContext/vaults/<vaultId>/exports/dws"
export MYCONTEXT_VAULT_ID="<vaultId>"

./scripts/sync/push-dws-export.sh
```

PowerShell：

```powershell
$env:MYCONTEXT_SYNC_URL = "https://your-server/api/v1/channel-sync"
$env:MYCONTEXT_SYNC_TOKEN = "your-sync-token"
$env:MYCONTEXT_EXPORT_DIR = "C:\Users\<用户名>\AppData\Roaming\MyContext\vaults\<vaultId>\exports\dws"
$env:MYCONTEXT_VAULT_ID = "<vaultId>"
.\scripts\sync\push-dws-export.ps1
```

目录结构须对齐 kl-graph 四件套：

```
<export-dir>/
  chat/
    manifest.json
    scopes.jsonl
    records.jsonl
    resources.jsonl
  minutes/          # 可选，结构同上
    ...
```

## 排错

| 现象 | 处理 |
| --- | --- |
| `MYCONTEXT_SYNC_URL 与 MYCONTEXT_SYNC_TOKEN 必填` | 设置两个环境变量后重试 |
| `dws 探活失败` | 执行 `dws auth login`；或改用 `--fixture` 测 API |
| HTTP 401 | token 与服务端不一致 |
| HTTP 400 `invalid_body` | 四件套不全或 manifest.sources 与文件键不匹配 |
| HTTP 404 | URL 路径错误或 Web Service 未启动 |

## 安全说明

- 脚本**默认不会**在本机重跑完整 chat→四件套流水线；`--export-dir` 只打包已有 export 并 POST。
- `--from-dws` 例外：只调白名单只读命令导出再推送，不扩大 dws 读取面。
- 日志与示例均使用假 ID；勿在 issue/PR 中粘贴真实聊天或 openId。
