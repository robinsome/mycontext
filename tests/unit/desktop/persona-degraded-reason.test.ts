/**
 * 降级横幅说的是**真实原因**（LLM 未配置），不是误导性代称。
 */
import { describe, expect, it } from "vitest"
import { ManualClock, createLogger } from "@mycontext/kernel"
import { LlmClient, staticLlmProvider } from "@mycontext/llm"
import type { ProcessRunner, RuntimeEnv } from "@mycontext/runtime-env"
import { PersonaService } from "../../../apps/desktop/src/main/services/persona.service.js"
import { explainDegradedReason } from "../../../apps/desktop/src/renderer/features/persona/decision-reason.js"

const NOW = 1_785_000_000_000
const logger = createLogger("test", { level: "error" })

function workingLlm(): LlmClient {
  return new LlmClient({
    baseUrl: "https://example.invalid",
    apiKey: "k",
    model: "m",
    fetchImpl: async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: "好" } }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
  })
}

function makeService(options: { llm: LlmClient | null }) {
  return new PersonaService({
    clock: new ManualClock(NOW),
    logger,
    llmProvider: staticLlmProvider(options.llm),
    getWindow: () => null,
    runtime: {} as RuntimeEnv,
    processes: {} as ProcessRunner,
  })
}

describe("★ snapshot 报的是真实降级原因", () => {
  it("模型没配 → llm_not_configured", () => {
    const service = makeService({ llm: null })
    expect(service.degradedReason()).toBe("llm_not_configured")
  })

  it("模型配好 → null（横幅不显示）", () => {
    const service = makeService({ llm: workingLlm() })
    expect(service.degradedReason()).toBeNull()
  })

  it("snapshot 把它带出去", () => {
    const service = makeService({ llm: null })
    const snapshot = service.snapshot()
    expect(snapshot.agentAvailable).toBe(false)
    expect(snapshot.degradedReason).toBe("llm_not_configured")
  })
})

describe("★ 文案映射", () => {
  const t = (key: string): string => key

  it("llm_not_configured → llmNotConfigured", () => {
    expect(explainDegradedReason("llm_not_configured", t)).toBe("degradedReasons.llmNotConfigured")
  })
})
