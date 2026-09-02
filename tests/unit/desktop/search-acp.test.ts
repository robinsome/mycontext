/**
 * SearchService 网关主路：注入假 LlmClient，不打真网。
 */
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { ManualClock, createLogger } from "@mycontext/kernel"
import { openStore, VAULT_MIGRATIONS, type StoreHandle } from "@mycontext/store"
import type { ProcessRunner, RuntimeEnv } from "@mycontext/runtime-env"
import { LlmClient, staticLlmProvider } from "@mycontext/llm"
import { SearchService } from "@main/services/search.service.js"

const dirs: string[] = []
const NOW = 1_785_000_000_000

afterEach(() => {
  while (dirs.length > 0) {
    const dir = dirs.pop()
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true })
  }
})

function openVaultDb(): StoreHandle {
  const dir = mkdtempSync(join(tmpdir(), "mycontext-search-"))
  dirs.push(dir)
  return openStore({ path: join(dir, "vault.sqlite"), migrations: VAULT_MIGRATIONS })
}

function makeService(options: { hasGateway: boolean; answer?: string }) {
  const handle = openVaultDb()
  const streamed: { degradedReason: string | null; done: boolean }[] = []
  const fakeWindow = {
    isDestroyed: () => false,
    webContents: {
      send: (_channel: string, payload: { degradedReason: string | null; done: boolean }) => {
        streamed.push({ degradedReason: payload.degradedReason, done: payload.done })
      },
    },
  } as unknown as ReturnType<ConstructorParameters<typeof SearchService>[0]["getWindow"]>

  const workspaceRoot = mkdtempSync(join(tmpdir(), "mycontext-ws-"))
  dirs.push(workspaceRoot)

  const llm =
    options.hasGateway === false
      ? staticLlmProvider(null)
      : staticLlmProvider(
          new LlmClient({
            baseUrl: "https://llm.test.example/v1",
            apiKey: "sk-gw",
            model: "m",
            fetchImpl: async () =>
              new Response(
                JSON.stringify({
                  choices: [{ message: { content: options.answer ?? "网关答案" } }],
                }),
                { status: 200, headers: { "content-type": "application/json" } },
              ),
          }),
        )

  const service = new SearchService({
    clock: new ManualClock(NOW),
    logger: createLogger("test", { level: "error" }),
    runtime: {} as RuntimeEnv,
    processes: {} as ProcessRunner,
    klRoot: "/fake/kl-graph",
    klPort: 8200,
    primaryChannelId: "dingtalk",
    getWindow: () => fakeWindow,
    llmProvider: llm,
  })
  service.attach(handle.db, {
    workspaceRoot,
    home: join(workspaceRoot, "agent-home"),
    npmCache: join(workspaceRoot, "npm-cache"),
  })
  return {
    service,
    handle,
    streamed,
    lastDegradedReason: () => streamed.filter((s) => s.done).at(-1)?.degradedReason ?? null,
    close: () => handle.close(),
  }
}

describe("SearchService · 网关主路", () => {
  it("有网关 → 归纳答案，degradedReason 为空", async () => {
    const ctx = makeService({ hasGateway: true })
    const session = ctx.service.create("问题")
    await ctx.service.prompt(session.id, "查一下")

    const detail = ctx.service.detail(session.id)
    expect(ctx.service.agentAvailable()).toBe(true)
    expect(detail.session.state).toBe("idle")
    expect(ctx.lastDegradedReason()).toBeNull()
    const assistant = detail.items.find((i) => i.role === "assistant" && i.itemType === "message")
    expect(assistant).toBeDefined()
    const text = JSON.parse(assistant!.contentJson)
      .map((b: { kind: string; text?: string }) => (b.kind === "text" ? b.text : ""))
      .join("")
    expect(text).toBe("网关答案")
    ctx.close()
  })

  it("无网关 → recallOnly，degraded 可见", async () => {
    const ctx = makeService({ hasGateway: false })
    const session = ctx.service.create("问题")
    await ctx.service.prompt(session.id, "查一下")
    expect(ctx.service.agentAvailable()).toBe(false)
    expect(ctx.lastDegradedReason()).toMatch(/模型网关|本地召回/)
    const items = ctx.service.detail(session.id).items
    expect(items.some((i) => i.toolName === "mycontext_local_recall")).toBe(true)
    ctx.close()
  })
})
