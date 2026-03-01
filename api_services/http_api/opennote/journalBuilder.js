'use strict';

const crypto = require('crypto');
const { normalizeText } = require('./enrichment');

function formatUsd(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 'Unknown';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(num);
}

function formatDate(iso) {
  const text = normalizeText(iso);
  if (!text) return 'Unknown';
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return 'Unknown';
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
}

function buildJournalTitle(eventName) {
  const name = normalizeText(eventName) || 'Unknown Hackathon';
  return name;
}

function buildJournalMarkdown({ result, school, location, venueLabel, links }) {
  const event = result?.event || {};
  const route = result?.route || {};
  const cost = result?.cost_estimate || {};

  const lines = [
    `# ${buildJournalTitle(event.name)}`,
    '',
    '## Overview',
    `- School: ${school || 'Unknown'}`,
    `- City: ${location?.city || 'Unknown'}`,
    `- State: ${location?.state || 'Unknown'}`,
    `- Country: ${location?.country || 'Unknown'}`,
    `- Venue: ${venueLabel || 'Unknown'}`,
    `- Dates: ${formatDate(event.start_datetime_utc)} to ${formatDate(event.end_datetime_utc)}`,
    '',
    '## Travel & Stay',
    `- Origin Airport: ${route.origin_airport || 'Unknown'}`,
    `- Destination Airport: ${route.destination_airport || 'Unknown'}`,
    `- Estimated Flight Cost: ${formatUsd(cost.estimated_flight_cost)}`,
    `- Estimated Lodging Cost: ${formatUsd(cost.estimated_lodging_cost)}`,
    `- Estimated Total Cost: ${formatUsd(cost.estimated_total_cost)}`,
    '',
    '## Quick Links',
    `- Event: ${normalizeText(event.url) || 'Unknown'}`,
    `- Google Flights (round trip): ${links.googleFlightsLink}`,
    `- Hotel Search: ${links.hotelSearchLink}`,
    `- Uber to Venue: ${links.uberLink}`,
  ];

  return lines.join('\n');
}

function buildOpenNoteJournalPayload({ result, school, location, venueLabel, links }) {
  const event = result?.event || {};
  const title = buildJournalTitle(event.name);
  const contentMarkdown = buildJournalMarkdown({
    result,
    school,
    location,
    venueLabel,
    links,
  });

  return {
    title,
    content_markdown: contentMarkdown,
    metadata: {
      source: 'hacktrack',
      event_id: event.id == null ? null : String(event.id),
      event_url: normalizeText(event.url) || null,
      city: location?.city || 'Unknown',
      state: location?.state || 'Unknown',
      country: location?.country || 'Unknown',
      school: school || 'Unknown',
      venue: venueLabel || 'Unknown',
      links,
      start_datetime_utc: normalizeText(event.start_datetime_utc) || null,
      end_datetime_utc: normalizeText(event.end_datetime_utc) || null,
    },
  };
}

function hashJournalPayload(payload) {
  const stable = JSON.stringify(payload);
  return crypto.createHash('sha256').update(stable).digest('hex');
}

module.exports = {
  buildOpenNoteJournalPayload,
  hashJournalPayload,
};
