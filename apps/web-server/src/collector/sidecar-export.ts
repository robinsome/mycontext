/**
 * 将 sidecar `list-all-conversations` JSON 写入 chat 四件套（scopes 为主）。
 *
 * **追加语义**：Task 4 分页循环会多次调用；每次只 append 新 scope 行，
 * 不覆盖已有 scopes.jsonl。同一 `id` 已存在则跳过（written 不计入）。
 * records/resources 保持空文件；manifest.json 更新 `note` 与 scope 计数。
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const WORKSPACE_ID = "workspace:ali-ding"

/** 与 export-materializer / push-dws-export 同形，避免拉 channels 循环依赖。 */
function scopeIdFor(conversationExternalId: string): string {
  const safe = conversationExternalId.replaceAll(/[/\\:*?"<>|\r\n]/g, "_").replace(/^\.+$/, "_")
  return `chat:${safe === "" ? "unknown" : safe}`
}

interface RawConversation {
  openConversationId?: unknown
  id?: unknown
  title?: unknown
  memberCount?: unknown
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined
}

function externalIdFrom(raw: RawConversation): string | null {
  return asString(raw.openConversationId) ?? asString(raw.id) ?? null
}

function parsePayload(payload: unknown): { conversations: RawConversation[]; hasMore: boolean } {
  if (payload === null || typeof payload !== "object") {
    throw new Error("sidecar payload must be an object")
  }
  const root = payload as { result?: unknown }
  if (root.result === null || typeof root.result !== "object") {
    throw new Error("sidecar payload missing result")
  }
  const result = root.result as { conversations?: unknown; hasMore?: unknown }
  if (!Array.isArray(result.conversations)) {
    throw new Error("sidecar payload missing result.conversations array")
  }
  const hasMore = result.hasMore === true
  return { conversations: result.conversations as RawConversation[], hasMore }
}

function readExistingScopeIds(scopesPath: string): Set<string> {
  if (!existsSync(scopesPath)) return new Set()
  const text = readFileSync(scopesPath, "utf8")
  const ids = new Set<string>()
  for (const line of text.split("\n")) {
    const trimmed = line.trim()
    if (trimmed === "") continue
    try {
      const row = JSON.parse(trimmed) as { id?: unknown }
      if (typeof row.id === "string") ids.add(row.id)
    } catch {
      // 已有损坏行不阻断追加
    }
  }
  return ids
}

function countScopeLines(scopesPath: string): number {
  if (!existsSync(scopesPath)) return 0
  return readFileSync(scopesPath, "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "").length
}

function ensureEmptyJsonl(chatDir: string, name: string): void {
  const path = join(chatDir, name)
  if (!existsSync(path)) {
    writeFileSync(path, "", "utf8")
  }
}

function updateManifest(chatDir: string, scopeCount: number): void {
  const manifestPath = join(chatDir, "manifest.json")
  let manifest: Record<string, unknown> = {}
  if (existsSync(manifestPath)) {
    try {
      manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, unknown>
    } catch {
      manifest = {}
    }
  }
  manifest.note = `sidecar list-all-conversations scopes=${scopeCount}`
  if (manifest.schema === undefined) {
    manifest.schema = "mycontext.openapi-collect.v1"
  }
  if (manifest.exportedAt === undefined) {
    manifest.exportedAt = Date.now()
  }
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8")
}

function conversationToScopeLine(raw: RawConversation): { id: string; line: string } | null {
  const externalId = externalIdFrom(raw)
  if (externalId === null) return null
  const scopeId = scopeIdFor(externalId)
  const title = typeof raw.title === "string" ? raw.title : ""
  const data: Record<string, unknown> = {
    title,
    openConversationId: externalId,
  }
  if (typeof raw.memberCount === "number") {
    data.memberCount = raw.memberCount
  }
  const scope = {
    id: scopeId,
    type: "chat",
    parent_id: WORKSPACE_ID,
    data,
  }
  return { id: scopeId, line: JSON.stringify(scope) }
}

/**
 * 将会话列表写入 `exportRoot/chat/scopes.jsonl`（追加、去重）。
 * records/resources 若不存在则创建空文件；manifest.json 更新 note。
 */
export function writeConversationsToChatExport(
  exportRoot: string,
  payload: unknown,
): { written: number; hasMore: boolean } {
  const { conversations, hasMore } = parsePayload(payload)
  const chatDir = join(exportRoot, "chat")
  const scopesPath = join(chatDir, "scopes.jsonl")
  mkdirSync(chatDir, { recursive: true })

  const existingIds = readExistingScopeIds(scopesPath)
  const newLines: string[] = []
  let written = 0

  for (const raw of conversations) {
    const mapped = conversationToScopeLine(raw)
    if (mapped === null) continue
    if (existingIds.has(mapped.id)) continue
    existingIds.add(mapped.id)
    newLines.push(mapped.line)
    written += 1
  }

  if (newLines.length > 0) {
    const prefix =
      existsSync(scopesPath) && readFileSync(scopesPath, "utf8").length > 0 ? "\n" : ""
    appendFileSync(scopesPath, `${prefix}${newLines.join("\n")}\n`, "utf8")
  } else if (!existsSync(scopesPath)) {
    writeFileSync(scopesPath, "", "utf8")
  }

  ensureEmptyJsonl(chatDir, "records.jsonl")
  ensureEmptyJsonl(chatDir, "resources.jsonl")
  updateManifest(chatDir, countScopeLines(scopesPath))

  return { written, hasMore }
}
