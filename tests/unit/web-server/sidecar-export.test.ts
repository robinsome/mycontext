/**
 * sidecar list-all-conversations → chat 四件套 scopes（假 ID fixture）。
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { writeConversationsToChatExport } from "../../../apps/web-server/src/collector/sidecar-export.js"

const FAKE_CID = "cidFAKE0001=="
const FAKE_CID_2 = "cidFAKE0002=="

const dirs: string[] = []

afterEach(() => {
  while (dirs.length > 0) {
    const dir = dirs.pop()
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true })
  }
})

function tempExportRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), "mycontext-sidecar-export-"))
  dirs.push(dir)
  return dir
}

function listAllPayload(
  conversations: Array<{ openConversationId?: string; id?: string; title?: string }>,
  hasMore: boolean,
): unknown {
  return {
    success: true,
    result: { conversations, hasMore },
  }
}

function readScopes(exportRoot: string): unknown[] {
  const text = readFileSync(join(exportRoot, "chat", "scopes.jsonl"), "utf8")
  return text
    .trim()
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as unknown)
}

describe("writeConversationsToChatExport", () => {
  it("writes one chat scope from list-all-conversations payload (fake cid)", () => {
    const exportRoot = tempExportRoot()
    const payload = listAllPayload(
      [{ openConversationId: FAKE_CID, title: "示例群" }],
      false,
    )

    const result = writeConversationsToChatExport(exportRoot, payload)

    expect(result).toEqual({ written: 1, hasMore: false })
    const scopes = readScopes(exportRoot)
    expect(scopes).toHaveLength(1)
    expect(scopes[0]).toMatchObject({
      id: `chat:${FAKE_CID}`,
      type: "chat",
      parent_id: "workspace:ali-ding",
      data: {
        title: "示例群",
        openConversationId: FAKE_CID,
      },
    })
    expect(readFileSync(join(exportRoot, "chat", "records.jsonl"), "utf8")).toBe("")
    expect(readFileSync(join(exportRoot, "chat", "resources.jsonl"), "utf8")).toBe("")
    const manifest = JSON.parse(readFileSync(join(exportRoot, "chat", "manifest.json"), "utf8")) as {
      note?: string
    }
    expect(manifest.note).toMatch(/sidecar/i)
  })

  it("accepts conversation.id when openConversationId is absent", () => {
    const exportRoot = tempExportRoot()
    const payload = listAllPayload([{ id: FAKE_CID, title: "" }], false)

    const result = writeConversationsToChatExport(exportRoot, payload)

    expect(result.written).toBe(1)
    const scopes = readScopes(exportRoot)
    expect(scopes[0]).toMatchObject({
      id: `chat:${FAKE_CID}`,
      data: { title: "", openConversationId: FAKE_CID },
    })
  })

  it("returns hasMore:true without requiring caller to finish pagination here", () => {
    const exportRoot = tempExportRoot()
    const payload = listAllPayload([{ openConversationId: FAKE_CID, title: "A" }], true)

    const result = writeConversationsToChatExport(exportRoot, payload)

    expect(result).toEqual({ written: 1, hasMore: true })
  })

  it("appends new scopes on subsequent calls without wiping prior pages", () => {
    const exportRoot = tempExportRoot()
    writeConversationsToChatExport(
      exportRoot,
      listAllPayload([{ openConversationId: FAKE_CID, title: "第一页" }], true),
    )
    const second = writeConversationsToChatExport(
      exportRoot,
      listAllPayload([{ openConversationId: FAKE_CID_2, title: "第二页" }], false),
    )

    expect(second).toEqual({ written: 1, hasMore: false })
    const scopes = readScopes(exportRoot)
    expect(scopes).toHaveLength(2)
    expect(scopes.map((s) => (s as { id: string }).id)).toEqual([
      `chat:${FAKE_CID}`,
      `chat:${FAKE_CID_2}`,
    ])
  })

  it("skips duplicate scope ids when appending", () => {
    const exportRoot = tempExportRoot()
    writeConversationsToChatExport(
      exportRoot,
      listAllPayload([{ openConversationId: FAKE_CID, title: "A" }], true),
    )
    const again = writeConversationsToChatExport(
      exportRoot,
      listAllPayload([{ openConversationId: FAKE_CID, title: "B" }], false),
    )

    expect(again.written).toBe(0)
    expect(readScopes(exportRoot)).toHaveLength(1)
  })

  it("throws on malformed payload (no conversations array)", () => {
    const exportRoot = tempExportRoot()
    expect(() =>
      writeConversationsToChatExport(exportRoot, { success: true, result: { hasMore: false } }),
    ).toThrow(/conversations/i)
    expect(existsSync(join(exportRoot, "chat", "scopes.jsonl"))).toBe(false)
  })
})
