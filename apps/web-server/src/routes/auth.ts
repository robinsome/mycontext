import type { IncomingMessage, ServerResponse } from "node:http"
import { AUTH_ERROR } from "@mycontext/sync-contract"
import { jsonResponse } from "../http-utils.js"
import {
  buildAuthorizeUrl,
  newOAuthState,
  vaultIdFromOpenId,
  type DingTalkOAuthConfig,
  type ExchangeUserToken,
} from "../oauth/dingtalk-oauth.js"
import {
  clearSessionCookie,
  parseSessionCookie,
  setSessionCookie,
  type SessionStore,
} from "../oauth/session-store.js"

const pendingStates = new Map<string, number>()

export interface AuthRouteDeps {
  oauthConfig: DingTalkOAuthConfig | null
  sessions: SessionStore
  exchangeUserToken: ExchangeUserToken
  secureCookie?: boolean
}

export function handleAuthLoginGet(
  _request: IncomingMessage,
  response: ServerResponse,
  deps: AuthRouteDeps,
): void {
  if (deps.oauthConfig === null) {
    jsonResponse(response, 503, { error: AUTH_ERROR.NOT_CONFIGURED })
    return
  }
  const state = newOAuthState()
  pendingStates.set(state, Date.now())
  const location = buildAuthorizeUrl(deps.oauthConfig, state)
  response.writeHead(302, { Location: location })
  response.end()
}

export async function handleAuthCallbackGet(
  request: IncomingMessage,
  response: ServerResponse,
  deps: AuthRouteDeps,
): Promise<void> {
  if (deps.oauthConfig === null) {
    jsonResponse(response, 503, { error: AUTH_ERROR.NOT_CONFIGURED })
    return
  }
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`)
  const code = url.searchParams.get("authCode") ?? url.searchParams.get("code")
  const state = url.searchParams.get("state")
  if (code === null || code === "" || state === null || state === "" || !pendingStates.has(state)) {
    jsonResponse(response, 400, { error: AUTH_ERROR.INVALID_STATE })
    return
  }
  pendingStates.delete(state)

  let tokens
  try {
    tokens = await deps.exchangeUserToken({ code, config: deps.oauthConfig })
  } catch (err) {
    // 不打印 code/secret；只记失败类型便于排障
    const reason = err instanceof Error ? err.message : "unknown"
    console.error("OAuth token exchange failed:", reason)
    jsonResponse(response, 502, { error: AUTH_ERROR.TOKEN_EXCHANGE_FAILED })
    return
  }

  const vaultId = vaultIdFromOpenId(tokens.openId)
  const session = deps.sessions.create({
    vaultId,
    openId: tokens.openId,
    corpId: deps.oauthConfig.corpId,
    tokens,
  })
  const secure = deps.secureCookie === true
  response.writeHead(302, {
    Location: "/",
    "Set-Cookie": setSessionCookie(session.sessionId, secure),
  })
  response.end()
}

export function handleAuthMeGet(
  request: IncomingMessage,
  response: ServerResponse,
  deps: AuthRouteDeps,
): void {
  const sessionId = parseSessionCookie(request.headers.cookie)
  if (sessionId === null) {
    jsonResponse(response, 401, { error: AUTH_ERROR.UNAUTHORIZED })
    return
  }
  const session = deps.sessions.get(sessionId)
  if (session === null) {
    jsonResponse(response, 401, { error: AUTH_ERROR.UNAUTHORIZED })
    return
  }
  jsonResponse(response, 200, {
    vaultId: session.vaultId,
    openId: session.openId,
    corpId: session.corpId,
  })
}

export function handleAuthLogoutPost(
  request: IncomingMessage,
  response: ServerResponse,
  deps: AuthRouteDeps,
): void {
  const sessionId = parseSessionCookie(request.headers.cookie)
  if (sessionId !== null) deps.sessions.destroy(sessionId)
  response.writeHead(200, {
    "Content-Type": "application/json; charset=utf-8",
    "Set-Cookie": clearSessionCookie(deps.secureCookie === true),
  })
  response.end(JSON.stringify({ ok: true }))
}

/** 测试辅助：清空 pending state */
export function clearPendingOAuthStates(): void {
  pendingStates.clear()
}
