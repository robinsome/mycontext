import type { IncomingMessage, ServerResponse } from "node:http"
import { COLLECT_ERROR, collectRunRequestSchema } from "@mycontext/sync-contract"
import { OPENAPI_CAPABILITY_MATRIX, dwsCommandKey } from "@mycontext/channels"
import { jsonResponse, readJsonBody } from "../http-utils.js"
import { runCapabilityCollect } from "../collector/run-collect.js"
import type { CallMappedFn } from "../collector/openapi-client.js"
import { createDockerSidecarRunner, type SidecarRunner } from "../collector/sidecar-runner.js"
import { parseSessionCookie, type SessionStore } from "../oauth/session-store.js"

export interface CollectRouteDeps {
  dataDir: string
  sessions: SessionStore
  callMapped?: CallMappedFn
  /** 测试注入；缺省且 env 有 MYCONTEXT_DWS_SIDECAR_IMAGE 时构造 Docker runner */
  sidecarRunner?: SidecarRunner
}

function resolveSidecarRunner(deps: CollectRouteDeps): SidecarRunner | undefined {
  if (deps.sidecarRunner !== undefined) return deps.sidecarRunner
  const image = process.env["MYCONTEXT_DWS_SIDECAR_IMAGE"]
  if (image === undefined || image === "") return undefined
  const maxRaw = process.env["MYCONTEXT_DWS_SIDECAR_MAX_CONCURRENT"]
  const maxConcurrent =
    maxRaw !== undefined && maxRaw !== "" ? Number.parseInt(maxRaw, 10) : undefined
  return createDockerSidecarRunner({
    image,
    ...(maxConcurrent !== undefined && Number.isFinite(maxConcurrent)
      ? { maxConcurrent }
      : {}),
  })
}

export function handleCapabilitiesGet(_request: IncomingMessage, response: ServerResponse): void {
  jsonResponse(response, 200, {
    capabilities: OPENAPI_CAPABILITY_MATRIX.map((row) => ({
      command: dwsCommandKey(row.dwsCommand),
      status: row.status,
      skillRef: row.skillRef,
      notes: row.notes,
      hasOpenApi: row.openApi !== null,
    })),
  })
}

export async function handleCollectRunPost(
  request: IncomingMessage,
  response: ServerResponse,
  deps: CollectRouteDeps,
): Promise<void> {
  const sessionId = parseSessionCookie(request.headers.cookie)
  if (sessionId === null) {
    jsonResponse(response, 401, { error: COLLECT_ERROR.UNAUTHORIZED })
    return
  }
  const session = deps.sessions.get(sessionId)
  if (session === null) {
    jsonResponse(response, 401, { error: COLLECT_ERROR.UNAUTHORIZED })
    return
  }

  let body: unknown
  try {
    body = await readJsonBody(request)
  } catch {
    jsonResponse(response, 400, { error: COLLECT_ERROR.INVALID_BODY })
    return
  }
  // 空 body 视为 {}
  const parsed = collectRunRequestSchema.safeParse(body === undefined ? {} : body)
  if (!parsed.success) {
    jsonResponse(response, 400, { error: COLLECT_ERROR.INVALID_BODY })
    return
  }

  try {
    const sidecarRunner = resolveSidecarRunner(deps)
    const result = await runCapabilityCollect({
      dataDir: deps.dataDir,
      vaultId: session.vaultId,
      accessToken: session.accessToken,
      ...(parsed.data.commands !== undefined ? { commandKeys: parsed.data.commands } : {}),
      ...(deps.callMapped !== undefined ? { callMapped: deps.callMapped } : {}),
      ...(sidecarRunner !== undefined ? { sidecarRunner } : {}),
    })
    jsonResponse(response, 200, {
      ok: true,
      vaultId: session.vaultId,
      exportRoot: result.exportRoot,
      results: result.results,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    jsonResponse(response, 502, { error: COLLECT_ERROR.FAILED, message })
  }
}
