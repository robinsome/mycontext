/**
 * Sync token 管理接口鉴权：Bearer **或** 有效钉钉 OAuth session。
 *
 * channel-sync / graph/build 仍只用 Bearer；本助手只给 GET/rotate token。
 */
import type { IncomingMessage } from "node:http"
import { timingSafeEqual } from "node:crypto"
import { parseSessionCookie, type SessionStore } from "../oauth/session-store.js"
import type { SyncTokenStore } from "../sync-token-store.js"

export function hasSyncTokenAdminAccess(
  request: IncomingMessage,
  tokenStore: SyncTokenStore,
  sessions: SessionStore,
): boolean {
  if (bearerMatches(request, tokenStore.get())) return true
  const sessionId = parseSessionCookie(request.headers.cookie)
  if (sessionId === null) return false
  return sessions.get(sessionId) !== null
}

function bearerMatches(request: IncomingMessage, expected: string): boolean {
  const header = request.headers.authorization ?? ""
  const provided = header.startsWith("Bearer ") ? header.slice(7) : ""
  if (provided.length === 0 || provided.length !== expected.length) return false
  try {
    return timingSafeEqual(Buffer.from(provided), Buffer.from(expected))
  } catch {
    return false
  }
}
