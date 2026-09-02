/**
 * ★ 「降级必须可见」这条原则的门禁。
 *
 * `agentAvailable` 必须与 `prompt` 实际走的路一致：
 * 有 `llmProvider` → 走网关归纳；否则 → recallOnly。
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const SERVICE = join(
  import.meta.dirname,
  "../../../apps/desktop/src/main/services/search.service.ts",
)

describe("★ 搜索降级的可见性", () => {
  const source = readFileSync(SERVICE, "utf8")

  it("agentAvailable 由 llmProvider 决定", () => {
    expect(source).toMatch(/agentAvailable\(\)[\s\S]*llmProvider/)
    expect(source).toMatch(/tryGatewayAnswer/)
    expect(source).toMatch(/recallOnly/)
  })

  it("prompt 先走网关，失败再 recallOnly", () => {
    const gatewayIdx = source.indexOf("tryGatewayAnswer")
    const recallIdx = source.indexOf("recallOnly(")
    expect(gatewayIdx).toBeGreaterThan(-1)
    expect(recallIdx).toBeGreaterThan(gatewayIdx)
  })
})
