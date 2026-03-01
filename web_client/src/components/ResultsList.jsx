import { useEffect, useMemo, useState } from "react"

const FILTER_INPUT =
  "w-48 bg-[rgba(245,237,214,0.07)] border border-[var(--border)] rounded-[6px] px-3 py-2 text-[var(--cream)] outline-none focus:border-[var(--teal)] font-['Syne',sans-serif]"
const FILTER_LABEL = "text-xs font-semibold uppercase tracking-[0.25em] text-[var(--muted)] font-['Space_Mono',monospace]"

function clamp01(x) {
  if (!Number.isFinite(x)) return 0
  return Math.max(0, Math.min(1, x))
}

function norm(value, min, max) {
  if (!Number.isFinite(value) || !Number.isFinite(min) || !Number.isFinite(max)) return 0
  if (max === min) return 1
  return clamp01((value - min) / (max - min))
}

function formatUSD(n) {
  const num = Number(n)
  if (!Number.isFinite(num)) return "$—"
  return new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(num)
}

function formatDateRange(fromISO, toISO) {
  if (!fromISO || !toISO) return "—"
  const fmt = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" })
  return `${fmt.format(new Date(fromISO))} – ${fmt.format(new Date(toISO))}`
}

function splitFriendCities(text) {
  if (Array.isArray(text)) {
    return text
      .map((entry) => (entry ?? "").toString().trim())
      .filter(Boolean)
  }
  return (text ?? "")
    .toString()
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
}

function showClassConstraint(value) {
  const text = (value ?? "").toString().trim()
  return text || "none"
}

function showBudgetConstraint(value) {
  const budget = Number(value)
  if (!Number.isFinite(budget) || budget < 0) return "No budget cap"
  return `Max $${Math.round(budget)}`
}

function showMaxTravelTimeConstraint(value) {
  const minutes = Number(value)
  if (!Number.isFinite(minutes) || minutes < 0) return "No one-way time cap"
  const hours = minutes / 60
  const rounded = Math.round(hours * 10) / 10
  return `Max ${rounded}h one-way`
}

const MOCK_HACKATHONS = [
  {
    id: "hackmit",
    name: "HackMIT",
    city: "Cambridge, MA",
    from: "2026-09-19",
    to: "2026-09-20",
    estimated_cost: 520,
    travel_time_hours: 6.0,
    prize_pool: 50000,
    url: "https://hackmit.org/",
  },
  {
    id: "calhacks",
    name: "Cal Hacks",
    city: "Berkeley, CA",
    from: "2026-10-23",
    to: "2026-10-25",
    estimated_cost: 180,
    travel_time_hours: 1.2,
    prize_pool: 25000,
    url: "https://calhacks.io/",
  },
  {
    id: "hackgt",
    name: "HackGT",
    city: "Atlanta, GA",
    from: "2026-10-02",
    to: "2026-10-04",
    estimated_cost: 420,
    travel_time_hours: 4.8,
    prize_pool: 35000,
    url: "https://hack.gt/",
  },
  {
    id: "pennapps",
    name: "PennApps",
    city: "Philadelphia, PA",
    from: "2026-09-11",
    to: "2026-09-13",
    estimated_cost: 480,
    travel_time_hours: 5.4,
    prize_pool: 40000,
    url: "https://pennapps.com/",
  },
  {
    id: "treehacks",
    name: "TreeHacks",
    city: "Stanford, CA",
    from: "2026-02-13",
    to: "2026-02-15",
    estimated_cost: 160,
    travel_time_hours: 1.0,
    prize_pool: 30000,
    url: "https://www.treehacks.com/",
  },
]

export default function ResultsList({ formData }) {
  const friends = useMemo(() => splitFriendCities(formData?.friend_cities), [formData?.friend_cities])
  const friendsLower = useMemo(() => friends.map((s) => s.toLowerCase()), [friends])

  const [status, setStatus] = useState("loading") // loading | ready | empty | error
  const [errorText, setErrorText] = useState("")

  const [maxFlightHours, setMaxFlightHours] = useState("6")
  const [minPrizePool, setMinPrizePool] = useState("0")

  const scored = useMemo(() => {
    const prizes = MOCK_HACKATHONS.map((h) => h.prize_pool)
    const ratios = MOCK_HACKATHONS.map((h) => h.prize_pool / Math.max(1, h.estimated_cost))
    const travels = MOCK_HACKATHONS.map((h) => h.travel_time_hours)

    const prizeMin = Math.min(...prizes)
    const prizeMax = Math.max(...prizes)
    const ratioMin = Math.min(...ratios)
    const ratioMax = Math.max(...ratios)
    const travelMin = Math.min(...travels)
    const travelMax = Math.max(...travels)

    return MOCK_HACKATHONS.map((h) => {
      const prize_score = norm(h.prize_pool, prizeMin, prizeMax)
      const prize_to_cost_score = norm(h.prize_pool / Math.max(1, h.estimated_cost), ratioMin, ratioMax)
      const travel_time_score = 1 - norm(h.travel_time_hours, travelMin, travelMax)
      const friend_bonus_score = friendsLower.some((c) => h.city.toLowerCase().includes(c)) ? 1 : 0

      const composite =
        0.35 * prize_score +
        0.25 * prize_to_cost_score +
        0.25 * travel_time_score +
        0.15 * friend_bonus_score

      return {
        ...h,
        scores: {
          composite,
        },
      }
    })
  }, [friendsLower])

  const filteredAndSorted = useMemo(() => {
    const maxH = Number(maxFlightHours)
    const minP = Number(minPrizePool)

    return scored
      .filter((h) => (Number.isFinite(maxH) ? h.travel_time_hours <= maxH : true))
      .filter((h) => (Number.isFinite(minP) ? h.prize_pool >= minP : true))
      .sort((a, b) => b.scores.composite - a.scores.composite)
  }, [scored, maxFlightHours, minPrizePool])

  useEffect(() => {
    setStatus("loading")
    setErrorText("")

    const t = window.setTimeout(() => {
      try {
        if (!Array.isArray(filteredAndSorted)) throw new Error("results_not_array")
        setStatus(filteredAndSorted.length ? "ready" : "empty")
      } catch (e) {
        setStatus("error")
        setErrorText(e instanceof Error ? e.message : "unknown_error")
      }
    }, 450)

    return () => window.clearTimeout(t)
  }, [filteredAndSorted])

  return (
    <div className="w-full font-['Syne',sans-serif]">
      <div className="flex items-end gap-6">
        <div className="text-3xl font-black tracking-[-0.02em] sm:text-4xl">
          {filteredAndSorted.length} HACKATHONS FOUND
        </div>
      </div>

      <div className="mt-6 border-y border-white/10 py-4">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
            <label className="block">
              <div className={FILTER_LABEL}>
                Max flight hours
              </div>
              <input
                value={maxFlightHours}
                onChange={(e) => setMaxFlightHours(e.target.value)}
                inputMode="decimal"
                placeholder="6"
                className={FILTER_INPUT}
              />
            </label>

            <label className="block">
              <div className={FILTER_LABEL}>
                Min prize pool
              </div>
              <input
                value={minPrizePool}
                onChange={(e) => setMinPrizePool(e.target.value)}
                inputMode="numeric"
                placeholder="0"
                className={FILTER_INPUT}
              />
            </label>
          </div>

          <div className="text-xs font-semibold uppercase tracking-[0.25em] text-[rgba(245,237,214,0.4)] font-['Space_Mono',monospace]">
            {formData?.primary_airport_code ? formData.primary_airport_code : "—"} •{" "}
            {formData?.timezone || "Timezone unknown"} •{" "}
            {formData?.country || "Country unknown"} •{" "}
            {showBudgetConstraint(formData?.max_cost)} •{" "}
            {showMaxTravelTimeConstraint(formData?.max_time)} •{" "}
            Fri {showClassConstraint(formData?.friday_last_class)} • Mon {showClassConstraint(formData?.monday_first_class)} •{" "}
            {friends.length ? `Friends: ${friends.join(", ")}` : "No friend cities"}
          </div>
        </div>
      </div>

      {status === "loading" ? (
        <div className="grid min-h-[50vh] place-items-center">
          <div className="text-4xl font-black tracking-[-0.02em]">SEARCHING...</div>
        </div>
      ) : null}

      {status === "error" ? (
        <div className="grid min-h-[50vh] place-items-center text-center">
          <div>
            <div className="text-4xl font-black tracking-[-0.02em] text-[#e4032e]">
              SOMETHING WENT WRONG.
            </div>
            <div className="mt-3 text-xs font-semibold uppercase tracking-[0.25em] text-white/40">
              {errorText || "unknown_error"}
            </div>
          </div>
        </div>
      ) : null}

      {status === "empty" ? (
        <div className="grid min-h-[50vh] place-items-center">
          <div className="text-4xl font-black tracking-[-0.02em]">NO MATCHES FOUND.</div>
        </div>
      ) : null}

      {status === "ready" ? (
        <div className="mt-6 space-y-4">
          {filteredAndSorted.map((h, idx) => {
            const match = `${Math.round(h.scores.composite * 100)}% match`
            return (
              <article key={h.id} className="demo-card">
                <div className="demo-card-header">
                  <div>
                    <div className="event-name">
                      #{idx + 1} · {h.name}
                    </div>
                    <div className="event-city">
                      📍 {h.city} · {formatDateRange(h.from, h.to)}
                    </div>
                  </div>
                  <div className="score-badge">{match}</div>
                </div>

                <div className="demo-meta">
                  <div className="meta-item">
                    <div className="meta-label">Est. Cost</div>
                    <div className="meta-value gold">{formatUSD(h.estimated_cost)}</div>
                  </div>
                  <div className="meta-item">
                    <div className="meta-label">Travel Time</div>
                    <div className="meta-value">{`${h.travel_time_hours.toFixed(1)}h`}</div>
                  </div>
                  <div className="meta-item">
                    <div className="meta-label">Prize Pool</div>
                    <div className="meta-value gold">{formatUSD(h.prize_pool)}</div>
                  </div>
                  <div className="meta-item">
                    <div className="meta-label">Friend Nearby</div>
                    <div className={`meta-value ${friends.length ? "green" : ""}`}>
                      {friends.length ? "Possible couch" : "None known"}
                    </div>
                  </div>
                </div>

                <div className="mt-3 flex items-center justify-between text-xs">
                  <div className="text-[var(--muted)] font-['Space_Mono',monospace]">
                    Match factors: prize, ROI, travel, friends
                  </div>
                  <a
                    href={h.url}
                    target="_blank"
                    rel="noreferrer"
                    className="btn-ghost"
                    style={{ padding: "0.4rem 1rem", fontSize: "0.8rem" }}
                  >
                    View Event →
                  </a>
                </div>
              </article>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
