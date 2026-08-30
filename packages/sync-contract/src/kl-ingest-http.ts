/**
 * kl-server `POST /ingest` 的 HTTP 契约（纯函数，desktop 与 web-server 共用）。
 *
 * 上游 `IngestRequest` 是 `extra="forbid"`，字段名必须是 `input_dir` + `source_id`。
 * 见 `tests/unit/desktop/kl-ingest-request-body.test.ts`。
 */

/** 组装 `/ingest` 请求体。 */
export function buildIngestRequestBody(
  exportDir: string,
  sourceId: string,
): Record<string, unknown> {
  return { input_dir: exportDir, source_id: sourceId }
}

/** 向 kl-server 触发 ingest；返回 HTTP 状态码。 */
export async function postKlIngest(
  port: number,
  exportDir: string,
  sourceId: string,
): Promise<number> {
  const response = await fetch(`http://127.0.0.1:${String(port)}/ingest`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildIngestRequestBody(exportDir, sourceId)),
    signal: AbortSignal.timeout(10_000),
  })
  return response.status
}
