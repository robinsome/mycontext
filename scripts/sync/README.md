# 本机 sync 脚本（仅依赖 dws）

Win / mac 用户**不安装 MyContext agent**，只装官方渠道 CLI（`dws`），用本目录脚本把
`exports/dws` 四件套 **推送** 到 Ubuntu 上的 Web Service。

## 安装 dws

### macOS / Linux

1. 从 [dingtalk-workspace-cli 发行页](https://github.com/open-dingtalk/dingtalk-workspace-cli/releases)
   下载对应平台的压缩包，解压后将 `dws` 放到 `PATH` 目录（例如 `~/.local/bin`）。
2. 或用 npm 全局安装（包名 `dingtalk-workspace-cli`，可执行文件名为 `dws`）：

   ```bash
   npm install -g dingtalk-workspace-cli
   ```

3. 验证：

   ```bash
   dws --help
   ```

### Windows

1. 从上述发行页下载 Windows 版，解压后将目录加入系统 `PATH`。
2. 或在 PowerShell 中：

   ```powershell
   npm install -g dingtalk-workspace-cli
   ```

3. 新开终端执行 `dws --help` 确认可用。

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

服务端需已设置 `MYCONTEXT_DATA_DIR` 与相同 token，例如：

```bash
export MYCONTEXT_DATA_DIR=/tmp/mycontext-data
export MYCONTEXT_SYNC_TOKEN=your-sync-token
export MYCONTEXT_PORT=8787
node --import tsx apps/web-server/src/index.ts
```

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
