'use strict';

const express = require('express');
const { DateTime } = require('luxon');
const db = require('../db');
const { checkTimeFeasibility }                        = require('../feasibility/timeFeasibility');
const {
  checkBudgetFeasibility,
  normalizeCityToken,
  resolveAirport,
  resolveAirportCity,
  resolveAirportTimezone,
} = require('../feasibility/budgetFeasibility');

const router = express.Router();
const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;
const DATE_TIME_WITH_TZ_RE = /^\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?(?:Z|[+-]\d{2}:\d{2})$/;
const MAX_ORIGIN_AIRPORTS = 3;
const CITY_GEO_CACHE = new Map();
const MAX_CITY_GEO_CACHE_ENTRIES = 5000;
const GEO_TIMEOUT_MS = 3500;
const GEO_RESULT_COUNT = 10;
const SCRAPE_TIMEOUT_MS = 6500;
const MAX_SCRAPE_HTML_LENGTH = 1_000_000;
const DRIVE_AIRPORT_CLUSTERS = [
  new Set(['LAX', 'SNA', 'LGB', 'ONT', 'BUR']),
];
const AMBIGUOUS_US_CITY_TOKENS = new Set([
  'ontario',
]);
const US_COUNTRY_TOKENS = new Set([
  'united states',
  'united states of america',
  'us',
  'usa',
  'u s',
  'u s a',
  'america',
]);

function decodeHtmlEntities(value) {
  return String(value ?? '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

function collapseWhitespace(value) {
  return decodeHtmlEntities(value).replace(/\s+/g, ' ').trim();
}

function stripHtml(value) {
  return collapseWhitespace(String(value ?? '').replace(/<[^>]*>/g, ' '));
}

function extractHtmlAttribute(tagHtml, attrName) {
  const safeAttr = String(attrName ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = String(tagHtml ?? '').match(
    new RegExp(`${safeAttr}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i')
  );
  if (!match) return '';
  return collapseWhitespace(match[2] ?? match[3] ?? match[4] ?? '');
}

function extractMetaContent(html, predicate) {
  const tags = String(html ?? '').match(/<meta\b[^>]*>/gi) ?? [];
  for (const tag of tags) {
    const name = extractHtmlAttribute(tag, 'name').toLowerCase();
    const property = extractHtmlAttribute(tag, 'property').toLowerCase();
    const itemprop = extractHtmlAttribute(tag, 'itemprop').toLowerCase();
    const key = name || property || itemprop;
    if (!key) continue;
    if (!predicate(key, { name, property, itemprop })) continue;
    const content = extractHtmlAttribute(tag, 'content');
    if (content) return content;
  }
  return '';
}

function getJsonLdScripts(html) {
  const scripts = [];
  const re = /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = re.exec(String(html ?? '')) != null)) {
    const raw = (match[1] ?? '').trim().replace(/^<!--/, '').replace(/-->$/, '').trim();
    if (raw) scripts.push(raw);
  }
  return scripts;
}

function flattenJsonLdNodes(node, output) {
  if (node == null) return;
  if (Array.isArray(node)) {
    for (const child of node) flattenJsonLdNodes(child, output);
    return;
  }
  if (typeof node !== 'object') return;

  output.push(node);
  if (Array.isArray(node['@graph'])) {
    flattenJsonLdNodes(node['@graph'], output);
  }
}

function parseJsonLdNodes(html) {
  const nodes = [];
  const scripts = getJsonLdScripts(html);
  for (const script of scripts) {
    try {
      const parsed = JSON.parse(script);
      flattenJsonLdNodes(parsed, nodes);
    } catch {
      // Skip malformed JSON-LD blocks.
    }
  }
  return nodes;
}

function toTypeTokens(value) {
  if (Array.isArray(value)) {
    return value
      .map((entry) => collapseWhitespace(entry).toLowerCase())
      .filter(Boolean);
  }
  const token = collapseWhitespace(value).toLowerCase();
  return token ? [token] : [];
}

function isJsonLdType(node, typeToken) {
  const expected = collapseWhitespace(typeToken).toLowerCase();
  if (!expected) return false;
  return toTypeTokens(node?.['@type']).some((token) => token === expected || token.endsWith(`/${expected}`));
}

function toObjectLike(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function pickString(...candidates) {
  for (const candidate of candidates) {
    const text = collapseWhitespace(candidate);
    if (text) return text;
  }
  return '';
}

function parseCountryToken(value) {
  if (typeof value === 'string') return collapseWhitespace(value);
  if (value != null && typeof value === 'object') {
    return pickString(value.name, value['@id']);
  }
  return '';
}

function parseLooseLocationString(value) {
  const tokens = collapseWhitespace(value)
    .split(',')
    .map((token) => collapseWhitespace(token))
    .filter(Boolean);

  if (tokens.length >= 3) {
    return {
      city: tokens[tokens.length - 3],
      state: tokens[tokens.length - 2],
      country: tokens[tokens.length - 1],
    };
  }
  if (tokens.length === 2) {
    return { city: tokens[0], state: '', country: tokens[1] };
  }
  return { city: tokens[0] ?? '', state: '', country: '' };
}

function parseLocationNode(locationNode) {
  if (!locationNode) return { venue_name: '', city: '', state: '', country: '' };
  if (typeof locationNode === 'string') {
    return { venue_name: '', ...parseLooseLocationString(locationNode) };
  }

  const location = toObjectLike(locationNode) ?? {};
  const address = toObjectLike(location.address) ?? location;

  return {
    venue_name: pickString(location.name),
    city: pickString(address.addressLocality, address.locality, address.city),
    state: pickString(address.addressRegion, address.region, address.state, address.stateCode),
    country: parseCountryToken(address.addressCountry ?? address.country),
  };
}

function normalizeScrapedDate(value) {
  const text = collapseWhitespace(value);
  if (!text) return '';

  const iso = DateTime.fromISO(text, { setZone: true });
  if (iso.isValid) return iso.toUTC().toISO();

  const httpDate = DateTime.fromHTTP(text, { zone: 'utc' });
  if (httpDate.isValid) return httpDate.toUTC().toISO();

  const rfc = DateTime.fromRFC2822(text, { zone: 'utc' });
  if (rfc.isValid) return rfc.toUTC().toISO();

  const jsDate = new Date(text);
  if (!Number.isNaN(jsDate.getTime())) {
    return DateTime.fromJSDate(jsDate, { zone: 'utc' }).toUTC().toISO();
  }
  return '';
}

function inferEventFromJsonLd(nodes) {
  const eventNode = nodes.find((node) => isJsonLdType(node, 'event'));
  if (!eventNode) {
    return {
      name: '',
      school: '',
      city: '',
      state: '',
      country: '',
      venue_name: '',
      start_datetime_utc: '',
      end_datetime_utc: '',
      url: '',
      source: '',
    };
  }

  const organizer = toObjectLike(eventNode.organizer) ?? {};
  const locationNodes = Array.isArray(eventNode.location) ? eventNode.location : [eventNode.location];
  const parsedLocations = locationNodes.map(parseLocationNode);
  const bestLocation = parsedLocations.find((entry) => entry.city || entry.country) ?? parsedLocations[0] ?? {};

  return {
    name: pickString(eventNode.name),
    school: pickString(organizer.name),
    city: pickString(bestLocation.city),
    state: pickString(bestLocation.state),
    country: pickString(bestLocation.country),
    venue_name: pickString(bestLocation.venue_name),
    start_datetime_utc: normalizeScrapedDate(eventNode.startDate),
    end_datetime_utc: normalizeScrapedDate(eventNode.endDate),
    url: pickString(eventNode.url),
    source: 'jsonld',
  };
}

function inferEventFromMeta(html) {
  const titleFromMeta = extractMetaContent(html, (key) =>
    key === 'og:title' || key === 'twitter:title' || key === 'title'
  );
  const htmlTitle = stripHtml((String(html ?? '').match(/<title\b[^>]*>([\s\S]*?)<\/title>/i) ?? [])[1]);
  const name = pickString(titleFromMeta, htmlTitle);

  const school = extractMetaContent(html, (key) =>
    key === 'og:site_name' || key === 'application-name' || key === 'author'
  );

  const city = extractMetaContent(html, (key) =>
    key === 'geo.placename' || key === 'place:location:locality' || key === 'og:locality'
  );
  const state = extractMetaContent(html, (key) =>
    key === 'place:location:region' || key === 'og:region'
  );
  const country = extractMetaContent(html, (key) =>
    key === 'place:location:country' || key === 'og:country-name'
  );

  const startFromMeta = extractMetaContent(html, (key) =>
    key === 'event:start_time' || key === 'event:start' || key === 'startdate'
  );
  const endFromMeta = extractMetaContent(html, (key) =>
    key === 'event:end_time' || key === 'event:end' || key === 'enddate'
  );

  const timeDateTimes = [];
  const timeRe = /<time\b[^>]*datetime\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/gi;
  let timeMatch;
  while ((timeMatch = timeRe.exec(String(html ?? '')) != null)) {
    const token = pickString(timeMatch[2], timeMatch[3], timeMatch[4]);
    if (token) timeDateTimes.push(token);
  }

  return {
    name,
    school,
    city,
    state,
    country,
    venue_name: '',
    start_datetime_utc: normalizeScrapedDate(startFromMeta || timeDateTimes[0]),
    end_datetime_utc: normalizeScrapedDate(endFromMeta || timeDateTimes[1]),
    url: extractMetaContent(html, (key) => key === 'og:url' || key === 'canonical'),
    source: 'meta',
  };
}

function mergeScrapedEventData(primary, fallback) {
  return {
    name: pickString(primary?.name, fallback?.name),
    school: pickString(primary?.school, fallback?.school),
    city: pickString(primary?.city, fallback?.city),
    state: pickString(primary?.state, fallback?.state),
    country: pickString(primary?.country, fallback?.country),
    venue_name: pickString(primary?.venue_name, fallback?.venue_name),
    start_datetime_utc: pickString(primary?.start_datetime_utc, fallback?.start_datetime_utc),
    end_datetime_utc: pickString(primary?.end_datetime_utc, fallback?.end_datetime_utc),
    url: pickString(primary?.url, fallback?.url),
    source: pickString(primary?.source, fallback?.source),
  };
}

function isPrivateIpv4Host(hostname) {
  const octets = String(hostname ?? '')
    .split('.')
    .map((part) => Number(part));
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
    return false;
  }
  if (octets[0] === 10 || octets[0] === 127 || octets[0] === 0) return true;
  if (octets[0] === 169 && octets[1] === 254) return true;
  if (octets[0] === 192 && octets[1] === 168) return true;
  if (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) return true;
  return false;
}

function isBlockedScrapeHostname(hostname) {
  const host = String(hostname ?? '').trim().toLowerCase();
  if (!host) return true;
  const isIpv6Host = host.includes(':');
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  if (host === '::1' || host === '0:0:0:0:0:0:0:1') return true;
  if (isIpv6Host && host.startsWith('fe80:')) return true;
  if (isIpv6Host && (host.startsWith('fc') || host.startsWith('fd'))) return true;
  if (host.endsWith('.local')) return true;
  if (isPrivateIpv4Host(host)) return true;
  return false;
}

function normalizeScrapeTargetUrl(rawUrl) {
  const candidate = String(rawUrl ?? '').trim();
  if (!candidate) throw new Error('url query param is required');

  let parsed;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new Error('Invalid url query param');
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('Only http/https URLs are supported');
  }

  if (isBlockedScrapeHostname(parsed.hostname)) {
    throw new Error('URL host is not allowed');
  }

  parsed.hash = '';
  return parsed;
}

function normalizeAirportCode(value) {
  if (typeof value !== 'string') return null;
  const code = value.trim().toUpperCase();
  return /^[A-Z]{3}$/.test(code) ? code : null;
}

function isLikelyUnitedStatesCountry(country) {
  if (country == null) return null;
  const token = normalizeCityToken(String(country));
  if (!token) return null;
  return US_COUNTRY_TOKENS.has(token);
}

function normalizeOriginAirports(query) {
  const originAirports = [];
  const seen = new Set();

  const addAirportToken = (token) => {
    const code = normalizeAirportCode(token);
    if (!code) throw new Error('origin_airport values must be 3-letter IATA codes');
    if (seen.has(code)) return;
    if (originAirports.length >= MAX_ORIGIN_AIRPORTS) {
      throw new Error(`origin_airport accepts at most ${MAX_ORIGIN_AIRPORTS} airports`);
    }
    seen.add(code);
    originAirports.push(code);
  };

  const addFromValue = (raw) => {
    if (raw == null) return;
    if (Array.isArray(raw)) {
      for (const entry of raw) addFromValue(entry);
      return;
    }

    const text = String(raw).trim();
    if (!text) return;

    if (text.startsWith('[') && text.endsWith(']')) {
      try {
        const parsed = JSON.parse(text);
        if (Array.isArray(parsed)) {
          for (const entry of parsed) addFromValue(entry);
          return;
        }
      } catch {
        // Fall back to delimiter splitting for non-JSON strings.
      }
    }

    const segments = text.split(/,|;|\||\n/).map((segment) => segment.trim()).filter(Boolean);
    if (segments.length > 1) {
      for (const segment of segments) addAirportToken(segment);
      return;
    }

    addAirportToken(text);
  };

  addFromValue(query.origin_airport);
  addFromValue(query['origin_airport[]']);
  addFromValue(query.origin_airports);
  addFromValue(query['origin_airports[]']);

  return originAirports;
}

function buildOriginAirportPriority(originAirports) {
  return new Map(originAirports.map((code, idx) => [code, idx]));
}

function normalizeNonNegativeNumber(value) {
  const asNum = Number(value);
  return Number.isFinite(asNum) && asNum >= 0 ? asNum : null;
}

function findDriveAirportCluster(airportCode) {
  const normalized = normalizeAirportCode(airportCode);
  if (!normalized) return null;
  for (const cluster of DRIVE_AIRPORT_CLUSTERS) {
    if (cluster.has(normalized)) return cluster;
  }
  return null;
}

function isDriveReachableDestination(destinationAirport, originAirportSet) {
  const destination = normalizeAirportCode(destinationAirport);
  if (!destination || !(originAirportSet instanceof Set) || originAirportSet.size === 0) {
    return false;
  }

  if (originAirportSet.has(destination)) return true;

  const destinationCluster = findDriveAirportCluster(destination);
  if (!destinationCluster) return false;

  for (const originAirport of originAirportSet) {
    if (destinationCluster.has(originAirport)) return true;
  }
  return false;
}

function pickDriveOriginAirport(destinationAirport, normalizedOriginAirports) {
  const destination = normalizeAirportCode(destinationAirport);
  const origins = Array.isArray(normalizedOriginAirports) ? normalizedOriginAirports : [];
  if (destination && origins.includes(destination)) return destination;

  const destinationCluster = findDriveAirportCluster(destination);
  if (destinationCluster) {
    for (const originAirport of origins) {
      if (destinationCluster.has(originAirport)) return originAirport;
    }
  }

  return origins[0] ?? destination;
}

function sortRoutesForDestination(routes, originPriority) {
  return [...routes].sort((a, b) => {
    const aRank = originPriority.get(a.origin_airport) ?? Number.MAX_SAFE_INTEGER;
    const bRank = originPriority.get(b.origin_airport) ?? Number.MAX_SAFE_INTEGER;
    if (aRank !== bRank) return aRank - bRank;

    const aFlightCost = normalizeNonNegativeNumber(a.avg_outbound_price);
    const aReturnCost = normalizeNonNegativeNumber(a.avg_return_price);
    const bFlightCost = normalizeNonNegativeNumber(b.avg_outbound_price);
    const bReturnCost = normalizeNonNegativeNumber(b.avg_return_price);
    const aTotal = aFlightCost == null || aReturnCost == null ? Number.MAX_SAFE_INTEGER : aFlightCost + aReturnCost;
    const bTotal = bFlightCost == null || bReturnCost == null ? Number.MAX_SAFE_INTEGER : bFlightCost + bReturnCost;

    return aTotal - bTotal;
  });
}

function normalizeDateFilter(value, boundary) {
  if (value == null || value === '') return null;
  const fieldName = boundary === 'start' ? 'date_range_start' : 'date_range_end';
  const text = String(value).trim().replace(' ', 'T');

  if (DATE_ONLY_RE.test(text)) {
    throw new Error(
      `Invalid ${fieldName} value: use an ISO 8601 datetime with explicit timezone (e.g. 2026-03-01T00:00:00-08:00)`
    );
  }
  if (!DATE_TIME_WITH_TZ_RE.test(text)) {
    throw new Error(`Invalid ${fieldName} value`);
  }

  const parsed = DateTime.fromISO(text, { setZone: true });
  if (!parsed.isValid) throw new Error(`Invalid ${fieldName} value`);

  return parsed.toUTC().toISO();
}

function normalizeScheduleBoundary(value, fieldName) {
  const text = String(value ?? '').trim().replace(' ', 'T');
  if (!DATE_TIME_WITH_TZ_RE.test(text)) {
    throw new Error(
      `Invalid ${fieldName} value: use an ISO 8601 datetime with explicit timezone (e.g. 2026-03-06T18:00:00-08:00)`
    );
  }

  const parsed = DateTime.fromISO(text, { setZone: true });
  if (!parsed.isValid) throw new Error(`Invalid ${fieldName} value`);
  return parsed;
}

function ensureValidTimezone(timezone) {
  const probe = DateTime.now().setZone(String(timezone ?? ''));
  if (!probe.isValid) throw new Error('user_timezone must be a valid IANA timezone');
}

function normalizeEventUtcDateTime(value) {
  if (value == null || value === '') return null;
  const parsed = value instanceof Date
    ? DateTime.fromJSDate(value, { zone: 'utc' })
    : DateTime.fromISO(String(value), { zone: 'utc' });
  if (!parsed.isValid) return null;
  return parsed.toUTC().toISO();
}

function buildLodgingLookup(lodgingRows) {
  const statsByCity = {};

  for (const row of lodgingRows) {
    const cityToken = normalizeCityToken(row.city);
    const nightlyRate = Number(row.nightly_rate);
    if (!cityToken || !Number.isFinite(nightlyRate) || nightlyRate < 0) continue;

    if (!statsByCity[cityToken]) {
      statsByCity[cityToken] = { sum: 0, count: 0 };
    }
    statsByCity[cityToken].sum += nightlyRate;
    statsByCity[cityToken].count += 1;
  }

  const nightlyRateByCity = {};
  for (const [cityToken, stats] of Object.entries(statsByCity)) {
    nightlyRateByCity[cityToken] = Math.round((stats.sum / stats.count) * 100) / 100;
  }

  return nightlyRateByCity;
}

function resolveLodgingNightlyRate(eventCity, routeDestinationCity, destAirport, nightlyRateByCity) {
  const candidates = [];
  const addCandidate = (raw) => {
    const token = normalizeCityToken(raw);
    if (!token || candidates.includes(token)) return;
    candidates.push(token);
  };

  addCandidate(eventCity);
  addCandidate(routeDestinationCity);
  if (typeof eventCity === 'string') {
    for (const segment of eventCity.split(/,|\/|\||@|(?:\s[-–—]\s)/)) {
      addCandidate(segment);
    }
  }
  addCandidate(resolveAirportCity(destAirport));

  for (const cityToken of candidates) {
    const nightlyRate = nightlyRateByCity[cityToken];
    if (Number.isFinite(nightlyRate)) return nightlyRate;
  }

  return null;
}

function buildFriendCityTokenSet(rawFriendCities) {
  const friendCityTokens = new Set();
  const addToken = (raw) => {
    const token = normalizeCityToken(raw);
    if (token) friendCityTokens.add(token);
  };

  const addTokensFromText = (value) => {
    const text = String(value ?? '').trim();
    if (!text) return;

    addToken(text);

    if (text.startsWith('[') && text.endsWith(']')) {
      try {
        const parsed = JSON.parse(text);
        if (Array.isArray(parsed)) {
          for (const entry of parsed) addToken(entry);
          return;
        }
      } catch {
        // Fall back to delimiter parsing for non-JSON strings.
      }
    }

    for (const delimiter of ['|', ';', '\n']) {
      if (!text.includes(delimiter)) continue;
      for (const segment of text.split(delimiter)) addToken(segment);
    }

    if (text.includes(',')) {
      for (const segment of text.split(',')) addToken(segment);
    }
  };

  if (Array.isArray(rawFriendCities)) {
    for (const value of rawFriendCities) addTokensFromText(value);
  } else if (rawFriendCities != null) {
    addTokensFromText(rawFriendCities);
  }

  return friendCityTokens;
}

function hasFriendInDestinationCity(eventCity, routeDestinationCity, destAirport, friendCityTokens) {
  if (!(friendCityTokens instanceof Set) || friendCityTokens.size === 0) return false;

  const candidates = [];
  const addCandidate = (raw) => {
    const token = normalizeCityToken(raw);
    if (!token || candidates.includes(token)) return;
    candidates.push(token);
  };

  addCandidate(eventCity);
  addCandidate(routeDestinationCity);

  if (typeof eventCity === 'string') {
    for (const segment of eventCity.split(/,|\/|\||@|(?:\s[-–—]\s)/)) {
      addCandidate(segment);
    }
  }

  if (typeof routeDestinationCity === 'string') {
    for (const segment of routeDestinationCity.split(/,|\/|\||@|(?:\s[-–—]\s)/)) {
      addCandidate(segment);
    }
  }

  addCandidate(resolveAirportCity(destAirport));

  return candidates.some((cityToken) => friendCityTokens.has(cityToken));
}

function buildCityCandidateTokens(rawCity) {
  const tokens = [];
  const addToken = (raw) => {
    const token = normalizeCityToken(raw);
    if (!token || tokens.includes(token)) return;
    tokens.push(token);
  };

  addToken(rawCity);
  if (typeof rawCity === 'string') {
    for (const segment of rawCity.split(/,|\/|\||@|(?:\s[-–—]\s)/)) {
      addToken(segment);
    }
  }

  return tokens;
}

function isAmbiguousUsCityWithoutExplicitUsCountry(city, country) {
  if (isLikelyUnitedStatesCountry(country) === true) return false;
  return buildCityCandidateTokens(city).some((token) => AMBIGUOUS_US_CITY_TOKENS.has(token));
}

function resolveAirportFromRouteCities(eventCity, eventCountry, routesByDest) {
  if (isLikelyUnitedStatesCountry(eventCountry) === false) return null;

  const cityTokens = buildCityCandidateTokens(eventCity);
  if (!cityTokens.length) return null;

  let partialMatch = null;

  for (const [destinationAirport, destinationRoutes] of Object.entries(routesByDest ?? {})) {
    const routeCityToken = normalizeCityToken(
      destinationRoutes?.[0]?.destination_city ?? resolveAirportCity(destinationAirport)
    );
    if (!routeCityToken) continue;

    if (cityTokens.includes(routeCityToken)) {
      return destinationAirport;
    }

    for (const cityToken of cityTokens) {
      if (routeCityToken.includes(cityToken) || cityToken.includes(routeCityToken)) {
        const score = Math.min(routeCityToken.length, cityToken.length);
        if (!partialMatch || score > partialMatch.score) {
          partialMatch = { destinationAirport, score };
        }
      }
    }
  }

  return partialMatch?.destinationAirport ?? null;
}

function toRadians(value) {
  return (value * Math.PI) / 180;
}

function haversineDistanceKm(a, b) {
  const earthRadiusKm = 6371;
  const dLat = toRadians(b.lat - a.lat);
  const dLon = toRadians(b.lon - a.lon);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);
  const x = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  const y = 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
  return earthRadiusKm * y;
}

function buildCityGeocodeQueries(city, country) {
  const queries = [];
  const seen = new Set();
  const addQuery = (raw) => {
    const text = String(raw ?? '').trim();
    if (!text) return;
    const key = text.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    queries.push(text);
  };

  const normalizedCity = String(city ?? '').trim();
  const normalizedCountry = String(country ?? '').trim();
  if (!normalizedCity) return queries;

  if (normalizedCountry) addQuery(`${normalizedCity}, ${normalizedCountry}`);
  addQuery(normalizedCity);
  for (const token of buildCityCandidateTokens(normalizedCity)) {
    addQuery(token);
  }

  return queries;
}

async function fetchCityCoordinates(query) {
  if (!query || typeof fetch !== 'function') return null;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), GEO_TIMEOUT_MS);

  try {
    const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=${GEO_RESULT_COUNT}&language=en&format=json`;
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
      },
      signal: controller.signal,
    });
    if (!response.ok) return null;

    const payload = await response.json();
    const candidates = Array.isArray(payload?.results) ? payload.results : [];
    if (!candidates.length) return null;

    // Prefer higher-confidence localities by population. This avoids ambiguous
    // low-population matches (e.g., city names that exist in many states).
    const best = [...candidates]
      .sort((a, b) => {
        const popA = Number(a?.population);
        const popB = Number(b?.population);
        const hasPopA = Number.isFinite(popA) ? popA : -1;
        const hasPopB = Number.isFinite(popB) ? popB : -1;
        if (hasPopA !== hasPopB) return hasPopB - hasPopA;
        const featureA = String(a?.feature_code ?? '');
        const featureB = String(b?.feature_code ?? '');
        return featureB.localeCompare(featureA);
      })[0];

    const lat = Number(best?.latitude);
    const lon = Number(best?.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

    return { lat, lon };
  } catch {
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function geocodeCityCoordinates(city, country = null) {
  const cityToken = normalizeCityToken(city);
  if (!cityToken) return null;
  const countryToken = normalizeCityToken(country) ?? '';
  const cacheKey = `${cityToken}|${countryToken}`;

  if (CITY_GEO_CACHE.has(cacheKey)) {
    return CITY_GEO_CACHE.get(cacheKey);
  }

  const pending = (async () => {
    const queries = buildCityGeocodeQueries(city, country);
    for (const query of queries) {
      const coordinates = await fetchCityCoordinates(query);
      if (coordinates) return coordinates;
    }
    return null;
  })();

  CITY_GEO_CACHE.set(cacheKey, pending);
  let resolved = null;
  try {
    resolved = await pending;
  } catch {
    resolved = null;
  }
  CITY_GEO_CACHE.set(cacheKey, resolved);

  if (CITY_GEO_CACHE.size > MAX_CITY_GEO_CACHE_ENTRIES) {
    const oldestKey = CITY_GEO_CACHE.keys().next().value;
    if (oldestKey !== undefined) CITY_GEO_CACHE.delete(oldestKey);
  }

  return resolved;
}

async function buildRouteDestinationGeoLookup(routesByDest) {
  const entries = Object.entries(routesByDest ?? {});
  const pairs = await Promise.all(entries.map(async ([destinationAirport, destinationRoutes]) => {
    const destinationCity = destinationRoutes?.[0]?.destination_city ?? resolveAirportCity(destinationAirport);
    const coordinates = await geocodeCityCoordinates(destinationCity, 'United States')
      || await geocodeCityCoordinates(destinationCity, null);
    return [destinationAirport, coordinates];
  }));

  const geoByAirport = {};
  for (const [destinationAirport, coordinates] of pairs) {
    if (!coordinates) continue;
    geoByAirport[destinationAirport] = coordinates;
  }
  return geoByAirport;
}

async function resolveNearestAirportFromRoutes(eventCity, eventCountry, routeDestinationGeoByAirport) {
  const eventCoordinates = await geocodeCityCoordinates(eventCity, eventCountry);
  if (!eventCoordinates) return null;

  let bestAirport = null;
  let bestDistanceKm = Number.POSITIVE_INFINITY;
  for (const [destinationAirport, destinationCoordinates] of Object.entries(routeDestinationGeoByAirport ?? {})) {
    if (!destinationCoordinates) continue;
    const distanceKm = haversineDistanceKm(eventCoordinates, destinationCoordinates);
    if (!Number.isFinite(distanceKm)) continue;
    if (distanceKm < bestDistanceKm) {
      bestAirport = destinationAirport;
      bestDistanceKm = distanceKm;
    }
  }

  return bestAirport;
}

/**
 * GET /api/hackathons/scrape-event?url=https://example.com/event
 *
 * Scrapes a hackathon page and extracts event metadata (name, location, dates, etc.)
 * from JSON-LD and common HTML meta tags.
 */
router.get('/scrape-event', async (req, res) => {
  let targetUrl;
  try {
    targetUrl = normalizeScrapeTargetUrl(req.query.url);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  const abortController = new AbortController();
  const timeoutHandle = setTimeout(() => abortController.abort(), SCRAPE_TIMEOUT_MS);
  let response;
  try {
    response = await fetch(targetUrl.toString(), {
      method: 'GET',
      redirect: 'follow',
      signal: abortController.signal,
      headers: {
        Accept: 'text/html,application/xhtml+xml',
        'User-Agent': 'HackTrackBot/1.0',
      },
    });
  } catch (err) {
    const message = abortController.signal.aborted
      ? `Timed out fetching ${targetUrl.toString()}`
      : `Failed to fetch ${targetUrl.toString()}`;
    return res.status(502).json({ error: `${message}: ${err?.message ?? 'request_failed'}` });
  } finally {
    clearTimeout(timeoutHandle);
  }

  if (!response.ok) {
    return res.status(502).json({
      error: `Failed to fetch ${targetUrl.toString()} (status ${response.status})`,
    });
  }

  let html = '';
  try {
    html = await response.text();
  } catch (err) {
    return res.status(502).json({ error: `Failed to read response body: ${err?.message ?? 'read_failed'}` });
  }

  const pageHtml = html.slice(0, MAX_SCRAPE_HTML_LENGTH);
  const jsonLdNodes = parseJsonLdNodes(pageHtml);
  const inferredFromJsonLd = inferEventFromJsonLd(jsonLdNodes);
  const inferredFromMeta = inferEventFromMeta(pageHtml);
  const merged = mergeScrapedEventData(inferredFromJsonLd, inferredFromMeta);

  let normalizedEventUrl = pickString(merged.url, response.url, targetUrl.toString());
  try {
    normalizedEventUrl = new URL(normalizedEventUrl, response.url || targetUrl.toString()).toString();
  } catch {
    normalizedEventUrl = pickString(response.url, targetUrl.toString());
  }

  return res.json({
    fetched_url: pickString(response.url, targetUrl.toString()),
    event: {
      name: merged.name || '',
      school: merged.school || '',
      city: merged.city || '',
      state: merged.state || '',
      country: merged.country || '',
      venue_name: merged.venue_name || '',
      start_datetime_utc: merged.start_datetime_utc || '',
      end_datetime_utc: merged.end_datetime_utc || '',
      url: normalizedEventUrl,
      source: merged.source || 'none',
    },
  });
});

/**
 * GET /api/hackathons/feasible
 *
 * Required query params:
 *   origin_airport             - 1-3 IATA codes, supports repeated params or delimited string
 *   user_timezone              - IANA string, e.g. "America/New_York"
 *   budget                     - number (total all-in USD budget)
 *
 * Optional query params:
 *   friday_last_class_end      - ISO 8601 datetime with explicit timezone
 *   monday_first_class_start   - ISO 8601 datetime with explicit timezone
 *   include_lodging            - "true"|"false" (default: "true")
 *   friend_cities              - optional city list for free lodging if friend lives there
 *   date_range_start           - ISO 8601 datetime with explicit timezone
 *   date_range_end             - ISO 8601 datetime with explicit timezone
 *   max_flight_duration        - max combined outbound+return flight time in minutes
 *   min_prize_pool             - minimum event prize pool in USD
 */
router.get('/feasible', async (req, res) => {
  const {
    friday_last_class_end,
    monday_first_class_start,
    user_timezone,
    budget,
    include_lodging = 'true',
    friend_cities,
    date_range_start,
    date_range_end,
    max_flight_duration,
    min_prize_pool,
    include_unmapped,
  } = req.query;

  if (!user_timezone || !budget) {
    return res.status(400).json({
      error: 'Missing required query params: origin_airport, user_timezone, budget',
    });
  }

  let normalizedOriginAirports = [];
  try {
    normalizedOriginAirports = normalizeOriginAirports(req.query);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  if (normalizedOriginAirports.length === 0) {
    return res.status(400).json({ error: 'origin_airport is required and must include at least one IATA code' });
  }

  const budgetNum      = parseFloat(budget);
  const lodgingEnabled = include_lodging !== 'false';
  const includeUnmapped = include_unmapped === 'true';
  const friendCitiesRaw = friend_cities ?? req.query['friend_cities[]'];
  const friendCityTokens = buildFriendCityTokenSet(friendCitiesRaw);
  const originAirportSet = new Set(normalizedOriginAirports);
  const originAirportPriority = buildOriginAirportPriority(normalizedOriginAirports);

  if (isNaN(budgetNum) || budgetNum <= 0) {
    return res.status(400).json({ error: 'budget must be a positive number' });
  }

  let maxFlightDurationNum = null;
  if (max_flight_duration != null && max_flight_duration !== '') {
    maxFlightDurationNum = parseFloat(max_flight_duration);
    if (!Number.isFinite(maxFlightDurationNum) || maxFlightDurationNum < 0) {
      return res.status(400).json({ error: 'max_flight_duration must be a non-negative number (total minutes)' });
    }
  }

  let minPrizePoolNum = null;
  if (min_prize_pool != null && min_prize_pool !== '') {
    minPrizePoolNum = parseFloat(min_prize_pool);
    if (!Number.isFinite(minPrizePoolNum) || minPrizePoolNum < 0) {
      return res.status(400).json({ error: 'min_prize_pool must be a non-negative number (USD)' });
    }
  }

  let fridayLastClassEndHHMM;
  let mondayFirstClassStartHHMM;
  try {
    ensureValidTimezone(user_timezone);
    fridayLastClassEndHHMM = null;
    mondayFirstClassStartHHMM = null;

    if (friday_last_class_end != null && friday_last_class_end !== '') {
      const fridayLastClassBoundary = normalizeScheduleBoundary(friday_last_class_end, 'friday_last_class_end');
      fridayLastClassEndHHMM = fridayLastClassBoundary.setZone(user_timezone).toFormat('HH:mm');
    }
    if (monday_first_class_start != null && monday_first_class_start !== '') {
      const mondayFirstClassBoundary = normalizeScheduleBoundary(monday_first_class_start, 'monday_first_class_start');
      mondayFirstClassStartHHMM = mondayFirstClassBoundary.setZone(user_timezone).toFormat('HH:mm');
    }
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  let normalizedDateRangeStart;
  let normalizedDateRangeEnd;
  try {
    normalizedDateRangeStart = normalizeDateFilter(date_range_start, 'start');
    normalizedDateRangeEnd = normalizeDateFilter(date_range_end, 'end');
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  if (normalizedDateRangeStart && normalizedDateRangeEnd) {
    const startEpoch = Date.parse(normalizedDateRangeStart);
    const endEpoch = Date.parse(normalizedDateRangeEnd);
    if (Number.isFinite(startEpoch) && Number.isFinite(endEpoch) && startEpoch > endEpoch) {
      return res.status(400).json({ error: 'date_range_start must be before or equal to date_range_end' });
    }
  }

  try {
    // 1. Fetch in-person events
    const eventParams = [];
    const eventWhere = ['in_person = TRUE', "(LOWER(source) LIKE '%mlh%' OR LOWER(source) LIKE '%devpost%')"];

    if (normalizedDateRangeStart) {
      eventParams.push(normalizedDateRangeStart);
      eventWhere.push(`start_datetime_utc >= $${eventParams.length}`);
    }
    if (normalizedDateRangeEnd) {
      eventParams.push(normalizedDateRangeEnd);
      eventWhere.push(`start_datetime_utc <= $${eventParams.length}`);
    }

    const eventSql = `
      SELECT id, name, city, country, start_datetime_utc, end_datetime_utc, in_person, prize_pool, url, source
      FROM events
      WHERE ${eventWhere.join(' AND ')}
      ORDER BY start_datetime_utc ASC
    `;
    const { rows: events } = await db.query(eventSql, eventParams);

    // 2. Fetch all routes from provided origin airports
    const routeSql = `
      SELECT
        origin_airport,
        destination_airport,
        origin_city,
        destination_city,
        avg_outbound_price,
        avg_return_price,
        avg_outbound_duration_minutes,
        avg_return_duration_minutes
      FROM routes
      WHERE origin_airport = ANY($1::text[])
    `;
    const { rows: routes } = await db.query(routeSql, [normalizedOriginAirports]);

    // 3. Fetch lodging rates to avoid stale hardcoded assumptions.
    const { rows: lodgingRows } = await db.query('SELECT city, nightly_rate FROM lodging', []);

    const nightlyRateByCity = buildLodgingLookup(lodgingRows ?? []);

    // Build route lookup: destination_airport → [route options]
    const routesByDest = {};
    for (const route of routes ?? []) {
      const originAirport = normalizeAirportCode(route.origin_airport);
      const destinationAirport = normalizeAirportCode(route.destination_airport);
      if (!originAirport || !destinationAirport || !originAirportSet.has(originAirport)) continue;

      if (!routesByDest[destinationAirport]) routesByDest[destinationAirport] = [];
      routesByDest[destinationAirport].push({ ...route, origin_airport: originAirport });
    }

    for (const [destinationAirport, destinationRoutes] of Object.entries(routesByDest)) {
      routesByDest[destinationAirport] = sortRoutesForDestination(destinationRoutes, originAirportPriority);
    }
    const routeDestinationGeoByAirport = await buildRouteDestinationGeoLookup(routesByDest);

    // 4. Run budget + time feasibility on each event
    const feasibleEvents = [];
    for (const event of events ?? []) {
      const normalizedEventStart = normalizeEventUtcDateTime(event.start_datetime_utc);
      const normalizedEventEnd = normalizeEventUtcDateTime(event.end_datetime_utc);
      if (!normalizedEventStart || !normalizedEventEnd) continue;

      const eventWithNormalizedDateTimes = {
        ...event,
        start_datetime_utc: normalizedEventStart,
        end_datetime_utc: normalizedEventEnd,
      };

      // Apply min_prize_pool filter before running feasibility checks.
      if (minPrizePoolNum != null) {
        const prizePool = Number(event.prize_pool);
        if (!Number.isFinite(prizePool) || prizePool < minPrizePoolNum) continue;
      }

      // Resolve city → airport and evaluate drive/flight travel options.
      const hasAmbiguousUsCity = isAmbiguousUsCityWithoutExplicitUsCountry(event.city, event.country);
      const airportResolutionCountry = hasAmbiguousUsCity ? 'Canada' : event.country;
      const isUnitedStatesEvent = hasAmbiguousUsCity ? false : isLikelyUnitedStatesCountry(event.country);
      const canUseNearestAirportFallback = !hasAmbiguousUsCity && isUnitedStatesEvent !== false;
      let destAirport = resolveAirport(event.city, { country: airportResolutionCountry });
      let routeOptions = destAirport ? (routesByDest[destAirport] ?? []) : [];
      let isDriveReachable = isDriveReachableDestination(destAirport, originAirportSet);

      // Fallback for cities not covered by static airport mapping: infer airport
      // from destination_city values present in current route data.
      if (!destAirport || (routeOptions.length === 0 && !isDriveReachable)) {
        const inferredAirport = resolveAirportFromRouteCities(event.city, airportResolutionCountry, routesByDest);
        if (inferredAirport) {
          destAirport = inferredAirport;
          routeOptions = routesByDest[inferredAirport] ?? [];
          isDriveReachable = isDriveReachableDestination(destAirport, originAirportSet);
        }
      }
      if ((!destAirport || (routeOptions.length === 0 && !isDriveReachable)) && canUseNearestAirportFallback) {
        const nearestAirport = await resolveNearestAirportFromRoutes(
          event.city,
          event.country,
          routeDestinationGeoByAirport
        );
        if (nearestAirport) {
          destAirport = nearestAirport;
          routeOptions = routesByDest[nearestAirport] ?? [];
          isDriveReachable = isDriveReachableDestination(destAirport, originAirportSet);
        }
      }

      const isLocalDriveTrip = Boolean(destAirport && isDriveReachable && isUnitedStatesEvent !== false && !hasAmbiguousUsCity);
      const driveOriginAirport = isLocalDriveTrip
        ? pickDriveOriginAirport(destAirport, normalizedOriginAirports)
        : null;
      const travelCandidates = isLocalDriveTrip
        ? [{ travel_mode: 'drive', origin_airport: driveOriginAirport, route: null }]
        : routeOptions.map((routeOption) => ({
          travel_mode: 'flight',
          origin_airport: routeOption.origin_airport,
          route: routeOption,
        }));

      let selectedOutcome = null;

      for (const candidate of travelCandidates) {
        const route = candidate.route;
        const travelMode = candidate.travel_mode;
        const lodgingNightlyRate = resolveLodgingNightlyRate(
          event.city,
          route ? route.destination_city : null,
          destAirport,
          nightlyRateByCity
        );
        const hasFriendInCity = hasFriendInDestinationCity(
          event.city,
          route ? route.destination_city : null,
          destAirport,
          friendCityTokens
        );

        const budgetResult = checkBudgetFeasibility(
          eventWithNormalizedDateTimes,
          {
            budget: budgetNum,
            include_lodging: lodgingEnabled,
            lodging_nightly_rate: lodgingNightlyRate,
            has_friend_in_city: hasFriendInCity,
            travel_mode: travelMode,
            destination_airport: destAirport,
          },
          route
        );
        if (!budgetResult.feasible) continue;

        let timeResult;
        try {
          const outboundDuration = travelMode === 'drive' ? 0 : Number(route?.avg_outbound_duration_minutes);
          const returnDuration = travelMode === 'drive' ? 0 : Number(route?.avg_return_duration_minutes);
          if (!Number.isFinite(outboundDuration) || !Number.isFinite(returnDuration)) continue;

          if (maxFlightDurationNum != null && travelMode === 'flight') {
            if (outboundDuration + returnDuration > maxFlightDurationNum) continue;
          }

          const eventTimezone = resolveAirportTimezone(destAirport) || event.event_timezone || 'UTC';
          timeResult = checkTimeFeasibility(
            { ...eventWithNormalizedDateTimes, event_timezone: eventTimezone },
            {
              friday_last_class_end: fridayLastClassEndHHMM,
              monday_first_class_start: mondayFirstClassStartHHMM,
              user_timezone,
              avg_outbound_duration_minutes: outboundDuration,
              avg_return_duration_minutes:   returnDuration,
            }
          );
        } catch {
          continue;
        }
        if (!timeResult.feasible) continue;

        selectedOutcome = {
          travel_mode: travelMode,
          origin_airport: candidate.origin_airport,
          route,
          budgetResult,
          timeResult,
        };
        break;
      }

      const selectedTravelMode = selectedOutcome?.travel_mode ?? 'unknown';
      const selectedRoute = selectedOutcome?.route ?? null;
      const selectedOriginAirport = selectedOutcome?.origin_airport ?? normalizedOriginAirports[0];
      const originCity = selectedRoute?.origin_city ?? resolveAirportCity(selectedOriginAirport) ?? null;
      const destinationCity = selectedRoute?.destination_city ?? resolveAirportCity(destAirport) ?? event.city ?? null;

      if (!selectedOutcome && includeUnmapped) {
        feasibleEvents.push({
          event: eventWithNormalizedDateTimes,
          route: {
            travel_mode:                      'unknown',
            origin_airport:                   selectedOriginAirport,
            origin_city:                      originCity,
            destination_airport:             destAirport,
            destination_city:                 destinationCity,
            avg_outbound_price:              null,
            avg_return_price:                null,
            avg_outbound_duration_minutes:   null,
            avg_return_duration_minutes:     null,
          },
          cost_estimate: {
            estimated_flight_cost:   null,
            estimated_lodging_cost:  null,
            estimated_total_cost:    null,
          },
          time_feasibility: {
            latest_departure_utc:        null,
            earliest_return_arrival_utc: null,
          },
        });
        continue;
      }

      if (!selectedOutcome) continue;

      feasibleEvents.push({
        event: eventWithNormalizedDateTimes,
        route: {
          travel_mode:                      selectedTravelMode,
          origin_airport:                   selectedOriginAirport,
          origin_city:                      originCity,
          destination_airport:             destAirport,
          destination_city:                 destinationCity,
          avg_outbound_price:              selectedTravelMode === 'drive' ? 0 : (selectedRoute?.avg_outbound_price ?? null),
          avg_return_price:                selectedTravelMode === 'drive' ? 0 : (selectedRoute?.avg_return_price ?? null),
          avg_outbound_duration_minutes:   selectedTravelMode === 'drive' ? 0 : (selectedRoute?.avg_outbound_duration_minutes ?? null),
          avg_return_duration_minutes:     selectedTravelMode === 'drive' ? 0 : (selectedRoute?.avg_return_duration_minutes ?? null),
        },
        cost_estimate: {
          estimated_flight_cost:   selectedOutcome.budgetResult.estimated_flight_cost,
          estimated_lodging_cost:  selectedOutcome.budgetResult.estimated_lodging_cost,
          estimated_total_cost:    selectedOutcome.budgetResult.estimated_total_cost,
        },
        time_feasibility: {
          latest_departure_utc:        selectedOutcome.timeResult.latest_departure_utc,
          earliest_return_arrival_utc: selectedOutcome.timeResult.earliest_return_arrival_utc,
        },
      });
    }

    return res.json({ count: feasibleEvents.length, results: feasibleEvents });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
module.exports._private = {
  buildCityCandidateTokens,
  isAmbiguousUsCityWithoutExplicitUsCountry,
};
