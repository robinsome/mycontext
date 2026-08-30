/**
 * Ubuntu Web Service HTTP 入口。
 *
 * · GET /health
 * · 静态 UI
 * · sync / channel-sync / graph/build（Bearer sync token）
 * · OAuth：/api/v1/auth/*（企业应用用户登录）
 * · 采集：/api/v1/capabilities、/api/v1/collect/run（session cookie）
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http"
import { timingSafeEqual } from "node:crypto"
import {
  AUTH_ERROR,
  CHANNEL_SYNC_ERROR,
  COLLECT_ERROR,
  GRAPH_BUILD_ERROR,
  SYNC_STATUS_ERROR,
  SYNC_TOKEN_ERROR,
} from "@mycontext/sync-contract"
import { jsonResponse } from "./http-utils.js"
import { handleChannelSyncPost } from "./routes/channel-sync.js"
import { handleGraphBuildPost } from "./routes/graph-build.js"
import { handleSyncStatusGet } from "./routes/sync-status.js"
import { handleSyncTokenRotatePost } from "./routes/sync-token-rotate.js"
import { handleSyncTokenGet } from "./routes/sync-token-get.js"
import { hasSyncTokenAdminAccess } from "./routes/sync-token-access.js"
import {
  handleAuthCallbackGet,
  handleAuthLoginGet,
  handleAuthLogoutPost,
  handleAuthMeGet,
  type AuthRouteDeps,
} from "./routes/auth.js"
import { handleCapabilitiesGet, handleCollectRunPost, type CollectRouteDeps } from "./routes/collect.js"
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
import {
  defaultExchangeUserToken,
  resolveOAuthConfig,
  type DingTalkOAuthConfig,
  type ExchangeUserToken,
} from "./oauth/dingtalk-oauth.js"
import { createFileSessionStore, type SessionStore } from "./oauth/session-store.js"

export type { GraphBuildRunner } from "./graph-build-runner.js"
export type { SyncTokenStore } from "./sync-token-store.js"
export { createSyncTokenStore, fixedSyncTokenStore, generateSyncToken } from "./sync-token-store.js"
export {
  buildAuthorizeUrl,
  vaultIdFromOpenId,
  resolveOAuthConfig,
  defaultExchangeUserToken,
} from "./oauth/dingtalk-oauth.js"
export { createFileSessionStore, parseSessionCookie } from "./oauth/session-store.js"
export { runCapabilityCollect } from "./collector/run-collect.js"
export { defaultCallMapped } from "./collector/openapi-client.js"

export interface WebServerOptions {
  dataDir: string
  syncToken?: string
  tokenStore?: SyncTokenStore
  port?: number
  host?: string
  graphBuildRunner?: GraphBuildRunner
  oauthConfig?: DingTalkOAuthConfig | null
  sessions?: SessionStore
  exchangeUserToken?: ExchangeUserToken
  secureCookie?: boolean
  callMapped?: CollectRouteDeps["callMapped"]
}

export class WebServer {
  private server: Server | null = null
  private readonly tokenStore: SyncTokenStore
  private readonly graphBuildRunner: GraphBuildRunner
  private readonly oauthConfig: DingTalkOAuthConfig | null
  private readonly sessions: SessionStore
  private readonly exchangeUserToken: ExchangeUserToken
  private readonly secureCookie: boolean
  private readonly callMapped: CollectRouteDeps["callMapped"]

  constructor(private readonly options: WebServerOptions) {
    if (options.tokenStore !== undefined) {
      this.tokenStore = options.tokenStore
    } else if (options.syncToken !== undefined) {
      this.tokenStore = fixedSyncTokenStore(options.syncToken)
    } else {
      this.tokenStore = createSyncTokenStore(options.dataDir)
    }
    this.graphBuildRunner = options.graphBuildRunner ?? new DefaultGraphBuildRunner()
    this.oauthConfig = options.oauthConfig === undefined ? null : options.oauthConfig
    this.sessions = options.sessions ?? createFileSessionStore(options.dataDir)
    this.exchangeUserToken = options.exchangeUserToken ?? defaultExchangeUserToken
    this.secureCookie = options.secureCookie === true
    this.callMapped = options.callMapped
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

  private authDeps(): AuthRouteDeps {
    return {
      oauthConfig: this.oauthConfig,
      sessions: this.sessions,
      exchangeUserToken: this.exchangeUserToken,
      secureCookie: this.secureCookie,
    }
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

    if (url.pathname === "/api/v1/auth/login") {
      if (request.method !== "GET") {
        jsonResponse(response, 405, { error: AUTH_ERROR.METHOD_NOT_ALLOWED })
        return
      }
      handleAuthLoginGet(request, response, this.authDeps())
      return
    }

    if (url.pathname === "/api/v1/auth/callback") {
      if (request.method !== "GET") {
        jsonResponse(response, 405, { error: AUTH_ERROR.METHOD_NOT_ALLOWED })
        return
      }
      await handleAuthCallbackGet(request, response, this.authDeps())
      return
    }

    if (url.pathname === "/api/v1/auth/me") {
      if (request.method !== "GET") {
        jsonResponse(response, 405, { error: AUTH_ERROR.METHOD_NOT_ALLOWED })
        return
      }
      handleAuthMeGet(request, response, this.authDeps())
      return
    }

    if (url.pathname === "/api/v1/auth/logout") {
      if (request.method !== "POST") {
        jsonResponse(response, 405, { error: AUTH_ERROR.METHOD_NOT_ALLOWED })
        return
      }
      handleAuthLogoutPost(request, response, this.authDeps())
      return
    }

    if (url.pathname === "/api/v1/capabilities") {
      if (request.method !== "GET") {
        jsonResponse(response, 405, { error: COLLECT_ERROR.METHOD_NOT_ALLOWED })
        return
      }
      handleCapabilitiesGet(request, response)
      return
    }

    if (url.pathname === "/api/v1/collect/run") {
      if (request.method !== "POST") {
        jsonResponse(response, 405, { error: COLLECT_ERROR.METHOD_NOT_ALLOWED })
        return
      }
      await handleCollectRunPost(request, response, {
        dataDir: this.options.dataDir,
        sessions: this.sessions,
        ...(this.callMapped !== undefined ? { callMapped: this.callMapped } : {}),
      })
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

    if (url.pathname === "/api/v1/sync/token") {
      if (!hasSyncTokenAdminAccess(request, this.tokenStore, this.sessions)) {
        jsonResponse(response, 401, { error: SYNC_TOKEN_ERROR.UNAUTHORIZED })
        return
      }
      handleSyncTokenGet(request, response, this.tokenStore)
      return
    }

    if (url.pathname === "/api/v1/sync/token/rotate") {
      if (!hasSyncTokenAdminAccess(request, this.tokenStore, this.sessions)) {
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

  private authorized(request: IncomingMessage): boolean {
    const header = request.headers.authorization ?? ""
    const provided = header.startsWith("Bearer ") ? header.slice(7) : ""
    const expected = this.tokenStore.get()
    if (provided.length !== expected.length) return false
    return timingSafeEqual(Buffer.from(provided), Buffer.from(expected))
  }
}

export function resolveListenHost(env: NodeJS.ProcessEnv): string | undefined {
  const host = env["MYCONTEXT_HOST"]
  return host !== undefined && host !== "" ? host : undefined
}

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
  const oauthConfig = resolveOAuthConfig(process.env)
  const server = new WebServer({
    dataDir,
    tokenStore,
    port,
    oauthConfig,
    ...(host !== undefined ? { host } : {}),
  })
  await server.start()
  if (oauthConfig === null) {
    console.log("OAuth 未配置（需 DINGTALK_CLIENT_ID/SECRET、DINGTALK_CORP_ID、OAUTH_REDIRECT_URI）")
  } else {
    console.log("OAuth 已配置：GET /api/v1/auth/login")
  }
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
