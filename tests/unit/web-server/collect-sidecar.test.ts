/**
 * Task 4：runCapabilityCollect 接线 sidecar + 分页（假 ID fixture）。
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { runCapabilityCollect } from "../../../apps/web-server/src/collector/run-collect.js"
import type { SidecarRunner } from "../../../apps/web-server/src/collector/sidecar-runner.js"

const FAKE_CID = "cidFAKE0001=="
const FAKE_VAULT = "vaultFAKE0001"
const FAKE_TOKEN = "uat-fake-token-for-test"

const dirs: string[] = []

afterEach(() => {
  while (dirs.length > 0) {
    const dir = dirs.pop()
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true })
  }
})

function tempDataDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "mycontext-collect-sidecar-"))
  dirs.push(dir)
  return dir
}

function listAllPayload(
  conversations: Array<{ openConversationId?: string; title?: string }>,
  hasMore: boolean,
  nextCursor?: number,
): unknown {
  return {
    success: true,
    result: {
      conversations,
      hasMore,
      ...(nextCursor !== undefined ? { nextCursor } : {}),
    },
  }
}

function readScopeLines(exportRoot: string): string[] {
  const text = readFileSync(join(exportRoot, "chat", "scopes.jsonl"), "utf8")
  return text
    .trim()
    .split("\n")
    .filter((line) => line.length > 0)
}

describe("runCapabilityCollect sidecar", () => {
  it("injected runner: one page hasMore:false → chat list-all-conversations ok, scopes=1", async () => {
    const dataDir = tempDataDir()
    const sidecarRunner: SidecarRunner = async (req) => {
      expect(req.dwsArgs).toEqual(["chat", "list-all-conversations", "--limit", "100", "-f", "json"])
      expect(req.vaultId).toBe(FAKE_VAULT)
      expect(req.accessToken).toBe(FAKE_TOKEN)
      return {
        exitCode: 0,
        json: listAllPayload([{ openConversationId: FAKE_CID, title: "示例群" }], false),
        detail: "",
      }
    }

    const { exportRoot, results } = await runCapabilityCollect({
      dataDir,
      vaultId: FAKE_VAULT,
      accessToken: FAKE_TOKEN,
      commandKeys: ["chat list-all-conversations"],
      sidecarRunner,
    })

    const row = results.find((r) => r.command === "chat list-all-conversations")
    expect(row?.status).toBe("ok")
    expect(readScopeLines(exportRoot)).toHaveLength(1)
    expect(existsSync(join(exportRoot, "chat", "manifest.json"))).toBe(true)
  })

  it("paginates until hasMore:false and appends scopes", async () => {
    const dataDir = tempDataDir()
    let call = 0
    const sidecarRunner: SidecarRunner = async (req) => {
      call += 1
      if (call === 1) {
        expect(req.dwsArgs).toEqual(["chat", "list-all-conversations", "--limit", "100", "-f", "json"])
        return {
          exitCode: 0,
          json: listAllPayload([{ openConversationId: FAKE_CID, title: "第一页" }], true, 42),
          detail: "",
        }
      }
      expect(req.dwsArgs).toEqual([
        "chat",
        "list-all-conversations",
        "--limit",
        "100",
        "-f",
        "json",
        "--cursor",
        "42",
      ])
      return {
        exitCode: 0,
        json: listAllPayload([{ openConversationId: "cidFAKE0002==", title: "第二页" }], false),
        detail: "",
      }
    }

    const { exportRoot, results } = await runCapabilityCollect({
      dataDir,
      vaultId: FAKE_VAULT,
      accessToken: FAKE_TOKEN,
      commandKeys: ["chat list-all-conversations"],
      sidecarRunner,
    })

    expect(results[0]?.status).toBe("ok")
    expect(call).toBe(2)
    expect(readScopeLines(exportRoot)).toHaveLength(2)
  })

  it("sidecar failure → error, not ok with zero scopes pretending success", async () => {
    const dataDir = tempDataDir()
    const sidecarRunner: SidecarRunner = async () => ({
      exitCode: 1,
      json: null,
      detail: "stderr: sidecar failed",
    })

    const { exportRoot, results } = await runCapabilityCollect({
      dataDir,
      vaultId: FAKE_VAULT,
      accessToken: FAKE_TOKEN,
      commandKeys: ["chat list-all-conversations"],
      sidecarRunner,
    })

    expect(results[0]?.status).toBe("error")
    expect(results[0]?.detail).toMatch(/sidecar/i)
    expect(readScopeLines(exportRoot)).toHaveLength(0)
  })

  it("no sidecarRunner → error for sidecar row", async () => {
    const dataDir = tempDataDir()
    const { results } = await runCapabilityCollect({
      dataDir,
      vaultId: FAKE_VAULT,
      accessToken: FAKE_TOKEN,
      commandKeys: ["chat list-all-conversations"],
    })

    expect(results[0]?.status).toBe("error")
    expect(results[0]?.detail).toMatch(/runner|sidecar/i)
  })
})
