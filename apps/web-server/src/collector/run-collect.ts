/**
 * 按对照表跑采集：deferred/unsupported 记入进度；mapped 调用户 token HTTP；
 * sidecar 经 dws-sidecar 分页拉会话列表。
 * 落盘四件套最小 chat 源（可被 graph/build 识别）+ collect-progress.json。
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import {
  OPENAPI_CAPABILITY_MATRIX,
  dwsCommandKey,
  type OpenApiCapabilityRow,
} from "@mycontext/channels"
import { exportRootForVault } from "../routes/channel-sync.js"
import { defaultCallMapped, type CallMappedFn } from "./openapi-client.js"
import { writeConversationsToChatExport } from "./sidecar-export.js"
import type { SidecarRunner } from "./sidecar-runner.js"

export interface CollectCapabilityOutcome {
  command: string
  status: "mapped" | "deferred" | "unsupported" | "ok" | "unreadable" | "error"
  detail?: string
}

export interface CollectRunInput {
  dataDir: string
  vaultId: string
  accessToken: string
  /** 可选过滤 dws 命令键 */
  commandKeys?: string[]
  /** 测试注入；默认 defaultCallMapped */
  callMapped?: CallMappedFn
  /** sidecar 执行器；collect 路由可从 MYCONTEXT_DWS_SIDECAR_IMAGE 构造 */
  sidecarRunner?: SidecarRunner
  /** 该 vault 的 DWS_CONFIG_DIR；默认 dataDir/vaults/{vaultId}/dws-home */
  sidecarConfigRoot?: string
}

export interface CollectRunResult {
  exportRoot: string
  results: CollectCapabilityOutcome[]
}

/** 实测 dws list-all-conversations：`--limit` 1–100，`--cursor` 为 int。 */
const SIDECAR_PAGE_LIMIT = 100
const SIDECAR_MAX_PAGES = 100

function sidecarConfigDir(input: CollectRunInput): string {
  return input.sidecarConfigRoot ?? join(input.dataDir, "vaults", input.vaultId, "dws-home")
}

function readNextCursor(json: unknown): number | null {
  if (json === null || typeof json !== "object") return null
  const result = (json as { result?: unknown }).result
  if (result === null || typeof result !== "object") return null
  const nextCursor = (result as { nextCursor?: unknown }).nextCursor
  return typeof nextCursor === "number" ? nextCursor : null
}

async function runSidecarCollect(
  input: CollectRunInput,
  exportRoot: string,
  key: string,
): Promise<CollectCapabilityOutcome> {
  const runner = input.sidecarRunner
  if (runner === undefined) {
    return {
      command: key,
      status: "error",
      detail: "sidecar runner 未配置（需 MYCONTEXT_DWS_SIDECAR_IMAGE 或测试注入）",
    }
  }

  const configDir = sidecarConfigDir(input)
  let cursor: number | undefined
  let totalWritten = 0

  for (let page = 0; page < SIDECAR_MAX_PAGES; page += 1) {
    const dwsArgs = [
      "chat",
      "list-all-conversations",
      "--limit",
      String(SIDECAR_PAGE_LIMIT),
      "-f",
      "json",
    ]
    if (cursor !== undefined) {
      dwsArgs.push("--cursor", String(cursor))
    }

    const runResult = await runner({
      vaultId: input.vaultId,
      accessToken: input.accessToken,
      dwsArgs,
      configDir,
    })

    if (runResult.exitCode !== 0 || runResult.json === null) {
      return {
        command: key,
        status: "error",
        detail: runResult.detail || `sidecar exit ${runResult.exitCode}`,
      }
    }

    let exportResult: { written: number; hasMore: boolean }
    try {
      exportResult = writeConversationsToChatExport(exportRoot, runResult.json)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { command: key, status: "error", detail: message }
    }

    totalWritten += exportResult.written

    if (exportResult.hasMore !== true) {
      return {
        command: key,
        status: "ok",
        detail: `sidecar scopes=${totalWritten}`,
      }
    }

    const nextCursor = readNextCursor(runResult.json)
    if (nextCursor === null) {
      return {
        command: key,
        status: "error",
        detail: "hasMore=true 但缺少 result.nextCursor",
      }
    }
    cursor = nextCursor
  }

  return {
    command: key,
    status: "error",
    detail: `sidecar 分页超过安全上限 ${SIDECAR_MAX_PAGES} 页`,
  }
}

/** 确保 chat 四件套存在；不覆盖 sidecar 已写入的 scopes.jsonl。 */
function ensureMinimalChatExport(exportRoot: string, note: string): void {
  const chatDir = join(exportRoot, "chat")
  mkdirSync(chatDir, { recursive: true })
  for (const name of ["scopes.jsonl", "records.jsonl", "resources.jsonl"] as const) {
    const path = join(chatDir, name)
    if (!existsSync(path)) {
      writeFileSync(path, "", "utf8")
    }
  }
  const manifestPath = join(chatDir, "manifest.json")
  if (!existsSync(manifestPath)) {
    writeFileSync(
      manifestPath,
      `${JSON.stringify({
        schema: "mycontext.openapi-collect.v1",
        note,
        exportedAt: Date.now(),
      })}\n`,
      "utf8",
    )
  }
}

export async function runCapabilityCollect(input: CollectRunInput): Promise<CollectRunResult> {
  const exportRoot = exportRootForVault(input.dataDir, input.vaultId)
  mkdirSync(exportRoot, { recursive: true })

  const filter = input.commandKeys !== undefined ? new Set(input.commandKeys) : null
  const results: CollectCapabilityOutcome[] = []
  const callMapped = input.callMapped ?? defaultCallMapped

  for (const row of OPENAPI_CAPABILITY_MATRIX) {
    const key = dwsCommandKey(row.dwsCommand)
    if (filter !== null && !filter.has(key)) continue

    if (row.status === "unsupported") {
      results.push({
        command: key,
        status: "unsupported",
        detail: row.notes,
      })
      continue
    }

    if (row.status === "sidecar") {
      results.push(await runSidecarCollect(input, exportRoot, key))
      continue
    }

    if (row.status === "deferred" || row.openApi === null) {
      results.push({
        command: key,
        status: "deferred",
        detail: row.notes || "开放平台 path 待实测；不记采集成功",
      })
      continue
    }

    // mapped
    try {
      const outcome = await callMapped(row, {
        accessToken: input.accessToken,
        exportRoot,
      })
      results.push({ ...outcome, command: key })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      results.push({ command: key, status: "error", detail: message })
    }
  }

  writeFileSync(join(exportRoot, "collect-progress.json"), `${JSON.stringify({ results }, null, 2)}\n`, {
    mode: 0o600,
  })

  const okCount = results.filter((r) => r.status === "ok").length
  ensureMinimalChatExport(
    exportRoot,
    okCount > 0 ? `collect ok=${okCount}` : "collect progress only (deferred/unsupported)",
  )

  return { exportRoot, results }
}

export type { OpenApiCapabilityRow }
