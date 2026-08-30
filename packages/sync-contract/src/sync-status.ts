/**
 * GET /api/v1/sync/status —— 查询 vault 导出落盘状态（浏览器 UI / 脚本排错）。
 */
import { z } from "zod"
import { vaultIdSchema } from "./channel-sync.js"

export const syncStatusQuerySchema = z.object({
  vaultId: vaultIdSchema,
})

export type SyncStatusQuery = z.infer<typeof syncStatusQuerySchema>

export const syncStatusSourceSchema = z.object({
  hasRecordsJsonl: z.boolean(),
  /** manifest.json 里的 exported_at（毫秒），读不到则为 undefined。 */
  exportedAt: z.number().int().nonnegative().optional(),
})

export type SyncStatusSource = z.infer<typeof syncStatusSourceSchema>

export const syncStatusResponseSchema = z.object({
  ok: z.literal(true),
  vaultId: vaultIdSchema,
  /** 至少一个 source 存在 records.jsonl（与 hasIngestibleExport 一致）。 */
  hasExport: z.boolean(),
  sources: z.record(syncStatusSourceSchema),
})

export type SyncStatusResponse = z.infer<typeof syncStatusResponseSchema>

export const SYNC_STATUS_ERROR = {
  UNAUTHORIZED: "unauthorized",
  INVALID_QUERY: "invalid_query",
  METHOD_NOT_ALLOWED: "method_not_allowed",
  NOT_FOUND: "not_found",
  INTERNAL: "internal",
} as const

export type SyncStatusErrorCode = (typeof SYNC_STATUS_ERROR)[keyof typeof SYNC_STATUS_ERROR]

export const syncTokenRotateResponseSchema = z.object({
  ok: z.literal(true),
  /** 完整 token，仅本次响应返回一次。 */
  token: z.string().min(1),
  /** 掩码前缀，供 UI 展示「当前 token 已轮换」。 */
  prefix: z.string().min(1),
})

export type SyncTokenRotateResponse = z.infer<typeof syncTokenRotateResponseSchema>

/** GET /api/v1/sync/token —— 钉钉 OAuth 或 Bearer 后回显当前 file-backed token。 */
export const syncTokenGetResponseSchema = z.object({
  ok: z.literal(true),
  token: z.string().min(1),
  prefix: z.string().min(1),
  envLocked: z.literal(false),
})

export type SyncTokenGetResponse = z.infer<typeof syncTokenGetResponseSchema>

export const SYNC_TOKEN_ERROR = {
  UNAUTHORIZED: "unauthorized",
  ENV_LOCKED: "env_locked",
  METHOD_NOT_ALLOWED: "method_not_allowed",
  NOT_FOUND: "not_found",
  INTERNAL: "internal",
} as const

export type SyncTokenErrorCode = (typeof SYNC_TOKEN_ERROR)[keyof typeof SYNC_TOKEN_ERROR]
