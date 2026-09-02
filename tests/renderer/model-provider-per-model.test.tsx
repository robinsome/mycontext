/**
 * @vitest-environment jsdom
 *
 * 桌面端已移除 Anthropic 协议选择 —— 探测后不再出现协议 chip，也不再按模型自动切 anthropic。
 */
import { afterEach, describe, expect, it } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { I18nextProvider } from "react-i18next"
import { createI18n } from "@mycontext/i18n"
import type { MyContextApi } from "@mycontext/ipc-contract"
import { ModelConfigForm } from "@renderer/features/settings/model-config-form"

class NoopResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
;(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= NoopResizeObserver

afterEach(cleanup)

const ok = <T,>(data: T) => Promise.resolve({ ok: true as const, data })

function installApi(): void {
  const api = {
    runtimeConfig: {
      read: () =>
        ok({
          llmBaseUrl: { value: "https://gw.example.com/v1", source: "user" as const },
          llmApiKey: { configured: true, tail: "1234", source: "user" as const },
          modelMain: { value: "claude-x", source: "user" as const },
          mainProvider: { value: "openai" as const, source: "default" as const },
          embedModel: { value: "text-embedding-v4", source: "default" as const },
          embedLlmBaseUrl: { value: "", source: "default" as const },
          embedLlmApiKey: { configured: false, tail: null, source: "default" as const },
          embeddingDim: { value: "2048", source: "default" as const },
          embedSendDimensions: { value: true, source: "default" as const },
          klLlmBaseUrl: { value: "", source: "default" as const },
          klLlmApiKey: { configured: false, tail: null, source: "default" as const },
          klModelMain: { value: "", source: "default" as const },
          klProvider: { value: "openai" as const, source: "default" as const },
          klEffective: {
            baseUrl: "",
            model: "claude-x",
            apiKeyConfigured: true,
            provider: "openai" as const,
          },
          embedEffective: {
            baseUrl: "https://gw.example.com/v1",
            model: "text-embedding-v4",
            apiKeyConfigured: true,
            embeddingDim: 2048,
            sendDimensions: true,
          },
        }),
      save: () => ok({ appliedNow: true, needsRestart: [] as ("agent" | "klServer")[] }),
      probe: () =>
        ok({
          ok: true,
          reason: null,
          provider: "openai" as const,
          providers: ["openai" as const],
          modelProviders: {
            "claude-x": ["openai"],
            "qwen-x": ["openai"],
          } as Record<string, ("openai" | "anthropic")[]>,
          detail: null,
          models: ["claude-x", "qwen-x"],
        }),
      onChanged: () => () => undefined,
    },
  }
  ;(globalThis as { window?: { mycontext?: unknown } }).window ??= {}
  ;(window as unknown as { mycontext: unknown }).mycontext = api as unknown as MyContextApi
}

function renderForm() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <I18nextProvider i18n={createI18n("zh")}>
      <QueryClientProvider client={client}>
        <ModelConfigForm />
      </QueryClientProvider>
    </I18nextProvider>,
  )
}

describe("模型表单不再暴露 Anthropic 协议", () => {
  it("探测成功后无 Anthropic / OpenAI 协议 chip", async () => {
    installApi()
    renderForm()
    const probeButtons = await screen.findAllByText("测试连接")
    fireEvent.click(probeButtons[0]!)
    await waitFor(() => expect(screen.queryByText(/来自网关/)).not.toBeNull())
    expect(screen.queryByRole("button", { name: "Anthropic" })).toBeNull()
    expect(screen.queryByRole("button", { name: "OpenAI 兼容" })).toBeNull()
    expect(screen.getByRole("button", { name: "claude-x" })).not.toBeNull()
  })
})
