import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

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

function extractAddressContext(context?: { id: string; text: string }[]): {
  neighborhood?: string;
  locality?: string;
  city?: string;
} {
  if (!context) return {};
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

@Injectable()
export class MapboxService {
  private readonly logger = new Logger(MapboxService.name);
  private readonly accessToken: string;

  constructor(private readonly configService: ConfigService) {
    this.accessToken =
      this.configService.get<string>("MAPBOX_ACCESS_TOKEN") ||
      process.env.MAPBOX_ACCESS_TOKEN ||
      "";
    if (!this.accessToken) {
      this.logger.warn(
        "MAPBOX_ACCESS_TOKEN no configurado en entorno. Funciones geo ARPHA degradadas.",
      );
    }
  }

  /**
   * Reverse geocoding: coordinates (lat, lng) -> human-readable Colombian address.
   */
  async reverseGeocode(
    lat: number,
    lng: number,
  ): Promise<ReverseGeocodeResult | null> {
    if (!this.accessToken) return null;
    try {
      const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(
        lng,
      )},${encodeURIComponent(lat)}.json?access_token=${encodeURIComponent(
        this.accessToken,
      )}&country=co&language=es`;
      const res = await fetch(url, { signal: AbortSignal.timeout(7000) });

      if (!res.ok) {
        this.logger.warn(`Mapbox reverse geocode HTTP ${res.status}`);
        return null;
      }

      const data = (await res.json()) as {
        features?: {
          place_name: string;
          text: string;
          place_type: string[];
          context?: { id: string; text: string }[];
        }[];
      };

      if (!data.features || data.features.length === 0) {
        return null;
      }

      const best = data.features[0];
      const { neighborhood, locality, city } = extractAddressContext(
        best.context,
      );

      return {
        address: best.text || best.place_name,
        neighborhood,
        locality,
        city,
        full: best.place_name,
      };
    } catch (err) {
      this.logger.warn(
        `Mapbox reverse geocode failed: ${(err as Error).message}`,
      );
      return null;
    }
  }

  /**
   * Forward geocoding: textual address query -> geographic coordinates.
   */
  async forwardGeocode(query: string): Promise<ForwardGeocodeResult | null> {
    if (!this.accessToken) return null;
    try {
      const trimmed = query.trim();
      if (!trimmed) return null;

      const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(
        trimmed,
      )}.json?access_token=${encodeURIComponent(
        this.accessToken,
      )}&country=co&proximity=-74.0836,4.6533&language=es`;
      const res = await fetch(url, { signal: AbortSignal.timeout(7000) });

      if (!res.ok) {
        this.logger.warn(`Mapbox forward geocode HTTP ${res.status}`);
        return null;
      }

      const data = (await res.json()) as {
        features?: {
          center: [number, number]; // [lng, lat]
          place_name: string;
          place_type: string[];
        }[];
      };

      if (!data.features || data.features.length === 0) {
        return null;
      }

      const best = data.features[0];
      return {
        lng: best.center[0],
        lat: best.center[1],
        formattedAddress: best.place_name,
        placeType: best.place_type?.[0],
      };
    } catch (err) {
      this.logger.warn(
        `Mapbox forward geocode failed: ${(err as Error).message}`,
      );
      return null;
    }
  }

  /**
   * Route directions with live traffic: origin [lng, lat] -> destination [lng, lat].
   */
  async getRouteDirections(
    origin: [number, number],
    destination: [number, number],
  ): Promise<RouteDirectionsResult | null> {
    if (!this.accessToken) return null;
    try {
      const url = `https://api.mapbox.com/directions/v5/mapbox/driving-traffic/${encodeURIComponent(
        origin[0],
      )},${encodeURIComponent(origin[1])};${encodeURIComponent(
        destination[0],
      )},${encodeURIComponent(
        destination[1],
      )}?geometries=geojson&overview=full&access_token=${encodeURIComponent(
        this.accessToken,
      )}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(7000) });

      if (!res.ok) {
        this.logger.warn(`Mapbox directions HTTP ${res.status}`);
        return null;
      }

      const data = (await res.json()) as {
        code: string;
        routes?: {
          geometry: { coordinates: [number, number][] };
          duration: number;
          distance: number;
        }[];
      };

      if (data.code !== "Ok" || !data.routes?.[0]) {
        return null;
      }

      const route = data.routes[0];
      return {
        distanceKm: +(route.distance / 1000).toFixed(1),
        durationMin: Math.round(route.duration / 60),
        coordinates: route.geometry.coordinates,
      };
    } catch (err) {
      this.logger.warn(
        `Mapbox route directions failed: ${(err as Error).message}`,
      );
      return null;
    }
  }
}
