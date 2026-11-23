import {
  Controller,
  Get,
  Query,
  HttpCode,
  HttpStatus,
  BadRequestException,
  UseGuards,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { SessionGuard } from "../auth/session.guard";
import { Public } from "../common/decorators";
import { MapboxService } from "./mapbox.service";
import {
  ReverseGeocodeQueryDto,
  ForwardGeocodeQueryDto,
  DirectionsQueryDto,
} from "./dto/geocode-query.dto";

@Controller("geo")
@UseGuards(SessionGuard)
export class MapboxController {
  constructor(private readonly mapboxService: MapboxService) {}

  @Public()
  @Get("health")
  @HttpCode(HttpStatus.OK)
  health() {
    return { ok: true };
  }

  @Throttle({
    default: { ttl: 60000, limit: 20 },
    medium: { ttl: 10000, limit: 8 },
  })
  @Get("reverse")
  async reverseGeocode(@Query() query: ReverseGeocodeQueryDto) {
    if (query.lat == null || query.lng == null) {
      throw new BadRequestException("Coordenadas requeridas (lat, lng)");
    }
    const result = await this.mapboxService.reverseGeocode(
      query.lat,
      query.lng,
    );
    return { success: Boolean(result), data: result };
  }

  @Throttle({
    default: { ttl: 60000, limit: 20 },
    medium: { ttl: 10000, limit: 8 },
  })
  @Get("geocode")
  async forwardGeocode(@Query() query: ForwardGeocodeQueryDto) {
    if (!query.q?.trim()) {
      throw new BadRequestException("Término de búsqueda requerido (q)");
    }
    const result = await this.mapboxService.forwardGeocode(query.q);
    return { success: Boolean(result), data: result };
  }

  @Throttle({
    default: { ttl: 60000, limit: 15 },
    medium: { ttl: 10000, limit: 5 },
  })
  @Get("directions")
  async getDirections(@Query() query: DirectionsQueryDto) {
    const origin: [number, number] = [query.originLng, query.originLat];
    const destination: [number, number] = [query.destLng, query.destLat];
    const result = await this.mapboxService.getRouteDirections(
      origin,
      destination,
    );
    return { success: Boolean(result), data: result };
  }
}
