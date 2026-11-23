import { Test, TestingModule } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import { MapboxService } from "./mapbox.service";
import { sanitizeMapboxError } from "./mapbox-fetch.helper";

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

  it("should use Mapbox Geocoding API v6 for reverse geocoding and cache repeated grid calls", async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: jest.fn().mockResolvedValue(
        JSON.stringify({
          type: "FeatureCollection",
          features: [
            {
              geometry: { type: "Point", coordinates: [-74.06345, 4.67518] },
              properties: {
                name: "Calle 86a 24-62",
                full_address: "Calle 86a 24-62, 111211 Bogotá, Colombia",
                feature_type: "address",
                context: {
                  neighborhood: { name: "Polo Club" },
                  locality: { name: "Barrios Unidos" },
                  place: { name: "Bogotá" },
                },
              },
            },
          ],
        }),
      ),
    });
    global.fetch = fetchMock;

    const first = await service.reverseGeocode(4.6752, -74.0636);
    const second = await service.reverseGeocode(4.6752, -74.0636);

    expect(first).toEqual({
      address: "Calle 86a 24-62",
      neighborhood: "Polo Club",
      locality: "Barrios Unidos",
      city: "Bogotá",
      full: "Calle 86a 24-62, 111211 Bogotá, Colombia",
    });
    expect(second).toEqual(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [calledUrl, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(calledUrl).toContain(
      "https://api.mapbox.com/search/geocode/v6/reverse?",
    );
    expect(calledUrl).toContain("longitude=-74.0636");
    expect(calledUrl).toContain("latitude=4.6752");
    expect(init.redirect).toBe("manual");
  });

  it("should handle forward geocoding v6 gracefully when response is empty", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue({ features: [] }),
    });

    const result = await service.forwardGeocode("Inexistente");
    expect(result).toBeNull();
  });

  it("should return coordinates and formatted address on valid Geocoding v6 forward query", async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: jest.fn().mockResolvedValue(
        JSON.stringify({
          type: "FeatureCollection",
          features: [
            {
              geometry: { type: "Point", coordinates: [-74.0636, 4.6752] },
              properties: {
                name: "Bogotá",
                full_address: "Bogotá, Colombia",
                feature_type: "place",
                coordinates: { longitude: -74.0636, latitude: 4.6752 },
              },
            },
          ],
        }),
      ),
    });
    global.fetch = fetchMock;

    const result = await service.forwardGeocode("Bogota");
    expect(result).toEqual({
      lng: -74.0636,
      lat: 4.6752,
      formattedAddress: "Bogotá, Colombia",
      placeType: "place",
    });
    const [calledUrl] = fetchMock.mock.calls[0] as [string];
    expect(calledUrl).toContain(
      "https://api.mapbox.com/search/geocode/v6/forward?",
    );
    expect(calledUrl).toContain("q=Bogota");
  });

  it("should return route duration and distance on directions query and cache repeated calls", async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
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
    global.fetch = fetchMock;

    const first = await service.getRouteDirections(
      [-74.0636, 4.6752],
      [-74.0721, 4.711],
    );
    const second = await service.getRouteDirections(
      [-74.0636, 4.6752],
      [-74.0721, 4.711],
    );

    expect(first).toEqual({
      distanceKm: 5.2,
      durationMin: 12,
      coordinates: [
        [-74.0636, 4.6752],
        [-74.0721, 4.711],
      ],
    });
    expect(second).toEqual(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("should reject invalid coordinates before making any outbound Mapbox call", async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock;

    expect(await service.reverseGeocode(95, -74.06)).toBeNull();
    expect(await service.reverseGeocode(Number.NaN, -74.06)).toBeNull();
    expect(
      await service.getRouteDirections([-200, 4.6], [-74.06, 4.7]),
    ).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("should block 3xx redirects and oversized responses (>1 MiB)", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 302,
    });
    expect(await service.reverseGeocode(4.61, -74.08)).toBeNull();

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ "content-length": "2097152" }),
      json: jest.fn(),
    });
    expect(await service.forwardGeocode("Medellin")).toBeNull();
  });

  it("should gracefully handle fetch network exceptions and redact access tokens from errors", async () => {
    global.fetch = jest
      .fn()
      .mockRejectedValue(
        new Error(
          "Network timeout fetching https://api.mapbox.com/search?access_token=pk.secret123.abc",
        ),
      );

    expect(await service.reverseGeocode(4.6752, -74.0636)).toBeNull();
    expect(await service.forwardGeocode("Bogota")).toBeNull();
    expect(
      await service.getRouteDirections([-74.0636, 4.6752], [-74.0721, 4.711]),
    ).toBeNull();

    const sanitized = sanitizeMapboxError(
      new Error("Failed https://api.mapbox.com/x?access_token=pk.abc.def&q=1"),
    );
    expect(sanitized).not.toContain("pk.abc.def");
    expect(sanitized).toContain("access_token=<REDACTED>");
  });
});
