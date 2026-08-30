/**
 * POST /api/v1/channel-sync —— 接收本机推送的四件套导出。
 *
 * 只做校验 + 落盘，不触发建图（Task 3）。路径与 VaultStore 对齐：
 * `{dataDir}/vaults/{vaultId}/exports/dws/<source>/…`
 */
import { mkdirSync, writeFileSync } from "node:fs"
import { isAbsolute, join, relative, resolve, sep } from "node:path"
import type { IncomingMessage, ServerResponse } from "node:http"
import {
  CHANNEL_SYNC_ERROR,
  channelSyncFourPieceFileSchema,
  channelSyncRequestSchema,
  parseChannelSyncFileKey,
  type ChannelSyncRequest,
} from "@mycontext/sync-contract"
import { jsonResponse, readJsonBody } from "../http-utils.js"

export interface ChannelSyncRouteOptions {
  dataDir: string
}

/**
 * 与 desktop AppPaths 一致：vault 在 dataDir/vaults 下。
 *
 * ★ resolve + relative 二次断言：即便 vaultId 校验被绕过，落点也不能逃出 vaults/。
 */
export function exportRootForVault(dataDir: string, vaultId: string): string {
  const vaultsRoot = resolve(dataDir, "vaults")
  const exportRoot = resolve(vaultsRoot, vaultId, "exports", "dws")
  const rel = relative(vaultsRoot, exportRoot)
  if (rel === "" || rel.startsWith(`..${sep}`) || rel === ".." || isAbsolute(rel)) {
    throw new Error("vaultId 路径逃逸")
  }
  return exportRoot
}

/**
 * 物化四件套。
 *
 * ★ manifest.json **最后**写 —— 与 export-materializer 相同语义：
 * 「manifest 存在 ⇔ bundle 完整」，中途失败不留半份 manifest。
 */
export function materializeChannelSyncExport(dataDir: string, payload: ChannelSyncRequest): string {
  const exportRoot = exportRootForVault(dataDir, payload.manifest.vaultId)
  const entries: Array<{ relPath: string; content: Buffer }> = []

  for (const [key, text] of Object.entries(payload.files)) {
    const parsed = parseChannelSyncFileKey(key)
    if (parsed === null) continue
    entries.push({
      relPath: join(parsed.source, parsed.file),
      content: Buffer.from(text, "utf8"),
    })
  }
  if (payload.filesBase64 !== undefined) {
    for (const [key, encoded] of Object.entries(payload.filesBase64)) {
      const parsed = parseChannelSyncFileKey(key)
      if (parsed === null) continue
      entries.push({
        relPath: join(parsed.source, parsed.file),
        content: Buffer.from(encoded, "base64"),
      })
    }
  }

  const nonManifest = entries.filter((e) => !e.relPath.endsWith("manifest.json"))
  const manifestEntries = entries.filter((e) => e.relPath.endsWith("manifest.json"))

  for (const entry of nonManifest) {
    const abs = join(exportRoot, entry.relPath)
    mkdirSync(join(abs, ".."), { recursive: true })
    writeFileSync(abs, entry.content)
  }
  for (const entry of manifestEntries) {
    const abs = join(exportRoot, entry.relPath)
    mkdirSync(join(abs, ".."), { recursive: true })
    writeFileSync(abs, entry.content)
  }

  return exportRoot
}

export async function handleChannelSyncPost(
  request: IncomingMessage,
  response: ServerResponse,
  options: ChannelSyncRouteOptions,
): Promise<void> {
  if (request.method !== "POST") {
    jsonResponse(response, 405, { error: CHANNEL_SYNC_ERROR.METHOD_NOT_ALLOWED })
    return
  }

  let raw: unknown
  try {
    raw = await readJsonBody(request)
  } catch (error) {
    const message = error instanceof Error ? error.message : ""
    if (message.includes("JSON") || message.includes("json")) {
      jsonResponse(response, 400, { error: CHANNEL_SYNC_ERROR.INVALID_JSON })
      return
    }
    jsonResponse(response, 400, { error: CHANNEL_SYNC_ERROR.INVALID_BODY })
    return
  }

  const parsed = channelSyncRequestSchema.safeParse(raw)
  if (!parsed.success) {
    jsonResponse(response, 400, {
      error: CHANNEL_SYNC_ERROR.INVALID_BODY,
      details: parsed.error.flatten(),
    })
    return
  }

  let exportRoot: string
  try {
    exportRoot = materializeChannelSyncExport(options.dataDir, parsed.data)
  } catch (error) {
    const message = error instanceof Error ? error.message : ""
    if (message.includes("路径逃逸")) {
      jsonResponse(response, 400, { error: CHANNEL_SYNC_ERROR.INVALID_BODY })
      return
    }
    throw error
  }
  jsonResponse(response, 200, {
    ok: true,
    exportRoot,
    sources: parsed.data.manifest.sources,
    files: channelSyncFourPieceFileSchema.options.length * parsed.data.manifest.sources.length,
  })
}
