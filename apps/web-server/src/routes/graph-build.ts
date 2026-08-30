/**
 * POST /api/v1/graph/build —— 消费 Task 1 落盘的 exports/dws，触发 kl ingest。
 */
import type { IncomingMessage, ServerResponse } from "node:http"
import {
  GRAPH_BUILD_ERROR,
  graphBuildRequestSchema,
  hasIngestibleExport,
} from "@mycontext/sync-contract"
import type { GraphBuildRunner } from "../graph-build-runner.js"
import { exportRootForVault } from "./channel-sync.js"
import { jsonResponse, readJsonBody } from "../http-utils.js"

export interface GraphBuildRouteOptions {
  dataDir: string
  graphBuildRunner: GraphBuildRunner
  /** 请求体未带 sourceId 时的缺省（与 channel-sync manifest.channelId 常见值一致）。 */
  defaultSourceId?: string
}

export async function handleGraphBuildPost(
  request: IncomingMessage,
  response: ServerResponse,
  options: GraphBuildRouteOptions,
): Promise<void> {
  if (request.method !== "POST") {
    jsonResponse(response, 405, { error: GRAPH_BUILD_ERROR.METHOD_NOT_ALLOWED })
    return
  }

  let raw: unknown
  try {
    raw = await readJsonBody(request)
  } catch (error) {
    const message = error instanceof Error ? error.message : ""
    if (message.includes("JSON") || message.includes("json")) {
      jsonResponse(response, 400, { error: GRAPH_BUILD_ERROR.INVALID_JSON })
      return
    }
    jsonResponse(response, 400, { error: GRAPH_BUILD_ERROR.INVALID_BODY })
    return
  }

  const parsed = graphBuildRequestSchema.safeParse(raw)
  if (!parsed.success) {
    jsonResponse(response, 400, {
      error: GRAPH_BUILD_ERROR.INVALID_BODY,
      details: parsed.error.flatten(),
    })
    return
  }

  let exportDir: string
  try {
    exportDir = exportRootForVault(options.dataDir, parsed.data.vaultId)
  } catch (error) {
    const message = error instanceof Error ? error.message : ""
    if (message.includes("路径逃逸")) {
      jsonResponse(response, 400, { error: GRAPH_BUILD_ERROR.INVALID_BODY })
      return
    }
    throw error
  }

  if (!hasIngestibleExport(exportDir)) {
    jsonResponse(response, 404, { error: GRAPH_BUILD_ERROR.NO_EXPORT })
    return
  }

  const sourceId = parsed.data.sourceId ?? options.defaultSourceId ?? "dingtalk"
  const result = await options.graphBuildRunner.build({
    exportDir,
    vaultId: parsed.data.vaultId,
    sourceId,
  })

  if (!result.ok) {
    jsonResponse(response, 502, {
      error: GRAPH_BUILD_ERROR.BUILD_FAILED,
      reason: result.reason,
    })
    return
  }

  jsonResponse(response, 200, {
    ok: true,
    exportDir,
    vaultId: parsed.data.vaultId,
    sourceId,
  })
}
