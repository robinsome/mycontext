/**
 * SidecarRunner 白名单 + 假 runner 解析（不依赖 live Docker）。
 */
import { describe, expect, it } from "vitest"
import {
  assertAllowlistedDwsArgs,
  type SidecarRunner,
} from "../../../apps/web-server/src/collector/sidecar-runner.js"

describe("assertAllowlistedDwsArgs", () => {
  it("rejects non-allowlisted argv", () => {
    expect(() => assertAllowlistedDwsArgs(["chat", "message", "send", "--to", "x"])).toThrow(
      /allowlist/i,
    )
  })

  it("accepts sidecar matrix command with trailing flags", () => {
    expect(() =>
      assertAllowlistedDwsArgs(["chat", "list-all-conversations", "--limit", "1", "-f", "json"]),
    ).not.toThrow()
  })
})

describe("SidecarRunner (fake)", () => {
  it("parses success json from fake runner", async () => {
    const runner: SidecarRunner = async () => ({
      exitCode: 0,
      json: {
        success: true,
        result: { conversations: [{ id: "cidFAKE0001==" }], hasMore: false },
      },
      detail: "ok",
    })
    const r = await runner({
      vaultId: "vault_fake",
      accessToken: "uat-fake",
      dwsArgs: ["chat", "list-all-conversations", "--limit", "1", "-f", "json"],
      configDir: "/tmp/fake-dws-home",
    })
    expect(r.exitCode).toBe(0)
    expect((r.json as { success: boolean }).success).toBe(true)
  })
})
