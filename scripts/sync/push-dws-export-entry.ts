/**
 * 过渡：本机 dws 导出四件套 → POST `/api/v1/channel-sync`。
 *
 * **正式主路径**仍是 Ubuntu 企业应用 + OAuth + callMapped；本脚本只补
 * 「会话列表无 OpenAPI」期间的桥：本机已登录的 `dws`（PATH / 全局 npm）
 * 能走 MCP，服务器不装 dws。
 *
 * 用法：
 *   npx tsx scripts/sync/push-dws-export-entry.ts --fixture
 *   npx tsx scripts/sync/push-dws-export-entry.ts --export-dir DIR --vault-id ID
 *   npx tsx scripts/sync/push-dws-export-entry.ts --from-dws --vault-id ID [--hours 24]
 *
 * 环境变量：MYCONTEXT_SYNC_URL、MYCONTEXT_SYNC_TOKEN；
 * live 另需 MYCONTEXT_VAULT_ID / MYCONTEXT_EXPORT_DIR（可用 flag 覆盖）。
 *
 * 临时目录写 `/tmp`，不进 git；日志只打条数，不打标题/真实 ID。
 */
import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  createDingTalkConversations,
  createDingTalkIngest,
  DwsCli,
  formatDwsIsoTime,
  formatDwsLocalTime,
  type ChannelConversationItem,
  type ParsedMessageLike,
} from "../../packages/channels/src/index.ts"
import { systemClock, type Logger } from "../../packages/kernel/src/index.ts"
import { ProcessRunner, RuntimeEnv } from "../../packages/runtime-env/src/index.ts"
import {
  channelSyncRequestSchema,
  type ChannelSyncRequest,
  vaultIdSchema,
} from "../../packages/sync-contract/src/channel-sync.ts"

const WORKSPACE_ID = "workspace:ali-ding"
const FOUR = ["manifest.json", "scopes.jsonl", "records.jsonl", "resources.jsonl"] as const
const MESSAGE_PAGE_LIMIT = 100
/** list-all 防挂死：100 页 × 100 ≈ 1 万条量级上限。 */
const MESSAGE_MAX_PAGES = 100

export type PushMode = "fixture" | "export-dir" | "from-dws"

export interface PushDwsExportOptions {
  mode: PushMode
  syncUrl: string
  syncToken: string
  vaultId?: string
  exportDir?: string
  /** from-dws：回看小时数；0 = 只导会话 scopes，不拉消息。 */
  hours?: number
  /** 覆盖 dws 可执行文件（否则 PATH / npm / bundled）。 */
  dwsBin?: string
  log?: (line: string) => void
}

function scopeIdFor(externalId: string): string {
  const safe = externalId.replaceAll(/[/\\:*?"<>|\r\n]/g, "_").replace(/^\.+$/, "_")
  return `chat:${safe === "" ? "unknown" : safe}`
}

function joinLines(lines: string[]): string {
  return lines.length === 0 ? "" : `${lines.join("\n")}\n`
}

/** 合成假数据（与 bash --fixture 同形）。 */
export function buildFixturePayload(): ChannelSyncRequest {
  const exportedAt = 1_785_000_000_000
  const chatManifest = {
    source: "mycontext",
    dataset: "chat",
    scope_types: ["workspace", "chat"],
    record_types: ["message"],
    resource_kinds: [] as string[],
    counts: { scopes: 1, records: 0, resources: 0 },
    exported_at: exportedAt,
  }
  const scopeLine = {
    id: "cidFAKE0001==",
    type: "chat",
    parent_id: WORKSPACE_ID,
    data: { title: "示例群", member_count: 2 },
  }
  return channelSyncRequestSchema.parse({
    manifest: {
      vaultId: "vault-fake-001",
      channelId: "dingtalk",
      exportedAt: exportedAt,
      sources: ["chat"],
    },
    files: {
      "chat/manifest.json": `${JSON.stringify(chatManifest, null, 2)}\n`,
      "chat/scopes.jsonl": `${JSON.stringify(scopeLine)}\n`,
      "chat/records.jsonl": "",
      "chat/resources.jsonl": "",
    },
  })
}

/** 打包已有 exports/dws 目录。 */
export function buildPayloadFromExportDir(exportRoot: string, vaultId: string): ChannelSyncRequest {
  const parsedVault = vaultIdSchema.parse(vaultId)
  const sources: Array<"chat" | "minutes"> = []
  const files: Record<string, string> = {}
  let exportedAt = 0

  for (const source of ["chat", "minutes"] as const) {
    const srcDir = join(exportRoot, source)
    try {
      if (!statSync(srcDir).isDirectory()) continue
    } catch {
      continue
    }
    const missing = FOUR.filter((name) => {
      try {
        return !statSync(join(srcDir, name)).isFile()
      } catch {
        return true
      }
    })
    if (missing.length > 0) continue
    sources.push(source)
    for (const name of FOUR) {
      const key = `${source}/${name}`
      const text = readFileSync(join(srcDir, name), "utf8")
      files[key] = text
      if (name === "manifest.json") {
        try {
          const meta = JSON.parse(text) as { exported_at?: unknown }
          const ts = typeof meta.exported_at === "number" ? meta.exported_at : 0
          exportedAt = Math.max(exportedAt, ts)
        } catch {
          /* ignore */
        }
      }
    }
  }

  if (sources.length === 0) {
    throw new Error("未找到含四件套的 chat/ 或 minutes/ 目录")
  }
  if (exportedAt <= 0) exportedAt = Date.now()

  return channelSyncRequestSchema.parse({
    manifest: {
      vaultId: parsedVault,
      channelId: "dingtalk",
      exportedAt,
      sources,
    },
    files,
  })
}

/** 会话 + 可选消息 → chat 四件套（形状对齐 ExportMaterializer）。 */
export function buildChatPayloadFromDws(input: {
  vaultId: string
  conversations: ChannelConversationItem[]
  messages: ParsedMessageLike[]
  truncated: boolean
  exportedAt?: number
}): ChannelSyncRequest {
  const vaultId = vaultIdSchema.parse(input.vaultId)
  const exportedAt = input.exportedAt ?? Date.now()
  const scopeLines: string[] = []
  const recordLines: string[] = []

  // workspace 容器（loader 认 parent_id）
  scopeLines.push(
    JSON.stringify({
      id: WORKSPACE_ID,
      type: "workspace",
      parent_id: null,
      data: { title: "钉钉工作区" },
    }),
  )

  const seenScopes = new Set<string>()
  for (const c of input.conversations) {
    const scopeId = scopeIdFor(c.externalId)
    if (seenScopes.has(scopeId)) continue
    seenScopes.add(scopeId)
    scopeLines.push(
      JSON.stringify({
        id: scopeId,
        type: "chat",
        parent_id: WORKSPACE_ID,
        data: {
          title: c.title,
          chat_kind: c.kind,
          openConversationId: c.externalId,
          memberCount: c.memberCount,
        },
      }),
    )
  }

  for (const m of input.messages) {
    const cid = m.conversationExternalId
    const scopeId = scopeIdFor(cid)
    if (!seenScopes.has(scopeId)) {
      // list-all 可能带回会话窗口外的群：补一条最小 scope，标题未知
      seenScopes.add(scopeId)
      scopeLines.push(
        JSON.stringify({
          id: scopeId,
          type: "chat",
          parent_id: WORKSPACE_ID,
          data: {
            title: null,
            chat_kind: "group",
            openConversationId: cid,
          },
        }),
      )
    }
    const recordId = `${scopeId}:${m.externalId}`
    const data: Record<string, unknown> = {
      openMessageId: m.externalId,
      openConversationId: cid,
      content: m.contentText ?? "",
      createTime: formatDwsIsoTime(m.sentAt),
      timestampMs: m.sentAt,
      sender: m.senderDisplayName ?? "unknown",
      senderOpenDingTalkId: m.senderExternalId,
      isSelf: null,
    }
    if (m.quotedExternalId) {
      data.quotedMessage = { openMessageId: m.quotedExternalId }
    }
    recordLines.push(JSON.stringify({ id: recordId, scope_id: scopeId, type: "message", data }))
  }

  const chatCount = Math.max(0, seenScopes.size - 1)
  const chatManifest = {
    source: "mycontext",
    dataset: "chat",
    scope_types: ["workspace", "chat"],
    record_types: ["message"],
    resource_kinds: [] as string[],
    counts: { scopes: chatCount, records: recordLines.length, resources: 0 },
    exported_at: exportedAt,
    /** 过渡导出元数据：不进 loader 契约，仅供排错。 */
    mycontext_bridge: {
      truncatedConversations: input.truncated,
      conversationCount: input.conversations.length,
    },
  }

  return channelSyncRequestSchema.parse({
    manifest: {
      vaultId,
      channelId: "dingtalk",
      exportedAt,
      sources: ["chat"],
    },
    files: {
      "chat/manifest.json": `${JSON.stringify(chatManifest, null, 2)}\n`,
      "chat/scopes.jsonl": joinLines(scopeLines),
      "chat/records.jsonl": joinLines(recordLines),
      "chat/resources.jsonl": "",
    },
  })
}

export async function postChannelSync(
  syncUrl: string,
  syncToken: string,
  payload: ChannelSyncRequest,
): Promise<{ httpCode: number; body: string }> {
  const response = await fetch(syncUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${syncToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  })
  const body = await response.text()
  return { httpCode: response.status, body }
}

function quietLogger(): Logger {
  const logger: Logger = {
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    child: () => logger,
  }
  return logger
}

function createDwsCli(dwsBin: string | undefined): DwsCli {
  const logger = quietLogger()
  const runtime = new RuntimeEnv({
    binDir: join(tmpdir(), "mycontext-dws-bin-unused"),
    ...(dwsBin !== undefined && dwsBin !== "" ? { dwsBinOverride: dwsBin } : {}),
  })
  return new DwsCli({
    runtime,
    processes: new ProcessRunner(logger),
    logger,
    timeoutMs: 120_000,
  })
}

async function exportFromDws(options: {
  vaultId: string
  hours: number
  dwsBin?: string
  log: (line: string) => void
}): Promise<ChannelSyncRequest> {
  const cli = createDwsCli(options.dwsBin)
  options.log("探活: dws contact user get-self …")
  await cli.json(["contact", "user", "get-self"])

  options.log("拉取会话列表（三路合并，见 createDingTalkConversations）…")
  const conversationsApi = createDingTalkConversations(cli)
  const listed = await conversationsApi.list()
  options.log(
    `会话：${listed.items.length} 条${listed.truncated ? "（窗口可能截断，不完全）" : ""}`,
  )

  const messages: ParsedMessageLike[] = []
  if (options.hours > 0) {
    const end = systemClock.now()
    const start = end - options.hours * 3_600_000
    options.log(`拉取消息 list-all：最近 ${options.hours}h …`)
    const ingest = createDingTalkIngest(cli)
    let cursor: string | null = "0"
    for (let page = 0; page < MESSAGE_MAX_PAGES; page += 1) {
      const result = await ingest.pull({
        start,
        end,
        cursor,
        limit: MESSAGE_PAGE_LIMIT,
      })
      messages.push(...result.messages)
      const refused = result.refusedConversations ?? []
      if (refused.length > 0) {
        options.log(`本页不可读会话：${refused.length}（已跳过）`)
      }
      if (!result.hasMore) break
      const next = result.nextCursor
      if (next === null || next === "" || next === cursor) break
      cursor = next
    }
    options.log(`消息：${messages.length} 条`)
  } else {
    options.log("hours=0：只导会话 scopes，不拉消息")
  }

  // 旁证：确认 CLI 时间格式化器仍可用（不进 payload）
  void formatDwsLocalTime(systemClock.now())

  return buildChatPayloadFromDws({
    vaultId: options.vaultId,
    conversations: listed.items,
    messages,
    truncated: listed.truncated,
  })
}

export async function runPushDwsExport(options: PushDwsExportOptions): Promise<void> {
  const log = options.log ?? ((line: string) => console.error(line))
  if (!options.syncUrl || !options.syncToken) {
    throw new Error("MYCONTEXT_SYNC_URL 与 MYCONTEXT_SYNC_TOKEN 必填")
  }

  let payload: ChannelSyncRequest
  if (options.mode === "fixture") {
    log("模式: fixture（合成假数据）")
    payload = buildFixturePayload()
  } else if (options.mode === "export-dir") {
    if (!options.exportDir) throw new Error("export-dir 模式需要 --export-dir / MYCONTEXT_EXPORT_DIR")
    if (!options.vaultId) throw new Error("export-dir 模式需要 --vault-id / MYCONTEXT_VAULT_ID")
    log("模式: export-dir（打包已有四件套）")
    // 探活：PATH 上有 dws 时可选；没有则跳过（纯打包）
    const which = spawnSync("dws", ["contact", "user", "get-self"], {
      encoding: "utf8",
      timeout: 60_000,
    })
    if (which.status === 0) log("探活: dws contact user get-self ok")
    else log("跳过 dws 探活（未安装或未登录）；继续打包目录")
    payload = buildPayloadFromExportDir(options.exportDir, options.vaultId)
  } else {
    if (!options.vaultId) throw new Error("from-dws 模式需要 --vault-id / MYCONTEXT_VAULT_ID")
    log("模式: from-dws（本机 dws → 四件套）")
    payload = await exportFromDws({
      vaultId: options.vaultId,
      hours: options.hours ?? 24,
      ...(options.dwsBin !== undefined ? { dwsBin: options.dwsBin } : {}),
      log,
    })
  }

  // 可选落一份到 /tmp 便于对照（不含写入仓库）
  const dumpDir = mkdtempSync(join(tmpdir(), "mycontext-dws-push-"))
  writeFileSync(join(dumpDir, "payload.json"), JSON.stringify(payload.manifest), "utf8")
  log(`payload 摘要已写 ${dumpDir}/payload.json（仅 manifest）`)

  const { httpCode, body } = await postChannelSync(options.syncUrl, options.syncToken, payload)
  if (httpCode === 200) {
    log(body)
  } else {
    log(`响应体:\n${body}`)
  }
  log(`HTTP ${httpCode}`)
  if (httpCode !== 200) {
    throw new Error(`同步失败（HTTP ${httpCode}）`)
  }
  log("同步成功")
}

function parseArgs(argv: string[]): {
  mode: PushMode
  exportDir?: string
  vaultId?: string
  hours?: number
  dwsBin?: string
} {
  let mode: PushMode | null = null
  let exportDir: string | undefined
  let vaultId: string | undefined
  let hours: number | undefined
  let dwsBin: string | undefined

  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]
    if (a === "--fixture") mode = "fixture"
    else if (a === "--from-dws") mode = "from-dws"
    else if (a === "--export-dir") {
      mode = mode ?? "export-dir"
      exportDir = argv[++i]
    } else if (a === "--vault-id") vaultId = argv[++i]
    else if (a === "--hours") hours = Number(argv[++i])
    else if (a === "--dws-bin") dwsBin = argv[++i]
    else if (a === "-h" || a === "--help") {
      printHelp()
      process.exit(0)
    } else {
      throw new Error(`未知参数: ${a}`)
    }
  }

  if (mode === null) {
    if (process.env["MYCONTEXT_SYNC_FIXTURE"] && process.env["MYCONTEXT_SYNC_FIXTURE"] !== "0") {
      mode = "fixture"
    } else if (process.env["MYCONTEXT_EXPORT_DIR"]) {
      mode = "export-dir"
    } else {
      throw new Error("请指定 --fixture / --from-dws / --export-dir")
    }
  }

  return {
    mode,
    ...(exportDir !== undefined ? { exportDir } : {}),
    ...(vaultId !== undefined ? { vaultId } : {}),
    ...(hours !== undefined && Number.isFinite(hours) ? { hours } : {}),
    ...(dwsBin !== undefined ? { dwsBin } : {}),
  }
}

function printHelp(): void {
  console.log(`用法: npx tsx scripts/sync/push-dws-export-entry.ts [选项]

选项:
  --fixture                 推送合成假数据（vault-fake-001）
  --from-dws                本机 dws 拉会话（+ 可选消息）再推送
  --export-dir DIR          打包已有 exports/dws 四件套
  --vault-id ID             目标 vault（与浏览器 /auth/me 的 vaultId 对齐）
  --hours N                 from-dws 回看小时（默认 24；0=只导会话）
  --dws-bin PATH            覆盖 dws 可执行文件

环境变量:
  MYCONTEXT_SYNC_URL        例 http://127.0.0.1:8787/api/v1/channel-sync
  MYCONTEXT_SYNC_TOKEN      与服务端一致
  MYCONTEXT_VAULT_ID / MYCONTEXT_EXPORT_DIR / MYCONTEXT_DWS_BIN
`)
}

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2))
  await runPushDwsExport({
    mode: parsed.mode,
    syncUrl: process.env["MYCONTEXT_SYNC_URL"] ?? "",
    syncToken: process.env["MYCONTEXT_SYNC_TOKEN"] ?? "",
    vaultId: parsed.vaultId ?? process.env["MYCONTEXT_VAULT_ID"],
    exportDir: parsed.exportDir ?? process.env["MYCONTEXT_EXPORT_DIR"],
    hours: parsed.hours ?? Number(process.env["MYCONTEXT_HOURS"] ?? 24),
    dwsBin: parsed.dwsBin ?? process.env["MYCONTEXT_DWS_BIN"],
  })
}

const isDirect =
  process.argv[1] !== undefined &&
  (process.argv[1].endsWith("push-dws-export-entry.ts") ||
    process.argv[1].includes("push-dws-export-entry"))

if (isDirect) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`错误: ${message}`)
    process.exit(1)
  })
}
