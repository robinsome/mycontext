/**
 * 模型网关配置表单 —— 设置面板与 onboarding 第 2 步**共用**同一个组件。
 *
 * ## 为什么共用
 *
 * 两处改的是同一份配置（`RuntimeConfigService` 单一真源）。抄两份表单
 * 会在某天分叉：一处加了 KL 折叠区、另一处没有，而用户在两处看到的
 * 「同一个设置」长得不一样。共用组件从源头上避免这件事。
 *
 * ## ★★ 核心：一次「测试连接」同时解决三件事
 *
 * 首版这里是三个裸输入框 + 五六行说明小字，而它有一个**不说明就看不见**
 * 的问题：填错了不会当场报错 —— 模型名写错在几小时后的蒸馏/建图里表现为
 * `model_not_found`，密钥写错表现为 401，两者在界面上都**完全无声**。
 * 那正是本项目最怕的失效形态。
 *
 * `GET /v1/models` 一次请求同时给出：
 * ① 地址通不通、② 密钥对不对、③ **有哪些模型可选**。
 * 于是：
 * · 「配置正确吗」从"等几小时看有没有结论"变成"现在就有绿灯"；
 * · 模型名从**猜着填的输入框**变成**从列表里挑**（对齐本项目已有的
 *   `PersonaRuntimePanel` —— 那里的注释写着"给档位就是给建议"）。
 *
 * 探测前有内置推荐档位兜底，所以"还没测"时也不是空白。
 *
 * ## 用交互承载信息，而不是堆说明文字
 *
 * · 「配没配 key」→ `Tag`（状态圆点）。一个绿点比一句话快，且不占整行；
 * · 「地址/密钥对不对」→ 探测结果那一行（有颜色、有下一步动作）；
 * · 「有哪些模型」→ chips（选中态自解释，不需要"如 glm-5.2"这种提示）；
 * · 主模型、向量、知识库**各有**接口地址 / Key / 测试连接 —— 留空才回退主配置，
 *   绝不再暗示「去上方地址填 embedding」；
 * · 「KL / 向量留空回退主配置」→ 各区 placeholder **就是**会回退到的那个值；
 *
 * ## 保存按钮的 dirty 态
 *
 * 没改任何东西时按钮 disabled。首版无论改没改都能点，点完还显示「已保存」
 * —— 那是**假反馈**：它让用户以为自己的某个改动生效了，而实际上什么都没提交。
 *
 * ## apiKey 的三态
 *
 * UI 不回显完整 key（Tag 只给后 4 位）。输入框空串 = **不改**（保留旧值），
 * 不是清空 —— placeholder 就写着这件事。
 *
 * ## 表单自己**不带**分区标题
 *
 * 两个调用方都已经有标题（设置页的 `Section` / onboarding 的页标题）。
 * 再挂一层就是同一件事说三四遍 —— 标题的责任留给容器。
 */
import { useState } from "react"
import { Button, Field, Input, Tag, cn } from "@mycontext/design"
import type {
  CursorRuntime,
  RuntimeConfigProbe,
  RuntimeConfigView,
  SaveRuntimeConfigInput,
} from "@mycontext/ipc-contract"
import { useProbeRuntimeConfig, useRuntimeConfig, useSaveRuntimeConfig } from "../../lib/queries.js"
import { useDynamicTranslation } from "../../lib/use-dynamic-translation.js"

export interface ModelConfigFormProps {
  /** onboarding 里保存成功后回调（用于记 stepDone）。设置面板不传。 */
  onSaved?: () => void
  /** 保存按钮文案覆盖（onboarding 用「保存并继续」）。 */
  saveLabel?: string
}

/**
 * 还没探测时的推荐模型档位。
 *
 * ★ 给档位而不是空输入框（与 `PersonaRuntimePanel` 同一个判断：
 * "给档位就是给建议"）。这几个是本机网关实测能用的：`glm-5.2` 是默认。
 *
 * 探测成功后**用真实列表替换**它 —— 兜底值的作用只是"别让第一眼是空的"。
 */
const SUGGESTED_MODELS = ["glm-5.2", "claude-sonnet-4-6", "qwen3.7-plus"] as const
const SUGGESTED_EMBED = ["text-embedding-v4"] as const

export function ModelConfigForm({ onSaved, saveLabel }: ModelConfigFormProps) {
  const { t } = useDynamicTranslation("settings")
  const config = useRuntimeConfig()
  const save = useSaveRuntimeConfig()
  const probe = useProbeRuntimeConfig()
  /** 向量区独立探测 —— 与主模型共用一个 mutation 会互相覆盖结果。 */
  const embedProbe = useProbeRuntimeConfig()
  /** 知识库区独立探测。 */
  const klProbe = useProbeRuntimeConfig()

  // 受控草稿：null = 未编辑（显示当前值）。apiKey 单独用空串草稿（不回显）。
  const [llmBaseUrl, setLlmBaseUrl] = useState<string | null>(null)
  const [modelMain, setModelMain] = useState<string | null>(null)
  const [embedModel, setEmbedModel] = useState<string | null>(null)
  const [embedLlmBaseUrl, setEmbedLlmBaseUrl] = useState<string | null>(null)
  const [embedLlmApiKey, setEmbedLlmApiKey] = useState("")
  const [embeddingDim, setEmbeddingDim] = useState<string | null>(null)
  const [embedSendDimensions, setEmbedSendDimensions] = useState<boolean | null>(null)
  /** 向量模型名手输模式（探测列表里没有想要的那个时） */
  const [customEmbed, setCustomEmbed] = useState(false)
  const [apiKey, setApiKey] = useState("")
  const [klBaseUrl, setKlBaseUrl] = useState<string | null>(null)
  const [klModel, setKlModel] = useState<string | null>(null)
  const [klApiKey, setKlApiKey] = useState("")
  /** Agent API Key 草稿（空串 = 不改，与 llmApiKey 同语义）。 */
  const [cursorApiKey, setCursorApiKey] = useState("")
  /** Agent 运行时落点草稿。null = 未编辑。 */
  const [cursorRuntime, setCursorRuntime] = useState<CursorRuntime | null>(null)
  /** 模型名手输模式（探测列表里没有想要的那个时） */
  const [customModel, setCustomModel] = useState(false)
  /** 知识库模型手输模式 */
  const [customKl, setCustomKl] = useState(false)
  /**
   * 探测是**针对哪组凭据**跑的。
   *
   * ★ 防假反馈：探测成功给了绿灯后，用户又改了地址/密钥 —— 那条绿灯就
   * **不再代表当前输入**了（它测的是改之前那组）。而 `probe.data` 会一直留着。
   * 记下"探测时用的地址 + 有没有带 key"，当前草稿与之不一致时就不显示旧结果。
   * 这与本组件反对的"保存按钮假反馈"是同一条原则：结论必须对应当前状态。
   */
  const [probedAgainst, setProbedAgainst] = useState<{ baseUrl: string; withKey: boolean } | null>(
    null,
  )
  const [embedProbedAgainst, setEmbedProbedAgainst] = useState<{
    baseUrl: string
    withKey: boolean
  } | null>(null)
  const [klProbedAgainst, setKlProbedAgainst] = useState<{
    baseUrl: string
    withKey: boolean
  } | null>(null)

  const current: RuntimeConfigView | undefined = config.data
  if (current === undefined) return null

  const baseUrlValue = llmBaseUrl ?? current.llmBaseUrl.value
  const modelValue = modelMain ?? current.modelMain.value
  const embedBaseUrlValue = embedLlmBaseUrl ?? current.embedLlmBaseUrl.value
  const embedValue = embedModel ?? current.embedModel.value
  const embedDimValue = embeddingDim ?? String(current.embeddingDim.value)
  const embedSendDimensionsValue = embedSendDimensions ?? current.embedSendDimensions.value
  const klBaseUrlValue = klBaseUrl ?? current.klLlmBaseUrl.value
  /** 向量探测 / 展示用的生效地址：本区草稿优先，空则跟主模型草稿。 */
  const embedProbeUrl = embedBaseUrlValue.trim() !== "" ? embedBaseUrlValue : baseUrlValue
  const klProbeUrl = klBaseUrlValue.trim() !== "" ? klBaseUrlValue : baseUrlValue

  /**
   * 有没有未保存的改动。
   *
   * 没有就把保存按钮禁掉 —— 否则点一下会显示「已保存」而其实什么都没提交
   * （假反馈）。apiKey 的非空草稿也算改动（它的空串语义是"不改"）。
   */
  const dirty =
    llmBaseUrl !== null ||
    modelMain !== null ||
    embedModel !== null ||
    embedLlmBaseUrl !== null ||
    embedLlmApiKey !== "" ||
    embeddingDim !== null ||
    embedSendDimensions !== null ||
    klBaseUrl !== null ||
    klModel !== null ||
    cursorRuntime !== null ||
    apiKey !== "" ||
    klApiKey !== "" ||
    cursorApiKey !== ""

  const submit = (): void => {
    const patch: SaveRuntimeConfigInput = {}
    if (llmBaseUrl !== null) patch.llmBaseUrl = llmBaseUrl
    if (modelMain !== null) patch.modelMain = modelMain
    if (embedModel !== null) patch.embedModel = embedModel
    if (embedLlmBaseUrl !== null) patch.embedLlmBaseUrl = embedLlmBaseUrl
    if (embedLlmApiKey !== "") patch.embedLlmApiKey = embedLlmApiKey
    if (embeddingDim !== null) {
      const parsed = Number.parseInt(embeddingDim, 10)
      if (!Number.isNaN(parsed)) patch.embeddingDim = parsed
    }
    if (embedSendDimensions !== null) patch.embedSendDimensions = embedSendDimensions
    // 空串 = 不改（UI 不回显旧 key）
    if (apiKey !== "") patch.llmApiKey = apiKey
    if (klBaseUrl !== null) patch.klLlmBaseUrl = klBaseUrl
    if (klModel !== null) patch.klModelMain = klModel
    if (klApiKey !== "") patch.klLlmApiKey = klApiKey
    if (cursorApiKey !== "") patch.cursorApiKey = cursorApiKey
    if (cursorRuntime !== null) patch.cursorRuntime = cursorRuntime
    save.mutate(patch, {
      onSuccess: () => {
        // 草稿清空 → dirty 回到 false（保存后按钮自然禁掉）
        setApiKey("")
        setKlApiKey("")
        setCursorApiKey("")
        setLlmBaseUrl(null)
        setModelMain(null)
        setEmbedModel(null)
        setEmbedLlmBaseUrl(null)
        setEmbedLlmApiKey("")
        setEmbeddingDim(null)
        setEmbedSendDimensions(null)
        setKlBaseUrl(null)
        setKlModel(null)
        setCursorRuntime(null)
        onSaved?.()
      },
    })
  }

  /** 探测用**草稿值**：先测通再存才是自然顺序。 */
  const runProbe = (): void => {
    setProbedAgainst({ baseUrl: baseUrlValue, withKey: apiKey !== "" })
    probe.mutate({
      ...(baseUrlValue.trim() === "" ? {} : { baseUrl: baseUrlValue }),
      ...(apiKey === "" ? {} : { apiKey }),
    })
  }

  /** 向量区独立测：forEmbed 让缺省 key 走已存向量密钥（空则回退主密钥）。 */
  const runEmbedProbe = (): void => {
    setEmbedProbedAgainst({ baseUrl: embedProbeUrl, withKey: embedLlmApiKey !== "" })
    embedProbe.mutate({
      forEmbed: true,
      ...(embedProbeUrl.trim() === "" ? {} : { baseUrl: embedProbeUrl }),
      ...(embedLlmApiKey === "" ? {} : { apiKey: embedLlmApiKey }),
    })
  }

  /** 知识库区独立测：forKl 走已存 KL 密钥（空则回退主密钥）。 */
  const runKlProbe = (): void => {
    setKlProbedAgainst({ baseUrl: klProbeUrl, withKey: klApiKey !== "" })
    klProbe.mutate({
      forKl: true,
      ...(klProbeUrl.trim() === "" ? {} : { baseUrl: klProbeUrl }),
      ...(klApiKey === "" ? {} : { apiKey: klApiKey }),
    })
  }

  /**
   * 探测结果是否**仍对应当前输入**。
   *
   * 探完之后改了地址、或加/去了 key，旧结果就过期了 —— 这时不展示它，
   * 也不拿它的模型列表去覆盖推荐档位（否则会拿"上一次网关"的列表给"这一次地址"挑）。
   */
  const probeFresh =
    probedAgainst !== null &&
    probedAgainst.baseUrl === baseUrlValue &&
    probedAgainst.withKey === (apiKey !== "")

  const embedProbeFresh =
    embedProbedAgainst !== null &&
    embedProbedAgainst.baseUrl === embedProbeUrl &&
    embedProbedAgainst.withKey === (embedLlmApiKey !== "")

  const klProbeFresh =
    klProbedAgainst !== null &&
    klProbedAgainst.baseUrl === klProbeUrl &&
    klProbedAgainst.withKey === (klApiKey !== "")

  const result: RuntimeConfigProbe | undefined = probeFresh ? probe.data : undefined
  const embedResult: RuntimeConfigProbe | undefined = embedProbeFresh ? embedProbe.data : undefined
  const klResult: RuntimeConfigProbe | undefined = klProbeFresh ? klProbe.data : undefined
  /** 探到的列表优先；没探过用推荐档位。 */
  const modelOptions =
    result?.ok === true && result.models.length > 0
      ? result.models
      : (SUGGESTED_MODELS as readonly string[])
  const klModelOptions =
    klResult?.ok === true && klResult.models.length > 0
      ? klResult.models
      : (SUGGESTED_MODELS as readonly string[])
  /**
   * 向量模型 chips：优先带 embed 字样的；一个都没有就把全量列表摆出来
   * （本地 GGUF / 非标准命名）。没探过用推荐档位。
   */
  const embedOptions = ((): readonly string[] => {
    if (embedResult?.ok !== true || embedResult.models.length === 0) {
      return SUGGESTED_EMBED
    }
    const named = embedResult.models.filter((id) => /embed/i.test(id))
    return named.length > 0 ? named : embedResult.models
  })()

  const klModelValue = klModel ?? current.klModelMain.value

  const effectiveCursorRuntime: CursorRuntime = cursorRuntime ?? current.cursorRuntime.value

  return (
    <div className="flex flex-col gap-[var(--gap-section-lg)]">
      <section className="flex flex-col gap-[var(--gap-section-sm)]">
        <span className="typography-body-base-500 text-[var(--text-base-primary)]">
          {t("model.provider.mainSection")}
        </span>
        <Field label={t("model.provider.mainBaseUrl")}>
          {(attributes) => (
            <Input
              {...attributes}
              value={baseUrlValue}
              onChange={(event) => setLlmBaseUrl(event.target.value)}
              placeholder="https://…"
            />
          )}
        </Field>

        {/* key 的状态跟在 label 右边（Tag），不再单独占一行描述 */}
        <div className="flex flex-col gap-[var(--gap-component-sm)]">
          <div className="flex items-center gap-2">
            <span className="typography-body-small-400 text-[var(--text-base-secondary)]">
              {t("model.provider.apiKey")}
            </span>
            <KeyTag field={current.llmApiKey} />
          </div>
          <Input
            type="password"
            aria-label={t("model.provider.apiKey")}
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            placeholder={t("model.provider.apiKeyPlaceholder")}
          />
        </div>

        {/*
          ★ 测试连接。放在"地址 + 密钥"之后、"选模型"之前 —— 这个顺序
          就是操作顺序：填好凭证 → 测通 → 从探到的列表里挑模型。
        */}
        <div className="flex items-center gap-3">
          <Button size="sm" variant="secondary" disabled={probe.isPending} onClick={runProbe}>
            {probe.isPending ? t("model.probe.testing") : t("model.probe.test")}
          </Button>
          <ProbeResult result={result} failed={probeFresh && probe.isError} />
        </div>

        {/*
          模型选择：chips（探到的列表 / 推荐档位）+ 「其它」手输。
          选中态自己就说明了"现在用哪个"，不需要「如 glm-5.2」这类提示。
        */}
        <div className="flex flex-col gap-[var(--gap-component-sm)]">
          <div className="flex items-center gap-2">
            <span className="typography-body-small-400 text-[var(--text-base-secondary)]">
              {t("model.provider.modelMain")}
            </span>
            {result?.ok === true && result.models.length > 0 && (
              <Tag size="sm" status="accent">
                {t("model.probe.fromGateway", { count: result.models.length })}
              </Tag>
            )}
          </div>
          <ChipPicker
            options={modelOptions}
            value={modelValue}
            onPick={(next) => {
              setModelMain(next)
              setCustomModel(false)
            }}
            otherLabel={t("model.other")}
            custom={customModel || !modelOptions.includes(modelValue)}
            onCustom={() => setCustomModel(true)}
          />
          {(customModel || !modelOptions.includes(modelValue)) && (
            <Input
              aria-label={t("model.provider.modelMain")}
              value={modelValue}
              onChange={(event) => setModelMain(event.target.value)}
              placeholder="glm-5.2"
            />
          )}
          {/*
            ★ 探测成功、且当前模型名**不在**网关返回的列表里 → 明确警告。
            这正是本组件要防的那个静默失效：模型名对不上，几小时后的蒸馏/建图
            才以 `model_not_found` 报错，界面当下无声。既然刚探到了真实列表，
            就能当场指出"这个名字网关不认识"，把无声变成可见。
            只在 result.ok（真拿到列表）时判 —— 没探过不知道网关有什么，不妄断。
          */}
          {result?.ok === true &&
            result.models.length > 0 &&
            modelValue.trim() !== "" &&
            !result.models.includes(modelValue) && (
              <span className="typography-caption-400 text-[var(--status-warning)]">
                {t("model.probe.modelNotListed")}
              </span>
            )}
        </div>
      </section>

      {/*
        向量模型一级分区：自有接口地址 / Key / 测试连接 / 模型。
        留空地址才回退主配置 —— 绝不再让人去改上方主模型地址。
      */}
      <section className="flex flex-col gap-[var(--gap-section-sm)]">
        <div className="flex flex-col gap-1">
          <span className="typography-body-base-500 text-[var(--text-base-primary)]">
            {t("model.embed.title")}
          </span>
          <span className="typography-caption-400 text-[var(--text-base-tertiary)]">
            {t("model.embed.hint")}
          </span>
        </div>

        <Field label={t("model.provider.embedBaseUrl")}>
          {(attributes) => (
            <Input
              {...attributes}
              value={embedBaseUrlValue}
              onChange={(event) => setEmbedLlmBaseUrl(event.target.value)}
              placeholder={
                baseUrlValue.trim() !== ""
                  ? baseUrlValue
                  : t("model.embed.baseUrlPlaceholder")
              }
            />
          )}
        </Field>

        <div className="flex flex-col gap-[var(--gap-component-sm)]">
          <div className="flex items-center gap-2">
            <span className="typography-body-small-400 text-[var(--text-base-secondary)]">
              {t("model.provider.apiKey")}
            </span>
            <KeyTag field={current.embedLlmApiKey} fallbackLabel={t("model.embed.inherited")} />
          </div>
          <Input
            type="password"
            aria-label={t("model.provider.apiKey")}
            value={embedLlmApiKey}
            onChange={(event) => setEmbedLlmApiKey(event.target.value)}
            placeholder={t("model.provider.apiKeyPlaceholder")}
          />
        </div>

        <div className="flex items-center gap-3">
          <Button
            size="sm"
            variant="secondary"
            disabled={embedProbe.isPending}
            onClick={runEmbedProbe}
          >
            {embedProbe.isPending ? t("model.probe.testing") : t("model.probe.test")}
          </Button>
          <ProbeResult
            result={embedResult}
            failed={embedProbeFresh && embedProbe.isError}
          />
        </div>

        <div className="flex flex-col gap-[var(--gap-component-sm)]">
          <div className="flex items-center gap-2">
            <span className="typography-body-small-400 text-[var(--text-base-secondary)]">
              {t("model.provider.embedModel")}
            </span>
            {embedResult?.ok === true && embedResult.models.length > 0 && (
              <Tag size="sm" status="accent">
                {t("model.probe.fromGateway", { count: embedResult.models.length })}
              </Tag>
            )}
          </div>
          <ChipPicker
            options={embedOptions}
            value={embedValue}
            onPick={(next) => {
              setEmbedModel(next)
              setCustomEmbed(false)
            }}
            otherLabel={t("model.other")}
            custom={customEmbed || !embedOptions.includes(embedValue)}
            onCustom={() => setCustomEmbed(true)}
          />
          {(customEmbed || !embedOptions.includes(embedValue)) && (
            <Input
              aria-label={t("model.provider.embedModel")}
              value={embedValue}
              onChange={(event) => setEmbedModel(event.target.value)}
              placeholder={t("model.provider.embedPlaceholder")}
            />
          )}
          {embedResult?.ok === true &&
            embedResult.models.length > 0 &&
            embedValue.trim() !== "" &&
            !embedResult.models.includes(embedValue) && (
              <span className="typography-caption-400 text-[var(--status-warning)]">
                {t("model.probe.modelNotListed")}
              </span>
            )}
        </div>

        <Field label={t("model.embed.embeddingDim")}>
          {(attributes) => (
            <Input
              {...attributes}
              inputMode="numeric"
              value={embedDimValue}
              onChange={(event) => setEmbeddingDim(event.target.value)}
              placeholder={String(current.embedEffective.embeddingDim)}
            />
          )}
        </Field>

        <div className="flex flex-col gap-[var(--gap-component-sm)]">
          <span className="typography-body-small-400 text-[var(--text-base-secondary)]">
            {t("model.embed.sendDimensions")}
          </span>
          <div className="flex flex-wrap gap-1.5">
            <Chip
              selected={embedSendDimensionsValue}
              onClick={() => setEmbedSendDimensions(true)}
            >
              {t("model.embed.sendDimensionsOn")}
            </Chip>
            <Chip
              selected={!embedSendDimensionsValue}
              onClick={() => setEmbedSendDimensions(false)}
            >
              {t("model.embed.sendDimensionsOff")}
            </Chip>
          </div>
          <span className="typography-caption-400 text-[var(--text-base-tertiary)]">
            {t("model.embed.sendDimensionsHint")}
          </span>
        </div>
      </section>

      {/*
        Agent 运行时凭据 + 落点。
        主用订阅密钥；上方「模型网关」是 OpenAI 兼容 Fallback（搜索归纳 / 分身直连）。
        文案刻意不堆第三方产品名（商标门禁）—— 说「Agent API Key」「本地 / 云端」。
      */}
      <section className="flex flex-col gap-[var(--gap-section-sm)]">
        <div className="flex flex-col gap-[var(--gap-component-sm)]">
          <div className="flex items-center gap-2">
            <span className="typography-body-small-400 text-[var(--text-base-secondary)]">
              {t("model.agent.apiKey")}
            </span>
            <KeyTag field={current.cursorApiKey} />
          </div>
          <Input
            type="password"
            aria-label={t("model.agent.apiKey")}
            value={cursorApiKey}
            onChange={(event) => setCursorApiKey(event.target.value)}
            placeholder={t("model.provider.apiKeyPlaceholder")}
          />
          <span className="typography-caption-400 text-[var(--text-base-tertiary)]">
            {t("model.agent.apiKeyHint")}
          </span>
        </div>

        <div className="flex flex-col gap-[var(--gap-component-sm)]">
          <span className="typography-body-small-400 text-[var(--text-base-secondary)]">
            {t("model.agent.runtime")}
          </span>
          <div className="flex flex-wrap gap-1.5">
            <Chip
              selected={effectiveCursorRuntime === "local"}
              onClick={() => setCursorRuntime("local")}
            >
              {t("model.agent.runtimeLocal")}
            </Chip>
            <Chip
              selected={effectiveCursorRuntime === "cloud"}
              onClick={() => setCursorRuntime("cloud")}
            >
              {t("model.agent.runtimeCloud")}
            </Chip>
          </div>
          <span className="typography-caption-400 text-[var(--text-base-tertiary)]">
            {t("model.agent.runtimeHint")}
          </span>
        </div>
      </section>

      {/*
        知识库一级分区：自有接口地址 / Key / 测试连接 / 协议 / 模型。
        留空才回退主配置；测连接走 forKl，不误测主网关。
      */}
      <section className="flex flex-col gap-[var(--gap-section-sm)]">
        <div className="flex flex-col gap-1">
          <span className="typography-body-base-500 text-[var(--text-base-primary)]">
            {t("model.kl.title")}
          </span>
          <span className="typography-caption-400 text-[var(--text-base-tertiary)]">
            {t("model.kl.hint")}
          </span>
        </div>

        <Field label={t("model.provider.klBaseUrl")}>
          {(attributes) => (
            <Input
              {...attributes}
              value={klBaseUrlValue}
              onChange={(event) => setKlBaseUrl(event.target.value)}
              placeholder={
                baseUrlValue.trim() !== "" ? baseUrlValue : t("model.kl.baseUrlPlaceholder")
              }
            />
          )}
        </Field>

        <div className="flex flex-col gap-[var(--gap-component-sm)]">
          <div className="flex items-center gap-2">
            <span className="typography-body-small-400 text-[var(--text-base-secondary)]">
              {t("model.provider.apiKey")}
            </span>
            <KeyTag field={current.klLlmApiKey} fallbackLabel={t("model.kl.inherited")} />
          </div>
          <Input
            type="password"
            aria-label={t("model.provider.apiKey")}
            value={klApiKey}
            onChange={(event) => setKlApiKey(event.target.value)}
            placeholder={t("model.provider.apiKeyPlaceholder")}
          />
        </div>

        <div className="flex items-center gap-3">
          <Button size="sm" variant="secondary" disabled={klProbe.isPending} onClick={runKlProbe}>
            {klProbe.isPending ? t("model.probe.testing") : t("model.probe.test")}
          </Button>
          <ProbeResult result={klResult} failed={klProbeFresh && klProbe.isError} />
        </div>

        <div className="flex flex-col gap-[var(--gap-component-sm)]">
          <div className="flex items-center gap-2">
            <span className="typography-body-small-400 text-[var(--text-base-secondary)]">
              {t("model.provider.modelMain")}
            </span>
            {klResult?.ok === true && klResult.models.length > 0 && (
              <Tag size="sm" status="accent">
                {t("model.probe.fromGateway", { count: klResult.models.length })}
              </Tag>
            )}
          </div>
          <ChipPicker
            options={klModelOptions}
            value={klModelValue}
            onPick={(next) => {
              setKlModel(next)
              setCustomKl(false)
            }}
            // 空值 = 跟随主配置，所以这里多一个「跟随」档
            inheritLabel={t("model.kl.inherited")}
            onInherit={() => {
              setKlModel("")
              setCustomKl(false)
            }}
            otherLabel={t("model.other")}
            custom={customKl || (klModelValue !== "" && !klModelOptions.includes(klModelValue))}
            onCustom={() => setCustomKl(true)}
          />
          {(customKl || (klModelValue !== "" && !klModelOptions.includes(klModelValue))) && (
            <Input
              aria-label={t("model.provider.modelMain")}
              value={klModelValue}
              onChange={(event) => setKlModel(event.target.value)}
              placeholder={modelValue || "glm-5.2"}
            />
          )}
          {klResult?.ok === true &&
            klResult.models.length > 0 &&
            klModelValue.trim() !== "" &&
            !klResult.models.includes(klModelValue) && (
              <span className="typography-caption-400 text-[var(--status-warning)]">
                {t("model.probe.modelNotListed")}
              </span>
            )}
        </div>
      </section>

      <div className="flex items-center gap-3">
        <Button size="sm" disabled={save.isPending || !dirty} onClick={submit}>
          {saveLabel ?? t("model.save")}
        </Button>
        {/* 只在**真的存过**之后显示，且改动后（dirty）就撤掉 —— 不给假反馈 */}
        {save.isSuccess && !dirty && (
          <Tag size="sm" status="success" showIndicator>
            {t("model.saved")}
          </Tag>
        )}
      </div>
    </div>
  )
}

/**
 * 「配没配 key」用一个 Tag 表达，不用一整行描述。
 *
 * 已配置显示后 4 位（够确认"是我那把 key"）；未配置是**中性灰**而非红色 ——
 * 没配 key 在 onboarding 里是正常的起始状态，一进来就看到红色
 * 会让人以为自己弄坏了什么。
 */
function KeyTag({
  field,
  fallbackLabel,
}: {
  field: RuntimeConfigView["llmApiKey"]
  fallbackLabel?: string
}) {
  const { t } = useDynamicTranslation("settings")
  if (field.configured) {
    const fromCli = field.source === "cli"
    return (
      <Tag size="sm" status="success" showIndicator>
        {field.tail === null
          ? t(fromCli ? "model.keyOnCli" : "model.keyOn")
          : t(fromCli ? "model.keyTailCli" : "model.keyTail", { tail: field.tail })}
      </Tag>
    )
  }
  return (
    <Tag size="sm" status="default">
      {fallbackLabel ?? t("model.keyOff")}
    </Tag>
  )
}

/**
 * 探测结果那一行。
 *
 * ★ 失败时给的是**可照做的下一步**，不是网关的英文报文：
 * 401 该去换密钥、DNS 失败该去查地址 —— 两者的动作完全不同，
 * 所以 reason 分类在主进程就做好了（见 RuntimeConfigService.probe）。
 * 原文放进 `title`（悬停可见），不怼到界面上。
 */
function ProbeResult({
  result,
  failed,
}: {
  result: RuntimeConfigProbe | undefined
  failed: boolean
}) {
  const { t } = useDynamicTranslation("settings")
  // IPC 本身失败（极少见）也要有话说，不能静默
  if (failed) {
    return (
      <Tag size="sm" status="error" showIndicator>
        {t("model.probe.reason.unreachable")}
      </Tag>
    )
  }
  if (result === undefined) return null
  if (result.ok) {
    return (
      <Tag size="sm" status="success" showIndicator>
        {t("model.probe.ok", { count: result.models.length })}
      </Tag>
    )
  }
  return (
    <span
      className="typography-caption-400 text-[var(--status-error)]"
      title={result.detail ?? undefined}
    >
      {t(`model.probe.reason.${result.reason ?? "unreachable"}`)}
    </span>
  )
}

/**
 * 档位选择器（chips）。
 *
 * 对齐 `PersonaRuntimePanel` 的 `LimitRow`：**给档位就是给建议**。
 * 空输入框会让用户去想"填什么合法"，而这里选中态本身就是答案。
 *
 * 列表可能很长（网关实测 68 个模型），所以 `flex-wrap` + 滚动上限。
 */
function ChipPicker({
  options,
  value,
  onPick,
  otherLabel,
  custom = false,
  onCustom,
  inheritLabel,
  onInherit,
}: {
  options: readonly string[]
  value: string
  onPick: (next: string) => void
  /** 传了才显示「其它」（切到手输） */
  otherLabel?: string
  custom?: boolean
  onCustom?: () => void
  /** 传了才显示「跟随主配置」档（KL 用，空值即继承） */
  inheritLabel?: string
  onInherit?: () => void
}) {
  return (
    <div className="flex max-h-[136px] flex-wrap gap-1.5 overflow-y-auto">
      {inheritLabel !== undefined && onInherit !== undefined && (
        <Chip selected={value === ""} onClick={onInherit}>
          {inheritLabel}
        </Chip>
      )}
      {options.map((option) => (
        <Chip key={option} selected={!custom && value === option} onClick={() => onPick(option)}>
          {option}
        </Chip>
      ))}
      {otherLabel !== undefined && onCustom !== undefined && (
        <Chip selected={custom} onClick={onCustom}>
          {otherLabel}
        </Chip>
      )}
    </div>
  )
}

function Chip({
  selected,
  onClick,
  children,
}: {
  selected: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={cn(
        "typography-caption-400 cursor-pointer rounded-[var(--radius-sm)] px-2 py-1 transition-colors duration-150",
        "focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus-ring)]",
        selected
          ? "bg-[var(--overlay-on-container-selected)] text-[var(--text-base-primary)]"
          : "text-[var(--text-base-secondary)] hover:bg-[var(--overlay-on-container-hover)] hover:text-[var(--text-base-primary)]",
      )}
    >
      {children}
    </button>
  )
}
