# 本机 → Ubuntu：把 exports/dws 四件套 POST 到 Web Service。
# live 模式依赖 PATH 上的 dws；fixture 模式无需登录。
param(
    [switch]$Fixture,
    [string]$ExportDir = $env:MYCONTEXT_EXPORT_DIR,
    [string]$VaultId = $env:MYCONTEXT_VAULT_ID
)

$ErrorActionPreference = "Stop"

function Show-Usage {
    @"
用法: .\push-dws-export.ps1 [-Fixture] [-ExportDir DIR] [-VaultId ID]

环境变量:
  MYCONTEXT_SYNC_URL     POST 地址
  MYCONTEXT_SYNC_TOKEN   Bearer token
  MYCONTEXT_EXPORT_DIR   四件套根目录
  MYCONTEXT_VAULT_ID     目标 vaultId（live 模式必填）
  MYCONTEXT_SYNC_FIXTURE 设为 1 等同 -Fixture

live 模式推送前执行: dws contact user get-self
"@
}

if ($env:MYCONTEXT_SYNC_FIXTURE -eq "1") {
    $Fixture = $true
}

$syncUrl = $env:MYCONTEXT_SYNC_URL
$syncToken = $env:MYCONTEXT_SYNC_TOKEN

if ([string]::IsNullOrWhiteSpace($syncUrl) -or [string]::IsNullOrWhiteSpace($syncToken)) {
    Write-Error "MYCONTEXT_SYNC_URL 与 MYCONTEXT_SYNC_TOKEN 必填"
    exit 1
}

function Invoke-DwsSmoke {
    $dws = Get-Command dws -ErrorAction SilentlyContinue
    if (-not $dws) {
        Write-Error "未找到 dws（请先安装官方 CLI 并加入 PATH）"
        exit 1
    }
    Write-Host "探活: dws contact user get-self …" -ForegroundColor Cyan
    & dws contact user get-self *> $null
    if ($LASTEXITCODE -ne 0) {
        Write-Error "dws 探活失败（需 dws auth login）"
        exit 1
    }
}

function New-FixturePayload {
    $exportedAt = 1785000000000
    $chatManifest = @{
        source        = "mycontext"
        dataset       = "chat"
        scope_types   = @("workspace", "chat")
        record_types  = @("message")
        resource_kinds = @()
        counts        = @{ scopes = 1; records = 0; resources = 0 }
        exported_at   = $exportedAt
    } | ConvertTo-Json -Depth 6
    $scopeLine = (@{
        id        = "cidFAKE0001=="
        type      = "chat"
        parent_id = "workspace:ali-ding"
        data      = @{ title = "示例群"; member_count = 2 }
    } | ConvertTo-Json -Compress -Depth 5) + "`n"

    return @{
        manifest = @{
            vaultId    = "vault-fake-001"
            channelId  = "dingtalk"
            exportedAt = $exportedAt
            sources    = @("chat")
        }
        files = @{
            "chat/manifest.json"  = ($chatManifest + "`n")
            "chat/scopes.jsonl"   = $scopeLine
            "chat/records.jsonl"  = ""
            "chat/resources.jsonl" = ""
        }
    }
}

function New-ExportPayload {
    param(
        [Parameter(Mandatory = $true)][string]$Root,
        [Parameter(Mandatory = $true)][string]$Vault
    )

    if (-not (Test-Path -LiteralPath $Root -PathType Container)) {
        Write-Error "导出目录不存在: $Root"
        exit 1
    }
    if ([string]::IsNullOrWhiteSpace($Vault)) {
        Write-Error "live 模式需要 -VaultId 或 MYCONTEXT_VAULT_ID"
        exit 1
    }

    $four = @("manifest.json", "scopes.jsonl", "records.jsonl", "resources.jsonl")
    $sources = @()
    $files = @{}
    $exportedAt = 0

    foreach ($source in @("chat", "minutes")) {
        $srcDir = Join-Path $Root $source
        if (-not (Test-Path -LiteralPath $srcDir -PathType Container)) { continue }
        $missing = @($four | Where-Object { -not (Test-Path -LiteralPath (Join-Path $srcDir $_) -PathType Leaf) })
        if ($missing.Count -gt 0) {
            Write-Host "跳过不完整 source ${source}（缺 $($missing -join ', ')）" -ForegroundColor Yellow
            continue
        }
        $sources += $source
        foreach ($name in $four) {
            $key = "$source/$name"
            $content = Get-Content -LiteralPath (Join-Path $srcDir $name) -Raw -Encoding UTF8
            if ($null -eq $content) { $content = "" }
            $files[$key] = $content
            if ($name -eq "manifest.json") {
                try {
                    $meta = $content | ConvertFrom-Json
                    $ts = [int64]$meta.exported_at
                    if ($ts -gt $exportedAt) { $exportedAt = $ts }
                } catch { }
            }
        }
    }

    if ($sources.Count -eq 0) {
        Write-Error "未找到含四件套的 chat/ 或 minutes/ 目录"
        exit 1
    }
    if ($exportedAt -le 0) {
        $exportedAt = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    }

    return @{
        manifest = @{
            vaultId    = $Vault
            channelId  = "dingtalk"
            exportedAt = $exportedAt
            sources    = $sources
        }
        files = $files
    }
}

function Send-SyncPayload {
    param([Parameter(Mandatory = $true)]$Body)

    $headers = @{
        Authorization = "Bearer $syncToken"
        "Content-Type" = "application/json; charset=utf-8"
    }
    $json = $Body | ConvertTo-Json -Depth 20 -Compress
    try {
        $response = Invoke-WebRequest -Uri $syncUrl -Method Post -Headers $headers -Body $json -UseBasicParsing
        Write-Host "HTTP $($response.StatusCode)" -ForegroundColor Green
        Write-Host $response.Content
    } catch {
        $status = $_.Exception.Response.StatusCode.value__
        Write-Error "同步失败（HTTP $status）"
        exit 1
    }
}

if ($Fixture) {
    Write-Host "模式: fixture（合成假数据，跳过 dws 探活）" -ForegroundColor Cyan
    $payload = New-FixturePayload
} else {
    Invoke-DwsSmoke
    Write-Host "模式: live（打包 export 目录）" -ForegroundColor Cyan
    $payload = New-ExportPayload -Root $ExportDir -Vault $VaultId
}

Send-SyncPayload -Body $payload
Write-Host "同步成功" -ForegroundColor Green
