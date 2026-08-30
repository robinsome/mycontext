# 本机 sync 脚本（仅依赖 dws）

Win / mac 用户**不安装 MyContext agent**，只装官方渠道 CLI（`dws`），用本目录脚本把
`exports/dws` 四件套 **推送** 到 Ubuntu 上的 Web Service。

## 安装 dws

sync 脚本与渠道 CLI **v1.0.60** 对齐。从下列发行页下载**匹配本机平台**的资产，用同页 `checksums.txt` 校验 sha256 后，将 `dws` 加入 `PATH`：

**发行页：** https://github.com/DingTalk-Real-AI/dingtalk-workspace-cli/releases/tag/v1.0.60

| 平台 | 资产文件名 |
| --- | --- |
| macOS Apple Silicon | `dws-darwin-arm64.tar.gz` |
| macOS Intel | `dws-darwin-amd64.tar.gz` |
| Windows x64 | `dws-windows-amd64.zip` |
| Windows ARM64 | `dws-windows-arm64.zip` |

1. 下载上表对应资产并解压。
2. 对照发行页 `checksums.txt` 验证 sha256（mac/Linux 可用 `shasum -a 256 -c checksums.txt`；Windows 用等价工具）。
3. 将 `dws`（Windows 为 `dws.exe`）移到已在 `PATH` 中的目录。
4. 执行 `dws --help` 确认可用。

也可通过 npm 全局安装（**钉版本**）：

```bash
npm install -g dingtalk-workspace-cli@1.0.60
```

PowerShell 中同样使用 `@1.0.60`。

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
| `MYCONTEXT_SYNC_TOKEN` | 是 | 与服务端 `MYCONTEXT_SYNC_TOKEN` 一致的 Bearer |
| `MYCONTEXT_EXPORT_DIR` | live | 四件套根目录（含 `chat/`、`minutes/` 子目录） |
| `MYCONTEXT_VAULT_ID` | live | 服务端 vault 目录名，例 `vault-fake-001` |
| `MYCONTEXT_SYNC_FIXTURE` | 否 | 设为 `1` 时使用合成假数据 |

临时文件写在 `/tmp`（mac/Linux）或 `%TEMP%`（Windows），**不要**把导出物提交进 git。

## fixture 干跑（本地测通）

无需 dws 登录，向正在运行的 Web Service 推送假数据（`vault-fake-001` / `cidFAKE0001==`）：

```bash
export MYCONTEXT_SYNC_URL="http://127.0.0.1:8787/api/v1/channel-sync"
export MYCONTEXT_SYNC_TOKEN="your-sync-token"

# mac / Linux
./scripts/sync/push-dws-export.sh --fixture

# Windows PowerShell
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

- 脚本**不会**在本机重跑完整 chat→四件套流水线；live 模式只打包已有 export 并 POST。
- 只调用白名单只读命令做探活，不扩大 dws 读取面。
- 日志与示例均使用假 ID；勿在 issue/PR 中粘贴真实聊天或 openId。
