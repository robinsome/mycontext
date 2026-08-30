/**
 * 对已落盘 exportDir 触发 kl ingest 的可注入端口。
 */
import { hasIngestibleExport, postKlIngest } from "@mycontext/sync-contract"

export interface GraphBuildParams {
  exportDir: string
  vaultId: string
  sourceId: string
}

export interface GraphBuildRunnerResult {
  ok: boolean
  reason?: string
}

export interface GraphBuildRunner {
  build(params: GraphBuildParams): Promise<GraphBuildRunnerResult>
}

export interface DefaultGraphBuildRunnerOptions {
  klPort?: number
}

/** 默认实现：校验四件套 records.jsonl 存在后 POST /ingest。 */
export class DefaultGraphBuildRunner implements GraphBuildRunner {
  private readonly klPort: number

  constructor(options: DefaultGraphBuildRunnerOptions = {}) {
    this.klPort = options.klPort ?? Number(process.env["KL_SERVER_PORT"] ?? "8200")
  }

  async build(params: GraphBuildParams): Promise<GraphBuildRunnerResult> {
    if (!hasIngestibleExport(params.exportDir)) {
      return { ok: false, reason: "no_export" }
    }
    try {
      const status = await postKlIngest(this.klPort, params.exportDir, params.sourceId)
      if (status === 409 || (status >= 200 && status < 300)) {
        return { ok: true }
      }
      return { ok: false, reason: `HTTP ${String(status)}` }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { ok: false, reason: message }
    }
  }
}
