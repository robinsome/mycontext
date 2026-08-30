/**
 * push → graph/build 联调契约（Step 3）。
 *
 * 跨进程：shell channel-sync → HTTP graph/build；GraphBuildRunner 用 mock，不启真 kl。
 */
import { spawn } from "node:child_process"
import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { WebServer } from "../../../apps/web-server/src/index.js"
import type { GraphBuildParams, GraphBuildRunner } from "../../../apps/web-server/src/graph-build-runner.js"

const TOKEN = "sync-token-push-then-build"
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

function repoRoot(): string {
  return join(import.meta.dirname, "../../..")
}

function runPushFixture(port: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(join(repoRoot(), "scripts/sync/push-dws-export.sh"), ["--fixture"], {
      cwd: repoRoot(),
      env: {
        ...process.env,
        MYCONTEXT_SYNC_URL: `http://127.0.0.1:${String(port)}/api/v1/channel-sync`,
        MYCONTEXT_SYNC_TOKEN: TOKEN,
      },
    })
    let stderr = ""
    proc.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString()
    })
    const timer = setTimeout(() => {
      proc.kill("SIGTERM")
      reject(new Error(`push 脚本超时\n${stderr}`))
    }, 10_000)
    proc.on("close", (code) => {
      clearTimeout(timer)
      if (code !== 0) reject(new Error(`push exit ${String(code)}\n${stderr}`))
      else resolve(stderr)
    })
  })
}

describe("push → graph/build 联调", () => {
  it("push-dws-export.sh --fixture 后 graph/build → 200 且 mock build 收到正确 exportDir", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "mycontext-push-build-"))
    dirs.push(dataDir)

    const buildCalls: GraphBuildParams[] = []
    const graphBuildRunner: GraphBuildRunner = {
      build: vi.fn(async (params) => {
        buildCalls.push(params)
        return { ok: true }
      }),
    }

    const server = new WebServer({
      dataDir,
      syncToken: TOKEN,
      host: "127.0.0.1",
      graphBuildRunner,
    })
    servers.push(server)
    const port = await server.start()
    const base = `http://127.0.0.1:${String(port)}`

    const pushStderr = await runPushFixture(port)
    expect(pushStderr).toContain("HTTP 200")
    expect(pushStderr).toContain("同步成功")

    const exportRel = join("vaults", VAULT_ID, "exports", "dws")
    expect(
      existsSync(join(dataDir, exportRel, "chat", "records.jsonl")),
      "channel-sync 应落盘 chat/records.jsonl",
    ).toBe(true)

    const response = await fetch(`${base}/api/v1/graph/build`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ vaultId: VAULT_ID }),
    })
    const body = (await response.json()) as Record<string, unknown>

    expect(response.status).toBe(200)
    expect(body["ok"]).toBe(true)

    expect(buildCalls).toHaveLength(1)
    const call = buildCalls[0]
    expect(call?.exportDir.endsWith(`${exportRel.replaceAll("\\", "/")}`)).toBe(true)
    expect(call?.vaultId).toBe(VAULT_ID)
    expect(call?.sourceId).toBe("dingtalk")
  })
})
