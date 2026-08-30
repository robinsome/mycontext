/**
 * 对照表 mapped 行的默认 HTTP 客户端（用户 token）。
 * 禁止对未 mapped path 试探；403/无权限 → unreadable。
 */
import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { dwsCommandKey, type OpenApiCapabilityRow } from "@mycontext/channels"
import type { CollectCapabilityOutcome } from "./run-collect.js"

const API_HOST = "https://api.dingtalk.com"

export interface CallMappedContext {
  accessToken: string
  exportRoot: string
}

export type CallMappedFn = (
  row: OpenApiCapabilityRow,
  ctx: CallMappedContext,
) => Promise<CollectCapabilityOutcome>

function resolveUrl(path: string): string {
  if (path.startsWith("http://") || path.startsWith("https://")) return path
  return `${API_HOST}${path.startsWith("/") ? path : `/${path}`}`
}

async function userFetch(
  row: OpenApiCapabilityRow,
  accessToken: string,
): Promise<{ status: number; bodyText: string; json: unknown }> {
  const openApi = row.openApi
  if (openApi === null) {
    throw new Error("mapped 行缺少 openApi")
  }
  const response = await fetch(resolveUrl(openApi.path), {
    method: openApi.method,
    headers: {
      "x-acs-dingtalk-access-token": accessToken,
      ...(openApi.method !== "GET" ? { "Content-Type": "application/json" } : {}),
    },
  })
  const bodyText = await response.text()
  let json: unknown = null
  if (bodyText !== "") {
    try {
      json = JSON.parse(bodyText) as unknown
    } catch {
      json = null
    }
  }
  return { status: response.status, bodyText, json }
}

function writeIdentityMe(exportRoot: string, json: unknown): void {
  const dir = join(exportRoot, "identity")
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "me.json"), `${JSON.stringify(json, null, 2)}\n`, {
    mode: 0o600,
  })
}

/** 生产默认：按 row.openApi 调用户 token；get-self 额外落盘。 */
export const defaultCallMapped: CallMappedFn = async (row, ctx) => {
  const key = dwsCommandKey(row.dwsCommand)
  if (row.status !== "mapped" || row.openApi === null) {
    return { command: key, status: "error", detail: "非 mapped 行不应进入 callMapped" }
  }
  if (row.openApi.auth !== "user") {
    return { command: key, status: "error", detail: "仅支持 user token" }
  }

  let result: { status: number; bodyText: string; json: unknown }
  try {
    result = await userFetch(row, ctx.accessToken)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { command: key, status: "error", detail: message }
  }

  if (result.status === 401 || result.status === 403) {
    return {
      command: key,
      status: "unreadable",
      detail: `HTTP ${result.status}（无权限/拒绝，不绕过）`,
    }
  }
  if (result.status < 200 || result.status >= 300) {
    return {
      command: key,
      status: "error",
      detail: `HTTP ${result.status}`,
    }
  }
  if (result.json === null) {
    return { command: key, status: "error", detail: "响应非 JSON" }
  }

  if (key === "contact user get-self") {
    writeIdentityMe(ctx.exportRoot, result.json)
    return {
      command: key,
      status: "ok",
      detail: "wrote identity/me.json",
    }
  }

  return {
    command: key,
    status: "ok",
    detail: `HTTP ${result.status}`,
  }
}
