/**
 * 过渡 push TS 入口：fixture / 目录打包 / from-dws 物化（假 ID）。
 */
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { WebServer } from "../../../apps/web-server/src/index.js"
import {
  buildChatPayloadFromDws,
  buildFixturePayload,
  buildPayloadFromExportDir,
  postChannelSync,
  runPushDwsExport,
} from "../../../scripts/sync/push-dws-export-entry.ts"

const TOKEN = "sync-token-tsx-e2e"
const servers: WebServer[] = []
const dirs: string[] = []

afterEach(async () => {
  while (servers.length > 0) await servers.pop()?.stop()
  while (dirs.length > 0) {
    const dir = dirs.pop()
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true })
  }
})

describe("push-dws-export-entry", () => {
  it("buildFixturePayload 通过 channel-sync schema", () => {
    const payload = buildFixturePayload()
    expect(payload.manifest.vaultId).toBe("vault-fake-001")
    expect(payload.files["chat/scopes.jsonl"]).toContain("cidFAKE0001==")
  })

  it("buildPayloadFromExportDir 打包四件套", () => {
    const root = mkdtempSync(join(tmpdir(), "mycontext-export-pack-"))
    dirs.push(root)
    const chat = join(root, "chat")
    mkdirSync(chat)
    const exportedAt = 1_785_000_000_100
    writeFileSync(
      join(chat, "manifest.json"),
      JSON.stringify({
        source: "mycontext",
        dataset: "chat",
        scope_types: ["chat"],
        record_types: ["message"],
        resource_kinds: [],
        counts: { scopes: 0, records: 0, resources: 0 },
        exported_at: exportedAt,
      }),
      "utf8",
    )
    writeFileSync(join(chat, "scopes.jsonl"), "", "utf8")
    writeFileSync(join(chat, "records.jsonl"), "", "utf8")
    writeFileSync(join(chat, "resources.jsonl"), "", "utf8")

    const payload = buildPayloadFromExportDir(root, "vault-fake-002")
    expect(payload.manifest.vaultId).toBe("vault-fake-002")
    expect(payload.manifest.exportedAt).toBe(exportedAt)
    expect(payload.manifest.sources).toEqual(["chat"])
  })

  it("buildChatPayloadFromDws 用假会话写出 scopes", () => {
    const payload = buildChatPayloadFromDws({
      vaultId: "vault-fake-003",
      truncated: false,
      conversations: [
        {
          externalId: "cidFAKE0002==",
          title: "示例单聊",
          kind: "direct",
          memberCount: 2,
          lastMessageAt: 1_785_000_000_000,
        },
      ],
      messages: [
        {
          externalId: "msgFAKE0001==",
          conversationExternalId: "cidFAKE0002==",
          senderExternalId: "DFAKE0001",
          senderDisplayName: "Alice",
          contentText: "hello",
          contentJson: null,
          quotedExternalId: null,
          sentAt: 1_785_000_000_000,
          mentions: [],
          hasMedia: false,
        },
      ],
    })
    expect(payload.files["chat/scopes.jsonl"]).toContain("chat:cidFAKE0002==")
    expect(payload.files["chat/records.jsonl"]).toContain("msgFAKE0001==")
    expect(payload.files["chat/records.jsonl"]).toContain("+08:00")
  })

  it("runPushDwsExport --fixture → HTTP 200 落盘", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "mycontext-sync-tsx-"))
    dirs.push(dataDir)
    const server = new WebServer({ dataDir, syncToken: TOKEN, host: "127.0.0.1" })
    servers.push(server)
    const port = await server.start()

    await runPushDwsExport({
      mode: "fixture",
      syncUrl: `http://127.0.0.1:${port}/api/v1/channel-sync`,
      syncToken: TOKEN,
      log: () => undefined,
    })

    expect(
      existsSync(join(dataDir, "vaults", "vault-fake-001", "exports", "dws", "chat", "manifest.json")),
    ).toBe(true)
  })

  it("postChannelSync 401", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "mycontext-sync-tsx-401-"))
    dirs.push(dataDir)
    const server = new WebServer({ dataDir, syncToken: TOKEN, host: "127.0.0.1" })
    servers.push(server)
    const port = await server.start()
    const { httpCode } = await postChannelSync(
      `http://127.0.0.1:${port}/api/v1/channel-sync`,
      "wrong",
      buildFixturePayload(),
    )
    expect(httpCode).toBe(401)
  })
})
