import { Spectrum, type PlatformProviderConfig } from "spectrum-ts";
import { imessage } from "@spectrum-ts/imessage";
import { telegram } from "@spectrum-ts/telegram";
import { generateBtlRuntimeSummary, requireBtlRuntimeConfig } from "./runtime";

const USGS_PAST_DAY_URL =
  "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson";
const USER_AGENT = "qwake-earthquake-agent/1.0";
const DEFAULT_RADIUS_KM = 300;

type RiskTier = "clear" | "watch" | "caution" | "danger" | "unavailable";

type EarthquakeEvent = {
  id: string;
  place: string;
  magnitude: number;
  timeUtc: string;
  updatedUtc: string;
  longitude: number;
  latitude: number;
  depthKm: number;
  alert: string;
  mmi: number | null;
  tsunami: number;
  significance: number;
  url: string;
};

type UsgsFeature = {
  id?: string;
  properties?: {
    place?: string;
    mag?: number | null;
    time?: number;
    updated?: number;
    alert?: string | null;
    mmi?: number | null;
    tsunami?: number;
    sig?: number;
    url?: string;
  };
  geometry?: {
    coordinates?: [number, number, number];
  };
};

type UsgsFeed = {
  metadata?: {
    generated?: number;
    title?: string;
  };
  features?: UsgsFeature[];
};

type LocationResult = {
  latitude: number;
  longitude: number;
  label: string;
};

type RiskAssessment = {
  tier: RiskTier;
  location: LocationResult;
  radiusKm: number;
  sourceGeneratedUtc: string;
  consideredEvents: number;
  nearbyEvents: Array<EarthquakeEvent & { distanceKm: number; riskTier: RiskTier }>;
  summary: string;
  guidance: string;
};

const configuredProviders: PlatformProviderConfig[] = [imessage.config()];
const btlRuntimeConfig = requireBtlRuntimeConfig();
const telegramEnabled = Boolean(process.env.TELEGRAM_BOT_TOKEN);
const projectId = requiredEnv("PROJECT_ID");
const projectSecret = requiredEnv("PROJECT_SECRET");

if (telegramEnabled) {
  configuredProviders.push(
    telegram.config({
      botToken: requiredEnv("TELEGRAM_BOT_TOKEN"),
    }),
  );
}

console.info(
  JSON.stringify({
    event: "qwake.agent.boot",
    providers: telegramEnabled ? ["imessage", "telegram"] : ["imessage"],
    btlBaseURL: btlRuntimeConfig.baseURL,
    btlModel: btlRuntimeConfig.model,
  }),
);

const app = await Spectrum({
  projectId,
  projectSecret,
  providers: configuredProviders,
});

console.info(JSON.stringify({ event: "qwake.agent.ready" }));

for await (const [space, message] of app.messages) {
  if (message.content.type !== "text") {
    await space.send("Send a place name or coordinates, and I will check live USGS earthquakes from the past 24 hours.");
    continue;
  }

  try {
    const response = await handleTextMessage(message.content.text);
    await space.send(response);
  } catch (error) {
    await space.send(formatError(error));
  }
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

async function handleTextMessage(text: string): Promise<string> {
  const trimmed = text.trim();
  if (!trimmed || /^\/?(start|help)$/i.test(trimmed)) {
    return [
      "Send a place name or coordinates like `Tokyo` or `35.6762, 139.6503`.",
      "I will check live USGS earthquakes from the past 24 hours and tell you the nearest risk tier.",
      "This does not predict earthquakes. It only checks live reported events and official USGS fields.",
    ].join("\n");
  }

  if (/^\/?(stop|unsubscribe)$/i.test(trimmed)) {
    return "Alerts are not enabled in this build yet. No subscription was created.";
  }

  const location = await resolveLocation(trimmed);
  const assessment = await assessLocationRisk(location, DEFAULT_RADIUS_KM);
  return summarizeAssessment(assessment);
}

async function resolveLocation(text: string): Promise<LocationResult> {
  const coordinates = parseCoordinates(text);
  if (coordinates !== null) {
    const [latitude, longitude] = coordinates;
    return {
      latitude,
      longitude,
      label: `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`,
    };
  }

  const response = await fetch(
    `https://nominatim.openstreetmap.org/search?${new URLSearchParams({
      q: text,
      format: "json",
      limit: "1",
    })}`,
    { headers: { "User-Agent": USER_AGENT } },
  );

  if (!response.ok) {
    throw new Error(`Live geocoding failed with HTTP ${response.status}`);
  }

  const results = (await response.json()) as Array<{
    lat: string;
    lon: string;
    display_name?: string;
  }>;

  if (results.length === 0) {
    throw new Error("No live geocoding result found. Try coordinates like `34.0522, -118.2437`.");
  }

  const result = results[0];
  if (result === undefined) {
    throw new Error("No live geocoding result found. Try coordinates like `34.0522, -118.2437`.");
  }

  return {
    latitude: Number(result.lat),
    longitude: Number(result.lon),
    label: result.display_name ?? text,
  };
}

function parseCoordinates(text: string): [number, number] | null {
  const match = text.match(/(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/);
  if (!match) {
    return null;
  }

  const latitude = Number(match[1] ?? Number.NaN);
  const longitude = Number(match[2] ?? Number.NaN);
  if (
    Number.isNaN(latitude) ||
    Number.isNaN(longitude) ||
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180
  ) {
    return null;
  }

  return [latitude, longitude];
}

async function fetchRecentEarthquakes(): Promise<{
  generatedUtc: string;
  events: EarthquakeEvent[];
}> {
  const response = await fetch(USGS_PAST_DAY_URL, {
    headers: { "User-Agent": USER_AGENT },
  });

  if (!response.ok) {
    throw new Error(`Live USGS feed failed with HTTP ${response.status}`);
  }

  const feed = (await response.json()) as UsgsFeed;
  const events = (feed.features ?? [])
    .map(toEarthquakeEvent)
    .filter((event): event is EarthquakeEvent => event !== null)
    .sort((left, right) => Date.parse(right.timeUtc) - Date.parse(left.timeUtc));

  return {
    generatedUtc:
      feed.metadata?.generated === undefined
        ? new Date().toISOString()
        : new Date(feed.metadata.generated).toISOString(),
    events,
  };
}

function toEarthquakeEvent(feature: UsgsFeature): EarthquakeEvent | null {
  const coordinates = feature.geometry?.coordinates;
  const properties = feature.properties;
  if (!coordinates || !properties || properties.mag === null || properties.mag === undefined) {
    return null;
  }

  return {
    id: feature.id ?? "unknown",
    place: properties.place ?? "Unknown location",
    magnitude: properties.mag,
    timeUtc: new Date(properties.time ?? 0).toISOString(),
    updatedUtc: new Date(properties.updated ?? 0).toISOString(),
    longitude: coordinates[0],
    latitude: coordinates[1],
    depthKm: coordinates[2],
    alert: properties.alert ?? "none",
    mmi: properties.mmi ?? null,
    tsunami: properties.tsunami ?? 0,
    significance: properties.sig ?? 0,
    url: properties.url ?? "https://earthquake.usgs.gov/earthquakes/map/",
  };
}

async function assessLocationRisk(
  location: LocationResult,
  radiusKm: number,
): Promise<RiskAssessment> {
  const { events, generatedUtc } = await fetchRecentEarthquakes();
  const nearbyEvents = events
    .map((event) => ({
      ...event,
      distanceKm: haversineKm(location.latitude, location.longitude, event.latitude, event.longitude),
      riskTier: classifyEvent(event),
    }))
    .filter((event) => event.distanceKm <= radiusKm)
    .sort((left, right) => left.distanceKm - right.distanceKm || right.magnitude - left.magnitude);

  if (events.length === 0) {
    return {
      tier: "unavailable",
      location,
      radiusKm,
      sourceGeneratedUtc: generatedUtc,
      consideredEvents: 0,
      nearbyEvents,
      summary: "USGS returned no live events in the past-day feed. No fallback data is used.",
      guidance: guidanceForTier("unavailable"),
    };
  }

  if (nearbyEvents.length === 0) {
    return {
      tier: "clear",
      location,
      radiusKm,
      sourceGeneratedUtc: generatedUtc,
      consideredEvents: events.length,
      nearbyEvents,
      summary: `No live USGS earthquakes were found within ${radiusKm} km in the past 24 hours.`,
      guidance: guidanceForTier("clear"),
    };
  }

  const tier = highestTier(nearbyEvents.map((event) => event.riskTier));
  const closest = nearbyEvents[0];
  if (closest === undefined) {
    throw new Error("Live risk calculation failed after nearby events were detected.");
  }

  return {
    tier,
    location,
    radiusKm,
    sourceGeneratedUtc: generatedUtc,
    consideredEvents: events.length,
    nearbyEvents,
    summary: `Closest live event: M${closest.magnitude.toFixed(1)}, ${closest.distanceKm.toFixed(0)} km away near ${closest.place}.`,
    guidance: guidanceForTier(tier),
  };
}

function classifyEvent(event: EarthquakeEvent): RiskTier {
  const alert = event.alert.toLowerCase();
  if (event.tsunami === 1 || alert === "red" || alert === "orange" || event.magnitude >= 6.5) {
    return "danger";
  }
  if (alert === "yellow" || event.magnitude >= 5.0) {
    return "caution";
  }
  if (event.magnitude >= 3.5) {
    return "watch";
  }
  return "clear";
}

function highestTier(tiers: RiskTier[]): RiskTier {
  const tierRank: Record<RiskTier, number> = {
    unavailable: 0,
    clear: 1,
    watch: 2,
    caution: 3,
    danger: 4,
  };
  return tiers.reduce((highest, tier) => (tierRank[tier] > tierRank[highest] ? tier : highest), "clear");
}

function guidanceForTier(tier: RiskTier): string {
  if (tier === "danger") {
    return "Follow official emergency instructions now. Avoid damaged structures, unstable slopes, bridges, and coastlines when tsunami guidance applies.";
  }
  if (tier === "caution") {
    return "Be ready for aftershocks, avoid visibly damaged structures, and check local emergency channels before traveling toward the affected area.";
  }
  if (tier === "watch") {
    return "Monitor official updates and keep a basic safety plan ready, especially near older buildings or steep terrain.";
  }
  if (tier === "unavailable") {
    return "Live hazard status could not be established from the current feed.";
  }
  return "No nearby live USGS activity crossed the selected radius threshold.";
}

async function summarizeAssessment(assessment: RiskAssessment): Promise<string> {
  const deterministic = formatAssessment(assessment);
  const topEvents = assessment.nearbyEvents.slice(0, 3).map((event) => ({
    place: event.place,
    magnitude: event.magnitude,
    distanceKm: Math.round(event.distanceKm),
    depthKm: event.depthKm,
    timeUtc: event.timeUtc,
    alert: event.alert,
    tsunami: event.tsunami,
    url: event.url,
  }));

  try {
    const content = await generateBtlRuntimeSummary({
      location: assessment.location,
      tier: assessment.tier,
      summary: assessment.summary,
      guidance: assessment.guidance,
      sourceGeneratedUtc: assessment.sourceGeneratedUtc,
      consideredEvents: assessment.consideredEvents,
      topEvents,
    });
    if (!content) {
      return deterministic;
    }
    return `${content}\n\nSource: USGS past-day feed generated ${assessment.sourceGeneratedUtc}`;
  } catch (error) {
    return `${deterministic}\n\nBTL Runtime summary unavailable: ${formatError(error)}`;
  }
}

function formatAssessment(assessment: RiskAssessment): string {
  const lines = [
    `Status: ${assessment.tier.toUpperCase()}`,
    `Location: ${assessment.location.label}`,
    assessment.summary,
    assessment.guidance,
    `Source: USGS past-day feed generated ${assessment.sourceGeneratedUtc}`,
  ];

  if (assessment.nearbyEvents.length > 0) {
    const event = assessment.nearbyEvents[0];
    if (event === undefined) {
      return lines.join("\n");
    }
    lines.push(`USGS: ${event.url}`);
  }

  return lines.join("\n");
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const earthRadiusKm = 6371;
  const deltaLat = toRadians(lat2 - lat1);
  const deltaLon = toRadians(lon2 - lon1);
  const a =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(deltaLon / 2) ** 2;
  return 2 * earthRadiusKm * Math.asin(Math.sqrt(a));
}

function toRadians(value: number): number {
  return (value * Math.PI) / 180;
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return `Live check unavailable: ${error.message}`;
  }
  return "Live check unavailable due to an unknown error.";
}
