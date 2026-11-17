import { Test, TestingModule } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import { MapboxService } from "./mapbox.service";

describe("MapboxService", () => {
  let service: MapboxService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MapboxService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              if (key === "MAPBOX_ACCESS_TOKEN") {
                return "pk.test.token";
              }
              return null;
            }),
          },
        },
      ],
    }).compile();

    service = module.get<MapboxService>(MapboxService);
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  it("should handle forward geocoding gracefully when response is empty", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({ features: [] }),
    });

    const result = await service.forwardGeocode("Inexistente");
    expect(result).toBeNull();
  });

  it("should return coordinates and formatted address on valid geocode", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        features: [
          {
            center: [-74.0636, 4.6752],
            place_name: "Bogotá, Colombia",
            place_type: ["place"],
          },
        ],
      }),
    });

    const result = await service.forwardGeocode("Bogota");
    expect(result).toEqual({
      lng: -74.0636,
      lat: 4.6752,
      formattedAddress: "Bogotá, Colombia",
      placeType: "place",
    });
  });

  it("should return route duration and distance on directions query", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        code: "Ok",
        routes: [
          {
            distance: 5200,
            duration: 720,
            geometry: {
              coordinates: [
                [-74.0636, 4.6752],
                [-74.0721, 4.711],
              ],
            },
          },
        ],
      }),
    });

    const result = await service.getRouteDirections(
      [-74.0636, 4.6752],
      [-74.0721, 4.711],
    );

    expect(result).toEqual({
      distanceKm: 5.2,
      durationMin: 12,
      coordinates: [
        [-74.0636, 4.6752],
        [-74.0721, 4.711],
      ],
    });
  });

  it("should gracefully handle fetch network exceptions without crashing", async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error("Network timeout"));

    const reverse = await service.reverseGeocode(4.6752, -74.0636);
    expect(reverse).toBeNull();

    const forward = await service.forwardGeocode("Bogota");
    expect(forward).toBeNull();

    const route = await service.getRouteDirections(
      [-74.0636, 4.6752],
      [-74.0721, 4.711],
    );
    expect(route).toBeNull();
  });
});
