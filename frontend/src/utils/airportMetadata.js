const AIRPORT_METADATA = Object.freeze({
  ABE: { timezone: "America/New_York", country: "United States" },
  ABQ: { timezone: "America/Denver", country: "United States" },
  ACK: { timezone: "America/New_York", country: "United States" },
  ACV: { timezone: "America/Los_Angeles", country: "United States" },
  ACY: { timezone: "America/New_York", country: "United States" },
  ALB: { timezone: "America/New_York", country: "United States" },
  AMA: { timezone: "America/Chicago", country: "United States" },
  ASE: { timezone: "America/Denver", country: "United States" },
  ATL: { timezone: "America/New_York", country: "United States" },
  ATW: { timezone: "America/Chicago", country: "United States" },
  AUS: { timezone: "America/Chicago", country: "United States" },
  AVL: { timezone: "America/New_York", country: "United States" },
  AZA: { timezone: "America/Phoenix", country: "United States" },
  BDL: { timezone: "America/New_York", country: "United States" },
  BGR: { timezone: "America/New_York", country: "United States" },
  BHM: { timezone: "America/Chicago", country: "United States" },
  BIL: { timezone: "America/Denver", country: "United States" },
  BIS: { timezone: "America/Chicago", country: "United States" },
  BLI: { timezone: "America/Los_Angeles", country: "United States" },
  BNA: { timezone: "America/Chicago", country: "United States" },
  BOI: { timezone: "America/Boise", country: "United States" },
  BOS: { timezone: "America/New_York", country: "United States" },
  BTV: { timezone: "America/New_York", country: "United States" },
  BUF: { timezone: "America/New_York", country: "United States" },
  BUR: { timezone: "America/Los_Angeles", country: "United States" },
  BWI: { timezone: "America/New_York", country: "United States" },
  BZN: { timezone: "America/Denver", country: "United States" },
  CAE: { timezone: "America/New_York", country: "United States" },
  CAK: { timezone: "America/New_York", country: "United States" },
  CHO: { timezone: "America/New_York", country: "United States" },
  CHS: { timezone: "America/New_York", country: "United States" },
  CID: { timezone: "America/Chicago", country: "United States" },
  CLE: { timezone: "America/New_York", country: "United States" },
  CLT: { timezone: "America/New_York", country: "United States" },
  CMH: { timezone: "America/New_York", country: "United States" },
  COS: { timezone: "America/Denver", country: "United States" },
  CRP: { timezone: "America/Chicago", country: "United States" },
  CVG: { timezone: "America/New_York", country: "United States" },
  DAL: { timezone: "America/Chicago", country: "United States" },
  DAY: { timezone: "America/New_York", country: "United States" },
  DCA: { timezone: "America/New_York", country: "United States" },
  DEN: { timezone: "America/Denver", country: "United States" },
  DFW: { timezone: "America/Chicago", country: "United States" },
  DSM: { timezone: "America/Chicago", country: "United States" },
  DTW: { timezone: "America/Detroit", country: "United States" },
  ECP: { timezone: "America/Chicago", country: "United States" },
  EGE: { timezone: "America/Denver", country: "United States" },
  ELP: { timezone: "America/Denver", country: "United States" },
  EUG: { timezone: "America/Los_Angeles", country: "United States" },
  EWR: { timezone: "America/New_York", country: "United States" },
  EYW: { timezone: "America/New_York", country: "United States" },
  FAR: { timezone: "America/Chicago", country: "United States" },
  FAT: { timezone: "America/Los_Angeles", country: "United States" },
  FCA: { timezone: "America/Denver", country: "United States" },
  FLL: { timezone: "America/New_York", country: "United States" },
  FNT: { timezone: "America/Detroit", country: "United States" },
  FSD: { timezone: "America/Chicago", country: "United States" },
  FWA: { timezone: "America/Indiana/Indianapolis", country: "United States" },
  GEG: { timezone: "America/Los_Angeles", country: "United States" },
  GRR: { timezone: "America/Detroit", country: "United States" },
  GSO: { timezone: "America/New_York", country: "United States" },
  GSP: { timezone: "America/New_York", country: "United States" },
  HDN: { timezone: "America/Denver", country: "United States" },
  HHH: { timezone: "America/New_York", country: "United States" },
  HOU: { timezone: "America/Chicago", country: "United States" },
  HPN: { timezone: "America/New_York", country: "United States" },
  HRL: { timezone: "America/Chicago", country: "United States" },
  HSV: { timezone: "America/Chicago", country: "United States" },
  HTS: { timezone: "America/New_York", country: "United States" },
  HVN: { timezone: "America/New_York", country: "United States" },
  IAD: { timezone: "America/New_York", country: "United States" },
  IAH: { timezone: "America/Chicago", country: "United States" },
  ICT: { timezone: "America/Chicago", country: "United States" },
  IDA: { timezone: "America/Boise", country: "United States" },
  ILM: { timezone: "America/New_York", country: "United States" },
  IND: { timezone: "America/Indiana/Indianapolis", country: "United States" },
  ISP: { timezone: "America/New_York", country: "United States" },
  JAC: { timezone: "America/Denver", country: "United States" },
  JAN: { timezone: "America/Chicago", country: "United States" },
  JAX: { timezone: "America/New_York", country: "United States" },
  JFK: { timezone: "America/New_York", country: "United States" },
  LAS: { timezone: "America/Los_Angeles", country: "United States" },
  LAX: { timezone: "America/Los_Angeles", country: "United States" },
  LBB: { timezone: "America/Chicago", country: "United States" },
  LCK: { timezone: "America/New_York", country: "United States" },
  LEX: { timezone: "America/New_York", country: "United States" },
  LGA: { timezone: "America/New_York", country: "United States" },
  LGB: { timezone: "America/Los_Angeles", country: "United States" },
  LIT: { timezone: "America/Chicago", country: "United States" },
  MAF: { timezone: "America/Chicago", country: "United States" },
  MCI: { timezone: "America/Chicago", country: "United States" },
  MCO: { timezone: "America/New_York", country: "United States" },
  MDT: { timezone: "America/New_York", country: "United States" },
  MDW: { timezone: "America/Chicago", country: "United States" },
  MEM: { timezone: "America/Chicago", country: "United States" },
  MFE: { timezone: "America/Chicago", country: "United States" },
  MFR: { timezone: "America/Los_Angeles", country: "United States" },
  MHT: { timezone: "America/New_York", country: "United States" },
  MIA: { timezone: "America/New_York", country: "United States" },
  MKE: { timezone: "America/Chicago", country: "United States" },
  MOT: { timezone: "America/Chicago", country: "United States" },
  MSN: { timezone: "America/Chicago", country: "United States" },
  MSO: { timezone: "America/Denver", country: "United States" },
  MSP: { timezone: "America/Chicago", country: "United States" },
  MSY: { timezone: "America/Chicago", country: "United States" },
  MTJ: { timezone: "America/Denver", country: "United States" },
  MVY: { timezone: "America/New_York", country: "United States" },
  MYR: { timezone: "America/New_York", country: "United States" },
  OAK: { timezone: "America/Los_Angeles", country: "United States" },
  OKC: { timezone: "America/Chicago", country: "United States" },
  OMA: { timezone: "America/Chicago", country: "United States" },
  ONT: { timezone: "America/Los_Angeles", country: "United States" },
  ORD: { timezone: "America/Chicago", country: "United States" },
  ORF: { timezone: "America/New_York", country: "United States" },
  ORH: { timezone: "America/New_York", country: "United States" },
  PAE: { timezone: "America/Los_Angeles", country: "United States" },
  PBI: { timezone: "America/New_York", country: "United States" },
  PDX: { timezone: "America/Los_Angeles", country: "United States" },
  PHF: { timezone: "America/New_York", country: "United States" },
  PHL: { timezone: "America/New_York", country: "United States" },
  PHX: { timezone: "America/Phoenix", country: "United States" },
  PIA: { timezone: "America/Chicago", country: "United States" },
  PIE: { timezone: "America/New_York", country: "United States" },
  PIT: { timezone: "America/New_York", country: "United States" },
  PNS: { timezone: "America/Chicago", country: "United States" },
  PSC: { timezone: "America/Los_Angeles", country: "United States" },
  PSP: { timezone: "America/Los_Angeles", country: "United States" },
  PVD: { timezone: "America/New_York", country: "United States" },
  PVU: { timezone: "America/Denver", country: "United States" },
  PWM: { timezone: "America/New_York", country: "United States" },
  RAP: { timezone: "America/Denver", country: "United States" },
  RDM: { timezone: "America/Los_Angeles", country: "United States" },
  RDU: { timezone: "America/New_York", country: "United States" },
  RFD: { timezone: "America/Chicago", country: "United States" },
  RIC: { timezone: "America/New_York", country: "United States" },
  RNO: { timezone: "America/Los_Angeles", country: "United States" },
  ROC: { timezone: "America/New_York", country: "United States" },
  RSW: { timezone: "America/New_York", country: "United States" },
  SAN: { timezone: "America/Los_Angeles", country: "United States" },
  SAT: { timezone: "America/Chicago", country: "United States" },
  SAV: { timezone: "America/New_York", country: "United States" },
  SBA: { timezone: "America/Los_Angeles", country: "United States" },
  SBN: { timezone: "America/Indiana/Indianapolis", country: "United States" },
  SDF: { timezone: "America/Kentucky/Louisville", country: "United States" },
  SEA: { timezone: "America/Los_Angeles", country: "United States" },
  SFO: { timezone: "America/Los_Angeles", country: "United States" },
  SGF: { timezone: "America/Chicago", country: "United States" },
  SJC: { timezone: "America/Los_Angeles", country: "United States" },
  SLC: { timezone: "America/Denver", country: "United States" },
  SMF: { timezone: "America/Los_Angeles", country: "United States" },
  SNA: { timezone: "America/Los_Angeles", country: "United States" },
  SRQ: { timezone: "America/New_York", country: "United States" },
  STC: { timezone: "America/Chicago", country: "United States" },
  STL: { timezone: "America/Chicago", country: "United States" },
  STS: { timezone: "America/Los_Angeles", country: "United States" },
  SWF: { timezone: "America/New_York", country: "United States" },
  SYR: { timezone: "America/New_York", country: "United States" },
  TLH: { timezone: "America/New_York", country: "United States" },
  TOL: { timezone: "America/New_York", country: "United States" },
  TPA: { timezone: "America/New_York", country: "United States" },
  TTN: { timezone: "America/New_York", country: "United States" },
  TUL: { timezone: "America/Chicago", country: "United States" },
  TUS: { timezone: "America/Phoenix", country: "United States" },
  TVC: { timezone: "America/Detroit", country: "United States" },
  TYS: { timezone: "America/New_York", country: "United States" },
  VPS: { timezone: "America/Chicago", country: "United States" },
  VRB: { timezone: "America/New_York", country: "United States" },
  XNA: { timezone: "America/Chicago", country: "United States" },
})

function normalizeAirportCode(value) {
  const code = (value ?? "").toString().trim().toUpperCase()
  return /^[A-Z]{3}$/.test(code) ? code : ""
}

function inferTimezoneFromAirport(airportCode) {
  const code = normalizeAirportCode(airportCode)
  if (!code) return ""
  return AIRPORT_METADATA[code]?.timezone ?? ""
}

function inferCountryFromAirport(airportCode) {
  const code = normalizeAirportCode(airportCode)
  if (!code) return ""
  return AIRPORT_METADATA[code]?.country ?? ""
}

function inferBrowserTimezone() {
  try {
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone
    return typeof timezone === "string" && timezone ? timezone : ""
  } catch {
    return ""
  }
}

function extractRegionFromLocale(locale) {
  const text = (locale ?? "").toString().trim()
  if (!text) return ""

  try {
    const parsed = new Intl.Locale(text)
    if (parsed.region) return parsed.region.toUpperCase()
  } catch {
    // Fall back to regex parsing below.
  }

  const match = text.match(/[-_]([A-Za-z]{2})(?:[-_]|$)/)
  return match ? match[1].toUpperCase() : ""
}

function regionCodeToCountryName(regionCode) {
  const region = (regionCode ?? "").toString().trim().toUpperCase()
  if (!region) return ""

  try {
    const locale =
      (typeof navigator !== "undefined" && navigator.language) ||
      Intl.DateTimeFormat().resolvedOptions().locale ||
      "en"
    const names = new Intl.DisplayNames([locale], { type: "region" })
    const label = names.of(region)
    return typeof label === "string" && label ? label : ""
  } catch {
    return ""
  }
}

function inferBrowserCountry() {
  const locales = []

  if (typeof navigator !== "undefined") {
    if (Array.isArray(navigator.languages)) {
      locales.push(...navigator.languages)
    }
    if (navigator.language) locales.push(navigator.language)
  }

  try {
    const resolvedLocale = Intl.DateTimeFormat().resolvedOptions().locale
    if (resolvedLocale) locales.push(resolvedLocale)
  } catch {
    // Ignore.
  }

  const seen = new Set()
  for (const locale of locales) {
    const region = extractRegionFromLocale(locale)
    if (!region || seen.has(region)) continue
    seen.add(region)
    const country = regionCodeToCountryName(region)
    if (country) return country
  }

  return ""
}

function inferAirportMetadataFromCodes(airportCodes) {
  if (!Array.isArray(airportCodes)) return { timezone: "", country: "", airport_code: "" }

  for (const raw of airportCodes) {
    const code = normalizeAirportCode(raw)
    if (!code) continue

    const meta = AIRPORT_METADATA[code]
    if (!meta) continue

    return {
      timezone: meta.timezone ?? "",
      country: meta.country ?? "",
      airport_code: code,
    }
  }

  return { timezone: "", country: "", airport_code: "" }
}

export {
  normalizeAirportCode,
  inferTimezoneFromAirport,
  inferCountryFromAirport,
  inferBrowserTimezone,
  inferBrowserCountry,
  inferAirportMetadataFromCodes,
}
