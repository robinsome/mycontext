/**
 * Ubuntu Web Service HTTP 入口。
 *
 * · GET /health —— 探活，无需鉴权；
 * · GET / —— 薄静态 UI（同步状态 / token 设置）；
 * · GET /api/v1/sync/status?vaultId= —— Bearer 校验后查导出落盘状态；
 * · POST /api/v1/sync/token/rotate —— 文件-backed token 轮换（env 锁定则 409）；
 * · POST /api/v1/channel-sync —— Bearer 校验后落盘四件套；
 * · POST /api/v1/graph/build —— Bearer 校验后对 exports/dws 触发 kl ingest。
 *
 * Token：MYCONTEXT_SYNC_TOKEN 非空则进程内锁定；否则读写 dataDir/sync-token。
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http"
import { timingSafeEqual } from "node:crypto"
import {
  CHANNEL_SYNC_ERROR,
  GRAPH_BUILD_ERROR,
  SYNC_STATUS_ERROR,
  SYNC_TOKEN_ERROR,
} from "@mycontext/sync-contract"
import { jsonResponse } from "./http-utils.js"
import { handleChannelSyncPost } from "./routes/channel-sync.js"
import { handleGraphBuildPost } from "./routes/graph-build.js"
import { handleSyncStatusGet } from "./routes/sync-status.js"
import { handleSyncTokenRotatePost } from "./routes/sync-token-rotate.js"
import {
  DefaultGraphBuildRunner,
  type GraphBuildRunner,
} from "./graph-build-runner.js"
import {
  createSyncTokenStore,
  fixedSyncTokenStore,
  type SyncTokenStore,
} from "./sync-token-store.js"
import { serveStatic } from "./static-files.js"

export type { GraphBuildRunner } from "./graph-build-runner.js"
export type { SyncTokenStore } from "./sync-token-store.js"
export { createSyncTokenStore, fixedSyncTokenStore, generateSyncToken } from "./sync-token-store.js"

export interface WebServerOptions {
  /** 数据根（等同 MYCONTEXT_DATA_DIR / desktop userData） */
  dataDir: string
  /** 同步 Bearer；等同 MYCONTEXT_SYNC_TOKEN（测试 / env 锁定模式） */
  syncToken?: string
  /** 显式 token 存储；优先于 syncToken 字符串。 */
  tokenStore?: SyncTokenStore
  port?: number
  host?: string
  /** 建图触发；测试注入 mock，生产用 DefaultGraphBuildRunner。 */
  graphBuildRunner?: GraphBuildRunner
}

export class WebServer {
  private server: Server | null = null
  private readonly tokenStore: SyncTokenStore
  private readonly graphBuildRunner: GraphBuildRunner

  constructor(private readonly options: WebServerOptions) {
    if (options.tokenStore !== undefined) {
      this.tokenStore = options.tokenStore
    } else if (options.syncToken !== undefined) {
      this.tokenStore = fixedSyncTokenStore(options.syncToken)
    } else {
      this.tokenStore = createSyncTokenStore(options.dataDir)
    }
    this.graphBuildRunner = options.graphBuildRunner ?? new DefaultGraphBuildRunner()
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

    if (url.pathname === "/api/v1/sync/status") {
      if (!this.authorized(request)) {
        jsonResponse(response, 401, { error: SYNC_STATUS_ERROR.UNAUTHORIZED })
        return
      }
      handleSyncStatusGet(request, response, { dataDir: this.options.dataDir })
      return
    }

    if (url.pathname === "/api/v1/sync/token/rotate") {
      if (!this.authorized(request)) {
        jsonResponse(response, 401, { error: SYNC_TOKEN_ERROR.UNAUTHORIZED })
        return
      }
      handleSyncTokenRotatePost(request, response, this.tokenStore)
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

    if (url.pathname === "/api/v1/graph/build") {
      if (!this.authorized(request)) {
        jsonResponse(response, 401, { error: GRAPH_BUILD_ERROR.UNAUTHORIZED })
        return
      }
      await handleGraphBuildPost(request, response, {
        dataDir: this.options.dataDir,
        graphBuildRunner: this.graphBuildRunner,
      })
      return
    }

    if (request.method === "GET" && serveStatic(url.pathname, response)) {
      return
    }

    jsonResponse(response, 404, { error: CHANNEL_SYNC_ERROR.NOT_FOUND })
  }

  /** Bearer 校验；长度不等直接拒，避免 timingSafeEqual 抛错。 */
  private authorized(request: IncomingMessage): boolean {
    const header = request.headers.authorization ?? ""
    const provided = header.startsWith("Bearer ") ? header.slice(7) : ""
    const expected = this.tokenStore.get()
    if (provided.length !== expected.length) return false
    return timingSafeEqual(Buffer.from(provided), Buffer.from(expected))
  }
}

/** 从 env 解析 listen host；未设置或空串则交给 WebServer 默认 0.0.0.0。 */
export function resolveListenHost(env: NodeJS.ProcessEnv): string | undefined {
  const host = env["MYCONTEXT_HOST"]
  return host !== undefined && host !== "" ? host : undefined
}

/** CLI 入口：MYCONTEXT_DATA_DIR 必填；token 来自 env 或 dataDir/sync-token。 */
export async function main(): Promise<void> {
  const dataDir = process.env["MYCONTEXT_DATA_DIR"]
  const envToken = process.env["MYCONTEXT_SYNC_TOKEN"]
  if (dataDir === undefined || dataDir === "") {
    console.error("MYCONTEXT_DATA_DIR 未设置")
    process.exit(1)
  }
  const tokenStore = createSyncTokenStore(dataDir, envToken)
  const port = Number(process.env["MYCONTEXT_PORT"] ?? "8787")
  const host = resolveListenHost(process.env)
  const server = new WebServer({
    dataDir,
    tokenStore,
    port,
    ...(host !== undefined ? { host } : {}),
  })
  await server.start()
  if (envToken === undefined || envToken === "") {
    console.log("sync token 来自 dataDir/sync-token（可在浏览器设置页轮换）")
  } else {
    console.log("sync token 来自 MYCONTEXT_SYNC_TOKEN（进程内不可轮换）")
  }
  console.log(`web-server listening on :${server.port}`)
}

const entry = process.argv[1]
if (entry !== undefined && (entry.endsWith("/index.ts") || entry.endsWith("/index.js"))) {
  main().catch((error: unknown) => {
    console.error(error)
    process.exit(1)
  })
}
