function parseTimeParts(value) {
  const text = (value ?? "").toString().trim()
  if (!text) return null

  const match = text.match(/^(\d{2}):(\d{2})(?::(\d{2}))?$/)
  if (!match) return null

  const hour = Number(match[1])
  const minute = Number(match[2])
  const second = Number(match[3] ?? "0")
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59 || second < 0 || second > 59) return null

  return { hour, minute, second }
}

function formatHHMM(hour, minute) {
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`
}

function formatHHMMSS(hour, minute, second) {
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:${String(second).padStart(2, "0")}`
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
    const get = (type) => Number(parts.find((p) => p.type === type)?.value ?? NaN)
    const year = get("year")
    const month = get("month")
    const day = get("day")
    const hour = get("hour")
    const minute = get("minute")
    const second = get("second")
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

function localTimeToUtc(value, timeZone) {
  const parts = parseTimeParts(value)
  if (!parts) return null

  if (!timeZone) {
    return formatHHMMSS(parts.hour, parts.minute, parts.second)
  }

  const localToday = getZonedDateParts(new Date(), timeZone)
  if (!localToday) {
    return formatHHMMSS(parts.hour, parts.minute, parts.second)
  }

  const guessUtc = Date.UTC(
    localToday.year,
    localToday.month - 1,
    localToday.day,
    parts.hour,
    parts.minute,
    parts.second
  )
  const offsetMinutes = getTimeZoneOffsetMinutes(timeZone, new Date(guessUtc))
  if (offsetMinutes == null) {
    return formatHHMMSS(parts.hour, parts.minute, parts.second)
  }

  const utcMillis = guessUtc - offsetMinutes * 60_000
  const utcDate = new Date(utcMillis)
  return formatHHMMSS(utcDate.getUTCHours(), utcDate.getUTCMinutes(), utcDate.getUTCSeconds())
}

function utcTimeToLocalInput(value, timeZone) {
  const parts = parseTimeParts(value)
  if (!parts) return ""

  if (!timeZone) {
    return formatHHMM(parts.hour, parts.minute)
  }

  const localToday = getZonedDateParts(new Date(), timeZone)
  if (!localToday) {
    return formatHHMM(parts.hour, parts.minute)
  }

  const utcMillis = Date.UTC(
    localToday.year,
    localToday.month - 1,
    localToday.day,
    parts.hour,
    parts.minute,
    parts.second
  )
  const localParts = getZonedDateParts(new Date(utcMillis), timeZone)
  if (!localParts) return formatHHMM(parts.hour, parts.minute)

  return formatHHMM(localParts.hour, localParts.minute)
}

function normalizeNonNegativeInteger(value, fallback) {
  const parsed = Number(value)
  if (Number.isFinite(parsed) && parsed >= 0) return Math.round(parsed)
  return fallback
}

export {
  localTimeToUtc,
  normalizeNonNegativeInteger,
  utcTimeToLocalInput,
}
