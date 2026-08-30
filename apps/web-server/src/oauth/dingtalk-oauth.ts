/**
 * 钉钉企业内部应用：浏览器 OAuth（用户 token）。
 *
 * 不得用应用级 accessToken 读个人聊天；本模块只换用户 userAccessToken。
 *
 * 官方 `POST /v1.0/oauth2/userAccessToken` 只返回 accessToken/refreshToken/expireIn/corpId，
 * **不含 openId**；身份标识须再调 `GET /v1.0/contact/users/me`（需 Contact.User.Read）。
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
  // 企业内部应用建议带 corpId，减少选企业页
  url.searchParams.set("corpId", config.corpId)
  return url.toString()
}

export function newOAuthState(): string {
  return randomBytes(16).toString("hex")
}

async function fetchUserProfile(accessToken: string): Promise<{ openId: string; unionId?: string }> {
  const response = await fetch("https://api.dingtalk.com/v1.0/contact/users/me", {
    method: "GET",
    headers: {
      "x-acs-dingtalk-access-token": accessToken,
    },
  })
  const text = await response.text()
  if (!response.ok) {
    throw new Error(`users/me HTTP ${response.status}`)
  }
  let body: Record<string, unknown>
  try {
    body = JSON.parse(text) as Record<string, unknown>
  } catch {
    throw new Error("users/me 响应非 JSON")
  }
  const openId = typeof body["openId"] === "string" ? body["openId"] : ""
  const unionId = typeof body["unionId"] === "string" ? body["unionId"] : ""
  // openId 优先；个别租户可能只有 unionId，用其作稳定 vault 键
  const stableId = openId !== "" ? openId : unionId
  if (stableId === "") {
    throw new Error("users/me 缺少 openId/unionId")
  }
  return {
    openId: stableId,
    ...(unionId !== "" ? { unionId } : {}),
  }
}

/** 生产默认：换用户 token + 拉 /users/me。测试可注入 mock。 */
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
  const text = await response.text()
  if (!response.ok) {
    throw new Error(`token exchange HTTP ${response.status}`)
  }
  let body: Record<string, unknown>
  try {
    body = JSON.parse(text) as Record<string, unknown>
  } catch {
    throw new Error("token exchange 响应非 JSON")
  }
  const accessToken = typeof body["accessToken"] === "string" ? body["accessToken"] : ""
  const refreshToken = typeof body["refreshToken"] === "string" ? body["refreshToken"] : ""
  const expireIn = typeof body["expireIn"] === "number" ? body["expireIn"] : 7200
  if (accessToken === "") {
    throw new Error("token exchange 响应缺少 accessToken")
  }

  const profile = await fetchUserProfile(accessToken)
  return {
    accessToken,
    refreshToken,
    openId: profile.openId,
    expireIn,
    ...(profile.unionId !== undefined ? { unionId: profile.unionId } : {}),
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
