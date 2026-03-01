'use strict';

const { normalizeText } = require('./enrichment');

function toDateString(isoValue) {
  const text = normalizeText(isoValue);
  if (!text) return null;
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function normalizeAirportCode(value) {
  const code = String(value || '').trim().toUpperCase();
  return /^[A-Z]{3}$/.test(code) ? code : null;
}

function buildGoogleFlightsLink({ originAirport, destinationAirport, departDate, returnDate }) {
  const origin = normalizeAirportCode(originAirport);
  const destination = normalizeAirportCode(destinationAirport);
  const outbound = toDateString(departDate);
  const inbound = toDateString(returnDate);

  if (!origin || !destination || !outbound || !inbound) {
    return 'https://www.google.com/travel/flights';
  }

  return `https://www.google.com/travel/flights?hl=en#flt=${origin}.${destination}.${outbound}*${destination}.${origin}.${inbound}`;
}

function buildHotelSearchLink({ city, country, checkInDate, checkOutDate }) {
  const cityText = normalizeText(city) || 'Unknown';
  const countryText = normalizeText(country);
  const destination = [cityText, countryText].filter(Boolean).join(', ');
  const checkIn = toDateString(checkInDate);
  const checkOut = toDateString(checkOutDate);

  const queryParts = [`hotels in ${destination}`];
  if (checkIn && checkOut) queryParts.push(`${checkIn} to ${checkOut}`);

  const query = encodeURIComponent(queryParts.join(' '));
  return `https://www.google.com/travel/hotels?q=${query}`;
}

function buildUberLink({ venueLabel, latitude, longitude }) {
  const params = new URLSearchParams({
    action: 'setPickup',
    'dropoff[nickname]': normalizeText(venueLabel) || 'Hackathon Venue',
  });

  const hasLat = latitude != null && String(latitude).trim() !== '' && Number.isFinite(Number(latitude));
  const hasLon = longitude != null && String(longitude).trim() !== '' && Number.isFinite(Number(longitude));
  if (hasLat && hasLon) {
    const lat = Number(latitude);
    const lon = Number(longitude);
    params.set('dropoff[latitude]', String(lat));
    params.set('dropoff[longitude]', String(lon));
  } else {
    params.set('dropoff[formatted_address]', normalizeText(venueLabel) || 'Unknown');
  }

  return `https://m.uber.com/ul/?${params.toString()}`;
}

function buildTravelLinks({ result, location, venueLabel }) {
  const event = result?.event || {};
  const route = result?.route || {};

  const googleFlightsLink = buildGoogleFlightsLink({
    originAirport: route.origin_airport,
    destinationAirport: route.destination_airport,
    departDate: event.start_datetime_utc,
    returnDate: event.end_datetime_utc,
  });

  const hotelSearchLink = buildHotelSearchLink({
    city: location?.city,
    country: location?.country,
    checkInDate: event.start_datetime_utc,
    checkOutDate: event.end_datetime_utc,
  });

  const uberLink = buildUberLink({
    venueLabel,
    latitude: location?.latitude,
    longitude: location?.longitude,
  });

  return {
    googleFlightsLink,
    hotelSearchLink,
    uberLink,
  };
}

module.exports = {
  buildGoogleFlightsLink,
  buildHotelSearchLink,
  buildTravelLinks,
  buildUberLink,
};
