#!/usr/bin/env node
/**
 * 断言仓库解析到的 better-sqlite3 能被当前 Electron 加载。
 *
 * Windows 发版在 `dist:win` 之后还会再跑一遍 electron-builder 打 nsis/portable，
 * 那一步从 node_modules 取 .node。若此时仍是 Node ABI，安装包会静默打坏
 * （v0.1.1：127 vs Electron 148）。此脚本挂在打安装包之前，失败即停。
 */
import { spawnSync } from "node:child_process"
import { createRequire } from "node:module"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"

const root = resolve(fileURLToPath(import.meta.url), "..", "..")
const require = createRequire(import.meta.url)

let electronBin
try {
  electronBin = require("electron")
} catch (error) {
  console.error("✗ 解析不到 electron：", error instanceof Error ? error.message : error)
  process.exit(1)
}

const probe = spawnSync(
  electronBin,
  [
    "-e",
    "const Database = require('better-sqlite3'); const db = new Database(':memory:'); db.close(); process.stdout.write(String(process.versions.modules))",
  ],
  {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
    timeout: 60_000,
  },
)

if (probe.status !== 0) {
  const err = (probe.stderr ?? probe.stdout ?? "").trim().slice(0, 800)
  console.error(
    [
      "✗ better-sqlite3 无法被 Electron 加载（ABI 很可能仍是 Node）。",
      "  打 Windows 安装包前请确保 dist:win 保留了 Electron ABI 的 .node，",
      "  或手动执行 pnpm native:electron。",
      err !== "" ? `  原始信息：${err}` : "",
    ]
      .filter((line) => line !== "")
      .join("\n"),
  )
  process.exit(1)
}

const abi = (probe.stdout ?? "").trim()
console.log(`✓ better-sqlite3 可被 Electron 加载（ABI ${abi}）`)
