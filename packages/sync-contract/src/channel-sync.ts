/**
 * 本机 → Ubuntu 的渠道导出同步契约。
 *
 * ## POST 体形状（Task 1：JSON + 文本 map，multipart 后置）
 *
 * ```json
 * {
 *   "manifest": {
 *     "vaultId": "vault-fake-001",
 *     "channelId": "dingtalk",
 *     "exportedAt": 1785000000000,
 *     "sources": ["chat", "minutes"]
 *   },
 *   "files": {
 *     "chat/manifest.json": "{...}\n",
 *     "chat/scopes.jsonl": "",
 *     "chat/records.jsonl": "",
 *     "chat/resources.jsonl": ""
 *   },
 *   "filesBase64": {
 *     "minutes/records.jsonl": "<optional base64>"
 *   }
 * }
 * ```
 *
 * · `files`：UTF-8 文本（manifest / jsonl 的常规路径）；
 * · `filesBase64`：可选，值经 base64 解码后落盘（留给后续大二进制，Task 1 不强制）。
 *
 * 键格式固定为 `<source>/<filename>`，对齐 kl-graph 四件套：
 * `chat/`、`minutes/` 下各含 manifest.json + 三个 jsonl。
 *
 * 落盘目标：`{dataDir}/vaults/{vaultId}/exports/dws/`（与 VaultStore.paths().exportRoot 一致）。
 */
import { z } from "zod"

/** 四件套文件名 —— 与 export-materializer / kl-graph loader 对齐。 */
export const channelSyncFourPieceFileSchema = z.enum([
  "manifest.json",
  "scopes.jsonl",
  "records.jsonl",
  "resources.jsonl",
])

export type ChannelSyncFourPieceFile = z.infer<typeof channelSyncFourPieceFileSchema>

/** 本阶段推送的内容类型（与 exports/dws 下 source 目录名一致）。 */
export const channelSyncSourceNameSchema = z.enum(["chat", "minutes"])

export type ChannelSyncSourceName = z.infer<typeof channelSyncSourceNameSchema>

/** 同步包元数据：vault 与渠道身份由 manifest 携带，服务端不猜路径。 */
export const channelSyncManifestSchema = z.object({
  vaultId: z.string().min(1),
  channelId: z.string().min(1),
  exportedAt: z.number().int().nonnegative(),
  sources: z.array(channelSyncSourceNameSchema).min(1),
})

export type ChannelSyncManifest = z.infer<typeof channelSyncManifestSchema>

const FILE_KEY_RE =
  /^(?<source>chat|minutes)\/(?<file>manifest\.json|scopes\.jsonl|records\.jsonl|resources\.jsonl)$/

function parseFileKey(key: string): { source: ChannelSyncSourceName; file: ChannelSyncFourPieceFile } | null {
  const match = FILE_KEY_RE.exec(key)
  if (match?.groups?.source === undefined || match.groups.file === undefined) return null
  const source = channelSyncSourceNameSchema.safeParse(match.groups.source)
  const file = channelSyncFourPieceFileSchema.safeParse(match.groups.file)
  if (!source.success || !file.success) return null
  return { source: source.data, file: file.data }
}

function validateFileMap(
  files: Record<string, string>,
  label: "files" | "filesBase64",
): z.ZodIssue[] {
  const issues: z.ZodIssue[] = []
  for (const key of Object.keys(files)) {
    if (parseFileKey(key) === null) {
      issues.push({
        code: "custom",
        path: [label, key],
        message: `非法文件键：${key}（期望 <chat|minutes>/<四件套文件名>）`,
      })
    }
  }
  return issues
}

/** 完整 POST 体。 */
export const channelSyncRequestSchema = z
  .object({
    manifest: channelSyncManifestSchema,
    files: z.record(z.string(), z.string()).default({}),
    filesBase64: z.record(z.string(), z.string()).optional(),
  })
  .superRefine((value, ctx) => {
    for (const issue of validateFileMap(value.files, "files")) {
      ctx.addIssue(issue)
    }
    if (value.filesBase64 !== undefined) {
      for (const issue of validateFileMap(value.filesBase64, "filesBase64")) {
        ctx.addIssue(issue)
      }
    }

    // manifest 声明的每个 source 必须四件套齐全（manifest 最后写，但推送时一并带上）
    const keys = new Set([
      ...Object.keys(value.files),
      ...Object.keys(value.filesBase64 ?? {}),
    ])
    for (const source of value.manifest.sources) {
      for (const file of channelSyncFourPieceFileSchema.options) {
        const key = `${source}/${file}`
        if (!keys.has(key)) {
          ctx.addIssue({
            code: "custom",
            path: ["files"],
            message: `缺少 ${key}（manifest.sources 声明了 ${source}）`,
          })
        }
      }
    }
  })

export type ChannelSyncRequest = z.infer<typeof channelSyncRequestSchema>

/** API 错误码 —— 脚本侧重试/排错只看 machine-readable 字段。 */
export const CHANNEL_SYNC_ERROR = {
  UNAUTHORIZED: "unauthorized",
  INVALID_JSON: "invalid_json",
  INVALID_BODY: "invalid_body",
  NOT_FOUND: "not_found",
  METHOD_NOT_ALLOWED: "method_not_allowed",
  INTERNAL: "internal",
} as const

export type ChannelSyncErrorCode = (typeof CHANNEL_SYNC_ERROR)[keyof typeof CHANNEL_SYNC_ERROR]

/** 解析 file map 的键（供落盘侧复用，避免两处正则漂移）。 */
export function parseChannelSyncFileKey(key: string) {
  return parseFileKey(key)
}
