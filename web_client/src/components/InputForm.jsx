import { useEffect, useMemo, useState } from "react";
import {
    inferAirportMetadataFromCodes,
    inferBrowserCountry,
    inferBrowserTimezone,
    normalizeAirportCode,
} from "../utils/airportMetadata";
import { localTimeToUtc, utcTimeToLocalInput } from "../utils/classTimes";

const FIELD_INPUT =
    "w-full bg-[rgba(245,237,214,0.07)] border border-[rgba(0,200,180,0.18)] rounded-[6px] px-4 py-3 text-[var(--cream)] placeholder:text-[rgba(245,237,214,0.3)] outline-none focus:border-[var(--teal)] font-['Syne',sans-serif]";
const FIELD_LABEL =
    "mb-2 text-xs font-semibold uppercase tracking-[0.25em] text-[var(--muted)] font-['Space_Mono',monospace] md:whitespace-nowrap";

function toFriendCitiesText(value) {
    if (Array.isArray(value)) {
        return value
            .map((entry) => (entry ?? "").toString().trim())
            .filter(Boolean)
            .join(", ");
    }
    return (value ?? "").toString();
}

function parseFriendCities(text) {
    const seen = new Set();
    const cities = [];
    for (const raw of (text ?? "").toString().split(",")) {
        const city = raw.trim();
        if (!city) continue;
        const key = city.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        cities.push(city);
    }
    return cities;
}

function minutesToHoursInput(value) {
    const text = (value ?? "").toString().trim();
    if (!text) return "";

    const minutes = Number(text);
    if (!Number.isFinite(minutes) || minutes < 0) return "";

    const hours = minutes / 60;
    const rounded = Math.round(hours * 10) / 10;
    return String(rounded);
}

function hoursInputToMinutes(value) {
    const text = (value ?? "").toString().trim();
    if (!text) return null;

    const parsed = Number(text);
    if (!Number.isFinite(parsed) || parsed < 0) return null;

    return Math.round(parsed * 60);
}

function optionalNonNegativeInteger(value) {
    const text = (value ?? "").toString().trim();
    if (!text) return null;

    const parsed = Number(text);
    if (!Number.isFinite(parsed) || parsed < 0) return null;

    return Math.round(parsed);
}

function timezoneSourceLabel(timezoneSource) {
    if ((timezoneSource ?? "").startsWith("airport:")) {
        const code = timezoneSource.split(":")[1] || "airport";
        return `Inferred from airport (${code}).`;
    }
    if (timezoneSource === "browser") {
        return "Inferred from browser.";
    }
    return "";
}

function countrySourceLabel(countrySource) {
    if ((countrySource ?? "").startsWith("airport:")) {
        const code = countrySource.split(":")[1] || "airport";
        return `Inferred from airport (${code}).`;
    }
    if (countrySource === "browser") {
        return "Inferred from browser.";
    }
    return "";
}

function formStateFromInitial(initialValues) {
    const primaryAirport = normalizeAirportCode(
        initialValues?.primary_airport_code,
    );
    const secondaryAirport = normalizeAirportCode(
        initialValues?.secondary_airport_code,
    );
    const tertiaryAirport = normalizeAirportCode(
        initialValues?.tertiary_airport_code,
    );
    const inferredFromAirports = inferAirportMetadataFromCodes([
        primaryAirport,
        secondaryAirport,
        tertiaryAirport,
    ]);
    const browserTimezone = inferBrowserTimezone();
    const timezone =
        (initialValues?.timezone ?? "").toString().trim() ||
        inferredFromAirports.timezone ||
        browserTimezone;

    const next = {
        name: "",
        primary_airport_code: "",
        secondary_airport_code: "",
        tertiary_airport_code: "",
        max_cost: "",
        max_time: "",
        friday_last_class: "",
        monday_first_class: "",
        friend_cities: "",
    };

    if (initialValues && typeof initialValues === "object") {
        Object.assign(next, initialValues);
    }

    next.name = (initialValues?.name ?? "").toString();
    next.primary_airport_code = primaryAirport;
    next.secondary_airport_code = secondaryAirport;
    next.tertiary_airport_code = tertiaryAirport;
    next.max_cost =
        initialValues?.max_cost == null || initialValues?.max_cost === ""
            ? ""
            : String(optionalNonNegativeInteger(initialValues?.max_cost) ?? "");
    next.max_time = minutesToHoursInput(initialValues?.max_time);
    next.friday_last_class = utcTimeToLocalInput(
        initialValues?.friday_last_class,
        timezone,
    );
    next.monday_first_class = utcTimeToLocalInput(
        initialValues?.monday_first_class,
        timezone,
    );
    next.friend_cities = toFriendCitiesText(initialValues?.friend_cities);

    return next;
}

export default function InputForm({ initialValues, onSubmit }) {
    const [values, setValues] = useState(() =>
        formStateFromInitial(initialValues),
    );
    const [errorText, setErrorText] = useState("");

    useEffect(() => {
        if (!initialValues) return;
        setValues(formStateFromInitial(initialValues));
    }, [initialValues]);

    const inferred = useMemo(() => {
        const inferredFromAirports = inferAirportMetadataFromCodes([
            values.primary_airport_code,
            values.secondary_airport_code,
            values.tertiary_airport_code,
        ]);
        const browserTimezone = inferBrowserTimezone();
        const browserCountry = inferBrowserCountry();

        const timezone = inferredFromAirports.timezone || browserTimezone || "";
        const country = inferredFromAirports.country || browserCountry || "";
        const timezoneSource = inferredFromAirports.timezone
            ? `airport:${inferredFromAirports.airport_code}`
            : browserTimezone
              ? "browser"
              : "";
        const countrySource = inferredFromAirports.country
            ? `airport:${inferredFromAirports.airport_code}`
            : browserCountry
              ? "browser"
              : "";

        return {
            ...inferredFromAirports,
            timezone,
            country,
            timezone_source: timezoneSource,
            country_source: countrySource,
        };
    }, [
        values.primary_airport_code,
        values.secondary_airport_code,
        values.tertiary_airport_code,
    ]);

    const parsed = useMemo(() => {
        return {
            name: values.name.trim(),
            timezone: inferred.timezone,
            country: inferred.country,
            primary_airport_code: normalizeAirportCode(
                values.primary_airport_code,
            ),
            secondary_airport_code: normalizeAirportCode(
                values.secondary_airport_code,
            ),
            tertiary_airport_code: normalizeAirportCode(
                values.tertiary_airport_code,
            ),
            max_cost: optionalNonNegativeInteger(values.max_cost),
            max_time: hoursInputToMinutes(values.max_time),
            friday_last_class: localTimeToUtc(
                values.friday_last_class,
                inferred.timezone,
            ),
            monday_first_class: localTimeToUtc(
                values.monday_first_class,
                inferred.timezone,
            ),
            friend_cities: parseFriendCities(values.friend_cities),
        };
    }, [values, inferred]);

    const update = (key) => (e) => {
        setValues((v) => ({ ...v, [key]: e.target.value }));
        setErrorText("");
    };
    const updateAirport = (key) => (e) => {
        setValues((v) => ({ ...v, [key]: e.target.value.toUpperCase() }));
        setErrorText("");
    };

    const handleSubmit = (e) => {
        e.preventDefault();
        const hasClassTimes = Boolean(
            values.friday_last_class || values.monday_first_class,
        );
        if (hasClassTimes && !inferred.timezone) {
            setErrorText(
                "Could not infer timezone from your airport codes, so class times cannot be converted to UTC.",
            );
            return;
        }
        setErrorText("");
        onSubmit?.(parsed);
    };

    return (
        <form
            onSubmit={handleSubmit}
            className="w-full max-w-none font-['Syne',sans-serif]"
        >
            <div
                className="section-label"
                style={{ textAlign: "left", marginBottom: "0.75rem" }}
            >
                User Profile
            </div>
            <div className="mt-6 grid gap-10">
                <div className="grid gap-8 sm:grid-cols-2">
                    <label className="block">
                        <div className={FIELD_LABEL}>Name</div>
                        <input
                            value={values.name}
                            onChange={update("name")}
                            placeholder="Linus Torvald"
                            inputMode="text"
                            className={FIELD_INPUT}
                        />
                    </label>

                    <label className="block">
                        <div className={FIELD_LABEL}>Primary airport code</div>
                        <input
                            value={values.primary_airport_code}
                            onChange={updateAirport("primary_airport_code")}
                            placeholder="LAX"
                            inputMode="text"
                            className={FIELD_INPUT}
                            maxLength={3}
                            pattern="[A-Za-z]{3}"
                            required
                        />
                    </label>

                    <label className="block">
                        <div className={FIELD_LABEL}>
                            Secondary airport code (optional)
                        </div>
                        <input
                            value={values.secondary_airport_code}
                            onChange={updateAirport("secondary_airport_code")}
                            placeholder="SNA"
                            inputMode="text"
                            className={FIELD_INPUT}
                            maxLength={3}
                            pattern="[A-Za-z]{3}"
                        />
                    </label>

                    <label className="block">
                        <div className={FIELD_LABEL}>
                            Tertiary airport code (optional)
                        </div>
                        <input
                            value={values.tertiary_airport_code}
                            onChange={updateAirport("tertiary_airport_code")}
                            placeholder="LGB"
                            inputMode="text"
                            className={FIELD_INPUT}
                            maxLength={3}
                            pattern="[A-Za-z]{3}"
                        />
                    </label>
                </div>

                <div className="grid gap-8 sm:grid-cols-2">
                    <label className="block">
                        <div className={FIELD_LABEL}>Max cost (USD)</div>
                        <input
                            type="number"
                            min="0"
                            step="1"
                            value={values.max_cost}
                            onChange={update("max_cost")}
                            placeholder="1000"
                            className={FIELD_INPUT}
                        />
                        <div className="mt-2 text-xs text-[var(--muted)] font-['Space_Mono',monospace]">
                            Leave blank if you do not care.
                        </div>
                    </label>

                    <label className="block">
                        <div className={FIELD_LABEL}>
                            Max travel time (one-way hours)
                        </div>
                        <input
                            type="number"
                            min="0"
                            step="0.5"
                            value={values.max_time}
                            onChange={update("max_time")}
                            placeholder="8"
                            className={FIELD_INPUT}
                        />
                        <div className="mt-2 text-xs text-[var(--muted)] font-['Space_Mono',monospace]">
                            Leave blank if you do not care.
                        </div>
                    </label>
                </div>

                <div className="grid gap-8 sm:grid-cols-2">
                    <label className="block">
                        <div className={FIELD_LABEL}>
                            Friday last class (local, optional)
                        </div>
                        <input
                            type="time"
                            value={values.friday_last_class}
                            onChange={update("friday_last_class")}
                            className={FIELD_INPUT}
                        />
                        <div className="mt-2 text-xs text-[var(--muted)] font-['Space_Mono',monospace]">
                            Leave blank to skip Friday class constraints.
                        </div>
                    </label>

                    <label className="block">
                        <div className={FIELD_LABEL}>
                            Monday first class (local, optional)
                        </div>
                        <input
                            type="time"
                            value={values.monday_first_class}
                            onChange={update("monday_first_class")}
                            className={FIELD_INPUT}
                        />
                        <div className="mt-2 text-xs text-[var(--muted)] font-['Space_Mono',monospace]">
                            Leave blank to skip Monday class constraints.
                        </div>
                    </label>
                </div>

                {errorText ? (
                    <div className="text-xs text-[#e4032e] font-['Space_Mono',monospace]">
                        {errorText}
                    </div>
                ) : null}

                <div className="grid gap-8 sm:grid-cols-2">
                    <label className="block">
                        <div className={FIELD_LABEL}>Timezone</div>
                        <input
                            value={
                                inferred.timezone || "Unknown for this airport"
                            }
                            className={FIELD_INPUT}
                            readOnly
                        />
                        {timezoneSourceLabel(inferred.timezone_source) ? (
                            <div className="mt-2 text-xs text-[var(--muted)] font-['Space_Mono',monospace]">
                                {timezoneSourceLabel(inferred.timezone_source)}
                            </div>
                        ) : null}
                    </label>

                    <label className="block">
                        <div className={FIELD_LABEL}>Country</div>
                        <input
                            value={inferred.country || "Unknown"}
                            className={FIELD_INPUT}
                            readOnly
                        />
                        {countrySourceLabel(inferred.country_source) ? (
                            <div className="mt-2 text-xs text-[var(--muted)] font-['Space_Mono',monospace]">
                                {countrySourceLabel(inferred.country_source)}
                            </div>
                        ) : null}
                    </label>
                </div>

                <label className="block">
                    <div className={FIELD_LABEL}>
                        Friend cities (comma separated)
                    </div>
                    <input
                        value={values.friend_cities}
                        onChange={update("friend_cities")}
                        placeholder="Stanford, Berkeley, Philadelphia"
                        className={FIELD_INPUT}
                    />
                </label>

                <div className="flex items-center justify-between gap-6">
                    <div className="text-xs font-semibold uppercase tracking-[0.25em] text-[var(--cream)] font-['Space_Mono',monospace]">
                        Shareable via URL query params
                    </div>
                    <button type="submit" className="btn-primary">
                        ⚡ Find Hackathons →
                    </button>
                </div>
            </div>
        </form>
    );
}
