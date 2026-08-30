/**
 * 服务端 session：HttpOnly cookie 存 sessionId，token 只在内存/落盘加密前的明文文件
 * （MVP：dataDir/sessions/<id>.json，权限 0o600；生产可换密钥槽）。
 */
import { randomBytes } from "node:crypto"
import { mkdirSync, readFileSync, writeFileSync, unlinkSync, existsSync } from "node:fs"
import { join } from "node:path"
import type { UserTokenBundle } from "./dingtalk-oauth.js"

export interface SessionRecord {
  sessionId: string
  vaultId: string
  openId: string
  corpId: string
  accessToken: string
  refreshToken: string
  createdAt: number
}

export interface SessionStore {
  create(input: {
    vaultId: string
    openId: string
    corpId: string
    tokens: UserTokenBundle
  }): SessionRecord
  get(sessionId: string): SessionRecord | null
  destroy(sessionId: string): void
}

export function createFileSessionStore(dataDir: string): SessionStore {
  const root = join(dataDir, "sessions")
  mkdirSync(root, { recursive: true })

  return {
    create(input) {
      const sessionId = randomBytes(24).toString("hex")
      const record: SessionRecord = {
        sessionId,
        vaultId: input.vaultId,
        openId: input.openId,
        corpId: input.corpId,
        accessToken: input.tokens.accessToken,
        refreshToken: input.tokens.refreshToken,
        createdAt: Date.now(),
      }
      writeFileSync(join(root, `${sessionId}.json`), JSON.stringify(record), { mode: 0o600 })
      return record
    },
    get(sessionId) {
      if (!/^[a-f0-9]{48}$/.test(sessionId)) return null
      const path = join(root, `${sessionId}.json`)
      if (!existsSync(path)) return null
      try {
        return JSON.parse(readFileSync(path, "utf8")) as SessionRecord
      } catch {
        return null
      }
    },
    destroy(sessionId) {
      if (!/^[a-f0-9]{48}$/.test(sessionId)) return
      const path = join(root, `${sessionId}.json`)
      if (existsSync(path)) unlinkSync(path)
    },
  }
}

export const SESSION_COOKIE = "mc_session"

export function parseSessionCookie(header: string | undefined): string | null {
  if (header === undefined || header === "") return null
  for (const part of header.split(";")) {
    const [rawKey, ...rest] = part.trim().split("=")
    if (rawKey === SESSION_COOKIE) {
      const value = rest.join("=").trim()
      return value === "" ? null : value
    }
  }
  return null
}

export function setSessionCookie(sessionId: string, secure: boolean): string {
  const flags = ["Path=/", "HttpOnly", "SameSite=Lax", `Max-Age=${60 * 60 * 24 * 7}`]
  if (secure) flags.push("Secure")
  return `${SESSION_COOKIE}=${sessionId}; ${flags.join("; ")}`
}

export function clearSessionCookie(secure: boolean): string {
  const flags = ["Path=/", "HttpOnly", "SameSite=Lax", "Max-Age=0"]
  if (secure) flags.push("Secure")
  return `${SESSION_COOKIE}=; ${flags.join("; ")}`
}
