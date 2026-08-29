/**
 * `scripts/lib/kl-skill-sanitize.mjs` 的最小类型声明。
 *
 * 与 `python-env-mjs.d.ts` 同一理由：纯 JS 脚本不进 tsc `-b`，测试直接
 * import 运行时实现；缺的只是类型侧声明，避免 TS7016。
 *
 * ★ 用 named export 而不是 `export =`：测试是
 * `import { transformFor, withHostPreamble } from "…"`，
 * `export =` 配不上 named import（会报 TS2305）。
 */
declare module "*/scripts/lib/kl-skill-sanitize.mjs" {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export const transformFor: any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export const withHostPreamble: any
}
