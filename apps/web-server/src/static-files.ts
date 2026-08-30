/**
 * 托管 apps/web-server/public 下的薄静态 UI（Task 4 MVP）。
 */
import { createReadStream, existsSync, statSync } from "node:fs"
import { join, normalize, relative, sep } from "node:path"
import { fileURLToPath } from "node:url"
import type { ServerResponse } from "node:http"

const PUBLIC_DIR = join(fileURLToPath(new URL("..", import.meta.url)), "public")

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
  ".sh": "text/x-shellscript; charset=utf-8",
  ".ps1": "text/plain; charset=utf-8",
  ".template": "text/plain; charset=utf-8",
}


function resolvePublicPath(urlPath: string): string | null {
  const decoded = decodeURIComponent(urlPath)
  const rel = decoded === "/" || decoded === "" ? "index.html" : decoded.replace(/^\//, "")
  const normalized = normalize(rel)
  if (normalized.startsWith(`..${sep}`) || normalized === ".." || normalized.includes("\0")) {
    return null
  }
  const abs = join(PUBLIC_DIR, normalized)
  const relCheck = relative(PUBLIC_DIR, abs)
  if (relCheck.startsWith(`..${sep}`) || relCheck === "..") return null
  return abs
}

export function serveStatic(urlPath: string, response: ServerResponse): boolean {
  const abs = resolvePublicPath(urlPath)
  if (abs === null || !existsSync(abs)) return false

  const st = statSync(abs)
  if (!st.isFile()) return false

  const ext = abs.slice(abs.lastIndexOf("."))
  const contentType = MIME[ext] ?? "application/octet-stream"
  response.writeHead(200, { "content-type": contentType, "content-length": st.size })
  createReadStream(abs).pipe(response)
  return true
}
