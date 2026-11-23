import { Logger } from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import type { EnvironmentConfig } from "../config/config.interface";
import {
  MAX_VERIFIK_RESPONSE_BYTES,
  executeVerifikFetch,
  normalizeVerifikBearerToken,
  validateVerifikBaseUrl,
} from "./verifik-fetch.helper";
import {
  normalizeRuntDocumentNumber,
  normalizeRuntVehicle,
} from "./verifik-runt.helpers";
import {
  normalizeDriverLicense,
  normalizeFines,
  normalizeSinister,
  normalizeTaxes,
  normalizeValuation,
} from "./verifik-diagnostic.helpers";
import { VerifikService } from "./verifik.service";

type MockFetchCall = { url: string; init?: RequestInit };

function makeConfigService(
  overrides: Record<string, unknown> = {},
): ConfigService<EnvironmentConfig> {
  const values: Record<string, unknown> = {
    VERIFIK_API_TOKEN: "eyJhbGciOiJIUzI1NiJ9.test.token",
    VERIFIK_API_URL: "https://api.verifik.co",
    VERIFIK_TIMEOUT_MS: 5000,
    ...overrides,
  };
  return {
    get: (key: string) => values[key],
  } as unknown as ConfigService<EnvironmentConfig>;
}

function makeJsonResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

describe("Verifik API v2/v3 Contract & Security Suite", () => {
  const originalFetch = globalThis.fetch;
  let fetchCalls: MockFetchCall[] = [];

  afterEach(() => {
    globalThis.fetch = originalFetch;
    fetchCalls = [];
  });

  function installFetchMock(
    handler: (url: string, init?: RequestInit) => Response | Promise<Response>,
  ): void {
    const mockedFetch: typeof fetch = async (input, init) => {
      let url: string;
      if (typeof input === "string") {
        url = input;
      } else if (input instanceof URL) {
        url = input.toString();
      } else {
        url = input.url;
      }
      fetchCalls.push({ url, init });
      return handler(url, init);
    };
    globalThis.fetch = mockedFetch;
  }

  describe("verifik-fetch.helper (SSRF, Redirects, Token Hygiene & Size Cap)", () => {
    it("enforces HTTPS official Verifik host allowlist", () => {
      const prevEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = "production";
      try {
        expect(validateVerifikBaseUrl("https://api.verifik.co/")).toBe(
          "https://api.verifik.co",
        );
        expect(validateVerifikBaseUrl("https://verifik.app")).toBe(
          "https://verifik.app",
        );
        expect(validateVerifikBaseUrl("https://sandbox.verifik.co")).toBe(
          "https://sandbox.verifik.co",
        );
        expect(validateVerifikBaseUrl("http://api.verifik.co")).toBeNull();
        expect(validateVerifikBaseUrl("https://evil.example.com")).toBeNull();
        expect(
          validateVerifikBaseUrl("https://api.verifik.co.evil.com"),
        ).toBeNull();
        expect(validateVerifikBaseUrl("http://169.254.169.254")).toBeNull();
        expect(validateVerifikBaseUrl("not-a-url")).toBeNull();
      } finally {
        process.env.NODE_ENV = prevEnv;
      }
    });

    it("normalizes Bearer/JWT prefixes and rejects CRLF/whitespace tokens", () => {
      expect(normalizeVerifikBearerToken("Bearer abc.def.ghi")).toBe(
        "abc.def.ghi",
      );
      expect(normalizeVerifikBearerToken("JWT xyz.123.456")).toBe(
        "xyz.123.456",
      );
      expect(normalizeVerifikBearerToken("abc\r\nX-Injected: 1")).toBeNull();
      expect(normalizeVerifikBearerToken("abc def")).toBeNull();
      expect(normalizeVerifikBearerToken("   ")).toBeNull();
    });

    it("blocks 3xx redirects to protect the Bearer token and handles 401/403", async () => {
      const logger = new Logger("VerifikFetchTest");
      installFetchMock(
        () =>
          new Response(null, {
            status: 302,
            headers: { location: "https://attacker.example" },
          }),
      );

      const redirectRes = await executeVerifikFetch(
        makeConfigService(),
        logger,
        "/v2/co/cedula/premium",
        { documentNumber: "1020304050" },
      );
      expect(redirectRes.ok).toBe(false);
      if (!redirectRes.ok) {
        expect(redirectRes.reason).toBe("unavailable");
      }
      expect(fetchCalls[0]?.init?.redirect).toBe("manual");

      installFetchMock(() => makeJsonResponse(401, { message: "jwt expired" }));
      const unauthRes = await executeVerifikFetch(
        makeConfigService(),
        logger,
        "/v2/co/cedula/premium",
        { documentNumber: "1020304050" },
      );
      expect(unauthRes.ok).toBe(false);
      if (!unauthRes.ok) {
        expect(unauthRes.reason).toBe("unauthorized");
      }
    });

    it("rejects oversized upstream responses above 1 MiB", async () => {
      const logger = new Logger("VerifikFetchCapTest");
      installFetchMock(
        () =>
          new Response(
            JSON.stringify({ data: "x".repeat(MAX_VERIFIK_RESPONSE_BYTES) }),
            {
              status: 200,
              headers: {
                "content-type": "application/json",
                "content-length": String(MAX_VERIFIK_RESPONSE_BYTES + 100),
              },
            },
          ),
      );

      const res = await executeVerifikFetch(
        makeConfigService(),
        logger,
        "/v2/co/runt/vehicle-by-plate",
        { plate: "ABC12D" },
      );
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.reason).toBe("unavailable");
      }
    });
  });

  describe("verifik-runt.helpers (Official RUNT Response Shapes)", () => {
    it("parses official /v2/co/runt/vehicle-by-plate with cilidraje typo, SOAT & RTM", () => {
      const parsed = normalizeRuntVehicle(
        {
          informacionGeneral: {
            noPlaca: "XYZ98F",
            marca: "BMW",
            linea: "R 1250 GS",
            modelo: "2024",
            cilidraje: "1254",
            color: "NEGRO",
            tipoServicio: "PARTICULAR",
            clasificacion: "MOTOCICLETA",
            noMotor: "ENG998877",
            noChasis: "CHS112233",
            noVin: "WB10J9100R6123456",
          },
          soat: [
            {
              estado: "VIGENTE",
              noPoliza: "POL-555111",
              entidadExpideSoat: "SEGUROS MUNDIAL",
              fechaVigencia: "10/01/2026",
              fechaVencimiento: "09/01/2027",
            },
          ],
          tecnoMecanica: [
            {
              vigente: "SI",
              numeroCertificado: "RTM-777888",
              cdaExpide: "CDA BOGOTA NORTE",
              fechaExpedicion: "15/02/2026",
              fechaVigencia: "15/02/2027",
            },
          ],
        },
        "vfk-001",
        "FALLBACK",
      );

      expect(parsed.plate).toBe("XYZ98F");
      expect(parsed.brand).toBe("BMW");
      expect(parsed.modelLine).toBe("R 1250 GS");
      expect(parsed.year).toBe(2024);
      expect(parsed.displacementCc).toBe(1254);
      expect(parsed.engineNumber).toBe("ENG998877");
      expect(parsed.vinOrChassis).toBe("WB10J9100R6123456");
      expect(parsed.soat).toEqual({
        status: "VIGENTE",
        policyNumber: "POL-555111",
        insuranceCompany: "SEGUROS MUNDIAL",
        startDate: "2026-01-10",
        expiryDate: "2027-01-09",
      });
      expect(parsed.rtm).toEqual({
        status: "VIGENTE",
        certificateNumber: "RTM-777888",
        cdaName: "CDA BOGOTA NORTE",
        expeditionDate: "2026-02-15",
        expiryDate: "2027-02-15",
      });
    });

    it("parses /v2/co/runt/vehiculo basic & SOAT/techReview boolean variants", () => {
      const parsed = normalizeRuntVehicle(
        {
          vehicleInformation: {
            plate: "KTM45G",
            brand: "KTM",
            line: "890 ADVENTURE",
            model: "2023",
            cilindraje: "889",
          },
          soat: {
            valid: true,
            soatNumber: "SOAT-009",
            insuranceCompany: "SURA",
            coverageStartDate: "01/03/2026",
            dueDate: "01/03/2027",
          },
          techReview: {
            valid: false,
            reviewNumber: "REV-123",
            cdaName: "CDA CENTRO",
            dueDate: "01/01/2025",
          },
        },
        "vfk-002",
        "KTM45G",
      );

      expect(parsed.brand).toBe("KTM");
      expect(parsed.modelLine).toBe("890 ADVENTURE");
      expect(parsed.soat?.status).toBe("VIGENTE");
      expect(parsed.soat?.policyNumber).toBe("SOAT-009");
      expect(parsed.soat?.expiryDate).toBe("2027-03-01");
      expect(parsed.rtm?.status).toBe("VENCIDA");
      expect(parsed.rtm?.certificateNumber).toBe("REV-123");
    });

    it("enforces digits-only for CC/CE/PPT/PEP/NIT and alphanumeric for PA/CD", () => {
      expect(normalizeRuntDocumentNumber("CE", "CE-123.456")).toBe("123456");
      expect(normalizeRuntDocumentNumber("PPT", "0001234567")).toBe(
        "0001234567",
      );
      expect(normalizeRuntDocumentNumber("PA", "ab-98765")).toBe("AB98765");
    });
  });

  describe("verifik-diagnostic.helpers (SIMIT, Bogotá Tax, Fasecolda/SIBGA, Sinister, Driver)", () => {
    it("normalizes nested SIMIT value.value.data and Bogotá fines[]", () => {
      const simit = normalizeFines({
        value: {
          value: {
            data: {
              multas: [
                {
                  NúmeroComparendo: "110010000123",
                  valorPagar: "$650.000",
                  fechaComparendo: "2026-04-10",
                  organismoTransito: "BOGOTA",
                  infracciones: [
                    {
                      codigoInfraccion: "C29",
                      descripcionInfraccion: "Exceso de velocidad",
                    },
                  ],
                },
              ],
            },
          },
        },
      });
      expect(simit.totalFines).toBe(1);
      expect(simit.totalAmount).toBe(650000);
      expect(simit.fines[0]?.id).toBe("110010000123");
      expect(simit.fines[0]?.infractionCode).toBe("C29");

      const bogota = normalizeFines({
        fines: [
          {
            number: "99887766",
            type: "Comparendo",
            status: "Pendiente de pago",
            impositionDate: "2026-05-01",
            pendingBalance: 572600,
            impositionMedium: "Cámara salvavidas",
          },
        ],
      });
      expect(bogota.totalFines).toBe(1);
      expect(bogota.totalAmount).toBe(572600);
      expect(bogota.fines[0]?.id).toBe("99887766");
      expect(bogota.fines[0]?.authority).toBe(
        "Secretaría Distrital de Movilidad",
      );
    });

    it("parses Bogotá tax obligation.vehicle[] and NEVER fabricates AL_DIA on null", () => {
      expect(normalizeTaxes(null, "ABC12D").status).toBe("DESCONOCIDO");

      const overdue = normalizeTaxes(
        {
          obligation: {
            vehicle: [
              {
                obligationStatus: "Moroso",
                taxableYear: "2025",
                totalToPay: 420000,
              },
            ],
          },
        },
        "ABC12D",
      );
      expect(overdue.status).toBe("PENDIENTE");
      expect(overdue.pendingYears).toEqual(["2025"]);
      expect(overdue.totalAmount).toBe(420000);

      const clean = normalizeTaxes({ obligation: { vehicle: [] } }, "ABC12D");
      expect(clean.status).toBe("AL_DIA");
    });

    it("scales Fasecolda valueModel[] from thousands to COP and reads SIBGA commercialValue", () => {
      const val = normalizeValuation(
        {
          code: "01601234",
          valueModel: [
            { modelo: 2023, valor: 32500 },
            { modelo: 2024, valor: 36800 },
          ],
        },
        {
          period: 2026,
          valuation: { commercialValue: 35000000 },
        },
        "ABC12D",
        2024,
      );
      expect(val.fasecoldaCode).toBe("01601234");
      expect(val.fasecoldaValue).toBe(36_800_000);
      expect(val.sibgaValuation).toBe(35_000_000);
      expect(val.status).toBe("VERIFICADO");
    });

    it("parses Fasecolda singular sinister[] and NEVER fabricates LIMPIO on null", () => {
      expect(normalizeSinister(null, "ABC12D").status).toBe("DESCONOCIDO");

      const withHistory = normalizeSinister(
        {
          sinister: [
            {
              id: "SIN-1",
              accidentDate: "2025-07-12",
              protection: "Pérdida parcial daños",
            },
          ],
        },
        "ABC12D",
      );
      expect(withHistory.status).toBe("CON_HISTORIAL");
      expect(withHistory.sinisterCount).toBe(1);
      expect(withHistory.records[0]?.date).toBe("2025-07-12");
      expect(withHistory.records[0]?.type).toBe("Pérdida parcial daños");

      expect(normalizeSinister({ sinister: [] }, "ABC12D").status).toBe(
        "LIMPIO",
      );
    });

    it("normalizes official RUNT conductor licenses[]", () => {
      const lic = normalizeDriverLicense(
        {
          documentType: "CC",
          documentNumber: "1020304050",
          driverStatus: "ACTIVO",
          licenses: [
            {
              category: "A2",
              expeditionDate: "12/05/2018",
              dueDate: "12/05/2028",
              status: "ACTIVA",
            },
          ],
        },
        "CC",
        "1020304050",
      );
      expect(lic.status).toBe("ACTIVA");
      expect(lic.categories[0]?.category).toBe("A2");
      expect(lic.expiryDate).toBe("2028-05-12");
      expect(lic.expeditionDate).toBe("2018-05-12");
    });
  });

  describe("VerifikService (Billing Policy, Fallback Rules & Endpoints)", () => {
    it("calls /v2/co/runt/vehicle-by-plate first and does NOT double-bill on 404", async () => {
      const svc = new VerifikService(makeConfigService());
      installFetchMock(() =>
        makeJsonResponse(404, { code: "NotFound", message: "Not found" }),
      );

      const res = await svc.verifyRuntVehicle("CC", "1020304050", "ABC12D");
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.reason).toBe("not_found");
      }
      expect(fetchCalls).toHaveLength(1);
      expect(fetchCalls[0]?.url).toContain("/v2/co/runt/vehicle-by-plate?");
    });

    it("falls back to /v2/co/runt/vehiculo ONLY when primary returns unavailable (409 out-of-service / 5xx)", async () => {
      const svc = new VerifikService(makeConfigService());
      installFetchMock((url) => {
        if (url.includes("/v2/co/runt/vehicle-by-plate")) {
          return makeJsonResponse(409, {
            code: "Conflict",
            message: "Endpoint_out_of_service",
          });
        }
        return makeJsonResponse(200, {
          id: "vfk-fallback",
          data: {
            vehicle: {
              placa: "ABC12D",
              marca: "YAMAHA",
              linea: "MT-09",
              modelo: "2024",
              cilindraje: "890",
            },
          },
        });
      });

      const res = await svc.verifyRuntVehicle("CC", "1020304050", "ABC12D");
      expect(res.ok).toBe(true);
      expect(fetchCalls).toHaveLength(2);
      expect(fetchCalls[0]?.url).toContain("/v2/co/runt/vehicle-by-plate?");
      expect(fetchCalls[1]?.url).toContain("/v2/co/runt/vehiculo?");
    });

    it("rejects unsupported RUNT doc types without spending quota", async () => {
      const svc = new VerifikService(makeConfigService());
      installFetchMock(() => makeJsonResponse(200, { data: {} }));

      const res = await svc.verifyRuntVehicle("PPT", "1234567", "ABC12D");
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.reason).toBe("invalid_input");
      }
      expect(fetchCalls).toHaveLength(0);
    });

    it("uses /v2/co/simit/consultar/placa + /v2/co/bogota/vehicle/fines and returns DESCONOCIDO if both fail", async () => {
      const svc = new VerifikService(makeConfigService());
      installFetchMock(() =>
        makeJsonResponse(500, { message: "Internal error" }),
      );

      const res = await svc.getVehicleFines("ABC12D");
      expect(res.status).toBe("DESCONOCIDO");
      expect(fetchCalls).toHaveLength(2);
      expect(fetchCalls[0]?.url).toContain(
        "/v2/co/simit/consultar/placa?plate=ABC12D",
      );
      expect(fetchCalls[1]?.url).toContain(
        "/v2/co/bogota/vehicle/fines?plate=ABC12D",
      );
    });

    it("sends plate + documentType + documentNumber to /v2/co/bogota/vehicle/tax and skips call if doc unsupported", async () => {
      const svc = new VerifikService(makeConfigService());
      installFetchMock(() =>
        makeJsonResponse(200, { data: { obligation: { vehicle: [] } } }),
      );

      const skipped = await svc.getVehicleTaxes("ABC12D", "CE", "123456");
      expect(skipped.status).toBe("DESCONOCIDO");
      expect(fetchCalls).toHaveLength(0);

      const ok = await svc.getVehicleTaxes("ABC12D", "CC", "1020304050");
      expect(ok.status).toBe("AL_DIA");
      expect(fetchCalls).toHaveLength(1);
      expect(fetchCalls[0]?.url).toContain("/v2/co/bogota/vehicle/tax?");
      expect(fetchCalls[0]?.url).toContain("documentType=CC");
      expect(fetchCalls[0]?.url).toContain("documentNumber=1020304050");
    });

    it("uses Basic /v3/co/runt/conductor when primerApellido is provided and blocks PA without surname", async () => {
      const svc = new VerifikService(makeConfigService());
      installFetchMock(() =>
        makeJsonResponse(200, {
          data: {
            licenses: [
              {
                category: "A2",
                dueDate: "10/10/2030",
                status: "ACTIVA",
              },
            ],
          },
        }),
      );

      const paBlocked = await svc.getDriverLicense("PA", "AB12345");
      expect(paBlocked.status).toBe("DESCONOCIDO");
      expect(fetchCalls).toHaveLength(0);

      const v3 = await svc.getDriverLicense("CC", "1020304050", "PEREZ");
      expect(v3.status).toBe("ACTIVA");
      expect(fetchCalls[0]?.url).toContain("/v3/co/runt/conductor?");
      expect(fetchCalls[0]?.url).toContain("primerApellido=PEREZ");
    });

    it("classifies 409 out-of-service as unavailable vs 409 MissingParameter as invalid_input without leaking raw text", async () => {
      const svc = new VerifikService(makeConfigService());
      installFetchMock(() =>
        makeJsonResponse(409, {
          code: "Conflict",
          message: "Endpoint_out_of_service: internal_proxy_secret_leak",
        }),
      );

      const outRes = await svc.verifyCedulaPremium("1020304050");
      expect(outRes.ok).toBe(false);
      if (!outRes.ok) {
        expect(outRes.reason).toBe("unavailable");
        expect(outRes.message).not.toContain("internal_proxy_secret_leak");
      }

      installFetchMock(() =>
        makeJsonResponse(409, {
          code: "MissingParameter",
          message: "documentNumber invalid internal_secret",
        }),
      );

      const paramRes = await svc.verifyCedulaPremium("1020304050");
      expect(paramRes.ok).toBe(false);
      if (!paramRes.ok) {
        expect(paramRes.reason).toBe("invalid_input");
        expect(paramRes.message).not.toContain("internal_secret");
      }
    });
  });
});
