/**
 * 按对照表跑采集：deferred/unsupported 记入进度；mapped 调用户 token HTTP。
 * 落盘四件套最小 chat 源（可被 graph/build 识别）+ collect-progress.json。
 */
import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import {
  OPENAPI_CAPABILITY_MATRIX,
  dwsCommandKey,
  type OpenApiCapabilityRow,
} from "@mycontext/channels"
import { exportRootForVault } from "../routes/channel-sync.js"
import { defaultCallMapped, type CallMappedFn } from "./openapi-client.js"

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
}

export interface CollectRunResult {
  exportRoot: string
  results: CollectCapabilityOutcome[]
}

function writeMinimalChatExport(exportRoot: string, note: string): void {
  const chatDir = join(exportRoot, "chat")
  mkdirSync(chatDir, { recursive: true })
  writeFileSync(join(chatDir, "scopes.jsonl"), "", "utf8")
  writeFileSync(join(chatDir, "records.jsonl"), "", "utf8")
  writeFileSync(join(chatDir, "resources.jsonl"), "", "utf8")
  writeFileSync(
    join(chatDir, "manifest.json"),
    `${JSON.stringify({
      schema: "mycontext.openapi-collect.v1",
      note,
      exportedAt: Date.now(),
    })}\n`,
    "utf8",
  )
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

    if (row.status === "deferred" || row.status === "sidecar" || row.openApi === null) {
      // sidecar：Task 4 接入 dws-sidecar；此处暂记 deferred 等价，避免静默成功
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
  writeMinimalChatExport(
    exportRoot,
    okCount > 0 ? `collect ok=${okCount}` : "collect progress only (deferred/unsupported)",
  )

  return { exportRoot, results }
}

export type { OpenApiCapabilityRow }
