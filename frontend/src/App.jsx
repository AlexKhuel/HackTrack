import { useEffect, useMemo, useState } from "react"
import { Capacitor } from "@capacitor/core"
import { StatusBar, Style } from "@capacitor/status-bar"
import HomePage from "./components/HomePage"
import NavBar from "./components/NavBar"
import InputForm from "./components/InputForm"
import ResultsList from "./components/ResultsList"
import BackgroundScene from "./components/BackgroundScene"
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

export default function App() {
  const initial = useMemo(() => parseFormFromSearch(window.location.search), [])
  const [view, setView] = useState(initial.view)
  const [form, setForm] = useState({ ...DEFAULT_FORM, ...initial.form })

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

  const handleSubmit = (nextForm) => {
    setForm(nextForm)
    setView("results")
    setSearchFromForm({ view: "results", form: nextForm })
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

  return (
    <div className="min-h-screen bg-transparent text-white">
      <BackgroundScene />
      <div className="relative z-10">
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
            <div className="mx-auto w-full max-w-6xl px-6 py-28 sm:px-10">
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
