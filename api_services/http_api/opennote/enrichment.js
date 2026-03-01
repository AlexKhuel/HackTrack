'use strict';

const GEO_TIMEOUT_MS = 3500;
const SCHOOL_HINT_RE = /\b([A-Z][A-Za-z0-9'&.\- ]{2,}(?:University|College|Institute|School|Academy))\b/;
const NAME_AT_RE = /\b(?:at|@)\s+([^,\-|]+)/i;

function normalizeText(value) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text || null;
}

function inferSchoolFromEventName(eventName) {
  const name = normalizeText(eventName);
  if (!name) return null;

  const direct = name.match(SCHOOL_HINT_RE);
  if (direct?.[1]) return normalizeText(direct[1]);

  const atMatch = name.match(NAME_AT_RE);
  if (atMatch?.[1]) {
    const candidate = normalizeText(atMatch[1]);
    if (candidate && /(?:University|College|Institute|School|Academy)/i.test(candidate)) {
      return candidate;
    }
  }

  return null;
}

function inferSchoolFromUrl(urlValue) {
  const urlText = normalizeText(urlValue);
  if (!urlText) return null;

  try {
    const parsed = new URL(urlText.startsWith('http') ? urlText : `https://${urlText}`);
    const host = (parsed.hostname || '').toLowerCase();

    if (host.endsWith('.edu')) {
      const labels = host.replace(/\.edu$/, '').split('.').filter(Boolean);
      const candidate = labels[labels.length - 1] || labels[0];
      if (!candidate) return null;
      return candidate.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    }

    if (host.includes('university') || host.includes('college') || host.includes('institute')) {
      return host
        .replace(/^www\./, '')
        .split('.')[0]
        .replace(/[-_]+/g, ' ')
        .replace(/\b\w/g, (c) => c.toUpperCase());
    }
  } catch {
    return null;
  }

  return null;
}

async function geocodeCityCountry(city, country) {
  const normalizedCity = normalizeText(city);
  if (!normalizedCity) return null;

  const query = [normalizedCity, normalizeText(country)].filter(Boolean).join(', ');
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=1&language=en&format=json`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), GEO_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
      },
    });

    if (!response.ok) return null;
    const payload = await response.json();
    const best = Array.isArray(payload?.results) ? payload.results[0] : null;
    if (!best) return null;

    return {
      city: normalizeText(best.name) || normalizedCity,
      state: normalizeText(best.admin1),
      country: normalizeText(best.country) || normalizeText(country),
      latitude: Number.isFinite(Number(best.latitude)) ? Number(best.latitude) : null,
      longitude: Number.isFinite(Number(best.longitude)) ? Number(best.longitude) : null,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function enrichEventLocation(event) {
  const city = normalizeText(event?.city);
  const country = normalizeText(event?.country);
  const geocoded = await geocodeCityCountry(city, country);

  return {
    city: geocoded?.city || city || 'Unknown',
    state: geocoded?.state || 'Unknown',
    country: geocoded?.country || country || 'Unknown',
    latitude: geocoded?.latitude ?? null,
    longitude: geocoded?.longitude ?? null,
  };
}

function inferSchool(event) {
  const fromName = inferSchoolFromEventName(event?.name);
  if (fromName) return fromName;
  const fromUrl = inferSchoolFromUrl(event?.url);
  if (fromUrl) return fromUrl;
  return 'Unknown';
}

function buildVenueFallback(location) {
  const parts = [location?.city, location?.state, location?.country]
    .map(normalizeText)
    .filter(Boolean);
  if (parts.length === 0) return 'Unknown';
  return parts.join(', ');
}

module.exports = {
  buildVenueFallback,
  enrichEventLocation,
  inferSchool,
  normalizeText,
};
