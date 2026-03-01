const DEFAULT_BUDGET = 1_000_000

function pad2(value) {
  return String(value).padStart(2, "0")
}

function parseClock(value) {
  const text = (value ?? "").toString().trim()
  const match = text.match(/^(\d{2}):(\d{2})(?::(\d{2}))?$/)
  if (!match) return null

  const hour = Number(match[1])
  const minute = Number(match[2])
  const second = Number(match[3] ?? "0")
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59 || second < 0 || second > 59) return null
  return { hour, minute, second }
}

function getZonedDateParts(date, timeZone) {
  try {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    })
    const parts = formatter.formatToParts(date)
    const getNum = (type) => Number(parts.find((p) => p.type === type)?.value ?? NaN)
    const year = getNum("year")
    const month = getNum("month")
    const day = getNum("day")
    const hour = getNum("hour")
    const minute = getNum("minute")
    const second = getNum("second")

    if (![year, month, day, hour, minute, second].every(Number.isFinite)) return null
    return { year, month, day, hour, minute, second }
  } catch {
    return null
  }
}

function getTimeZoneOffsetMinutes(timeZone, utcDate) {
  const zoned = getZonedDateParts(utcDate, timeZone)
  if (!zoned) return null

  const asIfUtc = Date.UTC(
    zoned.year,
    zoned.month - 1,
    zoned.day,
    zoned.hour,
    zoned.minute,
    zoned.second
  )
  return Math.round((asIfUtc - utcDate.getTime()) / 60000)
}

function formatOffset(minutes) {
  const sign = minutes >= 0 ? "+" : "-"
  const abs = Math.abs(minutes)
  const hours = Math.trunc(abs / 60)
  const mins = abs % 60
  return `${sign}${pad2(hours)}:${pad2(mins)}`
}

function addDays(dateParts, days) {
  const shifted = new Date(Date.UTC(dateParts.year, dateParts.month - 1, dateParts.day + days))
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  }
}

function getReferenceBoundaryDates(timeZone) {
  const zonedNow = getZonedDateParts(new Date(), timeZone)
  if (!zonedNow) return null

  const today = { year: zonedNow.year, month: zonedNow.month, day: zonedNow.day }
  const weekday = new Date(Date.UTC(today.year, today.month - 1, today.day)).getUTCDay()
  const daysUntilFriday = (5 - weekday + 7) % 7
  const friday = addDays(today, daysUntilFriday)
  const monday = addDays(friday, 3)

  return { friday, monday }
}

function buildIsoFromLocalDateTime(referenceDate, localClock, timeZone) {
  const guessUtc = Date.UTC(
    referenceDate.year,
    referenceDate.month - 1,
    referenceDate.day,
    localClock.hour,
    localClock.minute,
    localClock.second
  )
  let offsetMinutes = getTimeZoneOffsetMinutes(timeZone, new Date(guessUtc))
  if (offsetMinutes == null) return null

  let utcMillis = guessUtc - offsetMinutes * 60_000
  const refinedOffset = getTimeZoneOffsetMinutes(timeZone, new Date(utcMillis))
  if (refinedOffset == null) return null
  if (refinedOffset !== offsetMinutes) {
    offsetMinutes = refinedOffset
    utcMillis = guessUtc - offsetMinutes * 60_000
  }

  const finalOffset = getTimeZoneOffsetMinutes(timeZone, new Date(utcMillis))
  const offset = finalOffset == null ? offsetMinutes : finalOffset
  const datePart = `${referenceDate.year}-${pad2(referenceDate.month)}-${pad2(referenceDate.day)}`
  const timePart = `${pad2(localClock.hour)}:${pad2(localClock.minute)}:${pad2(localClock.second)}`
  return `${datePart}T${timePart}${formatOffset(offset)}`
}

function utcClockToLocalClock(utcClock, referenceDate, timeZone) {
  const utcInstant = new Date(
    Date.UTC(
      referenceDate.year,
      referenceDate.month - 1,
      referenceDate.day,
      utcClock.hour,
      utcClock.minute,
      utcClock.second
    )
  )
  const local = getZonedDateParts(utcInstant, timeZone)
  if (!local) return null
  return { hour: local.hour, minute: local.minute, second: local.second }
}

function buildScheduleBoundaryIso(utcClockValue, referenceDate, timeZone, fieldName) {
  const raw = (utcClockValue ?? "").toString().trim()
  if (!raw) return null

  const utcClock = parseClock(raw)
  if (!utcClock) {
    throw new Error(`Invalid ${fieldName} value`)
  }

  const localClock = utcClockToLocalClock(utcClock, referenceDate, timeZone)
  if (!localClock) return null
  return buildIsoFromLocalDateTime(referenceDate, localClock, timeZone)
}

function normalizeAirportCode(value) {
  const code = (value ?? "").toString().trim().toUpperCase()
  return /^[A-Z]{3}$/.test(code) ? code : null
}

function collectOriginAirports(formData) {
  const seen = new Set()
  const airports = []

  for (const raw of [
    formData?.primary_airport_code,
    formData?.secondary_airport_code,
    formData?.tertiary_airport_code,
  ]) {
    const code = normalizeAirportCode(raw)
    if (!code || seen.has(code)) continue
    seen.add(code)
    airports.push(code)
  }
  return airports
}

function normalizeFriendCities(value) {
  if (Array.isArray(value)) {
    return value
      .map((entry) => (entry ?? "").toString().trim())
      .filter(Boolean)
  }

  return (value ?? "")
    .toString()
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
}

function toPositiveNumber(value) {
  const text = (value ?? "").toString().trim()
  if (!text) return null
  const num = Number(text)
  return Number.isFinite(num) && num > 0 ? num : null
}

function toNonNegativeNumber(value) {
  const text = (value ?? "").toString().trim()
  if (!text) return null
  const num = Number(text)
  return Number.isFinite(num) && num >= 0 ? num : null
}

function getUserTimeZone(formData) {
  const requested = (formData?.timezone ?? "").toString().trim()
  if (requested) {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: requested })
      return requested
    } catch {
      // Fall through to browser/default timezone.
    }
  }

  const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone
  if (browserTz) return browserTz
  return "UTC"
}

function isoNowInTimeZone(timeZone) {
  const now = new Date()
  const zoned = getZonedDateParts(now, timeZone)
  if (!zoned) return now.toISOString()

  const offset = getTimeZoneOffsetMinutes(timeZone, now)
  if (offset == null) return now.toISOString()

  const datePart = `${zoned.year}-${pad2(zoned.month)}-${pad2(zoned.day)}`
  const timePart = `${pad2(zoned.hour)}:${pad2(zoned.minute)}:${pad2(zoned.second)}`
  return `${datePart}T${timePart}${formatOffset(offset)}`
}

async function fetchFeasibleHackathons(formData, options = {}) {
  const userTimezone = getUserTimeZone(formData)
  const origins = collectOriginAirports(formData)

  if (origins.length === 0) {
    throw new Error("At least one origin airport is required")
  }

  const referenceDates = getReferenceBoundaryDates(userTimezone)
  if (!referenceDates) {
    throw new Error("Could not infer reference Friday/Monday dates")
  }

  const fridayLastClassEnd = buildScheduleBoundaryIso(
    formData?.friday_last_class,
    referenceDates.friday,
    userTimezone,
    "friday_last_class"
  )
  const mondayFirstClassStart = buildScheduleBoundaryIso(
    formData?.monday_first_class,
    referenceDates.monday,
    userTimezone,
    "monday_first_class"
  )

  const params = new URLSearchParams()
  for (const airport of origins) {
    params.append("origin_airport", airport)
  }

  const budget = toPositiveNumber(formData?.max_cost) ?? DEFAULT_BUDGET
  params.set("budget", String(budget))
  params.set("user_timezone", userTimezone)
  if (fridayLastClassEnd) {
    params.set("friday_last_class_end", fridayLastClassEnd)
  }
  if (mondayFirstClassStart) {
    params.set("monday_first_class_start", mondayFirstClassStart)
  }
  params.set("date_range_start", isoNowInTimeZone(userTimezone))

  const maxFlightDuration = toNonNegativeNumber(formData?.max_time)
  if (maxFlightDuration != null) {
    params.set("max_flight_duration", String(maxFlightDuration))
  }

  // If user left budget + travel + class timing blank, return all upcoming events,
  // even when route/cost metadata is missing.
  const unconstrainedSearch =
    toPositiveNumber(formData?.max_cost) == null &&
    maxFlightDuration == null &&
    fridayLastClassEnd == null &&
    mondayFirstClassStart == null
  if (unconstrainedSearch) {
    params.set("include_unmapped", "true")
  }

  const friendCities = normalizeFriendCities(formData?.friend_cities)
  for (const city of friendCities) {
    params.append("friend_cities", city)
  }

  const response = await fetch(`/api/hackathons/feasible?${params.toString()}`, {
    method: "GET",
    signal: options.signal,
  })

  const raw = await response.text()
  let payload = {}
  if (raw) {
    try {
      payload = JSON.parse(raw)
    } catch {
      payload = { error: raw }
    }
  }

  if (!response.ok) {
    const message =
      typeof payload?.error === "string" && payload.error
        ? payload.error
        : `Request failed (${response.status})`
    throw new Error(message)
  }

  return payload
}

export { fetchFeasibleHackathons }
