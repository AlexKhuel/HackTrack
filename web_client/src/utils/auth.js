import { Capacitor } from "@capacitor/core"

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? "")
  .toString()
  .trim()
  .replace(/\/+$/, "")
const IOS_API_BASE_URL = (import.meta.env.VITE_API_BASE_URL_IOS ?? "")
  .toString()
  .trim()
  .replace(/\/+$/, "")

const SESSION_TOKEN_STORAGE_KEY = "hacktrack.auth.token"

function buildApiUrl(path) {
  const isNativeIos = Capacitor.isNativePlatform() && Capacitor.getPlatform() === "ios"
  const baseUrl = isNativeIos && IOS_API_BASE_URL ? IOS_API_BASE_URL : API_BASE_URL
  if (!baseUrl) return path
  return `${baseUrl}${path}`
}

function isLocalhostUrl(url) {
  return /\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/i.test(url)
}

function buildFetchErrorMessage(url, originalMessage = "") {
  const isNativeIos = Capacitor.isNativePlatform() && Capacitor.getPlatform() === "ios"
  if (isNativeIos && isLocalhostUrl(url)) {
    return `Could not reach API at ${url}. On iPhone, localhost/127.0.0.1 points to the phone itself. Set VITE_API_BASE_URL_IOS to a reachable API URL.`
  }

  const detail = (originalMessage ?? "").toString().trim()
  return detail ? `Could not reach API at ${url}: ${detail}` : `Could not reach API at ${url}.`
}

async function parseJsonResponse(response) {
  const raw = await response.text()
  if (!raw) return {}
  try {
    return JSON.parse(raw)
  } catch {
    return { error: raw }
  }
}

async function request(path, init = {}) {
  const url = buildApiUrl(path)
  let response
  try {
    response = await fetch(url, init)
  } catch (err) {
    throw new Error(buildFetchErrorMessage(url, err?.message))
  }

  const payload = await parseJsonResponse(response)

  if (!response.ok) {
    const message =
      typeof payload?.error === "string" && payload.error
        ? payload.error
        : `Request failed (${response.status})`
    throw new Error(message)
  }

  return payload
}

function getStoredSessionToken() {
  return window.localStorage.getItem(SESSION_TOKEN_STORAGE_KEY) || ""
}

function setStoredSessionToken(token) {
  if (!token) return
  window.localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, token)
}

function clearStoredSessionToken() {
  window.localStorage.removeItem(SESSION_TOKEN_STORAGE_KEY)
}

async function signInWithGoogleCredential(credential) {
  return request("/api/auth/google", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ credential }),
  })
}

async function fetchSessionUser(token) {
  return request("/api/auth/me", {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  })
}

async function saveUserInput(token, input) {
  return request("/api/user-inputs", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ input }),
  })
}

async function fetchLatestUserInput(token) {
  return request("/api/user-inputs/latest", {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  })
}

export {
  clearStoredSessionToken,
  fetchLatestUserInput,
  fetchSessionUser,
  getStoredSessionToken,
  saveUserInput,
  setStoredSessionToken,
  signInWithGoogleCredential,
}
