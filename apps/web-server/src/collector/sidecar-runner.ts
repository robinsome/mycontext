/**
 * 按 vault 隔离的 dws sidecar 执行器（Docker 或测试注入假 runner）。
 * 白名单与 openapi-capability-matrix 的 `sidecar` 行对齐；禁止扩大读取面。
 */
import { spawn } from "node:child_process"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { OPENAPI_CAPABILITY_MATRIX } from "@mycontext/channels"

export interface SidecarRunRequest {
  vaultId: string
  accessToken: string
  /** 例如 ["chat","list-all-conversations","--limit","1","-f","json"] */
  dwsArgs: readonly string[]
  /** 该 vault 的 DWS_CONFIG_DIR（宿主机/卷绝对路径） */
  configDir: string
  /** 可选：刷新 token；B1 MVP 可先不写 refresh 文件 */
  refreshToken?: string
}

export interface SidecarRunResult {
  exitCode: number
  /** 解析后的顶层 JSON；失败时为 null */
  json: unknown | null
  /** 已 redacted 的 stderr/stdout 摘要，禁止含 token 原文 */
  detail: string
}

export type SidecarRunner = (req: SidecarRunRequest) => Promise<SidecarRunResult>

/** 矩阵 `sidecar` 行的 dwsCommand 前缀；尾部 flags 允许。 */
const SIDECAR_ALLOWLIST_PREFIXES: readonly (readonly string[])[] =
  OPENAPI_CAPABILITY_MATRIX.filter((row) => row.status === "sidecar").map((row) => row.dwsCommand)

export function assertAllowlistedDwsArgs(dwsArgs: readonly string[]): void {
  const allowed = SIDECAR_ALLOWLIST_PREFIXES.some((prefix) => {
    if (dwsArgs.length < prefix.length) return false
    return prefix.every((part, index) => dwsArgs[index] === part)
  })
  if (!allowed) {
    throw new Error(`dws argv not on sidecar allowlist: ${dwsArgs.join(" ")}`)
  }
}

/** 并发闸：sidecar 容器同时最多 N 个。 */
class Semaphore {
  private active = 0
  private readonly waiting: (() => void)[] = []

  constructor(private readonly limit: number) {}

  async acquire(): Promise<() => void> {
    if (this.active < this.limit) {
      this.active += 1
      return () => this.release()
    }
    await new Promise<void>((resolve) => {
      this.waiting.push(resolve)
    })
    this.active += 1
    return () => this.release()
  }

  private release(): void {
    this.active -= 1
    const next = this.waiting.shift()
    if (next !== undefined) next()
  }
}

function shellSingleQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

/** 从 stdout 末段解析 dws JSON 输出（`-f json`）。 */
function parseDwsJson(stdout: string): unknown | null {
  const trimmed = stdout.trim()
  if (trimmed === "") return null
  const lines = trimmed.split("\n")
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i]?.trim() ?? ""
    if (line === "" || line[0] !== "{") continue
    try {
      return JSON.parse(line) as unknown
    } catch {
      // 继续向前找合法 JSON 行
    }
  }
  try {
    return JSON.parse(trimmed) as unknown
  } catch {
    return null
  }
}

function isDwsFailure(json: unknown | null): boolean {
  if (json === null || typeof json !== "object") return true
  if ("success" in json && (json as { success?: unknown }).success === false) return true
  return false
}

/** 摘要里不得出现 token 原文（含 env 泄漏与 CLI 回显）。 */
function redactSidecarDetail(text: string, accessToken: string): string {
  let out = text
  if (accessToken.length > 0) {
    out = out.split(accessToken).join("[REDACTED_TOKEN]")
  }
  // uat-/Bearer 等常见 token 形态
  out = out.replace(/\b(uat-[A-Za-z0-9_-]{8,})\b/g, "[REDACTED_TOKEN]")
  out = out.replace(/\bBearer\s+[A-Za-z0-9._-]{8,}\b/gi, "Bearer [REDACTED_TOKEN]")
  const maxLen = 2000
  if (out.length > maxLen) {
    return `${out.slice(0, maxLen)}…`
  }
  return out
}

function summarizeOutput(stdout: string, stderr: string, accessToken: string): string {
  const parts: string[] = []
  if (stderr.trim() !== "") parts.push(`stderr: ${stderr.trim()}`)
  if (stdout.trim() !== "") parts.push(`stdout: ${stdout.trim()}`)
  return redactSidecarDetail(parts.join("\n"), accessToken)
}

async function runProcess(
  bin: string,
  args: readonly string[],
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, [...args], { stdio: ["ignore", "pipe", "pipe"] })
    let stdout = ""
    let stderr = ""
    proc.stdout?.on("data", (chunk: Buffer | string) => {
      stdout += chunk.toString()
    })
    proc.stderr?.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString()
    })
    proc.on("error", reject)
    proc.on("close", (code) => {
      resolve({ exitCode: code ?? 1, stdout, stderr })
    })
  })
}

/** web-server 在容器内时，docker.sock spawn 的 -v/--env-file 须用宿主机路径。 */
export function resolveHostPath(containerPath: string): string {
  const hostDataDir = process.env["MYCONTEXT_HOST_DATA_DIR"]
  const dataDir = process.env["MYCONTEXT_DATA_DIR"] ?? "/data"
  if (hostDataDir !== undefined && hostDataDir !== "" && containerPath.startsWith(`${dataDir}/`)) {
    return join(hostDataDir, containerPath.slice(dataDir.length + 1))
  }
  if (hostDataDir !== undefined && hostDataDir !== "" && containerPath === dataDir) {
    return hostDataDir
  }
  return containerPath
}

/** 0600 env 文件：Node 写容器路径（MYCONTEXT_DATA_DIR 下），docker 读宿主机路径。 */
export function sidecarEnvContainerPath(configDir: string, vaultId: string): string {
  return join(dirname(configDir), `.sidecar-env-${vaultId}`)
}

function writeSidecarEnvFile(containerPath: string, accessToken: string): void {
  mkdirSync(dirname(containerPath), { recursive: true, mode: 0o700 })
  writeFileSync(containerPath, `DWS_ACCESS_TOKEN=${accessToken}\n`, { mode: 0o600, encoding: "utf8" })
}

/** 构造 sidecar `docker run` argv；token 仅经 --env-file，禁止 `-e DWS_ACCESS_TOKEN`。 */
export function buildSidecarDockerArgs(input: {
  image: string
  hostConfigDir: string
  hostEnvFile: string
  script: string
}): string[] {
  return [
    "run",
    "--rm",
    "-e",
    "DWS_CONFIG_DIR=/dws-home",
    "--env-file",
    input.hostEnvFile,
    "-v",
    `${input.hostConfigDir}:/dws-home`,
    "--entrypoint",
    "bash",
    input.image,
    "-lc",
    input.script,
  ]
}

export function createDockerSidecarRunner(options: {
  image: string
  /** 默认 docker */
  dockerBin?: string
  maxConcurrent?: number
}): SidecarRunner {
  const dockerBin = options.dockerBin ?? "docker"
  const gate = new Semaphore(options.maxConcurrent ?? 2)

  return async (req: SidecarRunRequest): Promise<SidecarRunResult> => {
    assertAllowlistedDwsArgs(req.dwsArgs)

    const release = await gate.acquire()
    let envContainerPath: string | undefined
    try {
      mkdirSync(req.configDir, { recursive: true, mode: 0o700 })

      const businessCmd = ["dws", ...req.dwsArgs].map(shellSingleQuote).join(" ")
      const script =
        `dws auth login --token "$DWS_ACCESS_TOKEN" -y && ${businessCmd}`

      const hostConfigDir = resolveHostPath(req.configDir)
      envContainerPath = sidecarEnvContainerPath(req.configDir, req.vaultId)
      writeSidecarEnvFile(envContainerPath, req.accessToken)
      const hostEnvFile = resolveHostPath(envContainerPath)

      const dockerArgs = buildSidecarDockerArgs({
        image: options.image,
        hostConfigDir,
        hostEnvFile,
        script,
      })

      const { exitCode, stdout, stderr } = await runProcess(dockerBin, dockerArgs)
      const detail = summarizeOutput(stdout, stderr, req.accessToken)

      if (exitCode !== 0) {
        return { exitCode, json: null, detail }
      }

      const json = parseDwsJson(stdout)
      if (isDwsFailure(json)) {
        return { exitCode, json: null, detail }
      }

      return { exitCode, json, detail }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return {
        exitCode: 1,
        json: null,
        detail: redactSidecarDetail(message, req.accessToken),
      }
    } finally {
      if (envContainerPath !== undefined) {
        try {
          rmSync(envContainerPath, { force: true })
        } catch {
          // 清理失败不掩盖业务结果
        }
      }
      release()
    }
  }
}
