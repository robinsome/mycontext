/**
 * dws READ 白名单 ↔ dingtalk multi-skills 语义 ↔ 开放平台 HTTP 对照表。
 *
 * ## 为什么单独成表
 *
 * 企业应用采集器**禁止**按临时想法调 OpenAPI。skills（`~/.dws/skills/multi`）
 * 只描述 `dws` CLI 语义，**不是** HTTP path 说明书；本表是唯一允许的调度清单。
 *
 * · `mapped`：已填 `openApi`（须经开放平台文档 + 实测）；采集器可调用。
 * · `sidecar`：无公开 HTTP path，由 dws-sidecar 执行（用户 token + MCP/CLI）。
 * · `deferred`：语义来自 skill/白名单，HTTP 路径待实测；不得当成功跳过。
 * · `unsupported`：开放平台无等价或模型不同（如个人 Stream vs 企业回调）。
 *
 * Task 0：首批全部为 `deferred`（或明确 unsupported），避免伪造 path。
 * 实测填入 path 后改为 `mapped`。
 */
export type OpenApiAuthKind = "user"

export type OpenApiCapabilityStatus = "mapped" | "sidecar" | "deferred" | "unsupported"

export interface OpenApiEndpoint {
  method: "GET" | "POST" | "PUT" | "DELETE"
  /** 相对 api.dingtalk.com 的 path，或完整 URL；以实测为准 */
  path: string
  auth: OpenApiAuthKind
}

export interface OpenApiCapabilityRow {
  dwsCommand: readonly string[]
  /** 相对 `~/.dws/skills/multi/` 的 skill 文档路径 */
  skillRef: string
  status: OpenApiCapabilityStatus
  openApi: OpenApiEndpoint | null
  notes: string
}

export function dwsCommandKey(command: readonly string[]): string {
  return command.join(" ")
}

export const OPENAPI_CAPABILITY_MATRIX: readonly OpenApiCapabilityRow[] = [
  {
    dwsCommand: ["auth", "status"],
    skillRef: "dingtalk-shared/references/global-reference.md",
    status: "deferred",
    openApi: null,
    notes: "OAuth 会话态由 web-server 自管；不必镜像 dws auth status HTTP。",
  },
  {
    dwsCommand: ["contact", "user", "get-self"],
    skillRef: "dingtalk-contact/SKILL.md",
    status: "mapped",
    openApi: {
      method: "GET",
      path: "/v1.0/contact/users/me",
      auth: "user",
    },
    notes: "用户 token；实测 path。响应含 openId/unionId/nick 等；落盘 identity/me.json。",
  },
  {
    dwsCommand: ["contact", "user", "search"],
    skillRef: "dingtalk-contact/SKILL.md",
    status: "deferred",
    openApi: null,
    notes: "仅关键词消歧；禁止 search-mobile / 花名册 PII。",
  },
  {
    dwsCommand: ["chat", "message", "list-all"],
    skillRef: "dingtalk-chat/references/chat/message-query.md",
    status: "deferred",
    openApi: null,
    notes: "MVP 首波消息主路径；分页必须抽干。",
  },
  {
    dwsCommand: ["chat", "message", "list"],
    skillRef: "dingtalk-chat/references/chat/message-query.md",
    status: "deferred",
    openApi: null,
    notes: "MVP 首波。",
  },
  {
    dwsCommand: ["chat", "message", "list-mentions"],
    skillRef: "dingtalk-chat/references/chat/message-query.md",
    status: "deferred",
    openApi: null,
    notes: "MVP 首波。",
  },
  {
    dwsCommand: ["chat", "message", "list-unread-conversations"],
    skillRef: "dingtalk-chat/references/chat/message-query.md",
    status: "deferred",
    openApi: null,
    notes: "L1 探针；命令在 chat message 下。",
  },
  {
    dwsCommand: ["chat", "message", "query-send-status"],
    skillRef: "dingtalk-chat/references/chat/message-query.md",
    status: "deferred",
    openApi: null,
    notes: "分身发送关联用；无发送时可不调。",
  },
  {
    dwsCommand: ["chat", "conversation-info"],
    skillRef: "dingtalk-chat/references/chat/chat-conversation.md",
    status: "deferred",
    openApi: null,
    notes: "MVP 首波。",
  },
  {
    dwsCommand: ["chat", "list-all-conversations"],
    skillRef: "dingtalk-chat/references/chat/chat-conversation.md",
    status: "sidecar",
    openApi: null,
    notes:
      "B1 spike 2026-08-30：网页 OAuth userAccessToken + dws auth login --token 可走 MCP list_all_conversations。" +
      "无公开用户 token HTTP path；由 dws-sidecar 执行，禁止 App token / qyapi_chat_*。",
  },
  {
    dwsCommand: ["chat", "group", "list-all"],
    skillRef: "dingtalk-chat/references/chat/group-discovery.md",
    status: "deferred",
    openApi: null,
    notes:
      "2026-08-30 实测：dws 同走 MCP（list_my_groups_pagination → mcp-gw），非公开 OpenAPI；与 list-all-conversations 同缺口。",
  },
  {
    dwsCommand: ["chat", "group", "members", "list-by-ids"],
    skillRef: "dingtalk-chat/references/chat/group-discovery.md",
    status: "deferred",
    openApi: null,
    notes: "头像来源；需共同群。",
  },
  {
    dwsCommand: ["chat", "search-common"],
    skillRef: "dingtalk-chat/references/chat/group-discovery.md",
    status: "deferred",
    openApi: null,
    notes: "共同群搜索。",
  },
  {
    dwsCommand: ["chat", "message", "download-media"],
    skillRef: "dingtalk-chat/references/chat/message-media.md",
    status: "deferred",
    openApi: null,
    notes: "只写本地、不改远端；体积策略与现网一致。",
  },
  {
    dwsCommand: ["minutes", "list", "all"],
    skillRef: "dingtalk-minutes/SKILL.md",
    status: "deferred",
    openApi: null,
    notes: "第二波；注意 ENTERPRISE_NOT_AUTHORIZED 与 contact 能力互补。",
  },
  {
    dwsCommand: ["minutes", "get", "summary"],
    skillRef: "dingtalk-minutes/references/minutes.md",
    status: "deferred",
    openApi: null,
    notes: "第二波。",
  },
  {
    dwsCommand: ["minutes", "get", "transcription"],
    skillRef: "dingtalk-minutes/references/minutes.md",
    status: "deferred",
    openApi: null,
    notes: "第二波。",
  },
  {
    dwsCommand: ["event", "consume", "user_im_message_receive_at"],
    skillRef: "dingtalk-event/SKILL.md",
    status: "deferred",
    openApi: null,
    notes: "个人 OAuth Stream；企业应用回调模型不同，规格后置长连。",
  },
  {
    dwsCommand: ["event", "list"],
    skillRef: "dingtalk-event/references/event-im-keys.md",
    status: "deferred",
    openApi: null,
    notes: "与 consume 同后置。",
  },
  {
    dwsCommand: ["event", "status"],
    skillRef: "dingtalk-event/references/event-im-lifecycle.md",
    status: "deferred",
    openApi: null,
    notes: "与 consume 同后置。",
  },
  {
    dwsCommand: ["event", "stop"],
    skillRef: "dingtalk-event/references/event-im-operations.md",
    status: "deferred",
    openApi: null,
    notes: "与 consume 同后置。",
  },
  {
    dwsCommand: ["drive", "recent"],
    skillRef: "dingtalk-drive/SKILL.md",
    status: "deferred",
    openApi: null,
    notes: "文档第二波；禁止 drive download。",
  },
  {
    dwsCommand: ["wiki", "space", "list"],
    skillRef: "dingtalk-wiki/SKILL.md",
    status: "deferred",
    openApi: null,
    notes: "文档第二波。",
  },
  {
    dwsCommand: ["wiki", "node", "list"],
    skillRef: "dingtalk-wiki/SKILL.md",
    status: "deferred",
    openApi: null,
    notes: "文档第二波。",
  },
  {
    dwsCommand: ["doc", "read"],
    skillRef: "dingtalk-doc/references/doc/doc-read.md",
    status: "deferred",
    openApi: null,
    notes: "文档第二波；skill shortcut 与原子命令有漂移，以本行 dwsCommand 为准。",
  },
]

export function matrixRowForCommand(command: readonly string[]): OpenApiCapabilityRow | undefined {
  const key = dwsCommandKey(command)
  return OPENAPI_CAPABILITY_MATRIX.find((row) => dwsCommandKey(row.dwsCommand) === key)
}
