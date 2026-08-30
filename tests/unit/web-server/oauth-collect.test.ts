/**
 * Task 1–4：OAuth session、capabilities、collect → 四件套 → graph/build。
 */
import { mkdtempSync, existsSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { hasIngestibleExport } from "@mycontext/sync-contract"
import { WebServer, vaultIdFromOpenId } from "../../../apps/web-server/src/index.js"
import { clearPendingOAuthStates } from "../../../apps/web-server/src/routes/auth.js"

const dirs: string[] = []

afterEach(async () => {
  clearPendingOAuthStates()
  while (dirs.length > 0) {
    const dir = dirs.pop()
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true })
  }
})

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "mycontext-oauth-"))
  dirs.push(dir)
  return dir
}

describe("oauth + collect MVP", () => {
  it("OAuth 未配置 → login 503", async () => {
    const dataDir = tempDir()
    const server = new WebServer({ dataDir, syncToken: "tok", oauthConfig: null })
    const port = await server.start()
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/v1/auth/login`, { redirect: "manual" })
      expect(res.status).toBe(503)
    } finally {
      await server.stop()
    }
  })

  it("callback 换 token → session → me；collect 写 deferred 进度与四件套；graph/build 可触发", async () => {
    const dataDir = tempDir()
    const oauthConfig = {
      clientId: "ding-fake-client",
      clientSecret: "fake-secret",
      corpId: "dingFAKECORP0001",
      redirectUri: "http://127.0.0.1/api/v1/auth/callback",
    }
    const builds: string[] = []
    const server = new WebServer({
      dataDir,
      syncToken: "sync-tok-fake",
      oauthConfig,
      exchangeUserToken: async () => ({
        accessToken: "user-access-fake",
        refreshToken: "user-refresh-fake",
        openId: "openFAKE0001",
        expireIn: 7200,
      }),
      // 避免单测打真网：mapped 行由注入处理
      callMapped: async (row, ctx) => {
        const command = row.dwsCommand.join(" ")
        if (command === "contact user get-self") {
          const dir = join(ctx.exportRoot, "identity")
          const { mkdirSync, writeFileSync } = await import("node:fs")
          mkdirSync(dir, { recursive: true })
          writeFileSync(
            join(dir, "me.json"),
            `${JSON.stringify({ openId: "openFAKE0001", nick: "Alice" }, null, 2)}\n`,
          )
          return { command, status: "ok", detail: "wrote identity/me.json" }
        }
        return { command, status: "error", detail: "unexpected mapped in test" }
      },
      graphBuildRunner: {
        build: async ({ exportDir }) => {
          builds.push(exportDir)
          return { ok: true }
        },
      },
    })
    const port = await server.start()
    try {
      const login = await fetch(`http://127.0.0.1:${port}/api/v1/auth/login`, { redirect: "manual" })
      expect(login.status).toBe(302)
      const location = login.headers.get("location")
      expect(location).toContain("login.dingtalk.com")
      const state = new URL(location!).searchParams.get("state")
      expect(state).toBeTruthy()

      const cb = await fetch(
        `http://127.0.0.1:${port}/api/v1/auth/callback?authCode=codeFAKE&state=${state}`,
        { redirect: "manual" },
      )
      expect(cb.status).toBe(302)
      const setCookie = cb.headers.get("set-cookie")
      expect(setCookie).toContain("mc_session=")
      const sessionCookie = setCookie!.split(";")[0]!

      const me = await fetch(`http://127.0.0.1:${port}/api/v1/auth/me`, {
        headers: { cookie: sessionCookie },
      })
      expect(me.status).toBe(200)
      const meBody = (await me.json()) as { vaultId: string; openId: string }
      expect(meBody.openId).toBe("openFAKE0001")
      expect(meBody.vaultId).toBe(vaultIdFromOpenId("openFAKE0001"))

      const caps = await fetch(`http://127.0.0.1:${port}/api/v1/capabilities`)
      expect(caps.status).toBe(200)
      const capsBody = (await caps.json()) as { capabilities: unknown[] }
      expect(capsBody.capabilities.length).toBeGreaterThan(10)

      const collect = await fetch(`http://127.0.0.1:${port}/api/v1/collect/run`, {
        method: "POST",
        headers: { cookie: sessionCookie, "content-type": "application/json" },
        body: "{}",
      })
      expect(collect.status).toBe(200)
      const collectBody = (await collect.json()) as {
        ok: boolean
        exportRoot: string
        results: { status: string }[]
      }
      expect(collectBody.ok).toBe(true)
      expect(collectBody.results.some((r) => r.status === "ok")).toBe(true)
      expect(collectBody.results.some((r) => r.status === "deferred")).toBe(true)
      expect(existsSync(join(collectBody.exportRoot, "identity", "me.json"))).toBe(true)
      expect(existsSync(join(collectBody.exportRoot, "collect-progress.json"))).toBe(true)
      expect(hasIngestibleExport(collectBody.exportRoot)).toBe(true)

      const build = await fetch(`http://127.0.0.1:${port}/api/v1/graph/build`, {
        method: "POST",
        headers: {
          authorization: "Bearer sync-tok-fake",
          "content-type": "application/json",
        },
        body: JSON.stringify({ vaultId: meBody.vaultId }),
      })
      expect(build.status).toBe(200)
      expect(builds.length).toBe(1)
      expect(builds[0]).toBe(collectBody.exportRoot)

      const progress = JSON.parse(
        readFileSync(join(collectBody.exportRoot, "collect-progress.json"), "utf8"),
      ) as { results: unknown[] }
      expect(progress.results.length).toBeGreaterThan(0)
    } finally {
      await server.stop()
    }
  })

  it("无 session 时 collect → 401", async () => {
    const dataDir = tempDir()
    const server = new WebServer({
      dataDir,
      syncToken: "t",
      oauthConfig: {
        clientId: "c",
        clientSecret: "s",
        corpId: "corp",
        redirectUri: "http://127.0.0.1/cb",
      },
    })
    const port = await server.start()
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/v1/collect/run`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      })
      expect(res.status).toBe(401)
    } finally {
      await server.stop()
    }
  })

  it("defaultExchangeUserToken：token 响应无 openId 时补拉 /users/me", async () => {
    const { defaultExchangeUserToken, buildAuthorizeUrl } = await import(
      "../../../apps/web-server/src/oauth/dingtalk-oauth.js"
    )
    const auth = buildAuthorizeUrl(
      {
        clientId: "ding-fake",
        clientSecret: "sec",
        corpId: "dingFAKECORP",
        redirectUri: "http://127.0.0.1/cb",
      },
      "state1",
    )
    expect(auth).toContain("corpId=dingFAKECORP")

    const originalFetch = globalThis.fetch
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes("/oauth2/userAccessToken")) {
        expect(JSON.parse(String(init?.body))).toMatchObject({
          grantType: "authorization_code",
          code: "codeFAKE",
        })
        return new Response(
          JSON.stringify({
            accessToken: "uat-fake",
            refreshToken: "urt-fake",
            expireIn: 7200,
            corpId: "dingFAKECORP",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        )
      }
      if (url.includes("/contact/users/me")) {
        expect((init?.headers as Record<string, string>)["x-acs-dingtalk-access-token"]).toBe(
          "uat-fake",
        )
        return new Response(JSON.stringify({ openId: "openFAKE0001", unionId: "unionFAKE0001" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      }
      throw new Error(`unexpected fetch ${url}`)
    }) as typeof fetch
    try {
      const tokens = await defaultExchangeUserToken({
        code: "codeFAKE",
        config: {
          clientId: "ding-fake",
          clientSecret: "sec",
          corpId: "dingFAKECORP",
          redirectUri: "http://127.0.0.1/cb",
        },
      })
      expect(tokens.accessToken).toBe("uat-fake")
      expect(tokens.openId).toBe("openFAKE0001")
      expect(tokens.unionId).toBe("unionFAKE0001")
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
