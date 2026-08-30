/**
 * 钉钉企业内部应用：浏览器 OAuth（用户 token）。
 *
 * 不得用应用级 accessToken 读个人聊天；本模块只换用户 userAccessToken。
 */
import { createHash, randomBytes } from "node:crypto"
import { isSafePathSegment } from "@mycontext/sync-contract"

export interface DingTalkOAuthConfig {
  clientId: string
  clientSecret: string
  corpId: string
  redirectUri: string
}

export interface UserTokenBundle {
  accessToken: string
  refreshToken: string
  openId: string
  unionId?: string
  expireIn: number
}

export type ExchangeUserToken = (input: {
  code: string
  config: DingTalkOAuthConfig
}) => Promise<UserTokenBundle>

export function vaultIdFromOpenId(openId: string): string {
  const digest = createHash("sha256").update(openId, "utf8").digest("hex").slice(0, 20)
  const id = `u${digest}`
  if (!isSafePathSegment(id)) throw new Error("vaultId 生成失败")
  return id
}

export function buildAuthorizeUrl(config: DingTalkOAuthConfig, state: string): string {
  const url = new URL("https://login.dingtalk.com/oauth2/auth")
  url.searchParams.set("client_id", config.clientId)
  url.searchParams.set("redirect_uri", config.redirectUri)
  url.searchParams.set("response_type", "code")
  url.searchParams.set("scope", "openid corpid")
  url.searchParams.set("prompt", "consent")
  url.searchParams.set("state", state)
  return url.toString()
}

export function newOAuthState(): string {
  return randomBytes(16).toString("hex")
}

/** 生产默认：调开放平台换用户 token。测试注入 mock。 */
export const defaultExchangeUserToken: ExchangeUserToken = async ({ code, config }) => {
  const response = await fetch("https://api.dingtalk.com/v1.0/oauth2/userAccessToken", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      code,
      grantType: "authorization_code",
    }),
  })
  if (!response.ok) {
    throw new Error(`token exchange HTTP ${response.status}`)
  }
  const body = (await response.json()) as Record<string, unknown>
  const accessToken = typeof body["accessToken"] === "string" ? body["accessToken"] : ""
  const refreshToken = typeof body["refreshToken"] === "string" ? body["refreshToken"] : ""
  const openId = typeof body["openId"] === "string" ? body["openId"] : ""
  const expireIn = typeof body["expireIn"] === "number" ? body["expireIn"] : 7200
  if (accessToken === "" || openId === "") {
    throw new Error("token exchange 响应缺少 accessToken/openId")
  }
  return {
    accessToken,
    refreshToken,
    openId,
    expireIn,
    ...(typeof body["unionId"] === "string" ? { unionId: body["unionId"] } : {}),
  }
}

export function resolveOAuthConfig(env: NodeJS.ProcessEnv): DingTalkOAuthConfig | null {
  const clientId = env["DINGTALK_CLIENT_ID"]
  const clientSecret = env["DINGTALK_CLIENT_SECRET"]
  const corpId = env["DINGTALK_CORP_ID"]
  const redirectUri = env["OAUTH_REDIRECT_URI"]
  if (
    clientId === undefined ||
    clientId === "" ||
    clientSecret === undefined ||
    clientSecret === "" ||
    corpId === undefined ||
    corpId === "" ||
    redirectUri === undefined ||
    redirectUri === ""
  ) {
    return null
  }
  return { clientId, clientSecret, corpId, redirectUri }
}
