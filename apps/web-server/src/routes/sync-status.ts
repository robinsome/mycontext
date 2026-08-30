/**
 * GET /api/v1/sync/status?vaultId= —— 检查 exports/dws 是否已有可 ingest 的导出。
 */
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import type { IncomingMessage, ServerResponse } from "node:http"
import {
  channelSyncSourceNameSchema,
  SYNC_STATUS_ERROR,
  syncStatusQuerySchema,
  type SyncStatusResponse,
  type SyncStatusSource,
} from "@mycontext/sync-contract"
import { exportRootForVault } from "./channel-sync.js"
import { jsonResponse } from "../http-utils.js"

export interface SyncStatusRouteOptions {
  dataDir: string
}

function readManifestExportedAt(exportRoot: string, source: string): number | undefined {
  const manifestPath = join(exportRoot, source, "manifest.json")
  if (!existsSync(manifestPath)) return undefined
  try {
    const raw = JSON.parse(readFileSync(manifestPath, "utf8")) as { exported_at?: unknown }
    if (typeof raw.exported_at === "number" && Number.isInteger(raw.exported_at) && raw.exported_at >= 0) {
      return raw.exported_at
    }
  } catch {
    // 损坏 manifest 不影响 hasRecordsJsonl 判定
  }
  return undefined
}

export function buildSyncStatus(dataDir: string, vaultId: string): SyncStatusResponse {
  const exportRoot = exportRootForVault(dataDir, vaultId)
  const sources: Record<string, SyncStatusSource> = {}
  let hasExport = false

  for (const source of channelSyncSourceNameSchema.options) {
    const recordsPath = join(exportRoot, source, "records.jsonl")
    if (!existsSync(recordsPath)) continue
    hasExport = true
    sources[source] = {
      hasRecordsJsonl: true,
      exportedAt: readManifestExportedAt(exportRoot, source),
    }
  }

  return { ok: true, vaultId, hasExport, sources }
}

export function handleSyncStatusGet(
  request: IncomingMessage,
  response: ServerResponse,
  options: SyncStatusRouteOptions,
): void {
  if (request.method !== "GET") {
    jsonResponse(response, 405, { error: SYNC_STATUS_ERROR.METHOD_NOT_ALLOWED })
    return
  }

  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`)
  const parsed = syncStatusQuerySchema.safeParse({ vaultId: url.searchParams.get("vaultId") ?? "" })
  if (!parsed.success) {
    jsonResponse(response, 400, {
      error: SYNC_STATUS_ERROR.INVALID_QUERY,
      details: parsed.error.flatten(),
    })
    return
  }

  let body: SyncStatusResponse
  try {
    body = buildSyncStatus(options.dataDir, parsed.data.vaultId)
  } catch (error) {
    const message = error instanceof Error ? error.message : ""
    if (message.includes("路径逃逸")) {
      jsonResponse(response, 400, { error: SYNC_STATUS_ERROR.INVALID_QUERY })
      return
    }
    throw error
  }

  jsonResponse(response, 200, body)
}
