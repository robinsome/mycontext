/**
 * 企业应用 OAuth / 采集 API 契约（假值 fixture，无真实 token）。
 */
import { z } from "zod"
import { vaultIdSchema } from "./channel-sync.js"

export const AUTH_ERROR = {
  UNAUTHORIZED: "unauthorized",
  INVALID_STATE: "invalid_state",
  TOKEN_EXCHANGE_FAILED: "token_exchange_failed",
  NOT_CONFIGURED: "not_configured",
  METHOD_NOT_ALLOWED: "method_not_allowed",
} as const

export type AuthErrorCode = (typeof AUTH_ERROR)[keyof typeof AUTH_ERROR]

export const COLLECT_ERROR = {
  UNAUTHORIZED: "unauthorized",
  INVALID_BODY: "invalid_body",
  METHOD_NOT_ALLOWED: "method_not_allowed",
  FAILED: "collect_failed",
} as const

export type CollectErrorCode = (typeof COLLECT_ERROR)[keyof typeof COLLECT_ERROR]

export const authMeResponseSchema = z.object({
  vaultId: vaultIdSchema,
  openId: z.string().min(1),
  corpId: z.string().min(1),
})

export type AuthMeResponse = z.infer<typeof authMeResponseSchema>

export const collectRunRequestSchema = z.object({
  /** 可选：只跑这些 dws 命令键；默认跑矩阵中 status≠unsupported 的条目 */
  commands: z.array(z.string().min(1)).optional(),
})

export type CollectRunRequest = z.infer<typeof collectRunRequestSchema>

export const collectCapabilityResultSchema = z.object({
  command: z.string(),
  status: z.enum(["mapped", "deferred", "unsupported", "ok", "unreadable", "error"]),
  detail: z.string().optional(),
})

export const collectRunResponseSchema = z.object({
  ok: z.literal(true),
  vaultId: vaultIdSchema,
  exportRoot: z.string().min(1),
  results: z.array(collectCapabilityResultSchema),
})

export type CollectRunResponse = z.infer<typeof collectRunResponseSchema>
