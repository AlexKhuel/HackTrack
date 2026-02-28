import { useEffect, useMemo, useState } from "react"
import northAmericaGeo from "../assets/maps/north-america.geo.json"

const VIEWPORT = {
  width: 1000,
  height: 620,
}

const GEO_BOUNDS = {
  minLon: -170,
  maxLon: -50,
  minLat: 7,
  maxLat: 84,
}

const ACTIVE_ROUTE_FRACTION = 0.5
const INITIAL_STAGGER_MAX_MS = 5600
const RELAUNCH_MIN_MS = 180
const RELAUNCH_MAX_MS = 1700
const GROUND_TAXI_MIN_MS = 160
const GROUND_TAXI_MAX_MS = 900
const MIN_FLIGHT_MS = 17000
const MAX_FLIGHT_MS = 46000

const CITY_AIRPORTS = [
  { id: "yvr", label: "Vancouver", lon: -123.183, lat: 49.1947, major: false },
  { id: "sea", label: "Seattle", lon: -122.3088, lat: 47.4502, major: true },
  { id: "lax", label: "Los Angeles", lon: -118.4085, lat: 33.9416, major: true },
  { id: "ord", label: "Chicago", lon: -87.9073, lat: 41.9742, major: true },
  { id: "dfw", label: "Dallas", lon: -97.0403, lat: 32.8998, major: true },
  { id: "jfk", label: "New York", lon: -73.7781, lat: 40.6413, major: true },
  { id: "yyz", label: "Toronto", lon: -79.6306, lat: 43.6777, major: false },
  { id: "yul", label: "Montreal", lon: -73.7408, lat: 45.4706, major: false },
  { id: "mia", label: "Miami", lon: -80.2906, lat: 25.7959, major: true },
  { id: "mex", label: "Mexico City", lon: -99.0721, lat: 19.4361, major: true },
]

const ROUTE_BLUEPRINTS = [
  { id: "route-sea-jfk", from: "sea", to: "jfk", curvature: 0.2, bias: -1, baseDurationMs: 33400 },
  { id: "route-lax-yyz", from: "lax", to: "yyz", curvature: 0.18, bias: -1, baseDurationMs: 36200 },
  { id: "route-yvr-mex", from: "yvr", to: "mex", curvature: 0.2, bias: 1, baseDurationMs: 40800 },
  { id: "route-mia-yul", from: "mia", to: "yul", curvature: 0.14, bias: 1, baseDurationMs: 28600 },
  { id: "route-dfw-jfk", from: "dfw", to: "jfk", curvature: 0.16, bias: -1, baseDurationMs: 24600 },
  { id: "route-lax-mex", from: "lax", to: "mex", curvature: 0.1, bias: 1, baseDurationMs: 27400 },
  { id: "route-ord-mia", from: "ord", to: "mia", curvature: 0.14, bias: 1, baseDurationMs: 29800 },
  { id: "route-yul-sea", from: "yul", to: "sea", curvature: 0.22, bias: -1, baseDurationMs: 37400 },
]

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

function sampleOne(items) {
  if (!items.length) return null
  return items[randomInt(0, items.length - 1)]
}

function shuffle(items) {
  const clone = [...items]
  for (let i = clone.length - 1; i > 0; i -= 1) {
    const j = randomInt(0, i)
    ;[clone[i], clone[j]] = [clone[j], clone[i]]
  }
  return clone
}

function clamp(num, min, max) {
  return Math.max(min, Math.min(max, num))
}

function computeDurationMs(baseDurationMs) {
  const jitter = randomInt(-5200, 5200)
  return clamp(baseDurationMs + jitter, MIN_FLIGHT_MS, MAX_FLIGHT_MS)
}

function createFlight(slotId, route, launchDelayMs) {
  return {
    slotId,
    routeId: route.id,
    launchDelayMs,
    durationMs: computeDurationMs(route.baseDurationMs),
    instanceId: `${route.id}-${slotId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  }
}

function createInitialFlights(routes, activeCount) {
  return shuffle(routes)
    .slice(0, Math.min(activeCount, routes.length))
    .map((route, slotId) =>
      createFlight(
        slotId,
        route,
        slotId === 0 ? randomInt(0, 260) : randomInt(420, INITIAL_STAGGER_MAX_MS)
      )
    )
}

function pickNextRoute(routes, activeRouteIds, previousRoute) {
  if (!routes.length) return null

  const available = routes.filter((route) => !activeRouteIds.includes(route.id))
  if (!available.length) return null

  const blockedCities = new Set(previousRoute ? [previousRoute.from, previousRoute.to] : [])

  const strict = available.filter(
    (route) => route.id !== previousRoute?.id && !blockedCities.has(route.from) && !blockedCities.has(route.to)
  )
  if (strict.length) return sampleOne(strict)

  const avoidSameDeparture = available.filter(
    (route) => route.id !== previousRoute?.id && !blockedCities.has(route.from)
  )
  if (avoidSameDeparture.length) return sampleOne(avoidSameDeparture)

  const avoidImmediateRepeat = available.filter((route) => route.id !== previousRoute?.id)
  if (avoidImmediateRepeat.length) return sampleOne(avoidImmediateRepeat)

  return sampleOne(available)
}

function normalizeLongitude(lon) {
  return lon > 20 ? lon - 360 : lon
}

function projectToSvg([rawLon, lat]) {
  const lon = normalizeLongitude(rawLon)
  const lonSpan = GEO_BOUNDS.maxLon - GEO_BOUNDS.minLon
  const latSpan = GEO_BOUNDS.maxLat - GEO_BOUNDS.minLat
  const x = ((lon - GEO_BOUNDS.minLon) / lonSpan) * VIEWPORT.width
  const y = ((GEO_BOUNDS.maxLat - lat) / latSpan) * VIEWPORT.height
  return { x, y }
}

function pointToCommand(point, command = "L") {
  return `${command}${point.x.toFixed(2)} ${point.y.toFixed(2)}`
}

function ringToPath(ring) {
  if (!Array.isArray(ring) || ring.length < 3) return ""
  return ring
    .map((coordinate, index) => pointToCommand(projectToSvg(coordinate), index === 0 ? "M" : "L"))
    .join(" ")
    .concat(" Z")
}

function geometryToPath(geometry) {
  if (!geometry) return ""

  if (geometry.type === "Polygon") {
    return geometry.coordinates.map(ringToPath).filter(Boolean).join(" ")
  }

  if (geometry.type === "MultiPolygon") {
    return geometry.coordinates
      .map((polygon) => polygon.map(ringToPath).filter(Boolean).join(" "))
      .filter(Boolean)
      .join(" ")
  }

  return ""
}

function buildArcPath(start, end, curvature, bias) {
  const dx = end.x - start.x
  const dy = end.y - start.y
  const distance = Math.hypot(dx, dy)
  const normalLength = distance === 0 ? 1 : distance
  const nx = -dy / normalLength
  const ny = dx / normalLength
  const strength = Math.max(30, distance * curvature) * bias
  const cx = (start.x + end.x) / 2 + nx * strength
  const cy = (start.y + end.y) / 2 + ny * strength

  return `M${start.x.toFixed(2)} ${start.y.toFixed(2)} Q${cx.toFixed(2)} ${cy.toFixed(2)} ${end.x.toFixed(2)} ${end.y.toFixed(2)}`
}

function buildLatitudePath(latitude) {
  const start = projectToSvg([GEO_BOUNDS.minLon, latitude])
  const end = projectToSvg([GEO_BOUNDS.maxLon, latitude])
  return `M${start.x.toFixed(2)} ${start.y.toFixed(2)} L${end.x.toFixed(2)} ${end.y.toFixed(2)}`
}

function buildLongitudePath(longitude) {
  const top = projectToSvg([longitude, GEO_BOUNDS.maxLat])
  const bottom = projectToSvg([longitude, GEO_BOUNDS.minLat])
  return `M${top.x.toFixed(2)} ${top.y.toFixed(2)} L${bottom.x.toFixed(2)} ${bottom.y.toFixed(2)}`
}

export default function BackgroundScene() {
  const scene = useMemo(() => {
    const countryPaths = northAmericaGeo.features
      .map((feature) => ({
        id: (feature.id ?? "").toString().toLowerCase(),
        name: feature.properties?.name ?? "country",
        d: geometryToPath(feature.geometry),
      }))
      .filter((feature) => feature.d)

    const projectedCities = CITY_AIRPORTS.map((city) => ({
      ...city,
      ...projectToSvg([city.lon, city.lat]),
    }))

    const cityLookup = Object.fromEntries(projectedCities.map((city) => [city.id, city]))

    const routes = ROUTE_BLUEPRINTS.map((route) => {
      const from = cityLookup[route.from]
      const to = cityLookup[route.to]
      if (!from || !to) return null

      return {
        ...route,
        d: buildArcPath(from, to, route.curvature, route.bias),
      }
    }).filter(Boolean)

    const latitudeLines = [20, 30, 40, 50, 60, 70].map((latitude) => ({
      id: `lat-${latitude}`,
      d: buildLatitudePath(latitude),
    }))

    const longitudeLines = [-150, -130, -110, -90, -70].map((longitude) => ({
      id: `lon-${Math.abs(longitude)}`,
      d: buildLongitudePath(longitude),
    }))

    return {
      countryPaths,
      projectedCities,
      routes,
      latitudeLines,
      longitudeLines,
    }
  }, [])

  const routeLookup = useMemo(
    () =>
      Object.fromEntries(
        scene.routes.map((route) => [route.id, route])
      ),
    [scene.routes]
  )

  const activeFlightCount = useMemo(
    () => Math.max(1, Math.floor(scene.routes.length * ACTIVE_ROUTE_FRACTION)),
    [scene.routes.length]
  )

  const initialFlights = useMemo(
    () => createInitialFlights(scene.routes, activeFlightCount),
    [scene.routes, activeFlightCount]
  )

  const [flights, setFlights] = useState(initialFlights)

  useEffect(() => {
    setFlights(initialFlights)
  }, [initialFlights])

  useEffect(() => {
    let cancelled = false
    const timers = new Set()

    const scheduleFlightLifecycle = (flight) => {
      const handoffMs =
        flight.launchDelayMs +
        flight.durationMs +
        randomInt(GROUND_TAXI_MIN_MS, GROUND_TAXI_MAX_MS)

      const timerId = window.setTimeout(() => {
        if (cancelled) return

        let nextFlight = null

        setFlights((currentFlights) => {
          const currentFlight = currentFlights.find(
            (entry) => entry.slotId === flight.slotId
          )
          if (!currentFlight || currentFlight.instanceId !== flight.instanceId) {
            return currentFlights
          }

          const activeRouteIds = currentFlights
            .filter((entry) => entry.slotId !== currentFlight.slotId)
            .map((entry) => entry.routeId)

          const previousRoute = routeLookup[currentFlight.routeId]
          const nextRoute = pickNextRoute(scene.routes, activeRouteIds, previousRoute)

          if (!nextRoute) return currentFlights

          nextFlight = createFlight(
            currentFlight.slotId,
            nextRoute,
            randomInt(RELAUNCH_MIN_MS, RELAUNCH_MAX_MS)
          )

          return currentFlights.map((entry) =>
            entry.slotId === currentFlight.slotId ? nextFlight : entry
          )
        })

        if (!cancelled && nextFlight) {
          scheduleFlightLifecycle(nextFlight)
        }
      }, handoffMs)

      timers.add(timerId)
    }

    initialFlights.forEach((flight) => {
      scheduleFlightLifecycle(flight)
    })

    return () => {
      cancelled = true
      timers.forEach((timerId) => window.clearTimeout(timerId))
    }
  }, [initialFlights, routeLookup, scene.routes])

  return (
    <div id="bg-canvas" aria-hidden="true">
      <svg className="na-map" viewBox={`0 0 ${VIEWPORT.width} ${VIEWPORT.height}`} role="presentation" focusable="false">
        <defs>
          <linearGradient id="route-gradient" x1="0%" x2="100%" y1="0%" y2="0%">
            <stop offset="0%" stopColor="rgba(92, 182, 210, 0.06)" />
            <stop offset="55%" stopColor="rgba(165, 230, 252, 0.28)" />
            <stop offset="100%" stopColor="rgba(92, 182, 210, 0.08)" />
          </linearGradient>
          {scene.routes.map((route) => (
            <path key={route.id} id={route.id} d={route.d} />
          ))}
        </defs>

        <g className="na-grid">
          {scene.latitudeLines.map((line) => (
            <path key={line.id} d={line.d} />
          ))}
          {scene.longitudeLines.map((line) => (
            <path key={line.id} d={line.d} />
          ))}
        </g>

        <g className="na-countries">
          {scene.countryPaths.map((country) => (
            <path
              key={country.id}
              d={country.d}
              fillRule="evenodd"
              className={`na-country na-country-${country.id}`}
              aria-label={country.name}
            />
          ))}
        </g>

        <g className="flight-routes">
          {scene.routes.map((route, index) => (
            <use
              key={`line-${route.id}`}
              href={`#${route.id}`}
              className="flight-route"
              style={{
                animationDuration: `${15 + (index % 4) * 4}s`,
                animationDelay: `-${(index * 1.8).toFixed(1)}s`,
              }}
            />
          ))}
        </g>

        <g className="city-points">
          {scene.projectedCities.map((city) => (
            <circle
              key={city.id}
              cx={city.x}
              cy={city.y}
              r={city.major ? 3.8 : 2.7}
              className={`city-point${city.major ? " city-point-major" : ""}`}
            />
          ))}
        </g>

        <g className="planes">
          {flights.map((flight) => {
            const route = routeLookup[flight.routeId]
            if (!route) return null

            const launchSec = (flight.launchDelayMs / 1000).toFixed(2)
            const durationSec = (flight.durationMs / 1000).toFixed(2)

            return (
              <g key={flight.instanceId} className="plane" style={{ opacity: 0 }}>
              <path
                className="plane-hull"
                d="M0 -6.1 L1 -1.5 L6.6 -0.8 L6.6 0.8 L1 1.5 L0 6.1 L-1 6.1 L-2 1.8 L-7.2 1.1 L-7.2 -1.1 L-2 -1.8 L-1 -6.1 Z"
              />
              <path
                className="plane-wing"
                d="M-0.8 -2.6 L3.2 -3.8 L1.8 -1.1 Z M-0.8 2.6 L3.2 3.8 L1.8 1.1 Z"
              />
              <circle className="plane-cockpit" cx="3.8" cy="0" r="0.62" />
              <animateMotion
                begin={`${launchSec}s`}
                dur={`${durationSec}s`}
                repeatCount="1"
                fill="freeze"
                rotate="auto"
              >
                <mpath href={`#${route.id}`} />
              </animateMotion>
              <animate
                attributeName="opacity"
                begin={`${launchSec}s`}
                dur={`${durationSec}s`}
                values="0;0.96;0.94;0"
                keyTimes="0;0.16;0.84;1"
                repeatCount="1"
                fill="freeze"
              />
            </g>
            )
          })}
        </g>
      </svg>
      <div className="bg-vignette"></div>
    </div>
  )
}
