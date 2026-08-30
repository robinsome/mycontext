/**
 * Web Server 浏览器 UI 烟测：静态页 + sync/status API。
 */
import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { WebServer } from "../../../apps/web-server/src/index.js"
import { materializeChannelSyncExport } from "../../../apps/web-server/src/routes/channel-sync.js"
import type { ChannelSyncRequest } from "@mycontext/sync-contract"

const TOKEN = "sync-token-ui-smoke-test012345"
const VAULT_ID = "vault-fake-001"
const servers: WebServer[] = []
const dirs: string[] = []

afterEach(async () => {
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

async function startServer(dataDir: string) {
  const server = new WebServer({ dataDir, syncToken: TOKEN, host: "127.0.0.1" })
  servers.push(server)
  const port = await server.start()
  return { base: `http://127.0.0.1:${port}` }
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

describe("GET / 静态 UI", () => {
  it("返回 HTML 且含同步状态标题", async () => {
    const { base } = await startServer(tempDataDir())
    const response = await fetch(`${base}/`)
    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toContain("text/html")
    const html = await response.text()
    expect(html).toContain("MyContext Web Service")
    expect(html).toContain("同步状态")
  })

  it("GET /app.js → 200", async () => {
    const { base } = await startServer(tempDataDir())
    const response = await fetch(`${base}/app.js`)
    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toContain("javascript")
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
})
