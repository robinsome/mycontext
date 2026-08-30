/**
 * 本机 sync 脚本契约 —— 与 channel-sync.test.ts 同思路：
 * 跨进程（shell → WebServer HTTP）才是真实集成面。
 */
import { spawn, spawnSync } from "node:child_process"
import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { WebServer } from "../../../apps/web-server/src/index.js"

const TOKEN = "sync-token-script-e2e"
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

describe("push-dws-export.sh", () => {
  it("缺 MYCONTEXT_SYNC_URL/TOKEN → exit 1", () => {
    const result = spawnSync(join(repoRoot(), "scripts/sync/push-dws-export.sh"), ["--fixture"], {
      cwd: repoRoot(),
      env: {
        HOME: process.env["HOME"] ?? "",
        PATH: process.env["PATH"] ?? "",
        TMPDIR: process.env["TMPDIR"] ?? tmpdir(),
      },
    })
    expect(result.status).toBe(1)
    expect(result.stderr.toString()).toContain("MYCONTEXT_SYNC_URL")
  })

  it("--fixture 对 WebServer → HTTP 200，落盘 vault-fake-001", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "mycontext-sync-script-"))
    dirs.push(dataDir)
    const server = new WebServer({ dataDir, syncToken: TOKEN, host: "127.0.0.1" })
    servers.push(server)
    const port = await server.start()

    const stderr = await new Promise<string>((resolve, reject) => {
      const proc = spawn(join(repoRoot(), "scripts/sync/push-dws-export.sh"), ["--fixture"], {
        cwd: repoRoot(),
        env: {
          ...process.env,
          MYCONTEXT_SYNC_URL: `http://127.0.0.1:${port}/api/v1/channel-sync`,
          MYCONTEXT_SYNC_TOKEN: TOKEN,
        },
      })
      let out = ""
      proc.stderr.on("data", (chunk: Buffer) => {
        out += chunk.toString()
      })
      const timer = setTimeout(() => {
        proc.kill("SIGTERM")
        reject(new Error(`脚本超时\n${out}`))
      }, 10_000)
      proc.on("close", (code) => {
        clearTimeout(timer)
        if (code !== 0) reject(new Error(`exit ${code}\n${out}`))
        else resolve(out)
      })
    })

    expect(stderr).toContain("HTTP 200")
    expect(stderr).toContain("同步成功")
    expect(
      existsSync(join(dataDir, "vaults", "vault-fake-001", "exports", "dws", "chat", "manifest.json")),
    ).toBe(true)
  })
})

describe("push-dws-export.ps1", () => {
  it("pwsh 可用时通过语法解析（非 Windows 运行时烟测）", () => {
    const ps1 = join(repoRoot(), "scripts/sync/push-dws-export.ps1")
    const result = spawnSync(
      "pwsh",
      [
        "-NoProfile",
        "-Command",
        `$e=$null;[void][System.Management.Automation.Language.Parser]::ParseFile('${ps1.replace(/'/g, "''")}',[ref]$null,[ref]$e);if($e){$e|Write-Error;exit 1}`,
      ],
      { encoding: "utf8" },
    )
    if (result.error !== undefined && "code" in result.error && result.error.code === "ENOENT") {
      return
    }
    expect(result.status, result.stderr).toBe(0)
  })
})
