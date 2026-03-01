import { useEffect, useMemo, useState } from "react"
import { fetchFeasibleHackathons } from "../utils/api"

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

function mapFeasibleResult(result, index) {
  const event = result?.event ?? {}
  const route = result?.route ?? {}
  const costEstimate = result?.cost_estimate ?? {}

  const outboundMinutes = Number(route?.avg_outbound_duration_minutes)
  const returnMinutes = Number(route?.avg_return_duration_minutes)
  const totalTravelMinutes =
    Number.isFinite(outboundMinutes) && Number.isFinite(returnMinutes)
      ? outboundMinutes + returnMinutes
      : null

  const estimatedCost = Number(costEstimate?.estimated_total_cost)
  const prizePool = Number(event?.prize_pool)

  return {
    id: event?.id ?? `${event?.name ?? "event"}-${index}`,
    name: event?.name ?? "Unknown event",
    city: event?.city ?? "Unknown city",
    from: event?.start_datetime_utc ?? null,
    to: event?.end_datetime_utc ?? null,
    estimated_cost: Number.isFinite(estimatedCost) ? estimatedCost : 0,
    travel_time_hours: Number.isFinite(totalTravelMinutes) ? totalTravelMinutes / 60 : 0,
    prize_pool: Number.isFinite(prizePool) ? prizePool : 0,
    url: event?.url ?? "#",
  }
}

export default function ResultsList({ formData }) {
  const friends = useMemo(() => splitFriendCities(formData?.friend_cities), [formData?.friend_cities])
  const friendsLower = useMemo(() => friends.map((s) => s.toLowerCase()), [friends])

  const [isLoading, setIsLoading] = useState(true)
  const [errorText, setErrorText] = useState("")
  const [hackathons, setHackathons] = useState([])

  const [maxFlightHours, setMaxFlightHours] = useState("6")
  const [minPrizePool, setMinPrizePool] = useState("0")

  const scored = useMemo(() => {
    if (!hackathons.length) return []

    const prizes = hackathons.map((h) => Number(h.prize_pool)).filter(Number.isFinite)
    const ratios = hackathons
      .map((h) => Number(h.prize_pool) / Math.max(1, Number(h.estimated_cost)))
      .filter(Number.isFinite)
    const travels = hackathons.map((h) => Number(h.travel_time_hours)).filter(Number.isFinite)

    const prizeMin = prizes.length ? Math.min(...prizes) : 0
    const prizeMax = prizes.length ? Math.max(...prizes) : 0
    const ratioMin = ratios.length ? Math.min(...ratios) : 0
    const ratioMax = ratios.length ? Math.max(...ratios) : 0
    const travelMin = travels.length ? Math.min(...travels) : 0
    const travelMax = travels.length ? Math.max(...travels) : 0

    return hackathons.map((h) => {
      const prize_score = norm(h.prize_pool, prizeMin, prizeMax)
      const prize_to_cost_score = norm(h.prize_pool / Math.max(1, h.estimated_cost), ratioMin, ratioMax)
      const travel_time_score = 1 - norm(h.travel_time_hours, travelMin, travelMax)
      const cityText = (h.city ?? "").toString().toLowerCase()
      const friend_bonus_score = friendsLower.some((c) => cityText.includes(c)) ? 1 : 0

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
  }, [hackathons, friendsLower])

  const filteredAndSorted = useMemo(() => {
    const maxH = Number(maxFlightHours)
    const minP = Number(minPrizePool)

    return scored
      .filter((h) => {
        const travelHours = Number(h.travel_time_hours)
        if (!Number.isFinite(maxH)) return true
        if (!Number.isFinite(travelHours)) return false
        return travelHours <= maxH
      })
      .filter((h) => {
        const prizePool = Number(h.prize_pool)
        if (!Number.isFinite(minP)) return true
        if (!Number.isFinite(prizePool)) return false
        return prizePool >= minP
      })
      .sort((a, b) => b.scores.composite - a.scores.composite)
  }, [scored, maxFlightHours, minPrizePool])

  useEffect(() => {
    const abortController = new AbortController()
    setIsLoading(true)
    setErrorText("")

    fetchFeasibleHackathons(formData, { signal: abortController.signal })
      .then((payload) => {
        if (abortController.signal.aborted) return
        const rawResults = Array.isArray(payload?.results) ? payload.results : []
        setHackathons(rawResults.map((result, index) => mapFeasibleResult(result, index)))
      })
      .catch((error) => {
        if (abortController.signal.aborted) return
        setHackathons([])
        setErrorText(error instanceof Error ? error.message : "unknown_error")
      })
      .finally(() => {
        if (abortController.signal.aborted) return
        setIsLoading(false)
      })

    return () => {
      abortController.abort()
    }
  }, [formData])

  const status = isLoading ? "loading" : errorText ? "error" : filteredAndSorted.length ? "ready" : "empty"

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
