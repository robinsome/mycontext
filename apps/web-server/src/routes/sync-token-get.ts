/**
 * GET /api/v1/sync/token —— 回显当前 sync token（需 OAuth 或 Bearer）。
 *
 * 单租户运营台：登录用户下载客户端脚本需要明文 token。
 * env 锁定时仍回显（`envLocked: true`），但不允许 rotate。
 */
import type { IncomingMessage, ServerResponse } from "node:http"
import { SYNC_TOKEN_ERROR } from "@mycontext/sync-contract"
import {
  maskSyncTokenPrefix,
  type SyncTokenStore,
} from "../sync-token-store.js"
import { jsonResponse } from "../http-utils.js"

export function handleSyncTokenGet(
  request: IncomingMessage,
  response: ServerResponse,
  tokenStore: SyncTokenStore,
): void {
  if (request.method !== "GET") {
    jsonResponse(response, 405, { error: SYNC_TOKEN_ERROR.METHOD_NOT_ALLOWED })
    return
  }

  const token = tokenStore.get()
  jsonResponse(response, 200, {
    ok: true,
    token,
    prefix: maskSyncTokenPrefix(token),
    envLocked: tokenStore.isEnvLocked(),
  })
}
