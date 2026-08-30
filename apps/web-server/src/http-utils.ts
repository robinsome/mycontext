import type { IncomingMessage, ServerResponse } from "node:http"

const MAX_BODY_BYTES = 64 * 1024 * 1024

export function jsonResponse(response: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
  })
  response.end(payload)
}

/** 读 POST JSON；非法 JSON 抛错，由路由映射为 400。 */
export async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let bytes = 0
  for await (const chunk of request) {
    bytes += (chunk as Buffer).length
    if (bytes > MAX_BODY_BYTES) {
      throw new Error("请求体过大")
    }
    chunks.push(chunk as Buffer)
  }
  if (chunks.length === 0) return {}
  const text = Buffer.concat(chunks).toString("utf8")
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw new Error("请求体不是合法 JSON")
  }
}
