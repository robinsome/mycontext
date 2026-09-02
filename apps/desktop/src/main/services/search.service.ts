/**
 * 搜索服务。
 *
 * ## 降级链（每一档都在 UI 上明示，不静默降质）
 *
 * ① **主路**：OpenAI 兼容网关（设置里的模型 base/key，可指向 LiteLLM Proxy）
 *    → 本地召回后由网关归纳答案；
 * ② 网关不可用 → **只展示召回列表**（不编答案）；
 * ③ 连本地索引都没建好 → 提示"正在建索引"。
 */
import { join } from "node:path"
import { mkdirSync } from "node:fs"
import type { BrowserWindow } from "electron"
import { AppError, type Clock, type Logger } from "@mycontext/kernel"
import type { LlmProvider } from "@mycontext/llm"
import {
  FtsIndexRepository,
  MessageRepository,
  SearchSessionRepository,
  type SqliteDatabase,
} from "@mycontext/store"
import { recallMessages } from "@mycontext/retrieval"
import { type AgentDirs } from "./agent-dirs.js"
import { textBlock, type ChatItem } from "@mycontext/agent-runtime"
import {
  IPC_EVENTS,
  type SearchChatItem,
  type SearchSessionDetail,
  type SearchSessionSummary,
} from "@mycontext/ipc-contract"
import type { ProcessRunner, RuntimeEnv } from "@mycontext/runtime-env"

/** 直出召回列表时最多给多少条。再多用户也不会看，而且会把窗口撑爆。 */
const FALLBACK_RECALL_LIMIT = 20

export interface SearchServiceOptions {
  clock: Clock
  logger: Logger
  /** 保留装配兼容；搜索路径不再 spawn agent。 */
  runtime: RuntimeEnv
  processes: ProcessRunner
  skillsDir?: string
  klRoot: string
  klPort: number
  primaryChannelId: string
  klPortOf?: (channelId: string) => number | undefined
  klGraphs?: () => Readonly<Record<string, number>>
  getPythonEnv?: () => Promise<{ python: string; env: NodeJS.ProcessEnv } | null>
  getProvider?: () => string
  /** OpenAI 兼容网关（与数字分身直连共用 `LlmHolder`）。 */
  llmProvider?: LlmProvider
  getWindow: () => BrowserWindow | null
}

export class SearchService {
  private db: SqliteDatabase | null = null
  private readonly sourceDbs = new Map<string, SqliteDatabase>()
  private sessions: SearchSessionRepository | null = null

  constructor(private readonly options: SearchServiceOptions) {}

  private dirs: AgentDirs | null = null

  attach(
    db: SqliteDatabase,
    dirs: AgentDirs,
    sources: readonly { channelId: string; db: SqliteDatabase }[] = [],
  ): void {
    this.db = db
    this.dirs = dirs
    this.sourceDbs.clear()
    for (const source of sources) this.sourceDbs.set(source.channelId, source.db)
    this.sessions = new SearchSessionRepository(db)
  }

  detach(): void {
    this.db = null
    this.dirs = null
    this.sourceDbs.clear()
    this.sessions = null
  }

  private requireDirs(): AgentDirs {
    const dirs = this.dirs
    if (dirs === null) throw new AppError("DB_UNAVAILABLE", "尚未登录，agent 目录未就绪")
    return dirs
  }

  /**
   * 能否产出归纳答案（模型网关可用）。
   * 不可用 → UI 按「仅召回」呈现。
   */
  agentAvailable(): boolean {
    return this.options.llmProvider?.get() != null
  }

  list(): SearchSessionSummary[] {
    const sessions = this.sessions
    if (sessions === null) return []
    return sessions.listActive().map(toSummary)
  }

  detail(sessionId: string): SearchSessionDetail {
    const sessions = this.requireSessions()
    const session = sessions.findById(sessionId)
    if (session === null) {
      throw new AppError("IPC_BAD_REQUEST", "会话不存在", { context: { sessionId } })
    }
    return {
      session: toSummary(session),
      items: sessions.messages(sessionId).map((row) => ({
        id: row.id,
        seq: row.seq,
        role: row.role,
        itemType: row.itemType as SearchChatItem["itemType"],
        contentJson: row.contentJson,
        toolName: row.toolName,
        toolStatus: row.toolStatus as SearchChatItem["toolStatus"],
        turnId: row.turnId,
        createdAt: row.createdAt,
      })),
      agentAvailable: this.agentAvailable(),
      degradedReason: null,
    }
  }

  create(query: string, scope?: string): SearchSessionSummary {
    const sessions = this.requireSessions()
    const now = this.options.clock.now()
    const id = `srch_${now.toString(36)}_${Math.random().toString(36).slice(2, 8)}`
    const cwd = join(this.requireDirs().workspaceRoot, "search", id)
    mkdirSync(cwd, { recursive: true })

    const created = sessions.create({
      id,
      acpCwd: cwd,
      title: query.slice(0, 40),
      createdAt: now,
      graphScope: scope ?? this.options.primaryChannelId,
    })
    return toSummary(created)
  }

  rename(sessionId: string, title: string): void {
    this.requireSessions().rename(sessionId, title)
  }

  setPinned(sessionId: string, pinned: boolean): void {
    this.requireSessions().setPinned(sessionId, pinned)
  }

  remove(sessionId: string): void {
    this.requireSessions().remove(sessionId)
  }

  async prompt(sessionId: string, query: string): Promise<void> {
    const sessions = this.requireSessions()
    const now = this.options.clock.now()

    const userSeq = sessions.nextSeq(sessionId)
    sessions.appendMessages([
      {
        id: `${sessionId}_${userSeq}`,
        sessionId,
        seq: userSeq,
        role: "user",
        itemType: "message",
        contentJson: JSON.stringify([textBlock(query)]),
        createdAt: now,
      },
    ])
    sessions.setState(sessionId, "streaming", now)
    this.pushStream(sessionId, [], false, null)

    try {
      const ranGateway = await this.tryGatewayAnswer(
        sessionId,
        query,
        sessions.findById(sessionId)?.graphScope,
      )
      if (ranGateway) {
        sessions.setState(sessionId, "idle", this.options.clock.now())
        this.pushStream(sessionId, [], true, null)
        return
      }

      const items = this.recallOnly(sessionId, query, sessions.findById(sessionId)?.graphScope)
      sessions.appendMessages(items.map((item) => toAppendInput(sessionId, item)))
      sessions.setState(sessionId, "idle", this.options.clock.now())
      this.pushStream(sessionId, [], true, this.degradedReason())
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      const errorSeq = sessions.nextSeq(sessionId)
      sessions.appendMessages([
        {
          id: `${sessionId}_${errorSeq}`,
          sessionId,
          seq: errorSeq,
          role: "system",
          itemType: "error",
          contentJson: JSON.stringify([textBlock(detail)]),
          createdAt: this.options.clock.now(),
        },
      ])
      sessions.setState(sessionId, "error", this.options.clock.now())
      this.pushStream(sessionId, [], true, null)
      this.options.logger.warn("search prompt failed", { sessionId, detail })
    }
  }

  /** 用户点了"停止"：直连网关路径暂无流式取消，仅占位。 */
  cancel(_sessionId: string): void {}

  private degradedReason(): string {
    if (this.options.llmProvider?.get() == null) {
      return "未配置模型网关，已降级为本地召回（仅列出相关原文，不生成答案）。"
    }
    return "模型网关本轮未能完成，已降级为本地召回（仅列出相关原文，不生成答案）。"
  }

  /**
   * 本地召回 + OpenAI 兼容网关归纳成答案。
   */
  private async tryGatewayAnswer(
    sessionId: string,
    query: string,
    scope?: string,
  ): Promise<boolean> {
    const client = this.options.llmProvider?.get() ?? null
    if (client === null) return false

    const sessions = this.requireSessions()
    const startedAt = this.options.clock.now()
    const recalled = this.recallBySource(query, FALLBACK_RECALL_LIMIT, scope)
    const evidence = recalled.sources
      .flatMap((source) => {
        const label =
          source.channelId === "dingtalk"
            ? "钉钉"
            : source.channelId === "feishu"
              ? "飞书"
              : source.channelId
        return source.hits.map((hit) => {
          const when = new Date(hit.message.sentAt).toISOString().slice(0, 16).replace("T", " ")
          return {
            score: hit.score,
            text: `[${label}] ${when} ${hit.message.senderDisplayName ?? "未知"}：${(hit.message.contentText ?? "").slice(0, 240)}`,
          }
        })
      })
      .sort((a, b) => a.score - b.score)
      .slice(0, FALLBACK_RECALL_LIMIT)
      .map((row, index) => `[${String(index + 1)}] ${row.text}`)

    const contextBlock = evidence.length === 0 ? "（本地索引无命中）" : evidence.join("\n")

    try {
      const completion = await client.complete({
        messages: [
          {
            role: "system",
            content:
              "你根据用户问题与下面的本地召回原文作答。只依据原文，不要编造；原文不足就直说不知道。用简洁中文。",
          },
          {
            role: "user",
            content: `问题：${query}\n\n召回原文：\n${contextBlock}`,
          },
        ],
        maxTokens: 1200,
      })
      const answer = completion.text.trim()
      if (answer === "") return false

      let seq = sessions.nextSeq(sessionId)
      const turnId = `turn_${startedAt}`
      const toolItem: ChatItem = {
        id: `${sessionId}_${seq}`,
        seq,
        role: "assistant",
        itemType: "tool_call",
        content: [
          textBlock(
            recalled.relaxed
              ? `已本地召回 ${String(evidence.length)} 条（部分渠道已放宽词序），并由兼容网关归纳`
              : `已本地召回 ${String(evidence.length)} 条，并由兼容网关归纳`,
          ),
        ],
        toolName: "mycontext_gateway_answer",
        toolStatus: "success",
        turnId,
        createdAt: startedAt,
      }
      seq += 1
      const answerItem: ChatItem = {
        id: `${sessionId}_${seq}`,
        seq,
        role: "assistant",
        itemType: "message",
        content: [textBlock(answer)],
        turnId,
        createdAt: this.options.clock.now(),
      }
      sessions.appendMessages([toolItem, answerItem].map((item) => toAppendInput(sessionId, item)))
      this.pushStream(sessionId, [toolItem, answerItem].map(toStreamItem), false, null)
      return true
    } catch (error) {
      this.options.logger.warn("search gateway answer failed", {
        sessionId,
        detail: error instanceof Error ? error.message : String(error),
      })
      return false
    }
  }

  private recallOnly(sessionId: string, query: string, scope?: string): ChatItem[] {
    const startedAt = this.options.clock.now()

    const recalled = this.recallBySource(query, FALLBACK_RECALL_LIMIT, scope)
    const lines = recalled.sources
      .flatMap((source) => {
        const label =
          source.channelId === "dingtalk"
            ? "钉钉"
            : source.channelId === "feishu"
              ? "飞书"
              : source.channelId
        return source.hits.map((hit) => {
          const when = new Date(hit.message.sentAt).toISOString().slice(0, 16).replace("T", " ")
          return {
            score: hit.score,
            text: `[${label}] ${when} ${hit.message.senderDisplayName ?? "未知"}：${(hit.message.contentText ?? "").slice(0, 160)}`,
          }
        })
      })
      .sort((a, b) => a.score - b.score)
      .slice(0, FALLBACK_RECALL_LIMIT)
      .map((row, index) => `[${String(index + 1)}] ${row.text}`)

    let seq = this.requireSessions().nextSeq(sessionId)
    const turnId = `turn_${startedAt}`
    const toolItem: ChatItem = {
      id: `${sessionId}_${seq}`,
      seq,
      role: "assistant",
      itemType: "tool_call",
      content: [
        textBlock(
          recalled.relaxed
            ? `已分别查询钉钉和飞书，汇总命中 ${String(lines.length)} 条（部分渠道已放宽词序）`
            : `已分别查询钉钉和飞书，汇总命中 ${String(lines.length)} 条`,
        ),
      ],
      toolName: "mycontext_local_recall",
      toolStatus: "success",
      turnId,
      createdAt: startedAt,
    }
    seq += 1
    const answerItem: ChatItem = {
      id: `${sessionId}_${seq}`,
      seq,
      role: "assistant",
      itemType: "message",
      content: [
        textBlock(
          lines.length === 0
            ? "本地索引里没有找到相关消息。"
            : `以下是本地索引里最相关的记录：\n\n${lines.join("\n")}`,
        ),
      ],
      turnId,
      createdAt: this.options.clock.now(),
    }
    return [toolItem, answerItem]
  }

  private recallBySource(
    query: string,
    perSourceLimit: number,
    scope?: string,
  ): {
    relaxed: boolean
    sources: Array<{
      channelId: string
      hits: ReturnType<typeof recallMessages>["hits"]
    }>
  } {
    const primaryId = this.options.primaryChannelId
    const all: Array<{ channelId: string; db: SqliteDatabase }> = [
      { channelId: primaryId, db: this.requireDb() },
      ...[...this.sourceDbs.entries()].map(([channelId, sourceDb]) => ({
        channelId,
        db: sourceDb,
      })),
    ]
    const databases =
      scope === undefined || scope === "all"
        ? all
        : all.filter((entry) => entry.channelId === scope)
    let relaxed = false
    const sources = databases.map(({ channelId, db }) => {
      try {
        const result = recallMessages(
          { fts: new FtsIndexRepository(db), messages: new MessageRepository(db) },
          query,
          { limit: perSourceLimit },
        )
        relaxed ||= result.relaxed
        return { channelId, hits: result.hits }
      } catch (error) {
        this.options.logger.warn("isolated source recall failed", {
          channelId,
          detail: error instanceof Error ? error.message : String(error),
        })
        return { channelId, hits: [] }
      }
    })
    return { relaxed, sources }
  }

  private pushStream(
    sessionId: string,
    items: readonly SearchChatItem[],
    done: boolean,
    degradedReason: string | null,
  ): void {
    const window = this.options.getWindow()
    if (window === null || window.isDestroyed()) return
    window.webContents.send(IPC_EVENTS.searchStream, { sessionId, items, done, degradedReason })
  }

  async shutdown(): Promise<void> {}

  private requireSessions(): SearchSessionRepository {
    if (this.sessions === null) throw new AppError("DB_UNAVAILABLE", "尚未登录")
    return this.sessions
  }

  private requireDb(): SqliteDatabase {
    if (this.db === null) throw new AppError("DB_UNAVAILABLE", "尚未登录")
    return this.db
  }
}

function toAppendInput(
  sessionId: string,
  item: ChatItem,
): {
  id: string
  sessionId: string
  seq: number
  role: "user" | "assistant" | "system"
  itemType: string
  contentJson: string
  toolName?: string | null
  toolStatus?: string | null
  turnId?: string | null
  usageJson?: string | null
  createdAt: number
} {
  return {
    id: item.id,
    sessionId,
    seq: item.seq,
    role: item.role,
    itemType: item.itemType,
    contentJson: JSON.stringify(item.content),
    toolName: item.toolName ?? null,
    toolStatus: item.toolStatus ?? null,
    turnId: item.turnId ?? null,
    usageJson: item.usage !== undefined ? JSON.stringify(item.usage) : null,
    createdAt: item.createdAt,
  }
}

function toStreamItem(item: ChatItem): SearchChatItem {
  return {
    id: item.id,
    seq: item.seq,
    role: item.role,
    itemType: item.itemType,
    contentJson: JSON.stringify(item.content),
    toolName: item.toolName ?? null,
    toolStatus: item.toolStatus ?? null,
    turnId: item.turnId ?? null,
    createdAt: item.createdAt,
  }
}

function toSummary(row: {
  id: string
  title: string | null
  pinned: boolean
  messageCount: number
  lastActiveAt: number
  createdAt: number
  state: "idle" | "streaming" | "error"
  graphScope?: string
}): SearchSessionSummary {
  return {
    id: row.id,
    title: row.title,
    pinned: row.pinned,
    messageCount: row.messageCount,
    lastActiveAt: row.lastActiveAt,
    createdAt: row.createdAt,
    ...(row.graphScope === undefined ? {} : { graphScope: row.graphScope }),
    state: row.state,
  }
}
