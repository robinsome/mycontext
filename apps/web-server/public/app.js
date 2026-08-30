const TOKEN_KEY = "mycontext.syncToken"
const VAULT_KEY = "mycontext.vaultId"

const tokenInput = document.getElementById("token-input")
const vaultInput = document.getElementById("vault-input")
const statusOutput = document.getElementById("status-output")
const rotateResult = document.getElementById("rotate-result")
const saveBtn = document.getElementById("save-btn")
const refreshBtn = document.getElementById("refresh-btn")
const rotateBtn = document.getElementById("rotate-btn")

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

function authHeaders() {
  const token = getToken()
  if (token === null) throw new Error("请先填写并保存 Sync Token")
  return { authorization: `Bearer ${token}` }
}

async function fetchStatus() {
  const vaultId = vaultInput.value.trim()
  if (vaultId === "") {
    statusOutput.textContent = "请填写 Vault ID"
    return
  }
  statusOutput.textContent = "查询中…"
  try {
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
  if (token !== "") sessionStorage.setItem(TOKEN_KEY, token)
  if (vaultId !== "") sessionStorage.setItem(VAULT_KEY, vaultId)
  tokenInput.value = ""
  tokenInput.placeholder = sessionStorage.getItem(TOKEN_KEY) !== null ? "已保存（重新粘贴可覆盖）" : ""
  void fetchStatus()
}

async function rotateToken() {
  rotateResult.classList.remove("hidden", "error")
  rotateResult.textContent = "轮换中…"
  try {
    const response = await fetch("/api/v1/sync/token/rotate", {
      method: "POST",
      headers: authHeaders(),
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
    tokenInput.placeholder = "已保存新 token"
    rotateResult.textContent = `新 token（仅显示一次，请立即复制）：\n\n${body.token}\n\n前缀：${body.prefix ?? ""}`
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
        const response = await fetch("/api/v1/auth/me", { credentials: "same-origin" })
        const body = await response.json()
        meOutput.textContent = JSON.stringify(body, null, 2)
      } catch (error) {
        meOutput.textContent = error instanceof Error ? error.message : String(error)
      }
    })()
  })

  logoutBtn.addEventListener("click", () => {
    void (async () => {
      await fetch("/api/v1/auth/logout", { method: "POST", credentials: "same-origin" })
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

if (sessionStorage.getItem(TOKEN_KEY) !== null) {
  tokenInput.placeholder = "已保存（重新粘贴可覆盖）"
  void fetchStatus()
}
