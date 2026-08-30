/**
 * GET /api/v1/sync/token —— 回显当前 sync token（需 OAuth 或 Bearer）。
 *
 * env 锁定时不回显明文（部署侧持有）；file-backed 供浏览器登录后自动写入 sessionStorage。
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

  if (tokenStore.isEnvLocked()) {
    jsonResponse(response, 409, {
      error: SYNC_TOKEN_ERROR.ENV_LOCKED,
      message: "MYCONTEXT_SYNC_TOKEN 由部署环境锁定；请在部署配置中读取，浏览器不能回显。",
      envLocked: true,
    })
    return
  }

  const token = tokenStore.get()
  jsonResponse(response, 200, {
    ok: true,
    token,
    prefix: maskSyncTokenPrefix(token),
    envLocked: false,
  })
}
