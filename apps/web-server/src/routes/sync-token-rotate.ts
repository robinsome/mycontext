/**
 * POST /api/v1/sync/token/rotate —— 文件-backed token 轮换；env 锁定则拒绝。
 */
import type { IncomingMessage, ServerResponse } from "node:http"
import { SYNC_TOKEN_ERROR } from "@mycontext/sync-contract"
import type { SyncTokenStore } from "../sync-token-store.js"
import { jsonResponse } from "../http-utils.js"

export function handleSyncTokenRotatePost(
  request: IncomingMessage,
  response: ServerResponse,
  tokenStore: SyncTokenStore,
): void {
  if (request.method !== "POST") {
    jsonResponse(response, 405, { error: SYNC_TOKEN_ERROR.METHOD_NOT_ALLOWED })
    return
  }

  if (tokenStore.isEnvLocked()) {
    jsonResponse(response, 409, {
      error: SYNC_TOKEN_ERROR.ENV_LOCKED,
      message: "MYCONTEXT_SYNC_TOKEN 在进程启动时已设置，轮换仅对文件-backed token 可用",
    })
    return
  }

  const rotated = tokenStore.rotate()
  if (rotated === null) {
    jsonResponse(response, 409, { error: SYNC_TOKEN_ERROR.ENV_LOCKED })
    return
  }

  jsonResponse(response, 200, {
    ok: true,
    token: rotated.token,
    prefix: rotated.prefix,
  })
}
