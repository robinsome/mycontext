/**
 * Ubuntu Web Service HTTP 入口（Task 1 骨架）。
 *
 * · GET /health —— 探活，无需鉴权；
 * · POST /api/v1/channel-sync —— Bearer（MYCONTEXT_SYNC_TOKEN）校验后落盘四件套。
 *
 * 绑定地址默认 0.0.0.0（容器/systemd）；测试显式传 127.0.0.1。
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http"
import { timingSafeEqual } from "node:crypto"
import { CHANNEL_SYNC_ERROR } from "@mycontext/sync-contract"
import { jsonResponse } from "./http-utils.js"
import { handleChannelSyncPost } from "./routes/channel-sync.js"

export interface WebServerOptions {
  /** 数据根（等同 MYCONTEXT_DATA_DIR / desktop userData） */
  dataDir: string
  /** 同步 Bearer；等同 MYCONTEXT_SYNC_TOKEN */
  syncToken: string
  port?: number
  host?: string
}

export class WebServer {
  private server: Server | null = null
  private readonly syncToken: string

  constructor(private readonly options: WebServerOptions) {
    if (options.syncToken === "") {
      throw new Error("syncToken 不能为空（空 token 会让 Bearer 校验恒通过）")
    }
    this.syncToken = options.syncToken
  }

  get port(): number {
    const address = this.server?.address()
    return typeof address === "object" && address !== null ? address.port : 0
  }

  start(): Promise<number> {
    return new Promise((resolve, reject) => {
      const server = createServer((request, response) => {
        this.handle(request, response).catch(() => {
          jsonResponse(response, 500, { error: CHANNEL_SYNC_ERROR.INTERNAL })
        })
      })
      server.on("error", reject)
      const host = this.options.host ?? "0.0.0.0"
      server.listen(this.options.port ?? 0, host, () => {
        this.server = server
        resolve(this.port)
      })
    })
  }

  stop(): Promise<void> {
    const server = this.server
    if (server === null) return Promise.resolve()
    this.server = null
    return new Promise((resolve) => server.close(() => resolve()))
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`)

    if (url.pathname === "/health") {
      if (request.method !== "GET") {
        jsonResponse(response, 405, { error: CHANNEL_SYNC_ERROR.METHOD_NOT_ALLOWED })
        return
      }
      jsonResponse(response, 200, { ok: true })
      return
    }

    if (url.pathname === "/api/v1/channel-sync") {
      if (!this.authorized(request)) {
        jsonResponse(response, 401, { error: CHANNEL_SYNC_ERROR.UNAUTHORIZED })
        return
      }
      await handleChannelSyncPost(request, response, { dataDir: this.options.dataDir })
      return
    }

    jsonResponse(response, 404, { error: CHANNEL_SYNC_ERROR.NOT_FOUND })
  }

  /** Bearer 校验；长度不等直接拒，避免 timingSafeEqual 抛错。 */
  private authorized(request: IncomingMessage): boolean {
    const header = request.headers.authorization ?? ""
    const provided = header.startsWith("Bearer ") ? header.slice(7) : ""
    const expected = this.syncToken
    if (provided.length !== expected.length) return false
    return timingSafeEqual(Buffer.from(provided), Buffer.from(expected))
  }
}

/** CLI 入口：MYCONTEXT_DATA_DIR + MYCONTEXT_SYNC_TOKEN 必填。 */
export async function main(): Promise<void> {
  const dataDir = process.env["MYCONTEXT_DATA_DIR"]
  const syncToken = process.env["MYCONTEXT_SYNC_TOKEN"]
  if (dataDir === undefined || dataDir === "") {
    console.error("MYCONTEXT_DATA_DIR 未设置")
    process.exit(1)
  }
  if (syncToken === undefined || syncToken === "") {
    console.error("MYCONTEXT_SYNC_TOKEN 未设置")
    process.exit(1)
  }
  const port = Number(process.env["MYCONTEXT_PORT"] ?? "8787")
  const server = new WebServer({ dataDir, syncToken, port })
  await server.start()
  console.log(`web-server listening on :${server.port}`)
}

const entry = process.argv[1]
if (entry !== undefined && (entry.endsWith("/index.ts") || entry.endsWith("/index.js"))) {
  main().catch((error: unknown) => {
    console.error(error)
    process.exit(1)
  })
}
