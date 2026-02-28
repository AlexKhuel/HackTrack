import { useEffect, useMemo, useState } from "react"

const FIELD_INPUT =
  "w-full bg-[rgba(245,237,214,0.07)] border border-[rgba(0,200,180,0.18)] rounded-[6px] px-4 py-3 text-[var(--cream)] placeholder:text-[rgba(245,237,214,0.3)] outline-none focus:border-[var(--teal)] font-['Syne',sans-serif]"
const FIELD_LABEL =
  "mb-2 text-xs font-semibold uppercase tracking-[0.25em] text-[var(--muted)] font-['Space_Mono',monospace]"
const TIMEZONE_OPTIONS = [
  "America/Los_Angeles",
  "America/Denver",
  "America/Chicago",
  "America/New_York",
  "America/Phoenix",
  "America/Anchorage",
  "Pacific/Honolulu",
]

function normalizeAirport(code) {
  return (code ?? "").toString().trim().toUpperCase().slice(0, 3)
}

export default function InputForm({ initialValues, onSubmit }) {
  const [values, setValues] = useState(() => ({
    home_airport: "",
    home_timezone: "America/Los_Angeles",
    fri_last_class_end: "",
    mon_first_class_start: "",
    weekend_budget: "",
    date_from: "",
    date_to: "",
    friend_cities: "",
    ...(initialValues ?? {}),
  }))

  useEffect(() => {
    if (!initialValues) return
    setValues((v) => ({ ...v, ...initialValues }))
  }, [initialValues])

  const parsed = useMemo(() => {
    const budget = Number(values.weekend_budget)
    return {
      ...values,
      home_airport: normalizeAirport(values.home_airport),
      weekend_budget: Number.isFinite(budget) ? String(budget) : "",
      friend_cities: (values.friend_cities ?? "").toString(),
    }
  }, [values])

  const update = (key) => (e) => {
    setValues((v) => ({ ...v, [key]: e.target.value }))
  }

  const handleSubmit = (e) => {
    e.preventDefault()
    onSubmit?.(parsed)
  }

  return (
    <form onSubmit={handleSubmit} className="w-full max-w-3xl font-['Syne',sans-serif]">
      <div
        className="section-label"
        style={{ textAlign: "left", marginBottom: "0.75rem" }}
      >
        Your Preferences
      </div>
      <div className="mt-6 grid gap-10">
        <div className="grid gap-8 sm:grid-cols-2">
          <label className="block">
            <div className={FIELD_LABEL}>Home airport code</div>
            <input
              value={values.home_airport}
              onChange={update("home_airport")}
              placeholder="SNA"
              inputMode="text"
              className={FIELD_INPUT}
              required
            />
          </label>

          <label className="block">
            <div className={FIELD_LABEL}>Total weekend budget (USD)</div>
            <input
              type="number"
              min="0"
              step="1"
              value={values.weekend_budget}
              onChange={update("weekend_budget")}
              placeholder="500"
              className={FIELD_INPUT}
              required
            />
          </label>

          <label className="block">
            <div className={FIELD_LABEL}>Friday last class end time</div>
            <input
              type="time"
              value={values.fri_last_class_end}
              onChange={update("fri_last_class_end")}
              className={FIELD_INPUT}
              required
            />
          </label>

          <label className="block">
            <div className={FIELD_LABEL}>Monday first class start time</div>
            <input
              type="time"
              value={values.mon_first_class_start}
              onChange={update("mon_first_class_start")}
              className={FIELD_INPUT}
              required
            />
          </label>

          <label className="block">
            <div className={FIELD_LABEL}>Date range (from)</div>
            <input
              type="date"
              value={values.date_from}
              onChange={update("date_from")}
              className={FIELD_INPUT}
              required
            />
          </label>

          <label className="block">
            <div className={FIELD_LABEL}>Date range (to)</div>
            <input
              type="date"
              value={values.date_to}
              onChange={update("date_to")}
              className={FIELD_INPUT}
              required
            />
          </label>
        </div>

        <label className="block sm:max-w-[26rem]">
          <div className={FIELD_LABEL}>Home time zone</div>
          <select
            value={values.home_timezone}
            onChange={update("home_timezone")}
            className={FIELD_INPUT}
            required
          >
            {TIMEZONE_OPTIONS.map((tz) => (
              <option key={tz} value={tz}>
                {tz}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <div className={FIELD_LABEL}>Friend cities (optional, comma separated)</div>
          <input
            value={values.friend_cities}
            onChange={update("friend_cities")}
            placeholder="Stanford, Berkeley, Philadelphia"
            className={FIELD_INPUT}
          />
        </label>

        <div className="flex items-center justify-between gap-6">
          <div className="text-xs font-semibold uppercase tracking-[0.25em] text-[rgba(245,237,214,0.4)] font-['Space_Mono',monospace]">
            Shareable via URL query params
          </div>
          <button
            type="submit"
            className="btn-primary"
          >
            ⚡ Find Hackathons →
          </button>
        </div>
      </div>
    </form>
  )
}
