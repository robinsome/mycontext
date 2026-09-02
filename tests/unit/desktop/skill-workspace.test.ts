/**
 * ★ kl skill 资源目录仍由 SearchService 接收；建会话不再 cpSync 副本。
 */
import { mkdtempSync, rmSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { createLogger, ManualClock } from "@mycontext/kernel"
import type { ProcessRunner, RuntimeEnv } from "@mycontext/runtime-env"
import { SearchService } from "@main/services/search.service.js"
import { openTestVault } from "../../helpers/vault.js"

const START = 1_785_000_000_000
const REPO_ROOT = resolve(import.meta.dirname, "../../..")
const SKILLS_RESOURCE = join(REPO_ROOT, "apps/desktop/resources/skills")

const dirs: string[] = []
afterEach(() => {
  while (dirs.length > 0) {
    const dir = dirs.pop()
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true })
  }
})

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "mycontext-skill-"))
  dirs.push(dir)
  return dir
}

function makeService(options: { skillsDir?: string } = {}) {
  const vault = openTestVault()
  const workspaceRoot = tempDir()
  const service = new SearchService({
    clock: new ManualClock(START),
    logger: createLogger("test-search", { level: "error" }),
    runtime: {} as RuntimeEnv,
    processes: {} as ProcessRunner,
    ...(options.skillsDir === undefined ? {} : { skillsDir: options.skillsDir }),
    klRoot: "/fake/kl-graph",
    klPort: 8200,
    primaryChannelId: "dingtalk",
    getWindow: () => null,
  })
  service.attach(vault.db, {
    workspaceRoot,
    home: join(workspaceRoot, "agent-home"),
    npmCache: join(workspaceRoot, "npm-cache"),
  })
  return { vault, service, workspaceRoot }
}

describe("★ SearchService.create 不再 cpSync skill 到 cwd", () => {
  it("★★ 建会话时 `<cwd>/.opencode/skills/` 里**没有** kl 副本", () => {
    const { vault, service, workspaceRoot } = makeService({ skillsDir: SKILLS_RESOURCE })
    try {
      const session = service.create("上周的会议聊了什么")
      const cwd = join(workspaceRoot, "search", session.id)
      expect(existsSync(join(cwd, ".opencode", "skills", "kl", "SKILL.md"))).toBe(false)
    } finally {
      vault.close()
    }
  })

  it("skillsDir 不存在时建会话仍成功（降级而不是崩）", () => {
    const { vault, service } = makeService({ skillsDir: join(tmpdir(), "definitely-not-here") })
    try {
      expect(() => service.create("查询")).not.toThrow()
    } finally {
      vault.close()
    }
  })

  it("完全不传 skillsDir 也不崩（可选依赖）", () => {
    const { vault, service } = makeService()
    try {
      expect(() => service.create("查询")).not.toThrow()
    } finally {
      vault.close()
    }
  })
})
