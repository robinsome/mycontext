/**
 * 同步 Bearer token 管理：env 优先（进程启动时锁定），否则读写 dataDir/sync-token。
 */
import { randomBytes } from "node:crypto"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const TOKEN_FILE = "sync-token"
const TOKEN_BYTES = 32

export function generateSyncToken(): string {
  return `mc-sync-${randomBytes(TOKEN_BYTES).toString("base64url")}`
}

export function maskSyncTokenPrefix(token: string): string {
  if (token.length <= 12) return `${token.slice(0, 4)}…`
  return `${token.slice(0, 12)}…`
}

export interface SyncTokenStore {
  get(): string
  /** env 锁定时不可轮换。 */
  isEnvLocked(): boolean
  rotate(): { token: string; prefix: string } | null
}

/** 测试 / 显式传入固定 token：不可轮换。 */
export function fixedSyncTokenStore(token: string): SyncTokenStore {
  if (token === "") {
    throw new Error("syncToken 不能为空（空 token 会让 Bearer 校验恒通过）")
  }
  return {
    get: () => token,
    isEnvLocked: () => true,
    rotate: () => null,
  }
}

function readTokenFile(path: string): string | null {
  try {
    const text = readFileSync(path, "utf8").trim()
    return text === "" ? null : text
  } catch {
    return null
  }
}

function writeTokenFile(path: string, token: string): void {
  mkdirSync(join(path, ".."), { recursive: true })
  writeFileSync(path, `${token}\n`, { mode: 0o600 })
}

/**
 * 生产入口：MYCONTEXT_SYNC_TOKEN 非空 → env 锁定；否则 file-backed。
 * 文件不存在时在首次读取时生成并落盘。
 */
export function createSyncTokenStore(dataDir: string, envToken?: string): SyncTokenStore {
  if (envToken !== undefined && envToken !== "") {
    return fixedSyncTokenStore(envToken)
  }

  const tokenPath = join(dataDir, TOKEN_FILE)
  const existing = readTokenFile(tokenPath)
  let current: string
  if (existing !== null) {
    current = existing
  } else {
    current = generateSyncToken()
    writeTokenFile(tokenPath, current)
  }

  return {
    get: () => current,
    isEnvLocked: () => false,
    rotate: () => {
      const token = generateSyncToken()
      writeTokenFile(tokenPath, token)
      current = token
      return { token, prefix: maskSyncTokenPrefix(token) }
    },
  }
}
