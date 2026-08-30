/**
 * Web Server 浏览器 UI 烟测：静态页 + sync/status API。
 */
import { execSync } from "node:child_process"
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { WebServer, createSyncTokenStore } from "../../../apps/web-server/src/index.js"
import { materializeChannelSyncExport } from "../../../apps/web-server/src/routes/channel-sync.js"
import { clearPendingOAuthStates } from "../../../apps/web-server/src/routes/auth.js"
import type { ChannelSyncRequest } from "@mycontext/sync-contract"

const TOKEN = "sync-token-ui-smoke-test012345"
const VAULT_ID = "vault-fake-001"
const servers: WebServer[] = []
const dirs: string[] = []

afterEach(async () => {
  clearPendingOAuthStates()
  while (servers.length > 0) await servers.pop()?.stop()
  while (dirs.length > 0) {
    const dir = dirs.pop()
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true })
  }
})

function tempDataDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "mycontext-web-ui-"))
  dirs.push(dir)
  return dir
}

async function startServer(dataDir: string, syncToken: string = TOKEN) {
  const server = new WebServer({ dataDir, syncToken, host: "127.0.0.1" })
  servers.push(server)
  const port = await server.start()
  return { server, base: `http://127.0.0.1:${port}` }
}

async function startFileBackedServer(dataDir: string) {
  const tokenStore = createSyncTokenStore(dataDir)
  const server = new WebServer({ dataDir, tokenStore, host: "127.0.0.1" })
  servers.push(server)
  const port = await server.start()
  return { server, base: `http://127.0.0.1:${port}`, tokenStore }
}

/** file-backed sync token + 伪造 OAuth session（与 oauth-collect 同形）。 */
async function startOAuthFileBacked(dataDir: string) {
  const tokenStore = createSyncTokenStore(dataDir)
  const oauthConfig = {
    clientId: "ding-fake-client",
    clientSecret: "fake-secret",
    corpId: "dingFAKECORP0001",
    redirectUri: "http://127.0.0.1/api/v1/auth/callback",
  }
  const server = new WebServer({
    dataDir,
    tokenStore,
    host: "127.0.0.1",
    oauthConfig,
    exchangeUserToken: async () => ({
      accessToken: "user-access-fake",
      refreshToken: "user-refresh-fake",
      openId: "openFAKE0001",
      expireIn: 7200,
    }),
  })
  servers.push(server)
  const port = await server.start()
  const base = `http://127.0.0.1:${port}`

  const login = await fetch(`${base}/api/v1/auth/login`, { redirect: "manual" })
  const location = login.headers.get("location") ?? ""
  const state = new URL(location).searchParams.get("state")
  expect(state).toBeTruthy()
  const cb = await fetch(
    `${base}/api/v1/auth/callback?authCode=fake-code&state=${encodeURIComponent(state!)}`,
    { redirect: "manual" },
  )
  const setCookie = cb.headers.get("set-cookie")
  expect(setCookie).toContain("mc_session=")
  const sessionCookie = setCookie!.split(";")[0]!
  return { server, base, tokenStore, sessionCookie }
}

function minimalPayload(): ChannelSyncRequest {
  return {
    manifest: {
      vaultId: VAULT_ID,
      channelId: "dingtalk",
      exportedAt: 1_785_000_000_000,
      sources: ["chat"],
    },
    files: {
      "chat/manifest.json": `${JSON.stringify(
        {
          source: "mycontext",
          dataset: "chat",
          scope_types: ["workspace", "chat"],
          record_types: ["message"],
          resource_kinds: [],
          counts: { scopes: 1, records: 0, resources: 0 },
          exported_at: 1_785_000_000_000,
        },
        null,
        2,
      )}\n`,
      "chat/scopes.jsonl": "",
      "chat/records.jsonl": "",
      "chat/resources.jsonl": "",
    },
  }
}

async function getStatus(base: string, vaultId: string, token?: string) {
  const headers: Record<string, string> = {}
  if (token !== undefined) headers.authorization = `Bearer ${token}`
  const response = await fetch(
    `${base}/api/v1/sync/status?vaultId=${encodeURIComponent(vaultId)}`,
    { headers },
  )
  const body = (await response.json()) as Record<string, unknown>
  return { status: response.status, body }
}

async function postSync(base: string, body: unknown, token: string) {
  const response = await fetch(`${base}/api/v1/channel-sync`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  })
  const parsed = (await response.json()) as Record<string, unknown>
  return { status: response.status, body: parsed }
}

describe("GET / 静态 UI", () => {
  it("返回 HTML 且含同步状态标题", async () => {
    const { base } = await startServer(tempDataDir())
    const response = await fetch(`${base}/`)
    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toContain("text/html")
    const html = await response.text()
    expect(html).toContain("MyContext Web Service")
    expect(html).toContain("同步状态")
    expect(html).toContain("运行采集")
    expect(html).toContain("本机不必装 dws")
    expect(html).toContain("调试/应急")
    expect(html).toContain("客户端采集")
    expect(html).toContain("下载采集脚本 (.ts)")
    expect(html).toContain("/client/README.txt")
    const serverCollectIdx = html.indexOf("采集（服务器）")
    const clientCollectIdx = html.indexOf("客户端采集")
    expect(serverCollectIdx).toBeGreaterThan(-1)
    expect(clientCollectIdx).toBeGreaterThan(serverCollectIdx)
  })

  it("GET /client/README.txt 与 TS 脚本模板可下载", async () => {
    const { base } = await startServer(tempDataDir())
    const readme = await fetch(`${base}/client/README.txt`)
    expect(readme.status).toBe(200)
    const readmeText = await readme.text()
    expect(readmeText).toContain("路径 A")
    expect(readmeText).toContain("npx --yes tsx")
    expect(readmeText).toContain("dws auth login")

    const ts = await fetch(`${base}/client/collect-from-dws.ts.template`)
    expect(ts.status).toBe(200)
    const tsText = await ts.text()
    expect(tsText).toContain("__SYNC_URL__")
    expect(tsText).toContain("__SYNC_TOKEN__")
    expect(tsText).toContain("list-all-conversations")
    expect(tsText).toContain("npx --yes tsx")
  })

  it("GET /app.js → 200 且为合法 JS（无 TS 注解）", async () => {
    const { base } = await startServer(tempDataDir())
    const response = await fetch(`${base}/app.js`)
    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toContain("javascript")
    const js = await response.text()
    expect(js).not.toMatch(/:\s*(string|null|void|Promise|HeadersInit)\b/)
    const checkDir = mkdtempSync(join(tmpdir(), "mycontext-appjs-check-"))
    dirs.push(checkDir)
    const checkPath = join(checkDir, "app.js")
    writeFileSync(checkPath, js)
    execSync(`node --check "${checkPath}"`)
  })
})

describe("GET /api/v1/sync/status", () => {
  it("无 token → 401", async () => {
    const { base } = await startServer(tempDataDir())
    const { status, body } = await getStatus(base, VAULT_ID)
    expect(status).toBe(401)
    expect(body["error"]).toBe("unauthorized")
  })

  it("无导出 → hasExport false", async () => {
    const { base } = await startServer(tempDataDir())
    const { status, body } = await getStatus(base, VAULT_ID, TOKEN)
    expect(status).toBe(200)
    expect(body["ok"]).toBe(true)
    expect(body["vaultId"]).toBe(VAULT_ID)
    expect(body["hasExport"]).toBe(false)
    expect(body["sources"]).toEqual({})
  })

  it("fixture 落盘后 → hasExport true + chat exportedAt", async () => {
    const dataDir = tempDataDir()
    materializeChannelSyncExport(dataDir, minimalPayload())
    const { base } = await startServer(dataDir)

    const { status, body } = await getStatus(base, VAULT_ID, TOKEN)
    expect(status).toBe(200)
    expect(body["hasExport"]).toBe(true)
    const sources = body["sources"] as Record<string, { exportedAt?: number }>
    expect(sources["chat"]?.exportedAt).toBe(1_785_000_000_000)
    expect(
      existsSync(join(dataDir, "vaults", VAULT_ID, "exports", "dws", "chat", "records.jsonl")),
    ).toBe(true)
  })

  it("POST channel-sync 后 → hasExport true（HTTP 推送路径）", async () => {
    const dataDir = tempDataDir()
    const { base } = await startServer(dataDir)

    const before = await getStatus(base, VAULT_ID, TOKEN)
    expect(before.body["hasExport"]).toBe(false)

    const pushed = await postSync(base, minimalPayload(), TOKEN)
    expect(pushed.status).toBe(200)
    expect(pushed.body["ok"]).toBe(true)

    const after = await getStatus(base, VAULT_ID, TOKEN)
    expect(after.status).toBe(200)
    expect(after.body["hasExport"]).toBe(true)
    const sources = after.body["sources"] as Record<string, { exportedAt?: number }>
    expect(sources["chat"]?.exportedAt).toBe(1_785_000_000_000)
  })
})

describe("POST /api/v1/sync/token/rotate", () => {
  it("env 锁定 token → 409 env_locked", async () => {
    const { base } = await startServer(tempDataDir())
    const response = await fetch(`${base}/api/v1/sync/token/rotate`, {
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN}` },
    })
    expect(response.status).toBe(409)
    const body = (await response.json()) as Record<string, unknown>
    expect(body["error"]).toBe("env_locked")
  })

  it("file-backed → 200 新 token 一次；旧 token 401，新 token 可用", async () => {
    const dataDir = tempDataDir()
    const { base, tokenStore } = await startFileBackedServer(dataDir)
    const oldToken = tokenStore.get()

    const rotateResp = await fetch(`${base}/api/v1/sync/token/rotate`, {
      method: "POST",
      headers: { authorization: `Bearer ${oldToken}` },
    })
    expect(rotateResp.status).toBe(200)
    const rotateBody = (await rotateResp.json()) as Record<string, unknown>
    expect(rotateBody["ok"]).toBe(true)
    expect(typeof rotateBody["token"]).toBe("string")
    const newToken = rotateBody["token"] as string
    expect(newToken).not.toBe(oldToken)

    const oldAuth = await getStatus(base, VAULT_ID, oldToken)
    expect(oldAuth.status).toBe(401)

    const newAuth = await getStatus(base, VAULT_ID, newToken)
    expect(newAuth.status).toBe(200)
  })

  it("OAuth session 可轮换（无需先持有 Bearer）", async () => {
    const dataDir = tempDataDir()
    const { base, tokenStore, sessionCookie } = await startOAuthFileBacked(dataDir)
    const oldToken = tokenStore.get()

    const rotateResp = await fetch(`${base}/api/v1/sync/token/rotate`, {
      method: "POST",
      headers: { cookie: sessionCookie },
    })
    expect(rotateResp.status).toBe(200)
    const body = (await rotateResp.json()) as Record<string, unknown>
    expect(typeof body["token"]).toBe("string")
    expect(body["token"]).not.toBe(oldToken)
  })
})

describe("GET /api/v1/sync/token", () => {
  it("无鉴权 → 401", async () => {
    const { base } = await startFileBackedServer(tempDataDir())
    const response = await fetch(`${base}/api/v1/sync/token`)
    expect(response.status).toBe(401)
  })

  it("env 锁定 + Bearer → 200 回显当前 token（供客户端脚本下载）", async () => {
    const { base } = await startServer(tempDataDir())
    const response = await fetch(`${base}/api/v1/sync/token`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    })
    expect(response.status).toBe(200)
    const body = (await response.json()) as Record<string, unknown>
    expect(body["ok"]).toBe(true)
    expect(body["token"]).toBe(TOKEN)
    expect(body["envLocked"]).toBe(true)
    expect(typeof body["prefix"]).toBe("string")
  })

  it("OAuth session + file-backed → 200 回显当前 token", async () => {
    const dataDir = tempDataDir()
    const { base, tokenStore, sessionCookie } = await startOAuthFileBacked(dataDir)
    const response = await fetch(`${base}/api/v1/sync/token`, {
      headers: { cookie: sessionCookie },
    })
    expect(response.status).toBe(200)
    const body = (await response.json()) as Record<string, unknown>
    expect(body["ok"]).toBe(true)
    expect(body["token"]).toBe(tokenStore.get())
    expect(typeof body["prefix"]).toBe("string")
    expect(body["envLocked"]).toBe(false)
  })
})
