import { useEffect, useMemo, useState } from "react"
import HomePage from "./components/HomePage"
import NavBar from "./components/NavBar"
import InputForm from "./components/InputForm"
import ResultsList from "./components/ResultsList"
import BackgroundScene from "./components/BackgroundScene"

const DEFAULT_FORM = {
  home_airport: "",
  home_timezone: "America/Los_Angeles",
  fri_last_class_end: "",
  mon_first_class_start: "",
  weekend_budget: "",
  date_from: "",
  date_to: "",
  friend_cities: "",
}

function parseFormFromSearch(search) {
  const params = new URLSearchParams(search)
  const rawView = params.get("view")
  const view = rawView === "results" ? "results" : rawView === "form" ? "form" : "home"

  const pick = (key) => (params.get(key) ?? "").toString()
  const form = {
    home_airport: pick("home_airport"),
    home_timezone: pick("home_timezone") || "America/Los_Angeles",
    fri_last_class_end: pick("fri_last_class_end"),
    mon_first_class_start: pick("mon_first_class_start"),
    weekend_budget: pick("weekend_budget"),
    date_from: pick("date_from"),
    date_to: pick("date_to"),
    friend_cities: pick("friend_cities"),
  }

  return { view, form }
}

function setSearchFromForm({ view, form }) {
  const params = new URLSearchParams()
  params.set("view", view)

  for (const [k, v] of Object.entries(form ?? {})) {
    const value = (v ?? "").toString().trim()
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
