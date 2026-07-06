import { Spectrum, type PlatformProviderConfig } from "spectrum-ts";
import { imessage } from "@spectrum-ts/imessage";
import { telegram } from "@spectrum-ts/telegram";
import { requireExaSearchConfig, searchExaContext } from "./exa-search";
import { requireBtlRuntimeConfig } from "./runtime";

const USGS_PAST_DAY_URL =
  "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson";
const USER_AGENT = "qwake-earthquake-agent/1.0";
const DEFAULT_RADIUS_KM = 300;
const ACTIVE_HAZARD_LIMIT = 5;
const MAX_OUTBOUND_MESSAGE_CHARS = 3200;
const UNITED_STATES_ALIASES = new Set(["america", "the usa", "united states", "united states of america", "us", "usa"]);
const UNITED_STATES_PLACE_TERMS = [
  "alabama",
  "alaska",
  "arizona",
  "arkansas",
  "california",
  "colorado",
  "connecticut",
  "delaware",
  "florida",
  "georgia",
  "hawaii",
  "idaho",
  "illinois",
  "indiana",
  "iowa",
  "kansas",
  "kentucky",
  "louisiana",
  "maine",
  "maryland",
  "massachusetts",
  "michigan",
  "minnesota",
  "mississippi",
  "missouri",
  "montana",
  "nebraska",
  "nevada",
  "new hampshire",
  "new jersey",
  "new mexico",
  "new york",
  "north carolina",
  "north dakota",
  "ohio",
  "oklahoma",
  "oregon",
  "pennsylvania",
  "rhode island",
  "south carolina",
  "south dakota",
  "tennessee",
  "texas",
  "utah",
  "vermont",
  "virginia",
  "washington",
  "west virginia",
  "wisconsin",
  "wyoming",
  "aleutian islands",
  "alaska peninsula",
  "hawaiian islands",
  "puerto rico",
  "virgin islands",
  "guam",
  "northern mariana",
  "american samoa",
];

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

type RankedEarthquakeEvent = EarthquakeEvent & { riskTier: RiskTier };

type TextSendSpace = {
  send: (content: string) => Promise<unknown>;
};

const configuredProviders: PlatformProviderConfig[] = [imessage.config()];
const btlRuntimeConfig = requireBtlRuntimeConfig();
requireExaSearchConfig();
const telegramEnabled = Boolean(process.env.TELEGRAM_BOT_TOKEN);
const providerNames = telegramEnabled ? ["imessage", "telegram"] : ["imessage"];
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
    projectId: maskIdentifier(projectId),
    providers: providerNames,
    telegramEnabled,
    exaSearch: "required",
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
  const platform =
    getStringProperty(message, "platform") ??
    getStringProperty(message, "__platform") ??
    getStringProperty(space, "platform") ??
    getStringProperty(space, "__platform") ??
    "unknown";
  const maskedSpaceId = maskIdentifier(getStringProperty(space, "id") ?? "unknown");

  console.info(
    JSON.stringify({
      event: "qwake.agent.inbound",
      platform,
      contentType: message.content.type,
      spaceId: maskedSpaceId,
    }),
  );

  if (message.content.type !== "text") {
    const chunkCount = await sendTextResponse(
      space,
      "Send a place name or coordinates, and I will check live USGS earthquakes from the past 24 hours.",
    );
    console.info(
      JSON.stringify({
        event: "qwake.agent.reply_sent",
        platform,
        contentType: "help",
        spaceId: maskedSpaceId,
        chunkCount,
      }),
    );
    continue;
  }

  try {
    const response = await handleTextMessage(message.content.text);
    const chunkCount = await sendTextResponse(space, response);
    console.info(
      JSON.stringify({
        event: "qwake.agent.reply_sent",
        platform,
        contentType: "risk_assessment",
        spaceId: maskedSpaceId,
        chunkCount,
      }),
    );
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "qwake.agent.reply_error",
        platform,
        spaceId: maskedSpaceId,
        error: formatError(error),
      }),
    );
    await sendTextResponse(space, formatUserFacingError(error));
  }
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function getStringProperty(value: unknown, key: string): string | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }

  const property = (value as Record<string, unknown>)[key];
  return typeof property === "string" ? property : undefined;
}

function maskIdentifier(value: string): string {
  if (value.length <= 8) {
    return value;
  }

  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

async function sendTextResponse(space: TextSendSpace, text: string): Promise<number> {
  const chunks = splitOutboundMessage(text);
  for (const chunk of chunks) {
    await space.send(chunk);
  }

  return chunks.length;
}

function splitOutboundMessage(text: string): string[] {
  const normalized = text.trim() || "No live response text was generated.";
  if (normalized.length <= MAX_OUTBOUND_MESSAGE_CHARS) {
    return [normalized];
  }

  const chunks: string[] = [];
  let current = "";
  for (const block of normalized.split(/\n{2,}/)) {
    const cleanBlock = block.trim();
    if (!cleanBlock) {
      continue;
    }

    const candidate = current ? `${current}\n\n${cleanBlock}` : cleanBlock;
    if (candidate.length <= MAX_OUTBOUND_MESSAGE_CHARS) {
      current = candidate;
      continue;
    }

    if (current) {
      chunks.push(current);
      current = "";
    }

    for (const splitBlock of splitLongText(cleanBlock, MAX_OUTBOUND_MESSAGE_CHARS)) {
      if (!current) {
        current = splitBlock;
        continue;
      }

      const splitCandidate = `${current}\n\n${splitBlock}`;
      if (splitCandidate.length <= MAX_OUTBOUND_MESSAGE_CHARS) {
        current = splitCandidate;
      } else {
        chunks.push(current);
        current = splitBlock;
      }
    }
  }

  if (current) {
    chunks.push(current);
  }

  return chunks;
}

function splitLongText(text: string, maxLength: number): string[] {
  if (text.length <= maxLength) {
    return [text];
  }

  const chunks: string[] = [];
  let current = "";
  for (const word of text.split(/\s+/)) {
    if (word.length > maxLength) {
      if (current) {
        chunks.push(current);
        current = "";
      }
      for (let index = 0; index < word.length; index += maxLength) {
        chunks.push(word.slice(index, index + maxLength));
      }
      continue;
    }

    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxLength) {
      current = candidate;
    } else {
      chunks.push(current);
      current = word;
    }
  }

  if (current) {
    chunks.push(current);
  }

  return chunks;
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

  if (isActiveHazardRequest(trimmed)) {
    return summarizeActiveHazards("globally");
  }

  const locationQuery = extractLocationQuery(trimmed);
  if (isUnitedStatesQuery(locationQuery)) {
    return summarizeActiveHazards(
      "in the United States",
      isLikelyUnitedStatesEvent,
      "United States is too broad for a precise safety radius. Send a city, state, or coordinates for a personal check.",
    );
  }

  const location = await resolveLocation(locationQuery);
  const assessment = await assessLocationRisk(location, DEFAULT_RADIUS_KM);
  return summarizeAssessment(assessment);
}

function isActiveHazardRequest(text: string): boolean {
  if (parseCoordinates(text) !== null) {
    return false;
  }

  const normalized = normalizeText(text);
  return (
    /\b(where|which|what)\b.*\b(earthquakes?|quakes?|danger(?:ous)?|unsafe|risk|risks|risky|vulnerable|affected|avoid)\b/.test(
      normalized,
    ) ||
    /\b(vulnerable|dangerous|unsafe|affected|avoid|risk|risks|risky)\b.*\b(areas?|places?|locations?|regions?)\b/.test(
      normalized,
    ) ||
    /\b(areas?|places?|locations?|regions?)\b.*\b(vulnerable|dangerous|unsafe|affected|avoid|risk|risks|risky)\b/.test(
      normalized,
    )
  );
}

function extractLocationQuery(text: string): string {
  if (parseCoordinates(text) !== null) {
    return text;
  }

  const directPatterns = [
    /^(?:i\s*(?:am|'m)|im|am|we\s*(?:are|'re)|we're)\s+(?:currently\s+)?(?:in|at|near|around)\s+(.+?)\s*(?:right\s+now|now|rn|currently)?[.!?]*$/i,
    /^(?:my\s+location\s+is|location\s*:?)\s+(.+?)\s*(?:right\s+now|now|rn|currently)?[.!?]*$/i,
    /^(?:check|scan|assess|look\s+up|tell\s+me\s+about)\s+(.+?)\s*(?:right\s+now|now|rn|currently)?[.!?]*$/i,
  ];

  for (const pattern of directPatterns) {
    const match = text.match(pattern);
    const location = match?.[1];
    if (location) {
      return cleanLocationQuery(location);
    }
  }

  const trailingLocation = text.match(/\b(?:in|at|near|around)\s+(.+?)\s*(?:right\s+now|now|rn|currently)?[.!?]*$/i)?.[1];
  if (trailingLocation) {
    return cleanLocationQuery(trailingLocation);
  }

  return cleanLocationQuery(text);
}

function cleanLocationQuery(text: string): string {
  return text
    .replace(/[.!?]+$/g, "")
    .replace(/\b(?:right\s+now|now|rn|currently)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeLocationAlias(text: string): string {
  return normalizeText(text).replace(/\bu\s+s\b/g, "us").replace(/\bthe\s+/g, "").trim();
}

function isUnitedStatesQuery(text: string): boolean {
  return UNITED_STATES_ALIASES.has(normalizeLocationAlias(text));
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

async function summarizeActiveHazards(
  scopeLabel: string,
  filterEvents: (event: EarthquakeEvent) => boolean = () => true,
  note?: string,
): Promise<string> {
  const { events, generatedUtc } = await fetchRecentEarthquakes();
  const scopedEvents = events.filter(filterEvents);
  const rankedEvents = rankEarthquakeEvents(scopedEvents);
  const notableEvents = rankedEvents
    .filter((event) => event.riskTier !== "clear")
    .slice(0, ACTIVE_HAZARD_LIMIT);

  const lines = [`Live earthquake risk areas ${scopeLabel} from the past 24 hours:`];
  if (note) {
    lines.push(note);
  }

  if (events.length === 0) {
    lines.push("USGS returned no live events in the past-day feed. No fallback data is used.");
  } else if (scopedEvents.length === 0) {
    lines.push(`No live USGS events matched ${scopeLabel}.`);
  } else if (notableEvents.length === 0) {
    lines.push(`No WATCH, CAUTION, or DANGER events matched ${scopeLabel}.`);
  } else {
    notableEvents.forEach((event, index) => {
      lines.push(formatActiveHazardLine(event, index + 1));
    });
  }

  lines.push("This is not a prediction. Avoid affected areas only when official local guidance or visible damage says so.");
  lines.push("Send a city or coordinates for a personal radius check.");
  lines.push(`Source: USGS past-day feed generated ${generatedUtc}`);

  const exaContext = await searchExaContext(buildExaHazardQuery(scopeLabel, notableEvents));
  if (exaContext) {
    lines.push(exaContext);
  }

  return lines.join("\n");
}

function rankEarthquakeEvents(events: EarthquakeEvent[]): RankedEarthquakeEvent[] {
  return events
    .map((event) => ({
      ...event,
      riskTier: classifyEvent(event),
    }))
    .sort(
      (left, right) =>
        riskTierScore(right.riskTier) - riskTierScore(left.riskTier) ||
        right.magnitude - left.magnitude ||
        right.significance - left.significance ||
        Date.parse(right.timeUtc) - Date.parse(left.timeUtc),
    );
}

function formatActiveHazardLine(event: RankedEarthquakeEvent, index: number): string {
  const timeUtc = event.timeUtc.replace(".000Z", "Z");
  const tsunami = event.tsunami === 1 ? " tsunami flag" : "";
  const alert = event.alert === "none" ? "" : ` alert ${event.alert}`;
  return `${index}. ${event.riskTier.toUpperCase()} - M${event.magnitude.toFixed(1)} near ${event.place}; depth ${event.depthKm.toFixed(
    0,
  )} km; ${timeUtc}${alert}${tsunami}`;
}

function isLikelyUnitedStatesEvent(event: EarthquakeEvent): boolean {
  const place = normalizeText(event.place);
  return UNITED_STATES_PLACE_TERMS.some((term) => place.includes(term));
}

function buildExaHazardQuery(scopeLabel: string, events: RankedEarthquakeEvent[]): string {
  const eventPlaces = events
    .slice(0, 3)
    .map((event) => `M${event.magnitude.toFixed(1)} ${event.place}`)
    .join("; ");

  return [
    "current earthquake official advisory emergency update",
    scopeLabel,
    eventPlaces,
    "USGS local emergency management tsunami aftershock road closure shelter",
  ]
    .filter(Boolean)
    .join(" ");
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

function riskTierScore(tier: RiskTier): number {
  const tierRank: Record<RiskTier, number> = {
    unavailable: 0,
    clear: 1,
    watch: 2,
    caution: 3,
    danger: 4,
  };
  return tierRank[tier];
}

function highestTier(tiers: RiskTier[]): RiskTier {
  return tiers.reduce((highest, tier) => (riskTierScore(tier) > riskTierScore(highest) ? tier : highest), "clear");
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
  return appendExaContext(deterministic, assessment);
}

async function appendExaContext(message: string, assessment: RiskAssessment): Promise<string> {
  const exaContext = await searchExaContext(buildExaAssessmentQuery(assessment));
  if (!exaContext) {
    return message;
  }

  return `${message}\n\n${exaContext}`;
}

function buildExaAssessmentQuery(assessment: RiskAssessment): string {
  const eventPlaces = assessment.nearbyEvents
    .slice(0, 3)
    .map((event) => `M${event.magnitude.toFixed(1)} ${event.place}`)
    .join("; ");

  return [
    "current earthquake official advisory emergency update near",
    assessment.location.label,
    eventPlaces,
    "USGS local emergency management tsunami aftershock road closure shelter",
  ]
    .filter(Boolean)
    .join(" ");
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

function formatUserFacingError(error: unknown): string {
  if (isMessageTooLongError(error)) {
    return "The live check finished, but the chat platform rejected the reply length. I have shortened future replies; try the request again.";
  }

  return formatError(error);
}

function isMessageTooLongError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return /message is too long/i.test(error.message);
}
