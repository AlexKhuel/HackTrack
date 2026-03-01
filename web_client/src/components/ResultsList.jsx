import { useEffect, useMemo, useRef, useState } from "react";
import {
    fetchFeasibleHackathons,
    fetchScrapedHackathonEvent,
} from "../utils/api";

const FILTER_INPUT =
    "w-48 bg-[rgba(245,237,214,0.07)] border border-[var(--border)] rounded-[6px] px-3 py-2 text-[var(--cream)] outline-none focus:border-[var(--teal)] font-['Syne',sans-serif]";
const FILTER_LABEL =
    "text-xs font-semibold uppercase tracking-[0.25em] text-[var(--cream)] font-['Space_Mono',monospace]";
const ACTION_BUTTON = "btn-ghost";
const LOCATION_NOTE =
    "Copy Journal may ask for location (optional) to prefill Uber pickup in the generated link.";

function SkeletonCard() {
    return (
        <article className="demo-card skeleton-card">
            <div className="demo-card-header">
                <div style={{ flex: 1 }}>
                    <div className="skel skel-name" />
                    <div className="skel skel-city" />
                </div>
                <div className="skel skel-badge" />
            </div>
            <div className="score-bars">
                {[80, 65, 72, 55].map((w, i) => (
                    <div className="score-row" key={i}>
                        <div className="score-row-meta">
                            <div className="skel skel-label" />
                            <div className="skel skel-label" style={{ width: "2.5rem" }} />
                        </div>
                        <div className="bar-track">
                            <div className="skel skel-bar" style={{ width: `${w}%` }} />
                        </div>
                    </div>
                ))}
            </div>
            <div className="demo-meta">
                {[0, 1, 2, 3].map((i) => (
                    <div className="meta-item" key={i}>
                        <div className="skel skel-meta-label" />
                        <div className="skel skel-meta-value" />
                        <div className="skel skel-meta-sub" />
                    </div>
                ))}
            </div>
            <div className="mt-3 flex items-center justify-between">
                <div className="skel skel-footer-text" />
                <div className="skel skel-btn" />
            </div>
        </article>
    );
}

function clamp01(x) {
    if (!Number.isFinite(x)) return 0;
    return Math.max(0, Math.min(1, x));
}

function norm(value, min, max) {
    if (
        !Number.isFinite(value) ||
        !Number.isFinite(min) ||
        !Number.isFinite(max)
    )
        return 0;
    if (max === min) return 1;
    return clamp01((value - min) / (max - min));
}

function inverseNorm(value, min, max) {
    if (
        !Number.isFinite(value) ||
        !Number.isFinite(min) ||
        !Number.isFinite(max)
    )
        return 0;
    if (max === min) return 1;
    return clamp01((max - value) / (max - min));
}

function formatUSD(n) {
    const num = Number(n);
    if (!Number.isFinite(num)) return "$—";
    return new Intl.NumberFormat(undefined, {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 0,
    }).format(num);
}

function formatDateRangeCompact(fromISO, toISO) {
    if (!fromISO || !toISO) return "—";

    const from = new Date(fromISO);
    const to = new Date(toISO);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return "—";

    const sameMonth =
        from.getMonth() === to.getMonth() &&
        from.getFullYear() === to.getFullYear();
    const fromFmt = new Intl.DateTimeFormat(undefined, {
        month: "short",
        day: "numeric",
    });
    const toFmt = new Intl.DateTimeFormat(undefined, {
        month: sameMonth ? undefined : "short",
        day: "numeric",
    });
    return `${fromFmt.format(from)}–${toFmt.format(to)}`;
}

function formatDurationHours(hours, fallback = "Unknown") {
    if (hours == null || hours === "") return fallback;
    const value = Number(hours);
    if (!Number.isFinite(value) || value < 0) return fallback;
    const totalMinutes = Math.round(value * 60);
    if (totalMinutes === 0) return "Driving distance";
    const wholeHours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (wholeHours === 0) return `${minutes}m`;
    if (minutes === 0) return `${wholeHours}h`;
    return `${wholeHours}h ${minutes}m`;
}

function formatTravelTimeLabel(eachWayHours, totalHours) {
    if (Number.isFinite(eachWayHours)) {
        const duration = formatDurationHours(eachWayHours);
        return duration === "Driving distance"
            ? duration
            : `${duration} each way`;
    }
    const duration = formatDurationHours(totalHours);
    return duration === "Driving distance" ? duration : `${duration} total`;
}

function formatPrizePool(value) {
    const prize = Number(value);
    if (!Number.isFinite(prize) || prize <= 0) return "Unknown";
    return formatUSD(prize);
}

function normalizeScore(value) {
    const score = Number(value);
    if (!Number.isFinite(score)) return 0;
    return Math.max(0, Math.min(1, score));
}

function splitFriendCities(text) {
    if (Array.isArray(text)) {
        return text
            .map((entry) => (entry ?? "").toString().trim())
            .filter(Boolean);
    }
    return (text ?? "")
        .toString()
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
}

function getOneWayTravelHours(hackathon) {
    const outbound = Number(hackathon?.outbound_hours);
    if (Number.isFinite(outbound) && outbound >= 0) return outbound;

    // Fallback for legacy/partial payloads where only total travel is present.
    const total = Number(hackathon?.travel_time_hours);
    if (Number.isFinite(total) && total >= 0) return total / 2;

    return null;
}

function toFiniteNumberOrNull(value) {
    if (value == null || value === "") return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}

function toDateOnly(isoValue) {
    const raw = (isoValue ?? "").toString().trim();
    if (!raw) return "";
    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) return "";
    return parsed.toISOString().slice(0, 10);
}

function pickText(...values) {
    for (const value of values) {
        const text = (value ?? "").toString().trim();
        if (text) return text;
    }
    return "";
}

function buildGoogleFlightsLink({ origin, destination, departDateISO, returnDateISO }) {
    const from = (origin ?? "").toString().trim().toUpperCase();
    const to = (destination ?? "").toString().trim().toUpperCase();
    const departDate = toDateOnly(departDateISO);
    const returnDate = toDateOnly(returnDateISO);
    if (!from || !to || !departDate || !returnDate) {
        return "https://www.google.com/travel/flights";
    }
    return `https://www.google.com/travel/flights?hl=en#flt=${from}.${to}.${departDate}*${to}.${from}.${returnDate}`;
}

function buildHotelLink(city, state, country, fromISO, toISO) {
    const destination = [city, state, country].filter(Boolean).join(", ");
    const from = toDateOnly(fromISO);
    const to = toDateOnly(toISO);
    const query = [destination ? `hotels in ${destination}` : "hotels", from && to ? `${from} to ${to}` : ""]
        .filter(Boolean)
        .join(" ");
    return `https://www.google.com/travel/hotels?q=${encodeURIComponent(query)}`;
}

function normalizeStateCode(value) {
    const token = (value ?? "").toString().trim().toUpperCase();
    if (/^[A-Z]{2}$/.test(token)) return token;
    const tail = token.match(/([A-Z]{2})$/);
    return tail ? tail[1] : "";
}

function roundCoord(value) {
    const num = Number(value);
    if (!Number.isFinite(num)) return null;
    return Math.round(num * 10000) / 10000;
}

function buildUberLink({
    venueName,
    city,
    state,
    stateCode,
    country,
    venueLatitude,
    venueLongitude,
    pickup,
}) {
    const resolvedStateCode = normalizeStateCode(stateCode);
    const addressLine1 = pickText(venueName, `${city} Hackathon`, "Hackathon Venue");
    const addressLine2 = pickText(
        [city, resolvedStateCode || state].filter(Boolean).join(", "),
        [city, country].filter(Boolean).join(", "),
        city,
        country,
        "Hackathon Venue",
    );
    const drop = {
        addressLine1,
        addressLine2,
        source: "SEARCH",
    };
    const lat = roundCoord(venueLatitude);
    const lon = roundCoord(venueLongitude);
    if (Number.isFinite(lat) && Number.isFinite(lon)) {
        drop.latitude = lat;
        drop.longitude = lon;
    }

    const params = new URLSearchParams();
    params.set("drop[0]", JSON.stringify(drop));

    if (Number.isFinite(pickup?.latitude) && Number.isFinite(pickup?.longitude)) {
        params.set("pickup[latitude]", pickup.latitude.toFixed(6));
        params.set("pickup[longitude]", pickup.longitude.toFixed(6));
        const pickupLabel = pickText(pickup?.label, "Current location");
        params.set("pickup[nickname]", pickupLabel);
        params.set("pickup[formatted_address]", pickupLabel);
    }

    return `http://m.uber.com/go/product-selection?${params.toString()}`;
}

function isHttpUrl(value) {
    const text = (value ?? "").toString().trim();
    if (!text) return false;
    try {
        const parsed = new URL(text);
        return parsed.protocol === "http:" || parsed.protocol === "https:";
    } catch {
        return false;
    }
}

function toMarkdownLink(label, url) {
    if (!isHttpUrl(url)) return "Unknown";
    return `[${label}](${url})`;
}

function normalizeEventContext(hackathon, scrapedEvent) {
    const result = hackathon?.raw_result ?? {};
    const event = result?.event ?? {};
    const route = result?.route ?? {};

    const name = pickText(scrapedEvent?.name, hackathon?.name, event?.name, "Unknown Hackathon");
    const city = pickText(scrapedEvent?.city, hackathon?.city, event?.city, "Unknown");
    const state = pickText(scrapedEvent?.state, "Unknown");
    const country = pickText(scrapedEvent?.country, hackathon?.country, event?.country, "Unknown");
    const school = pickText(scrapedEvent?.school, "Unknown");
    const fromISO = pickText(scrapedEvent?.start_datetime_utc, hackathon?.from, event?.start_datetime_utc);
    const toISO = pickText(scrapedEvent?.end_datetime_utc, hackathon?.to, event?.end_datetime_utc);
    const eventUrl = pickText(scrapedEvent?.url, hackathon?.url, event?.url, "Unknown");
    const originAirport = pickText(route?.origin_airport, "Unknown");
    const destinationAirport = pickText(route?.destination_airport, "Unknown");
    const stateCode = pickText(scrapedEvent?.state_code);
    const venueName = pickText(scrapedEvent?.venue_name);
    const venueLatitude = toFiniteNumberOrNull(scrapedEvent?.venue_latitude);
    const venueLongitude = toFiniteNumberOrNull(scrapedEvent?.venue_longitude);

    return {
        name,
        school,
        city,
        state,
        stateCode,
        country,
        venueName,
        venueLatitude,
        venueLongitude,
        fromISO,
        toISO,
        eventUrl,
        originAirport,
        destinationAirport,
    };
}

function formatDateRangeJournal(fromISO, toISO) {
    const from = new Date(fromISO);
    const to = new Date(toISO);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
        return formatDateRangeCompact(fromISO, toISO);
    }
    const formatter = new Intl.DateTimeFormat(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
    });
    return `${formatter.format(from)} - ${formatter.format(to)}`;
}

function buildJournalMarkdown({ hackathon, scrapedEvent, pickup }) {
    const details = normalizeEventContext(hackathon, scrapedEvent);
    const flights = buildGoogleFlightsLink({
        origin: details.originAirport,
        destination: details.destinationAirport,
        departDateISO: details.fromISO,
        returnDateISO: details.toISO,
    });
    const hotels = buildHotelLink(
        details.city,
        details.state === "Unknown" ? "" : details.state,
        details.country,
        details.fromISO,
        details.toISO,
    );
    const uber = buildUberLink({
        venueName: details.venueName,
        city: details.city,
        state: details.state === "Unknown" ? "" : details.state,
        stateCode: details.stateCode,
        country: details.country,
        venueLatitude: details.venueLatitude,
        venueLongitude: details.venueLongitude,
        pickup,
    });

    const eventLink = toMarkdownLink("Event Page", details.eventUrl);
    const flightsLink = toMarkdownLink("Google Flights", flights);
    const hotelLink = toMarkdownLink("Hotel Search", hotels);
    const uberLink = toMarkdownLink("Uber Ride", uber);
    const dateRange = formatDateRangeJournal(details.fromISO, details.toISO);

    return [
        `# ${details.name}`,
        "",
        "## Overview",
        `- School: ${details.school || "Unknown"}`,
        `- City: ${details.city}`,
        `- State: ${details.state || "Unknown"}`,
        `- Country: ${details.country}`,
        `- Date Range: ${dateRange}`,
        "",
        "## Travel & Cost",
        `- Origin Airport: ${details.originAirport}`,
        `- Destination Airport: ${details.destinationAirport}`,
        `- Estimated Flight Cost: ${formatUSD(hackathon?.estimated_flight_cost)}`,
        `- Estimated Lodging Cost: ${formatUSD(hackathon?.estimated_lodging_cost)}`,
        `- Estimated Total Cost: ${formatUSD(hackathon?.estimated_cost)}`,
        "",
        "## Links",
        `- Event Link: ${eventLink}`,
        `- Google Flights (round trip): ${flightsLink}`,
        `- Hotel Search: ${hotelLink}`,
        `- Uber: ${uberLink}`,
    ].join("\n");
}

async function copyTextToClipboard(text) {
    const payload = String(text ?? "");
    if (!payload) throw new Error("Nothing to copy.");

    if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(payload);
        return;
    }

    const textarea = document.createElement("textarea");
    textarea.value = payload;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    document.execCommand("copy");
    document.body.removeChild(textarea);
}

function requestBrowserGeolocation() {
    if (!navigator?.geolocation?.getCurrentPosition) {
        return Promise.resolve(null);
    }
    return new Promise((resolve) => {
        navigator.geolocation.getCurrentPosition(
            (position) => {
                const latitude = Number(position?.coords?.latitude);
                const longitude = Number(position?.coords?.longitude);
                if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
                    resolve(null);
                    return;
                }
                resolve({ latitude, longitude });
            },
            () => resolve(null),
            {
                enableHighAccuracy: false,
                timeout: 2500,
                maximumAge: 5 * 60 * 1000,
            },
        );
    });
}

function buildPickupContext(formData, originAirport, geo) {
    const airport = pickText(
        originAirport,
        formData?.primary_airport_code,
        formData?.secondary_airport_code,
        formData?.tertiary_airport_code,
    );
    const country = pickText(formData?.country);
    const timezone = pickText(formData?.timezone);

    if (geo) {
        return {
            label: "Current location",
            latitude: geo.latitude,
            longitude: geo.longitude,
        };
    }

    if (airport) {
        return { label: `${airport} airport area`, latitude: null, longitude: null };
    }
    if (country && timezone) {
        return { label: `${country} (${timezone})`, latitude: null, longitude: null };
    }
    return {
        label: pickText(country, timezone, "Your location"),
        latitude: null,
        longitude: null,
    };
}

function mapFeasibleResult(result, index) {
    const event = result?.event ?? {};
    const route = result?.route ?? {};
    const costEstimate = result?.cost_estimate ?? {};

    const outboundMinutes = toFiniteNumberOrNull(
        route?.avg_outbound_duration_minutes,
    );
    const returnMinutes = toFiniteNumberOrNull(
        route?.avg_return_duration_minutes,
    );
    const totalTravelMinutes =
        Number.isFinite(outboundMinutes) && Number.isFinite(returnMinutes)
            ? outboundMinutes + returnMinutes
            : null;

    const estimatedCost = toFiniteNumberOrNull(costEstimate?.estimated_total_cost);
    const estimatedFlightCost = toFiniteNumberOrNull(
        costEstimate?.estimated_flight_cost,
    );
    const estimatedLodgingCost = toFiniteNumberOrNull(
        costEstimate?.estimated_lodging_cost,
    );
    const prizePool = toFiniteNumberOrNull(event?.prize_pool);

    return {
        id: event?.id ?? `${event?.name ?? "event"}-${index}`,
        name: event?.name ?? "Unknown event",
        city: event?.city ?? "Unknown city",
        country: event?.country ?? null,
        from: event?.start_datetime_utc ?? null,
        to: event?.end_datetime_utc ?? null,
        estimated_cost: Number.isFinite(estimatedCost) ? estimatedCost : null,
        estimated_flight_cost: Number.isFinite(estimatedFlightCost)
            ? estimatedFlightCost
            : null,
        estimated_lodging_cost: Number.isFinite(estimatedLodgingCost)
            ? estimatedLodgingCost
            : null,
        travel_time_hours: Number.isFinite(totalTravelMinutes)
            ? totalTravelMinutes / 60
            : null,
        outbound_hours: Number.isFinite(outboundMinutes)
            ? outboundMinutes / 60
            : null,
        return_hours: Number.isFinite(returnMinutes)
            ? returnMinutes / 60
            : null,
        prize_pool: Number.isFinite(prizePool) ? prizePool : null,
        url: event?.url ?? "#",
        raw_result: result,
    };
}

export default function ResultsList({
    formData,
}) {
    const friends = useMemo(
        () => splitFriendCities(formData?.friend_cities),
        [formData?.friend_cities],
    );
    const friendsLower = useMemo(
        () => friends.map((s) => s.toLowerCase()),
        [friends],
    );

    const [isLoading, setIsLoading] = useState(true);
    const [errorText, setErrorText] = useState("");
    const [hackathons, setHackathons] = useState([]);

    const [maxOneWayHoursFilter, setMaxOneWayHoursFilter] = useState("");
    const [minPrizePool, setMinPrizePool] = useState("");
    const [showFilters, setShowFilters] = useState(false);
    const [copyStates, setCopyStates] = useState({});
    const geoCacheRef = useRef({ attempted: false, value: null });

    const filteredAndSorted = useMemo(() => {
        const maxHText = (maxOneWayHoursFilter ?? "").toString().trim();
        const minPText = (minPrizePool ?? "").toString().trim();
        const maxH = maxHText === "" ? null : Number(maxHText);
        const minP = minPText === "" ? null : Number(minPText);

        const filtered = hackathons
            .filter((h) => {
                if (!Number.isFinite(maxH)) return true;
                const travelHours = getOneWayTravelHours(h);
                if (!Number.isFinite(travelHours)) return false;
                return travelHours <= maxH;
            })
            .filter((h) => {
                if (!Number.isFinite(minP)) return true;
                const prizePool = Number(h.prize_pool);
                if (!Number.isFinite(prizePool) || prizePool <= 0)
                    return minP <= 0;
                return prizePool >= minP;
            });

        if (!filtered.length) return [];

        // Make score components relative to the currently filtered candidate set.
        const prizes = filtered
            .map((h) => Number(h.prize_pool))
            .filter((value) => Number.isFinite(value) && value > 0);
        const travelPrices = filtered
            .map((h) => {
                const totalCost = Number(h.estimated_cost);
                return Number.isFinite(totalCost) && totalCost >= 0
                    ? totalCost
                    : Number.NaN;
            })
            .filter(Number.isFinite);
        const travels = filtered
            .map((h) => Number(h.travel_time_hours))
            .filter(Number.isFinite);

        // Log-normalize prizes so wide ranges ($1K–$1M) don't distort scores
        const logPrizes = prizes.map((p) => Math.log(Math.max(p, 1)));
        const logPrizeMin = logPrizes.length ? Math.min(...logPrizes) : 0;
        const logPrizeMax = logPrizes.length ? Math.max(...logPrizes) : 0;
        const travelPriceMin = travelPrices.length ? Math.min(...travelPrices) : 0;
        const travelPriceMax = travelPrices.length ? Math.max(...travelPrices) : 0;
        const travelMin = travels.length ? Math.min(...travels) : 0;
        const travelMax = travels.length ? Math.max(...travels) : 0;

        return filtered
            .map((h) => {
                const prizeValue = Number(h.prize_pool);
                const hasPrizePool = Number.isFinite(prizeValue) && prizeValue > 0;
                const totalCostValue = Number(h.estimated_cost);
                const travelPriceValue =
                    Number.isFinite(totalCostValue) && totalCostValue >= 0
                        ? totalCostValue
                        : null;

                const prize_score = hasPrizePool
                    ? norm(Math.log(Math.max(prizeValue, 1)), logPrizeMin, logPrizeMax)
                    : 0;
                const travel_price_score = inverseNorm(
                    travelPriceValue,
                    travelPriceMin,
                    travelPriceMax,
                );
                const travel_time_score = inverseNorm(
                    h.travel_time_hours,
                    travelMin,
                    travelMax,
                );
                const cityText = (h.city ?? "").toString().toLowerCase();
                const friend_bonus_score = friendsLower.some((c) =>
                    cityText.includes(c),
                )
                    ? 1
                    : 0;

                // ROI (40%) > Prize (30%) > Travel Time (20%) > Friend Bonus (10%)
                const composite =
                    0.3 * prize_score +
                    0.4 * travel_price_score +
                    0.2 * travel_time_score +
                    0.1 * friend_bonus_score;

                return {
                    ...h,
                    scores: {
                        composite,
                        prize_score,
                        travel_price_score,
                        travel_time_score,
                        friend_bonus_score,
                    },
                };
            })
            .sort((a, b) => b.scores.composite - a.scores.composite);
    }, [hackathons, friendsLower, maxOneWayHoursFilter, minPrizePool]);

    useEffect(() => {
        const abortController = new AbortController();
        setIsLoading(true);
        setErrorText("");
        setCopyStates({});

        fetchFeasibleHackathons(formData, { signal: abortController.signal })
            .then((payload) => {
                if (abortController.signal.aborted) return;
                const rawResults = Array.isArray(payload?.results)
                    ? payload.results
                    : [];
                setHackathons(
                    rawResults.map((result, index) =>
                        mapFeasibleResult(result, index),
                    ),
                );
            })
            .catch((error) => {
                if (abortController.signal.aborted) return;
                setHackathons([]);
                setErrorText(
                    error instanceof Error ? error.message : "unknown_error",
                );
            })
            .finally(() => {
                if (abortController.signal.aborted) return;
                setIsLoading(false);
            });

        return () => {
            abortController.abort();
        };
    }, [formData]);

    const handleCopyJournal = async (hackathon) => {
        const id = String(hackathon?.id ?? "");
        if (!id) return;

        setCopyStates((prev) => ({
            ...prev,
            [id]: {
                status: "loading",
                message:
                    "Scraping and building journal (location is optional and only used for Uber pickup prefill)...",
            },
        }));

        try {
            const result = hackathon?.raw_result ?? {};
            const route = result?.route ?? {};

            let scrapedEvent = null;
            const eventUrl = pickText(hackathon?.url);
            if (isHttpUrl(eventUrl)) {
                try {
                    scrapedEvent = await fetchScrapedHackathonEvent(eventUrl);
                } catch {
                    // Fallback to existing event payload when scraping fails.
                }
            }

            if (!geoCacheRef.current.attempted) {
                geoCacheRef.current.attempted = true;
                geoCacheRef.current.value = await requestBrowserGeolocation();
            }
            const pickup = buildPickupContext(
                formData,
                pickText(route?.origin_airport),
                geoCacheRef.current.value,
            );

            const markdown = buildJournalMarkdown({
                hackathon,
                scrapedEvent,
                pickup,
            });
            await copyTextToClipboard(markdown);
            setCopyStates((prev) => ({
                ...prev,
                [id]: { status: "success", message: "Journal copied to clipboard." },
            }));
        } catch (err) {
            setCopyStates((prev) => ({
                ...prev,
                [id]: {
                    status: "error",
                    message: err instanceof Error ? err.message : "Failed to copy journal.",
                },
            }));
        }
    };

    useEffect(() => {
        if (!isLoading) window.scrollTo({ top: 0, behavior: "instant" });
    }, [isLoading]);

    const status = isLoading
        ? "loading"
        : errorText
          ? "error"
          : filteredAndSorted.length
            ? "ready"
            : "empty";

    return (
        <div className="w-full font-['Syne',sans-serif]">
            <div className="flex items-end gap-6">
                <div className="text-3xl font-black tracking-[-0.02em] sm:text-4xl">
                    {filteredAndSorted.length} HACKATHONS FOUND
                </div>
            </div>
            <div className="mt-2 text-xs text-[var(--muted)] font-['Space_Mono',monospace]">
                {LOCATION_NOTE}
            </div>

            <div className="mt-6 border-y border-white/10 py-4">
                <button
                    type="button"
                    onClick={() => setShowFilters((value) => !value)}
                    className="mx-auto flex items-center justify-center gap-4 text-center"
                >
                    <span className="text-xs font-semibold uppercase tracking-[0.25em] text-[var(--cream)] font-['Space_Mono',monospace]">
                        Filters
                    </span>
                    <span className="text-xs font-semibold uppercase tracking-[0.25em] text-[var(--cream)] font-['Space_Mono',monospace]">
                        {showFilters ? "Hide" : "Show"}
                    </span>
                </button>

                {showFilters ? (
                    <div className="mt-4 flex w-full flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                        <label className="flex flex-col items-start text-left">
                            <div className={FILTER_LABEL}>
                                Max one-way travel time (hours)
                            </div>
                            <input
                                value={maxOneWayHoursFilter}
                                onChange={(e) =>
                                    setMaxOneWayHoursFilter(e.target.value)
                                }
                                inputMode="decimal"
                                placeholder="e.g. 6"
                                className={FILTER_INPUT}
                            />
                        </label>

                        <label className="flex flex-col items-start text-left sm:items-end sm:text-right">
                            <div className={FILTER_LABEL}>Min prize pool</div>
                            <input
                                value={minPrizePool}
                                onChange={(e) =>
                                    setMinPrizePool(e.target.value)
                                }
                                inputMode="numeric"
                                placeholder="0"
                                className={FILTER_INPUT}
                            />
                        </label>
                    </div>
                ) : null}
            </div>

            {status === "loading" ? (
                <div className="score-demo-wrap">
                    <SkeletonCard />
                    <SkeletonCard />
                </div>
            ) : null}

            {status === "error" ? (
                <div className="grid min-h-[50vh] place-items-center text-center">
                    <div>
                        <div className="text-4xl font-black tracking-[-0.02em] text-[#e4032e]">
                            SOMETHING WENT WRONG.
                        </div>
                        <div className="mt-3 text-xs font-semibold uppercase tracking-[0.25em] text-[var(--cream)]">
                            {errorText || "unknown_error"}
                        </div>
                    </div>
                </div>
            ) : null}

            {status === "empty" ? (
                <div className="grid min-h-[50vh] place-items-center">
                    <div className="text-4xl font-black tracking-[-0.02em]">
                        NO MATCHES FOUND.
                    </div>
                </div>
            ) : null}

            {status === "ready" ? (
                <div className="mt-6 space-y-4">
                    {filteredAndSorted.map((h, idx) => {
                        const compositeScore = normalizeScore(
                            h.scores.composite,
                        );
                        const scoreOutOfTen = `${(compositeScore * 10).toFixed(1)}/10`;
                        const prizeScore = normalizeScore(h.scores.prize_score);
                        const travelPriceScore = normalizeScore(
                            h.scores.travel_price_score,
                        );
                        const travelScore = normalizeScore(
                            h.scores.travel_time_score,
                        );
                        const friendScore = normalizeScore(
                            h.scores.friend_bonus_score,
                        );
                        const travelEachWay = h.outbound_hours;
                        const travelEachWayLabel = formatTravelTimeLabel(
                            travelEachWay,
                            h.travel_time_hours,
                        );
                        const isFriendNearby = friendScore > 0;
                        const totalCostLabel = formatUSD(h.estimated_cost);
                        const flightCostLabel = formatUSD(h.estimated_flight_cost);
                        const hotelCostLabel = formatUSD(h.estimated_lodging_cost);
                        const hasFlightCost = Number.isFinite(
                            h.estimated_flight_cost,
                        );
                        const hasHotelCost = Number.isFinite(
                            h.estimated_lodging_cost,
                        );
                        const hasCostBreakdown =
                            hasFlightCost || hasHotelCost;
                        const hotelShareSavings =
                            hasHotelCost && h.estimated_lodging_cost > 0
                                ? h.estimated_lodging_cost / 2
                                : null;
                        const hotelShareSavingsLabel = formatUSD(
                            hotelShareSavings,
                        );
                        const copyState = copyStates[h.id] ?? {
                            status: "idle",
                            message: "",
                        };
                        const isCopying = copyState.status === "loading";
                        return (
                            <article
                                key={h.id}
                                className="demo-card card-enter"
                                style={{ animationDelay: `${idx * 0.1}s` }}
                            >
                                <div className="demo-card-header">
                                    <div>
                                        <div className="event-name">
                                            #{idx + 1} {h.name}
                                        </div>
                                        <div className="event-city">
                                            📍 {h.city} ·{" "}
                                            {formatDateRangeCompact(
                                                h.from,
                                                h.to,
                                            )}
                                        </div>
                                    </div>
                                    <div className="score-badge">
                                        {scoreOutOfTen}
                                    </div>
                                </div>

                                <div className="score-bars">
                                    <div className="score-row">
                                        <div className="score-row-meta">
                                            <span>Prize Score</span>
                                            <span>{`${(prizeScore * 10).toFixed(1)}/10`}</span>
                                        </div>
                                        <div className="bar-track">
                                            <div
                                                className="bar-fill bar-prize"
                                                style={{
                                                    width: `${Math.round(prizeScore * 100)}%`,
                                                }}
                                            />
                                        </div>
                                    </div>
                                    <div className="score-row">
                                        <div className="score-row-meta">
                                            <span>Travel Price</span>
                                            <span>{`${(travelPriceScore * 10).toFixed(1)}/10`}</span>
                                        </div>
                                        <div className="bar-track">
                                            <div
                                                className="bar-fill bar-roi"
                                                style={{
                                                    width: `${Math.round(travelPriceScore * 100)}%`,
                                                }}
                                            />
                                        </div>
                                    </div>
                                    <div className="score-row">
                                        <div className="score-row-meta">
                                            <span>Travel Time</span>
                                            <span>{`${(travelScore * 10).toFixed(1)}/10`}</span>
                                        </div>
                                        <div className="bar-track">
                                            <div
                                                className="bar-fill bar-travel"
                                                style={{
                                                    width: `${Math.round(travelScore * 100)}%`,
                                                }}
                                            />
                                        </div>
                                    </div>
                                    <div className="score-row">
                                        <div className="score-row-meta">
                                            <span>Friend Bonus</span>
                                            <span>{`${(friendScore * 10).toFixed(1)}/10${isFriendNearby ? " ★" : ""}`}</span>
                                        </div>
                                        <div className="bar-track">
                                            <div
                                                className="bar-fill bar-friend"
                                                style={{
                                                    width: `${Math.round(friendScore * 100)}%`,
                                                }}
                                            />
                                        </div>
                                    </div>
                                </div>

                                <div className="demo-meta">
                                    <div className="meta-item">
                                        <div className="meta-label">
                                            Est Cost
                                        </div>
                                        <div className="meta-value gold">{`${totalCostLabel} round trip`}</div>
                                        {hasCostBreakdown ? (
                                            <div className="meta-subvalue">
                                                {`Flight ${flightCostLabel} · Hotel ${hotelCostLabel}`}
                                            </div>
                                        ) : null}
                                        {Number.isFinite(hotelShareSavings) ? (
                                            <div className="meta-subvalue">
                                                {`Hotel share: save ${hotelShareSavingsLabel}`}
                                            </div>
                                        ) : null}
                                    </div>
                                    <div className="meta-item">
                                        <div className="meta-label">Travel</div>
                                        <div className="meta-value">
                                            {travelEachWayLabel}
                                        </div>
                                    </div>
                                    <div className="meta-item">
                                        <div className="meta-label">
                                            Prize Pool
                                        </div>
                                        <div className="meta-value gold">
                                            {formatPrizePool(h.prize_pool)}
                                        </div>
                                    </div>
                                    <div className="meta-item">
                                        <div className="meta-label">
                                            Friend Nearby
                                        </div>
                                        <div
                                            className={`meta-value ${isFriendNearby ? "green" : ""}`}
                                        >
                                            {isFriendNearby
                                                ? "✓ Possible couch"
                                                : "None known"}
                                        </div>
                                    </div>
                                </div>

                                <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-xs">
                                    <div className="text-[var(--cream)] font-['Space_Mono',monospace]">
                                        Match factors: prize, travel price,
                                        travel, friends
                                    </div>
                                    <div className="flex flex-wrap items-center gap-2">
                                        <button
                                            type="button"
                                            className={ACTION_BUTTON}
                                            title="May ask for location (optional) to prefill Uber pickup in the copied journal"
                                            style={{
                                                padding: "0.4rem 1rem",
                                                fontSize: "0.8rem",
                                                opacity: isCopying ? 0.6 : 1,
                                            }}
                                            disabled={isCopying}
                                            onClick={() => {
                                                void handleCopyJournal(h);
                                            }}
                                        >
                                            {isCopying ? "Copying..." : "Copy Journal"}
                                        </button>
                                        <a
                                            href={h.url}
                                            target="_blank"
                                            rel="noreferrer"
                                            className={ACTION_BUTTON}
                                            style={{
                                                padding: "0.4rem 1rem",
                                                fontSize: "0.8rem",
                                            }}
                                        >
                                            View Event →
                                        </a>
                                    </div>
                                </div>

                                {copyState.message ? (
                                    <div
                                        className={`mt-2 text-xs font-semibold uppercase tracking-[0.2em] ${
                                            copyState.status === "error"
                                                ? "text-[#e4032e]"
                                                : "text-[var(--teal)]"
                                        }`}
                                    >
                                        {copyState.message}
                                    </div>
                                ) : null}
                            </article>
                        );
                    })}
                </div>
            ) : null}
        </div>
    );
}
