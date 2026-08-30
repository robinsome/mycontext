/**
 * SidecarRunner 白名单 + 假 runner 解析（不依赖 live Docker）。
 */
import { describe, expect, it } from "vitest"
import {
  assertAllowlistedDwsArgs,
  buildSidecarDockerArgs,
  resolveHostPath,
  sidecarEnvContainerPath,
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

describe("buildSidecarDockerArgs", () => {
  const token = "uat-fake-token-do-not-leak"

  it("uses --env-file host path and never passes raw token via -e", () => {
    const args = buildSidecarDockerArgs({
      image: "mycontext-dws-sidecar:0.1.0",
      hostConfigDir: "/host/vaults/v1/dws-home",
      hostEnvFile: "/host/vaults/v1/.sidecar-env-v1",
      script: "dws auth login --token \"$DWS_ACCESS_TOKEN\" -y && dws chat list-all-conversations",
    })

    const envFileIdx = args.indexOf("--env-file")
    expect(envFileIdx).toBeGreaterThan(-1)
    expect(args[envFileIdx + 1]).toBe("/host/vaults/v1/.sidecar-env-v1")
    expect(args).toContain("--entrypoint")
    expect(args[args.indexOf("--entrypoint") + 1]).toBe("bash")

    const joined = args.join(" ")
    expect(joined).not.toContain(token)
    expect(joined).not.toMatch(/-e\s+DWS_ACCESS_TOKEN=/)
    expect(joined).not.toContain("DWS_ACCESS_TOKEN=uat")
  })
})

describe("resolveHostPath", () => {
  it("maps MYCONTEXT_DATA_DIR prefix to MYCONTEXT_HOST_DATA_DIR", () => {
    const prevData = process.env["MYCONTEXT_DATA_DIR"]
    const prevHost = process.env["MYCONTEXT_HOST_DATA_DIR"]
    process.env["MYCONTEXT_DATA_DIR"] = "/data"
    process.env["MYCONTEXT_HOST_DATA_DIR"] = "/var/lib/docker/volumes/data/_data"
    try {
      expect(resolveHostPath("/data/vaults/v1/dws-home")).toBe(
        "/var/lib/docker/volumes/data/_data/vaults/v1/dws-home",
      )
      expect(sidecarEnvContainerPath("/data/vaults/v1/dws-home", "v1")).toBe(
        "/data/vaults/v1/.sidecar-env-v1",
      )
      expect(resolveHostPath("/data/vaults/v1/.sidecar-env-v1")).toBe(
        "/var/lib/docker/volumes/data/_data/vaults/v1/.sidecar-env-v1",
      )
    } finally {
      if (prevData === undefined) delete process.env["MYCONTEXT_DATA_DIR"]
      else process.env["MYCONTEXT_DATA_DIR"] = prevData
      if (prevHost === undefined) delete process.env["MYCONTEXT_HOST_DATA_DIR"]
      else process.env["MYCONTEXT_HOST_DATA_DIR"] = prevHost
    }
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
