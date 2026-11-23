import { Injectable, Logger, Optional } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createHash } from "node:crypto";
import { KvCacheService } from "../kv/kv-cache.service";
import {
  MAPBOX_API_ORIGIN,
  isValidCoordinates,
  isValidMapboxToken,
  parseForwardGeocodeFeature,
  parseReverseGeocodeFeature,
  safeMapboxFetchJson,
  type ForwardGeocodeResult,
  type GeocodingFeatureCollection,
  type ReverseGeocodeResult,
  type RouteDirectionsResult,
} from "./mapbox-fetch.helper";

export type {
  ReverseGeocodeResult,
  ForwardGeocodeResult,
  RouteDirectionsResult,
};

interface MemoryCacheEntry<T> {
  value: T;
  expiresAt: number;
}

const MAX_MEMORY_CACHE_ENTRIES = 500;
const REVERSE_TTL_SECONDS = 600;
const FORWARD_TTL_SECONDS = 900;
const DIRECTIONS_TTL_SECONDS = 60;
const BOGOTA_PROXIMITY = "-74.0836,4.6533";

@Injectable()
export class MapboxService {
  private readonly logger = new Logger(MapboxService.name);
  private readonly accessToken: string;
  private readonly memoryCache = new Map<string, MemoryCacheEntry<unknown>>();

  constructor(
    private readonly configService: ConfigService,
    @Optional() private readonly kvCache?: KvCacheService,
  ) {
    const rawToken =
      this.configService.get<string>("MAPBOX_ACCESS_TOKEN") ||
      process.env.MAPBOX_ACCESS_TOKEN ||
      "";
    const trimmed = rawToken.trim();
    if (!trimmed) {
      this.accessToken = "";
      this.logger.warn(
        "MAPBOX_ACCESS_TOKEN no configurado en entorno. Funciones geo ARPHA degradadas.",
      );
    } else if (!isValidMapboxToken(trimmed)) {
      this.accessToken = "";
      this.logger.error(
        "MAPBOX_ACCESS_TOKEN con formato inválido. Funciones geo ARPHA deshabilitadas.",
      );
    } else {
      this.accessToken = trimmed;
    }
  }

  private async getCached<T>(key: string): Promise<T | null> {
    const now = Date.now();
    const local = this.memoryCache.get(key);
    if (local && local.expiresAt > now) {
      return local.value as T;
    }
    if (local) {
      this.memoryCache.delete(key);
    }
    if (this.kvCache) {
      try {
        const kvVal = await this.kvCache.get<T>(key, false);
        if (kvVal !== null) {
          this.setMemoryCache(key, kvVal, 60);
          return kvVal;
        }
      } catch {
        // Degrade gracefully when KV is unavailable
      }
    }
    return null;
  }

  private async setCached<T>(
    key: string,
    value: T,
    ttlSeconds: number,
  ): Promise<void> {
    this.setMemoryCache(key, value, ttlSeconds);
    if (this.kvCache) {
      await this.kvCache.set(key, value, ttlSeconds, false).catch(() => {});
    }
  }

  private setMemoryCache<T>(key: string, value: T, ttlSeconds: number): void {
    if (this.memoryCache.size >= MAX_MEMORY_CACHE_ENTRIES) {
      const oldestKey = this.memoryCache.keys().next().value;
      if (oldestKey !== undefined) {
        this.memoryCache.delete(oldestKey);
      }
    }
    this.memoryCache.set(key, {
      value,
      expiresAt: Date.now() + ttlSeconds * 1000,
    });
  }

  /**
   * Reverse geocoding via Mapbox Geocoding API v6:
   * coordinates (lat, lng) -> human-readable Colombian address.
   */
  async reverseGeocode(
    lat: number,
    lng: number,
  ): Promise<ReverseGeocodeResult | null> {
    if (!this.accessToken || !isValidCoordinates(lat, lng)) return null;

    const cacheKey = `geo:v6:rev:${lat.toFixed(4)},${lng.toFixed(4)}`;
    const cached = await this.getCached<ReverseGeocodeResult>(cacheKey);
    if (cached) return cached;

    const url = new URL("/search/geocode/v6/reverse", MAPBOX_API_ORIGIN);
    url.searchParams.set("longitude", String(lng));
    url.searchParams.set("latitude", String(lat));
    url.searchParams.set("country", "co");
    url.searchParams.set("language", "es");
    url.searchParams.set("limit", "1");
    url.searchParams.set("access_token", this.accessToken);

    const data = await safeMapboxFetchJson<GeocodingFeatureCollection>(
      url,
      "reverse geocode v6",
      this.logger,
    );
    const parsed = parseReverseGeocodeFeature(data);
    if (parsed) {
      await this.setCached(cacheKey, parsed, REVERSE_TTL_SECONDS);
    }
    return parsed;
  }

  /**
   * Forward geocoding via Mapbox Geocoding API v6:
   * textual address query -> geographic coordinates.
   */
  async forwardGeocode(query: string): Promise<ForwardGeocodeResult | null> {
    if (!this.accessToken || typeof query !== "string") return null;

    const trimmed = query.replace(/[\r\n\t]+/g, " ").trim();
    if (trimmed.length < 2 || trimmed.length > 150) return null;

    const queryHash = createHash("sha256")
      .update(trimmed.toLowerCase())
      .digest("hex")
      .slice(0, 24);
    const cacheKey = `geo:v6:fwd:${queryHash}`;
    const cached = await this.getCached<ForwardGeocodeResult>(cacheKey);
    if (cached) return cached;

    const url = new URL("/search/geocode/v6/forward", MAPBOX_API_ORIGIN);
    url.searchParams.set("q", trimmed);
    url.searchParams.set("country", "co");
    url.searchParams.set("proximity", BOGOTA_PROXIMITY);
    url.searchParams.set("language", "es");
    url.searchParams.set("limit", "1");
    url.searchParams.set("access_token", this.accessToken);

    const data = await safeMapboxFetchJson<GeocodingFeatureCollection>(
      url,
      "forward geocode v6",
      this.logger,
    );
    const parsed = parseForwardGeocodeFeature(data);
    if (parsed) {
      await this.setCached(cacheKey, parsed, FORWARD_TTL_SECONDS);
    }
    return parsed;
  }

  /**
   * Route directions with live traffic via Mapbox Directions API v5:
   * origin [lng, lat] -> destination [lng, lat].
   */
  async getRouteDirections(
    origin: [number, number],
    destination: [number, number],
  ): Promise<RouteDirectionsResult | null> {
    if (!this.accessToken) return null;
    if (
      !Array.isArray(origin) ||
      !Array.isArray(destination) ||
      !isValidCoordinates(origin[1], origin[0]) ||
      !isValidCoordinates(destination[1], destination[0])
    ) {
      return null;
    }

    const cacheKey = `geo:v5:dir:${origin[0].toFixed(4)},${origin[1].toFixed(4)}:${destination[0].toFixed(4)},${destination[1].toFixed(4)}`;
    const cached = await this.getCached<RouteDirectionsResult>(cacheKey);
    if (cached) return cached;

    const pathCoords = `${origin[0]},${origin[1]};${destination[0]},${destination[1]}`;
    const url = new URL(
      `/directions/v5/mapbox/driving-traffic/${encodeURIComponent(pathCoords)}`,
      MAPBOX_API_ORIGIN,
    );
    url.searchParams.set("geometries", "geojson");
    url.searchParams.set("overview", "full");
    url.searchParams.set("access_token", this.accessToken);

    const data = await safeMapboxFetchJson<{
      code?: string;
      routes?: {
        geometry?: { coordinates?: [number, number][] };
        duration?: number;
        distance?: number;
      }[];
    }>(url, "directions v5", this.logger);

    const route = data?.code === "Ok" ? data.routes?.[0] : undefined;
    if (
      !route ||
      typeof route.distance !== "number" ||
      typeof route.duration !== "number" ||
      !Array.isArray(route.geometry?.coordinates)
    ) {
      return null;
    }

    const result: RouteDirectionsResult = {
      distanceKm: +(route.distance / 1000).toFixed(1),
      durationMin: Math.round(route.duration / 60),
      coordinates: route.geometry.coordinates,
    };
    await this.setCached(cacheKey, result, DIRECTIONS_TTL_SECONDS);
    return result;
  }
}
