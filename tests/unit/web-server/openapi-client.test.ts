/**
 * defaultCallMapped：users/me 成功落盘；403 → unreadable。
 */
import { mkdtempSync, existsSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { matrixRowForCommand } from "../../../packages/channels/src/plugins/dingtalk/openapi-capability-matrix.js"
import { defaultCallMapped } from "../../../apps/web-server/src/collector/openapi-client.js"

const dirs: string[] = []

afterEach(() => {
  while (dirs.length > 0) {
    const dir = dirs.pop()
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true })
  }
})

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "mycontext-openapi-"))
  dirs.push(dir)
  return dir
}

describe("defaultCallMapped", () => {
  it("contact user get-self → ok + identity/me.json", async () => {
    const exportRoot = tempDir()
    const row = matrixRowForCommand(["contact", "user", "get-self"])
    expect(row?.status).toBe("mapped")

    const originalFetch = globalThis.fetch
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toContain("/v1.0/contact/users/me")
      expect((init?.headers as Record<string, string>)["x-acs-dingtalk-access-token"]).toBe(
        "uat-fake",
      )
      return new Response(
        JSON.stringify({ openId: "openFAKE0001", unionId: "unionFAKE0001", nick: "Alice" }),
        { status: 200, headers: { "content-type": "application/json" } },
      )
    }) as typeof fetch

    try {
      const outcome = await defaultCallMapped(row!, {
        accessToken: "uat-fake",
        exportRoot,
      })
      expect(outcome.status).toBe("ok")
      const mePath = join(exportRoot, "identity", "me.json")
      expect(existsSync(mePath)).toBe(true)
      const me = JSON.parse(readFileSync(mePath, "utf8")) as { openId: string }
      expect(me.openId).toBe("openFAKE0001")
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it("HTTP 403 → unreadable（不绕过）", async () => {
    const exportRoot = tempDir()
    const row = matrixRowForCommand(["contact", "user", "get-self"])!
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ code: "Forbidden" }), {
        status: 403,
        headers: { "content-type": "application/json" },
      })) as typeof fetch
    try {
      const outcome = await defaultCallMapped(row, {
        accessToken: "uat-fake",
        exportRoot,
      })
      expect(outcome.status).toBe("unreadable")
      expect(existsSync(join(exportRoot, "identity", "me.json"))).toBe(false)
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
