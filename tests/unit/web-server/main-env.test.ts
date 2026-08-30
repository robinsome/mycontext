import { describe, expect, it } from "vitest"
import { resolveListenHost } from "../../../apps/web-server/src/index.js"

describe("resolveListenHost", () => {
  it("MYCONTEXT_HOST 非空时使用该值", () => {
    expect(resolveListenHost({ MYCONTEXT_HOST: "127.0.0.1" })).toBe("127.0.0.1")
  })

  it("未设置或空串时不覆盖 WebServer 默认", () => {
    expect(resolveListenHost({})).toBeUndefined()
    expect(resolveListenHost({ MYCONTEXT_HOST: "" })).toBeUndefined()
  })
})
