/**
 * POST /api/v1/graph/build —— 对已落盘的 exports/dws 触发 kl ingest。
 */
import { existsSync } from "node:fs"
import { join } from "node:path"
import { z } from "zod"
import { vaultIdSchema } from "./channel-sync.js"

export const graphBuildRequestSchema = z.object({
  vaultId: vaultIdSchema,
  /** 与 kl checkpoint 对齐；缺省 dingtalk（与 channel-sync manifest.channelId 常见值一致）。 */
  sourceId: z.string().min(1).optional(),
})

export type GraphBuildRequest = z.infer<typeof graphBuildRequestSchema>

export const GRAPH_BUILD_ERROR = {
  UNAUTHORIZED: "unauthorized",
  INVALID_JSON: "invalid_json",
  INVALID_BODY: "invalid_body",
  NO_EXPORT: "no_export",
  BUILD_FAILED: "build_failed",
  METHOD_NOT_ALLOWED: "method_not_allowed",
  NOT_FOUND: "not_found",
  INTERNAL: "internal",
} as const

export type GraphBuildErrorCode = (typeof GRAPH_BUILD_ERROR)[keyof typeof GRAPH_BUILD_ERROR]

/** 至少有一个 source 的 records.jsonl（chat 或 minutes）。 */
export function hasIngestibleExport(exportDir: string): boolean {
  return (
    existsSync(join(exportDir, "chat", "records.jsonl")) ||
    existsSync(join(exportDir, "minutes", "records.jsonl"))
  )
}
