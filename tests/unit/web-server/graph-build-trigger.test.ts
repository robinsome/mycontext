/**
 * Web Server 建图触发契约 —— mock GraphBuildRunner，不依赖真 kl-server。
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { WebServer } from "../../../apps/web-server/src/index.js"
import type { GraphBuildRunner } from "../../../apps/web-server/src/graph-build-runner.js"

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
  const dir = mkdtempSync(join(tmpdir(), "mycontext-web-graph-"))
  dirs.push(dir)
  return dir
}

async function startServer(dataDir: string, graphBuildRunner?: GraphBuildRunner) {
  const server = new WebServer({
    dataDir,
    syncToken: TOKEN,
    host: "127.0.0.1",
    ...(graphBuildRunner !== undefined ? { graphBuildRunner } : {}),
  })
  servers.push(server)
  const port = await server.start()
  return { server, base: `http://127.0.0.1:${port}` }
}

async function postGraphBuild(
  base: string,
  body: unknown,
  token?: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const headers: Record<string, string> = { "content-type": "application/json" }
  if (token !== undefined) headers.authorization = `Bearer ${token}`
  const response = await fetch(`${base}/api/v1/graph/build`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  })
  const text = await response.text()
  let parsed: Record<string, unknown> = {}
  try {
    parsed = JSON.parse(text) as Record<string, unknown>
  } catch {
    // 部分错误路径允许非 JSON
  }
  return { status: response.status, body: parsed }
}

function writeChatExport(dataDir: string, vaultId: string): string {
  const exportRoot = join(dataDir, "vaults", vaultId, "exports", "dws")
  mkdirSync(join(exportRoot, "chat"), { recursive: true })
  writeFileSync(join(exportRoot, "chat", "records.jsonl"), '{"id":"msg-fake-001"}\n')
  return exportRoot
}

describe("POST /api/v1/graph/build 鉴权", () => {
  it("无 token → 401", async () => {
    const { base } = await startServer(tempDataDir())
    const { status, body } = await postGraphBuild(base, { vaultId: "vault-fake-001" })
    expect(status).toBe(401)
    expect(body["error"]).toBe("unauthorized")
  })
})

describe("POST /api/v1/graph/build vaultId 安全", () => {
  it("vaultId 含 .. → 400", async () => {
    const dataDir = tempDataDir()
    const { base } = await startServer(dataDir)
    const { status, body } = await postGraphBuild(base, { vaultId: "../../outside" }, TOKEN)
    expect(status).toBe(400)
    expect(body["error"]).toBe("invalid_body")
    expect(existsSync(join(dataDir, "outside"))).toBe(false)
  })
})

describe("POST /api/v1/graph/build 触发", () => {
  it("无导出 → 404 no_export，不调用 runner", async () => {
    const dataDir = tempDataDir()
    const build = vi.fn<GraphBuildRunner["build"]>()
    const { base } = await startServer(dataDir, { build })

    const { status, body } = await postGraphBuild(base, { vaultId: "vault-fake-001" }, TOKEN)
    expect(status).toBe(404)
    expect(body["error"]).toBe("no_export")
    expect(build).not.toHaveBeenCalled()
  })

  it("有 chat/records.jsonl → 调用 runner 且 exportDir 正确", async () => {
    const dataDir = tempDataDir()
    const vaultId = "vault-fake-001"
    const exportRoot = writeChatExport(dataDir, vaultId)

    const build = vi.fn<GraphBuildRunner["build"]>().mockResolvedValue({ ok: true })
    const { base } = await startServer(dataDir, { build })

    const { status, body } = await postGraphBuild(base, { vaultId, sourceId: "dingtalk" }, TOKEN)
    expect(status).toBe(200)
    expect(body["ok"]).toBe(true)
    expect(body["exportDir"]).toBe(exportRoot)

    expect(build).toHaveBeenCalledTimes(1)
    expect(build).toHaveBeenCalledWith({
      exportDir: exportRoot,
      vaultId,
      sourceId: "dingtalk",
    })
  })
})
