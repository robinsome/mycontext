const TOKEN_KEY = "mycontext.syncToken"
const VAULT_KEY = "mycontext.vaultId"

const tokenInput = document.getElementById("token-input")
const vaultInput = document.getElementById("vault-input")
const statusOutput = document.getElementById("status-output")
const rotateResult = document.getElementById("rotate-result")
const saveBtn = document.getElementById("save-btn")
const refreshBtn = document.getElementById("refresh-btn")
const rotateBtn = document.getElementById("rotate-btn")
const syncTokenHint = document.getElementById("sync-token-hint")

if (
  !(tokenInput instanceof HTMLInputElement) ||
  !(vaultInput instanceof HTMLInputElement) ||
  !(statusOutput instanceof HTMLElement) ||
  !(rotateResult instanceof HTMLElement) ||
  !(saveBtn instanceof HTMLButtonElement) ||
  !(refreshBtn instanceof HTMLButtonElement) ||
  !(rotateBtn instanceof HTMLButtonElement)
) {
  throw new Error("页面元素缺失")
}

const savedVault = sessionStorage.getItem(VAULT_KEY)
if (savedVault !== null) vaultInput.value = savedVault

function getToken() {
  const fromSession = sessionStorage.getItem(TOKEN_KEY)
  if (fromSession !== null && fromSession !== "") return fromSession
  const typed = tokenInput.value.trim()
  return typed === "" ? null : typed
}

function setTokenHint(text) {
  if (syncTokenHint instanceof HTMLElement) syncTokenHint.textContent = text
  tokenInput.placeholder = text
}

function authHeaders() {
  const token = getToken()
  if (token === null) throw new Error("尚无 Sync Token：请先扫码登录，或手动粘贴")
  return { authorization: `Bearer ${token}` }
}

/**
 * 钉钉登录后用 session cookie 拉 file-backed sync token，写入 sessionStorage。
 * env 锁定时提示改用部署配置，不报错打断页面。
 */
async function loadSyncTokenFromServer() {
  const response = await fetch("/api/v1/sync/token", { credentials: "same-origin" })
  const body = await response.json()
  if (response.status === 401) {
    setTokenHint("未登录：扫码后自动获取 Sync Token")
    return false
  }
  if (!response.ok || typeof body.token !== "string") {
    setTokenHint(
      typeof body.message === "string" ? body.message : "获取 Sync Token 失败",
    )
    return false
  }
  sessionStorage.setItem(TOKEN_KEY, body.token)
  tokenInput.value = ""
  const locked = body.envLocked === true ? "（部署环境锁定，不可在此轮换）" : ""
  setTokenHint(`已从服务器加载（前缀 ${body.prefix ?? ""}）${locked}`)
  return true
}

async function refreshAuthAndToken() {
  const meResp = await fetch("/api/v1/auth/me", { credentials: "same-origin" })
  const meBody = await meResp.json()
  if (!meResp.ok) {
    setTokenHint("未登录：扫码后自动获取 Sync Token")
    return { loggedIn: false, me: meBody }
  }
  if (typeof meBody.vaultId === "string" && meBody.vaultId !== "") {
    vaultInput.value = meBody.vaultId
    sessionStorage.setItem(VAULT_KEY, meBody.vaultId)
  }
  await loadSyncTokenFromServer()
  return { loggedIn: true, me: meBody }
}

async function fetchStatus() {
  const vaultId = vaultInput.value.trim()
  if (vaultId === "") {
    statusOutput.textContent = "请填写 Vault ID（登录后会自动填入）"
    return
  }
  statusOutput.textContent = "查询中…"
  try {
    if (getToken() === null) await loadSyncTokenFromServer()
    const response = await fetch(
      `/api/v1/sync/status?vaultId=${encodeURIComponent(vaultId)}`,
      { headers: authHeaders() },
    )
    const body = await response.json()
    statusOutput.textContent = JSON.stringify(body, null, 2)
  } catch (error) {
    statusOutput.textContent = error instanceof Error ? error.message : String(error)
  }
}

function saveSettings() {
  const token = tokenInput.value.trim()
  const vaultId = vaultInput.value.trim()
  if (token !== "") {
    sessionStorage.setItem(TOKEN_KEY, token)
    setTokenHint("已保存手动粘贴的 token")
  }
  if (vaultId !== "") sessionStorage.setItem(VAULT_KEY, vaultId)
  tokenInput.value = ""
  void fetchStatus()
}

async function rotateToken() {
  rotateResult.classList.remove("hidden", "error")
  rotateResult.textContent = "轮换中…"
  try {
    // 优先 OAuth cookie；若已有 Bearer 也带上（兼容未登录但持有旧 token）
    const fetchHeaders = {}
    const existing = getToken()
    if (existing !== null) fetchHeaders.authorization = `Bearer ${existing}`

    const response = await fetch("/api/v1/sync/token/rotate", {
      method: "POST",
      credentials: "same-origin",
      headers: fetchHeaders,
    })
    const body = await response.json()
    if (!response.ok) {
      rotateResult.classList.add("error")
      rotateResult.textContent =
        typeof body.message === "string" ? body.message : JSON.stringify(body, null, 2)
      return
    }
    if (typeof body.token !== "string") {
      rotateResult.classList.add("error")
      rotateResult.textContent = "响应缺少 token"
      return
    }
    sessionStorage.setItem(TOKEN_KEY, body.token)
    tokenInput.value = ""
    setTokenHint(`已保存新 token（前缀 ${body.prefix ?? ""}）`)
    rotateResult.textContent = `新 token（仅显示一次，请立即复制到本机 CLI 若仍需要）：\n\n${body.token}\n\n前缀：${body.prefix ?? ""}`
  } catch (error) {
    rotateResult.classList.add("error")
    rotateResult.textContent = error instanceof Error ? error.message : String(error)
  }
}

saveBtn.addEventListener("click", () => saveSettings())
refreshBtn.addEventListener("click", () => void fetchStatus())
rotateBtn.addEventListener("click", () => void rotateToken())

const meOutput = document.getElementById("me-output")
const capsOutput = document.getElementById("caps-output")
const collectOutput = document.getElementById("collect-output")
const meBtn = document.getElementById("me-btn")
const logoutBtn = document.getElementById("logout-btn")
const capsBtn = document.getElementById("caps-btn")
const collectBtn = document.getElementById("collect-btn")

if (
  meOutput instanceof HTMLElement &&
  capsOutput instanceof HTMLElement &&
  collectOutput instanceof HTMLElement &&
  meBtn instanceof HTMLButtonElement &&
  logoutBtn instanceof HTMLButtonElement &&
  capsBtn instanceof HTMLButtonElement &&
  collectBtn instanceof HTMLButtonElement
) {
  meBtn.addEventListener("click", () => {
    void (async () => {
      meOutput.textContent = "查询中…"
      try {
        const { loggedIn, me } = await refreshAuthAndToken()
        meOutput.textContent = JSON.stringify(me, null, 2)
        if (loggedIn) void fetchStatus()
      } catch (error) {
        meOutput.textContent = error instanceof Error ? error.message : String(error)
      }
    })()
  })

  logoutBtn.addEventListener("click", () => {
    void (async () => {
      await fetch("/api/v1/auth/logout", { method: "POST", credentials: "same-origin" })
      sessionStorage.removeItem(TOKEN_KEY)
      setTokenHint("未登录：扫码后自动获取 Sync Token")
      meOutput.textContent = "已退出"
    })()
  })

  capsBtn.addEventListener("click", () => {
    void (async () => {
      capsOutput.textContent = "加载中…"
      try {
        const response = await fetch("/api/v1/capabilities")
        const body = await response.json()
        capsOutput.textContent = JSON.stringify(body, null, 2)
      } catch (error) {
        capsOutput.textContent = error instanceof Error ? error.message : String(error)
      }
    })()
  })

  collectBtn.addEventListener("click", () => {
    void (async () => {
      collectOutput.textContent = "采集中…"
      try {
        const response = await fetch("/api/v1/collect/run", {
          method: "POST",
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          body: "{}",
        })
        const body = await response.json()
        collectOutput.textContent = JSON.stringify(body, null, 2)
      } catch (error) {
        collectOutput.textContent = error instanceof Error ? error.message : String(error)
      }
    })()
  })
}

const clientHours = document.getElementById("client-hours")
const dlTsBtn = document.getElementById("dl-ts-btn")
const clientCollectHint = document.getElementById("client-collect-hint")

function syncUrlForClient() {
  return `${window.location.origin}/api/v1/channel-sync`
}

function downloadTextFile(filename, text) {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

async function fillClientScript(templatePath, filename) {
  const hint = clientCollectHint instanceof HTMLElement ? clientCollectHint : undefined
  try {
    // 刷新后先尽量恢复登录态 / vault / token
    if (!vaultInput.value.trim() || getToken() === null) {
      await refreshAuthAndToken()
    }
    if (getToken() === null) {
      await loadSyncTokenFromServer()
    }

    let vaultId = vaultInput.value.trim() || sessionStorage.getItem(VAULT_KEY) || ""
    let token = getToken() || ""

    if (!token) {
      const typed = tokenInput.value.trim()
      if (typed) {
        token = typed
        sessionStorage.setItem(TOKEN_KEY, typed)
      }
    }
    if (!token) {
      if (hint) {
        hint.textContent =
          "缺少 Sync Token：请先扫码登录（登录后会自动写入），或在设置里粘贴 token 后再下载。"
      }
      return
    }
    if (!vaultId) {
      if (hint) hint.textContent = "缺少 Vault ID：请先扫码登录。"
      return
    }

    const hoursEl = clientHours instanceof HTMLInputElement ? clientHours : undefined
    const hours = hoursEl && hoursEl.value !== "" ? String(Math.max(0, Number(hoursEl.value) || 0)) : "24"
    const tplResp = await fetch(templatePath, { credentials: "same-origin" })
    if (!tplResp.ok) {
      throw new Error(
        `模板下载失败 HTTP ${tplResp.status}（若为 404，说明服务器镜像过旧，需重新部署含 /client/ 的版本）`,
      )
    }
    let text = await tplResp.text()
    text = text
      .replaceAll("__SYNC_URL__", syncUrlForClient())
      .replaceAll("__SYNC_TOKEN__", token)
      .replaceAll("__VAULT_ID__", vaultId)
      .replaceAll("__HOURS__", hours)
    downloadTextFile(filename, text)
    if (hint) {
      hint.textContent = `已下载 ${filename}（含当前站点凭证）。请勿提交到 git；运行前确认已 dws auth login。`
    }
  } catch (error) {
    if (hint) hint.textContent = error instanceof Error ? error.message : String(error)
  }
}

if (dlTsBtn instanceof HTMLButtonElement) {
  dlTsBtn.addEventListener("click", () => {
    void fillClientScript(
      "/client/collect-from-dws.ts.template",
      "mycontext-collect-from-dws.ts",
    )
  })
}

// 进入页面：若已有钉钉 session，自动拉 sync token + vaultId
void (async () => {
  try {
    const { loggedIn } = await refreshAuthAndToken()
    if (loggedIn || getToken() !== null) void fetchStatus()
  } catch {
    setTokenHint("未登录：扫码后自动获取 Sync Token")
  }
})()
