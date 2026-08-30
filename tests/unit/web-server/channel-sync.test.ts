/**
 * Web Server 渠道同步接收端契约。
 *
 * 用真实 HTTP 而不是直接调 handler：鉴权、状态码、JSON 形状都是
 * 跨进程契约（本机 dws 脚本 → Ubuntu 服务），直接调方法测不到。
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { WebServer } from "../../../apps/web-server/src/index.js"
import type { ChannelSyncRequest } from "@mycontext/sync-contract"

const TOKEN = "sync-token-test-0123456789abcdef"
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
  const dir = mkdtempSync(join(tmpdir(), "mycontext-web-server-"))
  dirs.push(dir)
  return dir
}

async function startServer(dataDir: string) {
  const server = new WebServer({ dataDir, syncToken: TOKEN, host: "127.0.0.1" })
  servers.push(server)
  const port = await server.start()
  return { server, base: `http://127.0.0.1:${port}` }
}

function minimalPayload(): ChannelSyncRequest {
  return {
    manifest: {
      vaultId: "vault-fake-001",
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

async function postSync(base: string, body: unknown, token?: string) {
  const headers: Record<string, string> = { "content-type": "application/json" }
  if (token !== undefined) headers.authorization = `Bearer ${token}`
  const response = await fetch(`${base}/api/v1/channel-sync`, {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  })
  const text = await response.text()
  let parsed: Record<string, unknown> = {}
  try {
    parsed = JSON.parse(text) as Record<string, unknown>
  } catch {
    // 非 JSON 响应在部分错误路径上允许
  }
  return { status: response.status, body: parsed, text }
}

describe("GET /health", () => {
  it("无需鉴权 → 200 ok", async () => {
    const { base } = await startServer(tempDataDir())
    const response = await fetch(`${base}/health`)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true })
  })
})

describe("WebServer 构造", () => {
  it("空 syncToken → 抛错（禁止无鉴权启动）", () => {
    expect(
      () => new WebServer({ dataDir: tempDataDir(), syncToken: "", host: "127.0.0.1" }),
    ).toThrow(/syncToken 不能为空/)
  })
})

describe("POST /api/v1/channel-sync 鉴权", () => {
  it("无 token → 401", async () => {
    const { base } = await startServer(tempDataDir())
    const { status, body } = await postSync(base, minimalPayload())
    expect(status).toBe(401)
    expect(body["error"]).toBe("unauthorized")
  })

  it("坏 JSON → 400", async () => {
    const { base } = await startServer(tempDataDir())
    const response = await fetch(`${base}/api/v1/channel-sync`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${TOKEN}`,
        "content-type": "application/json",
      },
      body: "{not-json",
    })
    expect(response.status).toBe(400)
    const body = (await response.json()) as Record<string, unknown>
    expect(body["error"]).toBe("invalid_json")
  })
})

describe("POST /api/v1/channel-sync 落盘", () => {
  it("vaultId 含 .. → 400，不写 vaults 外", async () => {
    const dataDir = tempDataDir()
    const { base } = await startServer(dataDir)
    const payload = minimalPayload()
    payload.manifest.vaultId = "../../outside"

    const { status, body } = await postSync(base, payload, TOKEN)
    expect(status).toBe(400)
    expect(body["error"]).toBe("invalid_body")
    expect(existsSync(join(dataDir, "outside"))).toBe(false)
    expect(existsSync(join(dataDir, "vaults", "outside"))).toBe(false)
  })

  it("合法 payload → 200，四件套写到 dataDir/vaults/<id>/exports/dws/", async () => {
    const dataDir = tempDataDir()
    const { base } = await startServer(dataDir)
    const payload = minimalPayload()

    const { status, body } = await postSync(base, payload, TOKEN)
    expect(status).toBe(200)
    expect(body["ok"]).toBe(true)

    const exportRoot = join(dataDir, "vaults", payload.manifest.vaultId, "exports", "dws")
    for (const file of ["manifest.json", "scopes.jsonl", "records.jsonl", "resources.jsonl"]) {
      const path = join(exportRoot, "chat", file)
      expect(existsSync(path), `缺 chat/${file}`).toBe(true)
      expect(readFileSync(path, "utf8")).toBe(payload.files[`chat/${file}`])
    }
  })
})
