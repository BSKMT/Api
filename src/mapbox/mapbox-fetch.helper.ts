import { Logger } from "@nestjs/common";

export const MAPBOX_API_ORIGIN = "https://api.mapbox.com";
const MAPBOX_ALLOWED_HOST = "api.mapbox.com";
const MAX_MAPBOX_RESPONSE_BYTES = 1_048_576; // 1 MiB
const MAPBOX_TOKEN_PATTERN = /^(pk|sk)\.\S+$/;

export interface ReverseGeocodeResult {
  address: string;
  neighborhood?: string;
  locality?: string;
  city?: string;
  full: string;
}

export interface ForwardGeocodeResult {
  lat: number;
  lng: number;
  formattedAddress: string;
  placeType?: string;
}

export interface RouteDirectionsResult {
  distanceKm: number;
  durationMin: number;
  coordinates: [number, number][];
}

interface GeocodingV6ContextEntry {
  name?: string;
}

interface GeocodingV6Feature {
  geometry?: {
    coordinates?: [number, number];
  };
  properties?: {
    full_address?: string;
    name?: string;
    name_preferred?: string;
    place_formatted?: string;
    feature_type?: string;
    coordinates?: {
      longitude?: number;
      latitude?: number;
    };
    context?: {
      neighborhood?: GeocodingV6ContextEntry;
      locality?: GeocodingV6ContextEntry;
      place?: GeocodingV6ContextEntry;
      district?: GeocodingV6ContextEntry;
      region?: GeocodingV6ContextEntry;
      street?: GeocodingV6ContextEntry;
    };
  };
  // Backward compatibility if a mock or legacy payload returns v5 fields
  center?: [number, number];
  place_name?: string;
  text?: string;
  place_type?: string[];
  context?: { id: string; text: string }[];
}

export interface GeocodingFeatureCollection {
  features?: GeocodingV6Feature[];
}

export function isValidMapboxToken(token: string): boolean {
  const trimmed = token.trim();
  if (!trimmed || /\s/.test(trimmed)) return false;
  return MAPBOX_TOKEN_PATTERN.test(trimmed);
}

export function isValidCoordinates(lat: number, lng: number): boolean {
  return (
    typeof lat === "number" &&
    typeof lng === "number" &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
}

export function sanitizeMapboxError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  return raw
    .replace(/access_token=[^&\s"']+/gi, "access_token=<REDACTED>")
    .replace(/(pk|sk)\.[A-Za-z0-9._-]+/g, "$1.<REDACTED>");
}

type BoundedReadResult =
  | { status: "ok"; text: string }
  | { status: "oversized" }
  | { status: "unsupported" };

async function readStreamBounded(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): Promise<BoundedReadResult> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_MAPBOX_RESPONSE_BYTES) {
        await reader.cancel().catch(() => {});
        return { status: "oversized" };
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { status: "ok", text: new TextDecoder("utf-8").decode(merged) };
}

async function readBoundedText(res: Response): Promise<BoundedReadResult> {
  const headerLen = Number.parseInt(
    res.headers?.get?.("content-length") ?? "",
    10,
  );
  if (Number.isFinite(headerLen) && headerLen > MAX_MAPBOX_RESPONSE_BYTES) {
    return { status: "oversized" };
  }

  if (res.body && typeof res.body.getReader === "function") {
    return readStreamBounded(res.body.getReader());
  }

  if (typeof res.text === "function") {
    const text = await res.text();
    if (Buffer.byteLength(text, "utf8") > MAX_MAPBOX_RESPONSE_BYTES) {
      return { status: "oversized" };
    }
    return { status: "ok", text };
  }

  return { status: "unsupported" };
}

export async function safeMapboxFetchJson<T>(
  url: URL,
  label: string,
  logger: Logger,
  timeoutMs = 7000,
): Promise<T | null> {
  if (
    url.protocol !== "https:" ||
    url.hostname.toLowerCase() !== MAPBOX_ALLOWED_HOST
  ) {
    logger.error(`Blocked non-Mapbox outbound request in ${label}`);
    return null;
  }

  try {
    const res = await fetch(url.toString(), {
      method: "GET",
      headers: { Accept: "application/json" },
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (res.status >= 300 && res.status < 400) {
      logger.warn(
        `Mapbox ${label} blocked unexpected HTTP ${res.status} redirect`,
      );
      return null;
    }

    if (res.status === 401 || res.status === 403) {
      logger.error(
        `Mapbox ${label} HTTP ${res.status} — verify MAPBOX_ACCESS_TOKEN validity/scopes`,
      );
      return null;
    }

    if (!res.ok) {
      logger.warn(`Mapbox ${label} HTTP ${res.status}`);
      return null;
    }

    const readResult = await readBoundedText(res);
    if (readResult.status === "ok") {
      return JSON.parse(readResult.text) as T;
    }
    if (readResult.status === "oversized") {
      logger.warn(
        `Mapbox ${label} response exceeded ${MAX_MAPBOX_RESPONSE_BYTES} byte cap`,
      );
      return null;
    }

    if (typeof res.json === "function") {
      return (await res.json()) as T;
    }

    return null;
  } catch (err) {
    logger.warn(`Mapbox ${label} failed: ${sanitizeMapboxError(err)}`);
    return null;
  }
}

function extractV5Context(context?: { id: string; text: string }[]): {
  neighborhood?: string;
  locality?: string;
  city?: string;
} {
  if (!Array.isArray(context)) return {};
  let neighborhood: string | undefined;
  let locality: string | undefined;
  let city: string | undefined;
  for (const ctx of context) {
    if (ctx.id.startsWith("neighborhood")) neighborhood = ctx.text;
    else if (ctx.id.startsWith("locality")) locality = ctx.text;
    else if (ctx.id.startsWith("place")) city = ctx.text;
  }
  return { neighborhood, locality, city };
}

function parseReverseV6Properties(
  props: NonNullable<GeocodingV6Feature["properties"]>,
): ReverseGeocodeResult | null {
  const ctx = props.context;
  const address =
    props.name_preferred ||
    props.name ||
    ctx?.street?.name ||
    props.full_address ||
    "";
  const full =
    props.full_address ||
    [address, props.place_formatted].filter(Boolean).join(", ");
  if (!full && !address) return null;

  return {
    address: address || full,
    neighborhood: ctx?.neighborhood?.name,
    locality: ctx?.locality?.name,
    city: ctx?.place?.name || ctx?.region?.name,
    full: full || address,
  };
}

export function parseReverseGeocodeFeature(
  data: GeocodingFeatureCollection | null,
): ReverseGeocodeResult | null {
  const best = data?.features?.[0];
  if (!best) return null;

  if (best.properties) {
    return parseReverseV6Properties(best.properties);
  }

  if (best.place_name || best.text) {
    const { neighborhood, locality, city } = extractV5Context(best.context);
    const full = best.place_name || best.text || "";
    return {
      address: best.text || full,
      neighborhood,
      locality,
      city,
      full,
    };
  }

  return null;
}

function parseForwardV6Feature(
  best: GeocodingV6Feature,
  props: NonNullable<GeocodingV6Feature["properties"]>,
): ForwardGeocodeResult | null {
  const lng = props.coordinates?.longitude ?? best.geometry?.coordinates?.[0];
  const lat = props.coordinates?.latitude ?? best.geometry?.coordinates?.[1];
  if (
    typeof lat !== "number" ||
    typeof lng !== "number" ||
    !isValidCoordinates(lat, lng)
  ) {
    return null;
  }
  const formattedAddress =
    props.full_address ||
    [props.name_preferred || props.name, props.place_formatted]
      .filter(Boolean)
      .join(", ");
  if (!formattedAddress) return null;

  return {
    lng,
    lat,
    formattedAddress,
    placeType: props.feature_type,
  };
}

export function parseForwardGeocodeFeature(
  data: GeocodingFeatureCollection | null,
): ForwardGeocodeResult | null {
  const best = data?.features?.[0];
  if (!best) return null;

  if (best.properties) {
    return parseForwardV6Feature(best, best.properties);
  }

  if (
    Array.isArray(best.center) &&
    best.center.length >= 2 &&
    best.place_name
  ) {
    const [lng, lat] = best.center;
    if (!isValidCoordinates(lat, lng)) return null;
    return {
      lng,
      lat,
      formattedAddress: best.place_name,
      placeType: best.place_type?.[0],
    };
  }

  return null;
}
