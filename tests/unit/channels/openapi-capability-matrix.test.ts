/**
 * 开放平台能力对照表必须覆盖每一个 READ 白名单命令：
 * 遗漏 = 采集器可能静默跳过；重复 = 调度歧义。
 */
import { describe, expect, it } from "vitest"
import { DWS_COMMAND_ALLOWLIST } from "../../../packages/channels/src/plugins/dingtalk/cli.js"
import {
  OPENAPI_CAPABILITY_MATRIX,
  dwsCommandKey,
  matrixRowForCommand,
} from "../../../packages/channels/src/plugins/dingtalk/openapi-capability-matrix.js"

describe("openapi-capability-matrix", () => {
  it("每个 READ_COMMANDS 条目恰好一行，无重复", () => {
    const readKeys = DWS_COMMAND_ALLOWLIST.read.map((cmd) => dwsCommandKey(cmd))
    const matrixKeys = OPENAPI_CAPABILITY_MATRIX.map((row) => dwsCommandKey(row.dwsCommand))

    expect(matrixKeys.sort()).toEqual([...readKeys].sort())
    expect(new Set(matrixKeys).size).toBe(matrixKeys.length)
  })

  it("matrixRowForCommand 能按完整命令命中", () => {
    const row = matrixRowForCommand(["contact", "user", "get-self"])
    expect(row).toBeDefined()
    expect(row?.skillRef).toContain("dingtalk-contact")
  })

  it("mapped 行必须带 openApi；deferred/unsupported 的 openApi 为 null", () => {
    for (const row of OPENAPI_CAPABILITY_MATRIX) {
      if (row.status === "mapped") {
        expect(row.openApi, dwsCommandKey(row.dwsCommand)).not.toBeNull()
        expect(row.openApi?.auth).toBe("user")
      } else {
        expect(row.openApi, dwsCommandKey(row.dwsCommand)).toBeNull()
      }
    }
  })

  it("MVP 首波候选（身份/会话/消息）不得标 unsupported", () => {
    const mvpPrefixes = [
      "contact user get-self",
      "chat message list",
      "chat message list-all",
      "chat list-all-conversations",
      "chat conversation-info",
      "chat group list-all",
    ]
    for (const key of mvpPrefixes) {
      const row = OPENAPI_CAPABILITY_MATRIX.find((r) => dwsCommandKey(r.dwsCommand) === key)
      expect(row, key).toBeDefined()
      expect(row?.status, key).not.toBe("unsupported")
    }
  })

  it("个人 Stream 事件在本阶段为 deferred（与企业回调模型不同）", () => {
    const row = matrixRowForCommand(["event", "consume", "user_im_message_receive_at"])
    expect(row?.status).toBe("deferred")
  })
})
