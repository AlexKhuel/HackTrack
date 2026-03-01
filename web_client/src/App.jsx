import { useEffect, useMemo, useRef, useState } from "react"
import { Capacitor } from "@capacitor/core"
import { StatusBar, Style } from "@capacitor/status-bar"
import { SocialLogin } from "@capgo/capacitor-social-login"
import HomePage from "./components/HomePage"
import NavBar from "./components/NavBar"
import InputForm from "./components/InputForm"
import ResultsList from "./components/ResultsList"
import BackgroundScene from "./components/BackgroundScene"
import GoogleSignInPage from "./components/GoogleSignInPage"
import {
  clearStoredSessionToken,
  fetchLatestUserInput,
  saveUserInput,
  setStoredSessionToken,
  signInWithGoogleCredential,
} from "./utils/auth"
import {
  inferAirportMetadataFromCodes,
  inferBrowserCountry,
  inferBrowserTimezone,
  normalizeAirportCode,
} from "./utils/airportMetadata"

const DEFAULT_FORM = {
  name: "",
  timezone: "",
  country: "",
  primary_airport_code: "",
  secondary_airport_code: "",
  tertiary_airport_code: "",
  max_cost: "",
  max_time: "",
  friday_last_class: "",
  monday_first_class: "",
  friend_cities: [],
}

const AUTH_STATUS = {
  CHECKING: "checking",
  SIGNED_OUT: "signed_out",
  SIGNED_IN: "signed_in",
  GUEST: "guest",
}

function parseFriendCities(raw) {
  if (Array.isArray(raw)) {
    return raw
      .map((entry) => (entry ?? "").toString().trim())
      .filter(Boolean)
  }

  const text = (raw ?? "").toString().trim()
  if (!text) return []

  if (text.startsWith("[") && text.endsWith("]")) {
    try {
      const parsed = JSON.parse(text)
      if (Array.isArray(parsed)) return parseFriendCities(parsed)
    } catch {
      // Fall back to comma parsing.
    }
  }

  return text
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
}

function parseFormFromSearch(search) {
  const params = new URLSearchParams(search)
  const rawView = params.get("view")
  const view = rawView === "results" ? "results" : rawView === "form" ? "form" : "home"

  const pick = (key) => (params.get(key) ?? "").toString()
  const primaryAirportCode = normalizeAirportCode(pick("primary_airport_code"))
  const secondaryAirportCode = normalizeAirportCode(pick("secondary_airport_code"))
  const tertiaryAirportCode = normalizeAirportCode(pick("tertiary_airport_code"))
  const inferred = inferAirportMetadataFromCodes([
    primaryAirportCode,
    secondaryAirportCode,
    tertiaryAirportCode,
  ])
  const timezone = pick("timezone") || inferred.timezone || inferBrowserTimezone()
  const country = pick("country") || inferred.country || inferBrowserCountry()

  const form = {
    name: pick("name"),
    timezone,
    country,
    primary_airport_code: primaryAirportCode,
    secondary_airport_code: secondaryAirportCode,
    tertiary_airport_code: tertiaryAirportCode,
    max_cost: pick("max_cost"),
    max_time: pick("max_time"),
    friday_last_class: pick("friday_last_class"),
    monday_first_class: pick("monday_first_class"),
    friend_cities: parseFriendCities(pick("friend_cities")),
  }

  return { view, form }
}

function serializeQueryValue(value) {
  if (Array.isArray(value)) return value.join(",")
  return (value ?? "").toString().trim()
}

function setSearchFromForm({ view, form }) {
  const params = new URLSearchParams()
  params.set("view", view)

  for (const [k, v] of Object.entries(form ?? {})) {
    const value = serializeQueryValue(v)
    if (value) params.set(k, value)
  }

  const next = `?${params.toString()}`
  window.history.pushState({}, "", next)
}

function hasExplicitFormParams(search) {
  const params = new URLSearchParams(search)
  const keys = [
    "name",
    "timezone",
    "country",
    "primary_airport_code",
    "secondary_airport_code",
    "tertiary_airport_code",
    "max_cost",
    "max_time",
    "friday_last_class",
    "monday_first_class",
    "friend_cities",
  ]

  return keys.some((key) => {
    const value = params.get(key)
    return value != null && value.toString().trim() !== ""
  })
}

function normalizeSavedInput(rawInput) {
  if (!rawInput || typeof rawInput !== "object" || Array.isArray(rawInput)) return null

  return {
    name: (rawInput.name ?? "").toString(),
    timezone: (rawInput.timezone ?? "").toString(),
    country: (rawInput.country ?? "").toString(),
    primary_airport_code: normalizeAirportCode(rawInput.primary_airport_code) || "",
    secondary_airport_code: normalizeAirportCode(rawInput.secondary_airport_code) || "",
    tertiary_airport_code: normalizeAirportCode(rawInput.tertiary_airport_code) || "",
    max_cost: rawInput.max_cost == null ? "" : String(rawInput.max_cost),
    max_time: rawInput.max_time == null ? "" : String(rawInput.max_time),
    friday_last_class: (rawInput.friday_last_class ?? "").toString().slice(0, 8),
    monday_first_class: (rawInput.monday_first_class ?? "").toString().slice(0, 8),
    friend_cities: parseFriendCities(rawInput.friend_cities),
  }
}

export default function App() {
  const initial = useMemo(() => parseFormFromSearch(window.location.search), [])
  const hasQueryBackedFormValues = useMemo(() => hasExplicitFormParams(window.location.search), [])
  const [view, setView] = useState(initial.view)
  const [form, setForm] = useState({ ...DEFAULT_FORM, ...initial.form })

  const [authStatus, setAuthStatus] = useState(AUTH_STATUS.SIGNED_OUT)
  const [sessionToken, setSessionToken] = useState("")
  const [sessionUser, setSessionUser] = useState(null)
  const [authError, setAuthError] = useState("")
  const [isAuthBusy, setIsAuthBusy] = useState(false)
  const hasLoadedSavedInput = useRef(false)

  useEffect(() => {
    if (Capacitor.getPlatform() !== "ios") return

    const configureStatusBar = async () => {
      try {
        await StatusBar.show()
        await StatusBar.setStyle({ style: Style.Dark })
        await StatusBar.setOverlaysWebView({ overlay: true })
      } catch {
        // Ignore if status bar APIs are unavailable in this environment.
      }
    }

    void configureStatusBar()
  }, [])

  useEffect(() => {
    const onPopState = () => {
      const next = parseFormFromSearch(window.location.search)
      setView(next.view)
      setForm((prev) => ({ ...prev, ...next.form }))
    }
    window.addEventListener("popstate", onPopState)
    return () => window.removeEventListener("popstate", onPopState)
  }, [])

  useEffect(() => {
    if (authStatus !== AUTH_STATUS.SIGNED_IN || !sessionToken) return
    if (hasQueryBackedFormValues || hasLoadedSavedInput.current) return

    hasLoadedSavedInput.current = true
    let cancelled = false

    const loadSavedInput = async () => {
      try {
        const payload = await fetchLatestUserInput(sessionToken)
        if (cancelled) return
        const saved = normalizeSavedInput(payload?.input)
        if (!saved) return
        setForm((prev) => ({ ...prev, ...saved }))
      } catch (err) {
        console.warn("Failed to restore saved user input:", err)
      }
    }

    void loadSavedInput()
    return () => {
      cancelled = true
    }
  }, [authStatus, hasQueryBackedFormValues, sessionToken])

  const handleGoogleCredential = async (credential) => {
    setAuthError("")
    setIsAuthBusy(true)
    try {
      const payload = await signInWithGoogleCredential(credential)
      const token = (payload?.token ?? "").toString().trim()
      if (!token) throw new Error("Missing session token in auth response.")

      setStoredSessionToken(token)
      setSessionToken(token)
      setSessionUser(payload?.user ?? null)
      setAuthStatus(AUTH_STATUS.SIGNED_IN)
      hasLoadedSavedInput.current = false
    } catch (err) {
      setAuthError(err?.message || "Google sign-in failed.")
      setSessionToken("")
      setSessionUser(null)
      setAuthStatus(AUTH_STATUS.SIGNED_OUT)
    } finally {
      setIsAuthBusy(false)
    }
  }

  const handleContinueAsGuest = () => {
    setIsAuthBusy(false)
    setAuthError("")
    setSessionToken("")
    setSessionUser(null)
    setAuthStatus(AUTH_STATUS.GUEST)
  }

  const handleStartSignIn = () => {
    setAuthError("")
    setAuthStatus(AUTH_STATUS.SIGNED_OUT)
  }

  const handleSignOut = () => {
    if (Capacitor.isNativePlatform() && Capacitor.getPlatform() === "ios") {
      void SocialLogin.logout({ provider: "google" }).catch(() => {
        // Best effort only; local session is still cleared below.
      })
    }

    clearStoredSessionToken()
    hasLoadedSavedInput.current = false
    setSessionToken("")
    setSessionUser(null)
    setAuthError("")
    setAuthStatus(AUTH_STATUS.SIGNED_OUT)
  }

  const handleSubmit = (nextForm) => {
    setForm(nextForm)
    setView("results")
    setSearchFromForm({ view: "results", form: nextForm })

    if (authStatus === AUTH_STATUS.SIGNED_IN && sessionToken) {
      void saveUserInput(sessionToken, nextForm).catch((err) => {
        console.warn("Failed to persist user input:", err)
      })
    }
  }

  const goToForm = () => {
    setView("form")
    setSearchFromForm({ view: "form", form })
  }

  const goHome = () => {
    setView("home")
    setSearchFromForm({ view: "home", form })
  }

  const goBackFromSubpage = () => {
    if (view === "results") {
      setView("form")
      setSearchFromForm({ view: "form", form })
      return
    }
    goHome()
  }

  if (authStatus === AUTH_STATUS.CHECKING || authStatus === AUTH_STATUS.SIGNED_OUT) {
    return (
      <div className="min-h-screen bg-transparent text-white">
        <BackgroundScene />
        <div className="relative z-10">
          <GoogleSignInPage
            onCredential={handleGoogleCredential}
            onContinueAsGuest={handleContinueAsGuest}
            errorText={authError}
            isBusy={isAuthBusy || authStatus === AUTH_STATUS.CHECKING}
          />
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-transparent text-white">
      <BackgroundScene />
      <div className="relative z-10">
        {authStatus === AUTH_STATUS.SIGNED_IN ? (
          <div className="fixed right-4 top-[calc(var(--safe-top)+4.75rem)] z-[120] flex items-center gap-3 rounded-full border border-[var(--border)] bg-[rgba(0,20,35,0.8)] px-3 py-2 backdrop-blur-sm">
            <span className="max-w-[180px] truncate text-xs text-[var(--muted)] font-['Space_Mono',monospace]">
              {sessionUser?.name || sessionUser?.email || "Signed in"}
            </span>
            <button
              type="button"
              onClick={handleSignOut}
              className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--teal)]"
            >
              Sign out
            </button>
          </div>
        ) : (
          <div className="fixed right-4 top-[calc(var(--safe-top)+4.75rem)] z-[120] flex items-center gap-3 rounded-full border border-[var(--border)] bg-[rgba(0,20,35,0.8)] px-3 py-2 backdrop-blur-sm">
            <span className="max-w-[160px] truncate text-xs text-[var(--muted)] font-['Space_Mono',monospace]">
              Guest mode
            </span>
            <button
              type="button"
              onClick={handleStartSignIn}
              className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--teal)]"
            >
              Sign in
            </button>
          </div>
        )}

        {view === "home" ? (
          <HomePage onGetStarted={goToForm} />
        ) : (
          <>
            <NavBar
              ctaLabel="← Back"
              onCta={goBackFromSubpage}
              ctaHref="#top"
              onLogoClick={goHome}
              logoHref="#top"
              showLinks={false}
            />
            <div
              className="mx-auto w-full max-w-6xl px-6 pb-28 sm:px-10"
              style={{ paddingTop: "calc(var(--safe-top) + 8.75rem)" }}
            >
              <header className="mb-10">
                <div className="section-label" style={{ textAlign: "left", marginBottom: "0.75rem" }}>
                  {view === "form" ? "Your Inputs" : "Ranked Results"}
                </div>
                {view === "form" ? (
                  <div className="text-3xl font-black tracking-[-0.02em] sm:text-4xl">
                    Tell us your constraints.
                  </div>
                ) : null}
              </header>

              {view === "form" ? (
                <InputForm initialValues={form} onSubmit={handleSubmit} />
              ) : (
                <ResultsList formData={form} />
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
