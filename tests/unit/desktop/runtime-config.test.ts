/**
 * RuntimeConfigService —— 模型网关的单一真源。
 *
 * 锁住的性质：
 * 1. 三层解析：用户存的覆盖 > kernel loadConfig 默认层；
 * 2. KL / 向量三项留空回退主配置（`klEffective` / `embedEffective` 给出实际生效值）；
 * 3. 脱敏：apiKey 只给 configured + 后 4 位，明文不出现在视图里；
 * 4. save 后 process.env 被 seed（含 ANTHROPIC_* 别名）；
 * 5. apiKey 三态：undefined 不改、null/"" 清空、字符串写入；
 * 6. 坏数据回退默认层而不抛；
 * 7. adopt 旧的隐藏高级面板配置。
 */
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { createLogger, loadConfig, type LoadedConfig } from "@mycontext/kernel"
import { openStore, SettingsRepository } from "@mycontext/store"
import { RuntimeConfigService } from "@main/services/runtime-config.service.js"

const dirs: string[] = []
const NOW = "2026-08-02T00:00:00.000Z"

afterEach(() => {
  while (dirs.length > 0) {
    const dir = dirs.pop()
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true })
  }
})

function memorySecretStore() {
  const store = new Map<string, string>()
  return {
    store,
    read: (key: string) => {
      const v = store.get(key)
      return v === undefined || v === "" ? null : v
    },
    write: (key: string, value: string) => void store.set(key, value),
  }
}

function makeService(defaults?: LoadedConfig, env?: NodeJS.ProcessEnv, fetchImpl?: typeof fetch) {
  const dir = mkdtempSync(join(tmpdir(), "mycontext-rc-"))
  dirs.push(dir)
  const handle = openStore({ path: join(dir, "control.sqlite") })
  const secrets = memorySecretStore()
  const settings = new SettingsRepository(handle.db)
  const service = new RuntimeConfigService({
    settings,
    logger: createLogger("test", { level: "error" }),
    secretStore: secrets,
    defaults: defaults ?? loadConfig(),
    env: env ?? {},
    ...(fetchImpl === undefined ? {} : { fetchImpl }),
  })
  return { service, secrets, settings, close: () => handle.close() }
}

/** 造一个假网关响应。 */
function fakeFetch(
  handler: (url: string, init?: RequestInit) => { status: number; body: unknown } | Error,
): { impl: typeof fetch; urls: string[] } {
  const urls: string[] = []
  const impl = ((url: string, init?: RequestInit) => {
    urls.push(String(url))
    const result = handler(String(url), init)
    if (result instanceof Error) return Promise.reject(result)
    return Promise.resolve({
      ok: result.status >= 200 && result.status < 300,
      status: result.status,
      json: () => Promise.resolve(result.body),
      text: () =>
        Promise.resolve(
          typeof result.body === "string" ? result.body : JSON.stringify(result.body),
        ),
    } as unknown as Response)
  }) as unknown as typeof fetch
  return { impl, urls }
}

describe("三层解析", () => {
  it("无覆盖时走 kernel 默认层", () => {
    const ctx = makeService()
    const r = ctx.service.resolved()
    // 默认层：modelMain 默认 glm-5.2，embed text-embedding-v4
    expect(r.modelMain).toBe("glm-5.2")
    expect(r.embedModel).toBe("text-embedding-v4")
    ctx.close()
  })

  it("用户存的覆盖默认层", () => {
    const ctx = makeService()
    ctx.service.save({ modelMain: "claude-opus-4-8", llmBaseUrl: "https://custom" }, NOW)
    const r = ctx.service.resolved()
    expect(r.modelMain).toBe("claude-opus-4-8")
    expect(r.llmBaseUrl).toBe("https://custom")
    ctx.close()
  })

  it("默认层来自 loadConfig 的 env（真实环境变量优先）", () => {
    const defaults = loadConfig({ env: { MYCONTEXT_MODEL_MAIN: "qwen3.7-max" } })
    const ctx = makeService(defaults)
    expect(ctx.service.resolved().modelMain).toBe("qwen3.7-max")
    // view 里 source 标为 env
    expect(ctx.service.view().modelMain.source).toBe("env")
    ctx.close()
  })
})

describe("KL 三项回退主配置", () => {
  it("KL 全空时 klEffective 用主配置", () => {
    const ctx = makeService()
    ctx.service.save(
      { llmBaseUrl: "https://main", modelMain: "glm-5.2", llmApiKey: "sk-main1234" },
      NOW,
    )
    const r = ctx.service.resolved()
    expect(r.klBaseUrl).toBe("https://main")
    expect(r.klModel).toBe("glm-5.2")
    expect(r.klApiKey).toBe("sk-main1234")
    ctx.close()
  })

  it("KL 单独指定时不回退", () => {
    const ctx = makeService()
    ctx.service.save(
      {
        llmBaseUrl: "https://main",
        modelMain: "glm-5.2",
        klModelMain: "claude-sonnet-4-6",
        klLlmApiKey: "sk-kl9999",
      },
      NOW,
    )
    const r = ctx.service.resolved()
    expect(r.klModel).toBe("claude-sonnet-4-6")
    expect(r.klApiKey).toBe("sk-kl9999")
    // base 没单独填 → 回退主配置
    expect(r.klBaseUrl).toBe("https://main")
    const v = ctx.service.view()
    expect(v.klEffective.model).toBe("claude-sonnet-4-6")
    expect(v.klEffective.apiKeyConfigured).toBe(true)
    ctx.close()
  })
})

describe("向量配置回退主配置", () => {
  it("向量全空时 embedEffective 用主配置", () => {
    const ctx = makeService()
    ctx.service.save(
      { llmBaseUrl: "https://main", modelMain: "glm-5.2", llmApiKey: "sk-main1234" },
      NOW,
    )
    const r = ctx.service.resolved()
    expect(r.embedBaseUrl).toBe("https://main")
    expect(r.embedApiKey).toBe("sk-main1234")
    expect(r.embedModel).toBe("text-embedding-v4")
    expect(r.embeddingDim).toBe(2048)
    expect(r.embedSendDimensions).toBe(true)
    const v = ctx.service.view()
    expect(v.embedEffective.baseUrl).toBe("https://main")
    expect(v.embedEffective.apiKeyConfigured).toBe(true)
    ctx.close()
  })

  it("向量单独指定时不回退", () => {
    const ctx = makeService()
    ctx.service.save(
      {
        llmBaseUrl: "https://main",
        modelMain: "glm-5.2",
        embedLlmBaseUrl: "https://embed",
        embedLlmApiKey: "sk-embed9999",
        embedModel: "text-embedding-3-small",
        embeddingDim: 1536,
        embedSendDimensions: false,
      },
      NOW,
    )
    const r = ctx.service.resolved()
    expect(r.embedBaseUrl).toBe("https://embed")
    expect(r.embedApiKey).toBe("sk-embed9999")
    expect(r.embedModel).toBe("text-embedding-3-small")
    expect(r.embeddingDim).toBe(1536)
    expect(r.embedSendDimensions).toBe(false)
    const v = ctx.service.view()
    expect(v.embedEffective.model).toBe("text-embedding-3-small")
    expect(v.embedEffective.embeddingDim).toBe(1536)
    expect(v.embedEffective.sendDimensions).toBe(false)
    ctx.close()
  })
})

describe("脱敏", () => {
  it("apiKey 只给 configured + 后 4 位，明文不出现", () => {
    const ctx = makeService()
    ctx.service.save({ llmApiKey: "sk-super-secret-1234" }, NOW)
    const v = ctx.service.view()
    expect(v.llmApiKey.configured).toBe(true)
    expect(v.llmApiKey.tail).toBe("1234")
    expect(JSON.stringify(v)).not.toContain("sk-super-secret")
    ctx.close()
  })

  it("未配置 apiKey → configured false", () => {
    const ctx = makeService()
    expect(ctx.service.view().llmApiKey.configured).toBe(false)
    ctx.close()
  })
})

describe("seedProcessEnv", () => {
  it("save 后主网关写进 env 的 MYCONTEXT_* 与 ANTHROPIC_* 别名", () => {
    const env: NodeJS.ProcessEnv = {}
    const ctx = makeService(loadConfig(), env)
    ctx.service.save({ llmBaseUrl: "https://gw.example", llmApiKey: "sk-abc-7777" }, NOW)
    expect(env["MYCONTEXT_LLM_BASE_URL"]).toBe("https://gw.example")
    expect(env["MYCONTEXT_LLM_API_KEY"]).toBe("sk-abc-7777")
    // ANTHROPIC_* 别名（resolveGatewayModelConfig 优先级更高，必须一起 seed）
    expect(env["ANTHROPIC_BASE_URL"]).toBe("https://gw.example")
    expect(env["ANTHROPIC_AUTH_TOKEN"]).toBe("sk-abc-7777")
    ctx.close()
  })

  /**
   * ★★ 模型名也要 seed —— 否则 `.env` 里那一行是句谎话。
   *
   * opencode 子进程的模型配置（`resolveGatewayModelConfig`）从 env 读
   * `MYCONTEXT_MODEL_MAIN`，而 `bootstrap/config.ts` **刻意不写 process.env**
   * （见它的文件头）。少了这一行，dotenv 里的模型名就停在 `config.values` 里
   * 到不了子进程，于是子进程永远用写死的兜底默认值 —— 而"配了但不生效"
   * 是这个仓库里最难查的一类问题，因为每一层看起来都在正常工作。
   */
  it("★★ 模型名 seed 进 env（`.env` 里配的模型要真能到 agent 子进程）", () => {
    const env: NodeJS.ProcessEnv = {}
    const ctx = makeService(loadConfig(), env)
    ctx.service.save({ modelMain: "probe-model-9" }, NOW)
    expect(env["MYCONTEXT_MODEL_MAIN"]).toBe("probe-model-9")
    ctx.close()
  })

  it("★ 没存覆盖值时 seed 的是默认层（而不是空串）", () => {
    /**
     * 空串会被 `resolveModelName` 当成"没给"而回退到内置默认 —— 那时
     * 行为仍然对，但 env 里留一个空值会让排查的人以为"配过了"。
     */
    const env: NodeJS.ProcessEnv = {}
    const ctx = makeService(loadConfig(), env)
    ctx.service.seedProcessEnv()
    expect(env["MYCONTEXT_MODEL_MAIN"]).toBe("glm-5.2")
    ctx.close()
  })
})

describe("apiKey 三态", () => {
  it("undefined 不改，null 清空", () => {
    const ctx = makeService()
    ctx.service.save({ llmApiKey: "sk-original-8888" }, NOW)
    // 只改 baseUrl，apiKey undefined → 保留
    ctx.service.save({ llmBaseUrl: "https://y" }, NOW)
    expect(ctx.service.view().llmApiKey.tail).toBe("8888")
    // null 清空
    ctx.service.save({ llmApiKey: null }, NOW)
    expect(ctx.service.view().llmApiKey.configured).toBe(false)
    ctx.close()
  })
})

describe("坏数据回退", () => {
  it("库里存了坏 JSON → 走默认层不抛", () => {
    const ctx = makeService()
    ctx.settings.set("runtime_llm_config", "{not json", NOW)
    expect(() => ctx.service.resolved()).not.toThrow()
    expect(ctx.service.resolved().modelMain).toBe("glm-5.2")
    ctx.close()
  })
})

describe("adopt 旧高级面板配置", () => {
  it("首次运行搬入旧 baseUrl + apiKey", () => {
    const dir = mkdtempSync(join(tmpdir(), "mycontext-rc-adopt-"))
    dirs.push(dir)
    const handle = openStore({ path: join(dir, "control.sqlite") })
    const settings = new SettingsRepository(handle.db)
    const secrets = memorySecretStore()
    // 预置旧的高级面板配置
    settings.set(
      "advanced_ai_config",
      JSON.stringify({ baseUrl: "https://legacy", harness: {} }),
      NOW,
    )
    secrets.write("advanced_ai_api_key", "sk-legacy-5555")

    const service = new RuntimeConfigService({
      settings,
      logger: createLogger("test", { level: "error" }),
      secretStore: secrets,
      defaults: loadConfig(),
      env: {},
    })
    expect(service.resolved().llmBaseUrl).toBe("https://legacy")
    expect(service.view().llmApiKey.tail).toBe("5555")
    handle.close()
  })
})

/**
 * 网关探测。
 *
 * ★★ 这一组锁的是「把静默失效变成当场可见」这条性质。
 *
 * 模型名/密钥填错在生产上的表现是**几小时后**蒸馏或建图里的
 * `model_not_found` / 401 —— 日志一行、界面无声，而那正是本项目
 * 最怕的失效形态。探测把它提前到用户点按钮那一刻。
 *
 * 所以失败必须**分类**（reason），不是丢一段英文报文：
 * 「key 不对」与「地址连不上」要给的下一步动作完全不同。
 */
describe("网关探测", () => {
  it("成功 → 返回排序后的模型列表", async () => {
    const { impl, urls } = fakeFetch(() => ({
      status: 200,
      body: { data: [{ id: "qwen3.7-plus" }, { id: "glm-5.2" }, { id: "claude-opus-4-8" }] },
    }))
    const ctx = makeService(loadConfig(), {}, impl)
    ctx.service.save({ llmBaseUrl: "https://gw.example", llmApiKey: "sk-ok-1234" }, NOW)
    const result = await ctx.service.probe({})
    expect(result.ok).toBe(true)
    // 排序过：列表要稳定，否则每次探测 chips 顺序都在跳
    expect(result.models).toEqual(["claude-opus-4-8", "glm-5.2", "qwen3.7-plus"])
    expect(urls[0]).toBe("https://gw.example/v1/models")
    ctx.close()
  })

  it("base 带不带 /v1 都规范化到同一个 URL（不让用户去记）", async () => {
    const { impl, urls } = fakeFetch(() => ({ status: 200, body: { data: [] } }))
    const ctx = makeService(loadConfig(), {}, impl)
    await ctx.service.probe({ baseUrl: "https://gw.example/v1/", apiKey: "sk-x" })
    await ctx.service.probe({ baseUrl: "https://gw.example", apiKey: "sk-x" })
    expect(urls).toEqual(["https://gw.example/v1/models", "https://gw.example/v1/models"])
    ctx.close()
  })

  it("401 → unauthorized（不是笼统的失败）", async () => {
    const { impl } = fakeFetch(() => ({
      status: 401,
      body: { error: { message: "Invalid token" } },
    }))
    const ctx = makeService(loadConfig(), {}, impl)
    const result = await ctx.service.probe({ baseUrl: "https://gw.example", apiKey: "sk-bad" })
    expect(result.ok).toBe(false)
    expect(result.reason).toBe("unauthorized")
    expect(result.detail).toContain("Invalid token")
    ctx.close()
  })

  it("连不上 → unreachable", async () => {
    const { impl } = fakeFetch(() => new Error("getaddrinfo ENOTFOUND nope.invalid"))
    const ctx = makeService(loadConfig(), {}, impl)
    const result = await ctx.service.probe({ baseUrl: "https://nope.invalid", apiKey: "sk-x" })
    expect(result.reason).toBe("unreachable")
    ctx.close()
  })

  /**
   * ★ URL 填成了控制台首页这类情况：200 但返回 HTML。
   * 报 badResponse 而不是「成功但 0 个模型」—— 后者会让用户以为
   * 网关没模型可用，于是去查网关，而真因是自己 URL 填错了。
   */
  it("200 但不是 OpenAI 兼容形状 → badResponse", async () => {
    const { impl } = fakeFetch(() => ({ status: 200, body: "<html>console</html>" }))
    const ctx = makeService(loadConfig(), {}, impl)
    const result = await ctx.service.probe({ baseUrl: "https://gw.example", apiKey: "sk-x" })
    expect(result.ok).toBe(false)
    expect(result.reason).toBe("badResponse")
    ctx.close()
  })

  it("没填 key → noKey，且**不打网络**", async () => {
    const { impl, urls } = fakeFetch(() => ({ status: 200, body: { data: [] } }))
    const ctx = makeService(loadConfig(), {}, impl)
    const result = await ctx.service.probe({ baseUrl: "https://gw.example" })
    expect(result.reason).toBe("noKey")
    expect(urls).toEqual([])
    ctx.close()
  })

  /** 「不改 key、只测地址」要能表达 —— apiKey 省略时回退已存的那把。 */
  it("省略 apiKey 时用已存的 key", async () => {
    let seenAuth = ""
    const { impl } = fakeFetch((_url, init) => {
      seenAuth = String((init?.headers as Record<string, string> | undefined)?.["Authorization"])
      return { status: 200, body: { data: [{ id: "glm-5.2" }] } }
    })
    const ctx = makeService(loadConfig(), {}, impl)
    ctx.service.save({ llmApiKey: "sk-stored-9999" }, NOW)
    await ctx.service.probe({ baseUrl: "https://gw.example" })
    expect(seenAuth).toBe("Bearer sk-stored-9999")
    ctx.close()
  })

  /** 向量区独立测：forEmbed 让缺省 key 走已存向量密钥（空则回退主密钥）。 */
  it("forEmbed 省略 apiKey 时用已存的向量 key", async () => {
    let seenAuth = ""
    const { impl, urls } = fakeFetch((_url, init) => {
      seenAuth = String((init?.headers as Record<string, string> | undefined)?.["Authorization"])
      return { status: 200, body: { data: [{ id: "text-embedding-v4" }] } }
    })
    const ctx = makeService(loadConfig(), {}, impl)
    ctx.service.save(
      {
        llmApiKey: "sk-main-aaaa",
        llmBaseUrl: "https://main.example",
        embedLlmApiKey: "sk-embed-bbbb",
        embedLlmBaseUrl: "https://embed.example",
      },
      NOW,
    )
    await ctx.service.probe({ forEmbed: true })
    expect(seenAuth).toBe("Bearer sk-embed-bbbb")
    expect(urls[0]).toContain("embed.example")
    ctx.close()
  })

  /** 知识库区「测试连接」：forKl 缺省时用 KL 密钥。 */
  it("forKl 省略 apiKey 时用已存的知识库 key", async () => {
    let seenAuth = ""
    const { impl, urls } = fakeFetch((_url, init) => {
      seenAuth = String((init?.headers as Record<string, string> | undefined)?.["Authorization"])
      return { status: 200, body: { data: [{ id: "glm-5.2" }] } }
    })
    const ctx = makeService(loadConfig(), {}, impl)
    ctx.service.save(
      {
        llmApiKey: "sk-main-aaaa",
        llmBaseUrl: "https://main.example",
        klLlmApiKey: "sk-kl-cccc",
        klLlmBaseUrl: "https://kl.example",
      },
      NOW,
    )
    await ctx.service.probe({ forKl: true })
    expect(seenAuth).toBe("Bearer sk-kl-cccc")
    expect(urls[0]).toContain("kl.example")
    ctx.close()
  })

  it("OpenAI 形状 → provider openai", async () => {
    const { impl } = fakeFetch(() => ({
      status: 200,
      body: { data: [{ id: "glm-5.2", object: "model", owned_by: "system" }] },
    }))
    const ctx = makeService(loadConfig(), {}, impl)
    const result = await ctx.service.probe({ baseUrl: "https://gw.example", apiKey: "sk-x" })
    expect(result.ok).toBe(true)
    expect(result.provider).toBe("openai")
    // 没给 supported_endpoint_types 的老网关：回退到连通的那个协议（openai）
    expect(result.providers).toEqual(["openai"])
    ctx.close()
  })

  /**
   * 桌面端只走 OpenAI 兼容：即便网关标了 anthropic，探测结果也只报 openai。
   */
  it("探测结果固定 openai（忽略 supported_endpoint_types 里的 anthropic）", async () => {
    const { impl } = fakeFetch(() => ({
      status: 200,
      body: {
        data: [
          {
            id: "claude-opus-4-8",
            object: "model",
            supported_endpoint_types: ["anthropic", "openai"],
          },
          { id: "qwen-plus", object: "model", supported_endpoint_types: ["openai"] },
        ],
      },
    }))
    const ctx = makeService(loadConfig(), {}, impl)
    const result = await ctx.service.probe({ baseUrl: "https://gw.example", apiKey: "sk-x" })
    expect(result.ok).toBe(true)
    expect(result.providers).toEqual(["openai"])
    expect(result.provider).toBe("openai")
    expect(result.modelProviders["claude-opus-4-8"]).toEqual(["openai"])
    expect(result.modelProviders["qwen-plus"]).toEqual(["openai"])
    ctx.close()
  })

  /**
   * Anthropic 专用口（Bearer 404）不再重试 —— 桌面端已移除 Anthropic 接口。
   */
  it("Bearer 404 不再换 x-api-key 重试", async () => {
    const { impl, urls } = fakeFetch(() => ({ status: 404, body: "not found" }))
    const ctx = makeService(loadConfig(), {}, impl)
    const result = await ctx.service.probe({ baseUrl: "https://anthropic.example", apiKey: "sk-a" })
    expect(result.ok).toBe(false)
    expect(result.reason).toBe("badResponse")
    expect(urls.length).toBe(1)
    ctx.close()
  })

  it("401 归 unauthorized（只打一次）", async () => {
    const { impl, urls } = fakeFetch(() => ({ status: 401, body: { error: "bad key" } }))
    const ctx = makeService(loadConfig(), {}, impl)
    const result = await ctx.service.probe({ baseUrl: "https://gw.example", apiKey: "sk-bad" })
    expect(result.reason).toBe("unauthorized")
    expect(urls.length).toBe(1)
    ctx.close()
  })
})

/**
 * 协议固定 openai（桌面端已移除 Anthropic 接口）。
 */
describe("KL / 主模型协议固定 openai", () => {
  it("默认 openai", () => {
    const ctx = makeService()
    expect(ctx.service.resolved().klProvider).toBe("openai")
    expect(ctx.service.resolved().mainProvider).toBe("openai")
    expect(ctx.service.view().klProvider.value).toBe("openai")
    expect(ctx.service.view().mainProvider.value).toBe("openai")
    expect(ctx.service.view().klProvider.source).toBe("default")
    expect(ctx.service.view().mainProvider.source).toBe("default")
    ctx.close()
  })

  it("save anthropic 仍解析为 openai", () => {
    const ctx = makeService()
    ctx.service.save({ klProvider: "anthropic", mainProvider: "anthropic" }, NOW)
    expect(ctx.service.resolved().klProvider).toBe("openai")
    expect(ctx.service.resolved().mainProvider).toBe("openai")
    expect(ctx.service.view().klEffective.provider).toBe("openai")
    ctx.close()
  })

  it("env MYCONTEXT_*_PROVIDER=anthropic 也强制 openai", () => {
    const defaults = loadConfig({
      env: {
        MYCONTEXT_KL_PROVIDER: "anthropic",
        MYCONTEXT_MODEL_PROVIDER: "anthropic",
      },
    })
    const ctx = makeService(defaults)
    expect(ctx.service.resolved().klProvider).toBe("openai")
    expect(ctx.service.resolved().mainProvider).toBe("openai")
    ctx.close()
  })

  it("seed 进 env 的 MYCONTEXT_MODEL_PROVIDER 恒为 openai", () => {
    const env: NodeJS.ProcessEnv = {}
    const ctx = makeService(loadConfig(), env)
    ctx.service.save({ mainProvider: "anthropic" }, NOW)
    expect(env["MYCONTEXT_MODEL_PROVIDER"]).toBe("openai")
    ctx.close()
  })

  it("历史存盘 anthropic 启动时迁移为 openai", () => {
    const dir = mkdtempSync(join(tmpdir(), "mycontext-rc-"))
    dirs.push(dir)
    const handle = openStore({ path: join(dir, "control.sqlite") })
    const settings = new SettingsRepository(handle.db)
    settings.set(
      "runtime_llm_config",
      JSON.stringify({ mainProvider: "anthropic", klProvider: "anthropic" }),
      NOW,
    )
    const service = new RuntimeConfigService({
      settings,
      logger: createLogger("test", { level: "error" }),
      secretStore: memorySecretStore(),
      defaults: loadConfig(),
      env: {},
    })
    expect(service.resolved().mainProvider).toBe("openai")
    expect(service.resolved().klProvider).toBe("openai")
    const stored = JSON.parse(settings.get("runtime_llm_config") ?? "{}") as {
      mainProvider?: string
      klProvider?: string
    }
    expect(stored.mainProvider).toBe("openai")
    expect(stored.klProvider).toBe("openai")
    handle.close()
  })
})

/**
 * Agent 运行时凭据（`cursorApiKey`）与落点（`cursorRuntime`）。
 *
 * 锁住：secret 脱敏、三态、CURSOR_API_KEY 双读、seed 双写、默认 local。
 */
describe("Agent 运行时配置", () => {
  it("默认 cursorRuntime=local，apiKey 未配置", () => {
    const ctx = makeService()
    expect(ctx.service.resolved().cursorRuntime).toBe("local")
    expect(ctx.service.resolved().cursorApiKey).toBe("")
    const v = ctx.service.view()
    expect(v.cursorRuntime.value).toBe("local")
    expect(v.cursorRuntime.source).toBe("default")
    expect(v.cursorApiKey.configured).toBe(false)
    ctx.close()
  })

  it("save 覆盖 runtime 为 cloud + 脱敏 key", () => {
    const ctx = makeService()
    ctx.service.save({ cursorRuntime: "cloud", cursorApiKey: "sk-cursor-4242" }, NOW)
    expect(ctx.service.resolved().cursorRuntime).toBe("cloud")
    expect(ctx.service.resolved().cursorApiKey).toBe("sk-cursor-4242")
    const v = ctx.service.view()
    expect(v.cursorRuntime.value).toBe("cloud")
    expect(v.cursorRuntime.source).toBe("user")
    expect(v.cursorApiKey.configured).toBe(true)
    expect(v.cursorApiKey.tail).toBe("4242")
    expect(JSON.stringify(v)).not.toContain("sk-cursor")
    ctx.close()
  })

  it("apiKey 三态：undefined 不改，null 清空", () => {
    const ctx = makeService()
    ctx.service.save({ cursorApiKey: "sk-keep-1111" }, NOW)
    ctx.service.save({ cursorRuntime: "cloud" }, NOW)
    expect(ctx.service.view().cursorApiKey.tail).toBe("1111")
    ctx.service.save({ cursorApiKey: null }, NOW)
    expect(ctx.service.view().cursorApiKey.configured).toBe(false)
    ctx.close()
  })

  it("★ seed 双写 CURSOR_API_KEY + MYCONTEXT_CURSOR_API_KEY，并写 RUNTIME", () => {
    const env: NodeJS.ProcessEnv = {}
    const ctx = makeService(loadConfig(), env)
    ctx.service.save({ cursorApiKey: "sk-seed-9999", cursorRuntime: "cloud" }, NOW)
    expect(env["CURSOR_API_KEY"]).toBe("sk-seed-9999")
    expect(env["MYCONTEXT_CURSOR_API_KEY"]).toBe("sk-seed-9999")
    expect(env["MYCONTEXT_CURSOR_RUNTIME"]).toBe("cloud")
    ctx.close()
  })

  it("★ 清空 key 后 seed 会 delete 双名（不留空串透传）", () => {
    const env: NodeJS.ProcessEnv = {
      CURSOR_API_KEY: "stale",
      MYCONTEXT_CURSOR_API_KEY: "stale",
    }
    const ctx = makeService(loadConfig(), env)
    ctx.service.save({ cursorApiKey: "sk-tmp-0000" }, NOW)
    ctx.service.save({ cursorApiKey: null }, NOW)
    expect(env["CURSOR_API_KEY"]).toBeUndefined()
    expect(env["MYCONTEXT_CURSOR_API_KEY"]).toBeUndefined()
    ctx.close()
  })

  it("★ 双读：loadConfig 认 CURSOR_API_KEY（与 MYCONTEXT_* 同义）", () => {
    const defaults = loadConfig({ env: { CURSOR_API_KEY: "sk-from-alt-7777" } })
    const ctx = makeService(defaults)
    expect(ctx.service.resolved().cursorApiKey).toBe("sk-from-alt-7777")
    expect(ctx.service.view().cursorApiKey.configured).toBe(true)
    expect(ctx.service.view().cursorApiKey.source).toBe("env")
    ctx.close()
  })

  it("env 层可覆盖 runtime（MYCONTEXT_CURSOR_RUNTIME）", () => {
    const defaults = loadConfig({ env: { MYCONTEXT_CURSOR_RUNTIME: "cloud" } })
    const ctx = makeService(defaults)
    expect(ctx.service.resolved().cursorRuntime).toBe("cloud")
    expect(ctx.service.view().cursorRuntime.source).toBe("env")
    ctx.close()
  })
})
