import { createHmac } from "node:crypto";
import { verifyTurnstileAttestation } from "./common/utils/turnstile.util";
import {
  isActiveMember,
  isActiveLegendMember,
} from "./common/utils/membership-access.util";
import { parsePositiveInt } from "./common/utils/pagination.util";
import { sanitizeQuery } from "./common/utils/sanitize-query.util";
import { UpdateProfileSectionDto } from "./profile/dto/update-profile-section.dto";
import { UpdateSettingsDto } from "./settings/dto/update-settings.dto";
import { assertChannelAuthorized } from "./bird/bird-realtime-auth.helpers";
import { BirdWhatsappService } from "./bird/bird-whatsapp.service";
import { BirdService } from "./bird/bird.service";
import { evaluateOriginAccess } from "./bootstrap/security";
import { AlliedWorkshopGuard } from "./garage/guards/allied-workshop.guard";
import { InternalEdgeSecretGuard } from "./common/guards/internal-edge-secret.guard";
import { ParseObjectIdPipe } from "./common/pipes/parse-object-id.pipe";
import type { ExecutionContext } from "@nestjs/common";

describe("Security Remediation Regression Suite (Ciclo 8)", () => {
  describe("H-01: Turnstile HMAC Attestation", () => {
    const secret = "test-turnstile-secret-key-32-chars-minimum";
    const prevSecret = process.env.TURNSTILE_SECRET_KEY;

    beforeAll(() => {
      process.env.TURNSTILE_SECRET_KEY = secret;
    });

    afterAll(() => {
      if (prevSecret === undefined) {
        delete process.env.TURNSTILE_SECRET_KEY;
      } else {
        process.env.TURNSTILE_SECRET_KEY = prevSecret;
      }
    });

    it("accepts a valid recent HMAC attestation", () => {
      const ts = String(Math.floor(Date.now() / 1000));
      const action = "contact";
      const ip = "203.0.113.10";
      const reqId = "11111111-1111-4111-8111-111111111111";
      const sig = createHmac("sha256", secret)
        .update(`${ts}:${action}:${ip}:${reqId}`)
        .digest("hex");
      expect(
        verifyTurnstileAttestation(`${ts}.${sig}`, action, ip, reqId),
      ).toBe(true);
    });

    it("rejects forged, replayed-expired, or malformed headers", () => {
      const action = "contact";
      const ip = "203.0.113.10";
      const reqId = "11111111-1111-4111-8111-111111111111";
      expect(verifyTurnstileAttestation("1", action, ip, reqId)).toBe(false);
      expect(verifyTurnstileAttestation(undefined, action, ip, reqId)).toBe(
        false,
      );
      const oldTs = String(Math.floor(Date.now() / 1000) - 120);
      const sig = createHmac("sha256", secret)
        .update(`${oldTs}:${action}:${ip}:${reqId}`)
        .digest("hex");
      expect(
        verifyTurnstileAttestation(`${oldTs}.${sig}`, action, ip, reqId),
      ).toBe(false);
    });
  });

  describe("M-01: Authoritative Active Membership Check", () => {
    const future = new Date(Date.now() + 86_400_000);
    const past = new Date(Date.now() - 86_400_000);

    it("accepts active non-expired member with future expiry", () => {
      expect(
        isActiveMember({
          role: "member",
          membershipLevel: "Legend",
          membershipExpired: false,
          membershipExpiryDate: future,
        }),
      ).toBe(true);
      expect(
        isActiveLegendMember({
          role: "member",
          membershipLevel: "Legend",
          membershipExpired: false,
          membershipExpiryDate: future,
        }),
      ).toBe(true);
    });

    it("rejects expired date even when membershipExpired flag is false", () => {
      expect(
        isActiveMember({
          role: "member",
          membershipLevel: "Legend",
          membershipExpired: false,
          membershipExpiryDate: past,
        }),
      ).toBe(false);
    });

    it("rejects missing expiry date or non-member role", () => {
      expect(
        isActiveMember({
          role: "user",
          membershipLevel: "Legend",
          membershipExpired: false,
          membershipExpiryDate: future,
        }),
      ).toBe(false);
      expect(
        isActiveMember({
          role: "member",
          membershipLevel: "Legend",
          membershipExpired: false,
          membershipExpiryDate: null,
        }),
      ).toBe(false);
    });

    it("accepts staff/superadmin accounts that hold an active non-expired club membership", () => {
      expect(
        isActiveLegendMember({
          role: "superadmin",
          membershipLevel: "Legend",
          membershipExpired: false,
          membershipExpiryDate: future,
        }),
      ).toBe(true);
      expect(
        isActiveMember({
          role: "superadmin",
          membershipLevel: null,
          membershipExpired: false,
          membershipExpiryDate: future,
        }),
      ).toBe(false);
    });
  });

  describe("M-11: Safe Pagination Parsing", () => {
    it("prevents NaN bypasses and clamps bounds", () => {
      expect(parsePositiveInt("abc", 20, 100)).toBe(20);
      expect(parsePositiveInt(Number.NaN, 20, 100)).toBe(20);
      expect(parsePositiveInt("0", 20, 100)).toBe(20);
      expect(parsePositiveInt("-5", 20, 100)).toBe(20);
      expect(parsePositiveInt("99999", 20, 100)).toBe(100);
      expect(parsePositiveInt("15", 20, 100)).toBe(15);
    });
  });

  describe("M-04 / F-07 / L-08: Sanitization & Forbidden Fields", () => {
    it("strips MongoDB $ operators inside nested arrays", () => {
      const cleaned = sanitizeQuery({
        tags: [{ $gt: "" }, { safe: "ok" }],
        $where: "1==1",
      });
      expect(cleaned).toEqual({ tags: [{}, { safe: "ok" }] });
    });

    it("strips correoInstitucional and RUNT verification forgery fields from profile DTO", () => {
      const contacto = UpdateProfileSectionDto.sanitize(
        { celular: "3001234567", correoInstitucional: "admin@bskmt.com" },
        "contacto",
      );
      expect(contacto.correoInstitucional).toBeUndefined();

      const moto = UpdateProfileSectionDto.sanitize(
        { placaMoto: "ABC12D", verificadaRunt: "true", estadoRunt: "ACTIVO" },
        "motocicleta",
      );
      expect(moto.verificadaRunt).toBeUndefined();
      expect(moto.estadoRunt).toBeUndefined();
    });

    it("strips $ and dot-notation keys from UpdateSettingsDto", () => {
      const sanitized = UpdateSettingsDto.sanitize(
        {
          channels: { $ne: true, "a.b": "x", email: true },
        },
        "notifications",
      );
      expect(sanitized).toEqual({ channels: { email: true } });
    });
  });

  describe("M-12 / M-09: Bird Channel Auth & WhatsApp Recipient Validation", () => {
    it("requires support/* permission and console/superadmin authPortal for admin realtime channels", () => {
      expect(() =>
        assertChannelAuthorized(
          "private-admin-tickets",
          "ba1",
          "u1",
          "admin",
          ["shop"],
          "console",
        ),
      ).toThrow();
      expect(() =>
        assertChannelAuthorized(
          "private-admin-tickets",
          "ba1",
          "u1",
          "superadmin",
          [],
          "standard",
        ),
      ).toThrow();
      expect(() =>
        assertChannelAuthorized(
          "private-admin-tickets",
          "ba1",
          "u1",
          "admin",
          ["support"],
          "console",
        ),
      ).not.toThrow();
      expect(() =>
        assertChannelAuthorized(
          "private-admin-tickets",
          "ba1",
          "u1",
          "superadmin",
          [],
          "superadmin",
        ),
      ).not.toThrow();
    });

    it("rejects non-+57 digit-only phone numbers in WhatsApp recipient check", () => {
      const svc = new BirdWhatsappService({
        isConfigured: () => false,
      } as unknown as BirdService);
      expect(svc.isValidRecipient("+573001234567")).toBe(true);
      expect(svc.isValidRecipient("+14155551234")).toBe(false);
      expect(svc.isValidRecipient("14155551234")).toBe(false);
      expect(svc.isValidRecipient("CO.123456789")).toBe(true);
      expect(svc.isValidRecipient("wag_abc123")).toBe(true);
    });
  });

  describe("VULN-17 & Auth-Before-Validation: Origin Secret & AlliedWorkshopGuard", () => {
    it("accepts both X-BSKMT-Origin-Secret (Cloudflare Transform Rule) and X-CF-Origin-Secret (Workers)", () => {
      const secret = "a".repeat(64);
      expect(
        evaluateOriginAccess(
          { headers: { "x-bskmt-origin-secret": secret }, path: "/api/events" },
          secret,
          true,
        ),
      ).toEqual({ allowed: true, verified: true });
      expect(
        evaluateOriginAccess(
          { headers: { "x-cf-origin-secret": secret }, path: "/api/events" },
          secret,
          true,
        ),
      ).toEqual({ allowed: true, verified: true });
      expect(
        evaluateOriginAccess(
          { headers: {}, path: "/api/events" },
          secret,
          true,
        ),
      ).toEqual({ allowed: false, verified: false });
      expect(
        evaluateOriginAccess({ headers: {}, path: "/health" }, secret, true),
      ).toEqual({ allowed: true, verified: false });
    });

    it("rejects unauthenticated allied workshop requests in Guard before DTO validation", () => {
      const guard = new AlliedWorkshopGuard();
      const prev = process.env.ALLIED_WORKSHOP_TOKENS;
      const mkCtx = (headers: Record<string, string>, body: unknown) =>
        ({
          switchToHttp: () => ({
            getRequest: () => ({ headers, body }),
          }),
        }) as unknown as ExecutionContext;
      try {
        delete process.env.ALLIED_WORKSHOP_TOKENS;
        expect(() => guard.canActivate(mkCtx({}, {}))).toThrow();

        process.env.ALLIED_WORKSHOP_TOKENS = "tok_secret_123456:TallerBsk";
        expect(() => guard.canActivate(mkCtx({}, {}))).toThrow();
        expect(() =>
          guard.canActivate(mkCtx({ "x-workshop-token": "wrong" }, {})),
        ).toThrow();
        expect(
          guard.canActivate(
            mkCtx({ "x-workshop-token": "tok_secret_123456" }, {}),
          ),
        ).toBe(true);
        expect(
          guard.canActivate(
            mkCtx({}, { workshopAuthToken: "tok_secret_123456" }),
          ),
        ).toBe(true);
      } finally {
        if (prev === undefined) delete process.env.ALLIED_WORKSHOP_TOKENS;
        else process.env.ALLIED_WORKSHOP_TOKENS = prev;
      }
    });

    it("rejects unauthenticated internal edge batch requests before DTO validation", () => {
      const guard = new InternalEdgeSecretGuard();
      const prev = process.env.INTERNAL_EDGE_SECRET;
      const mkCtx = (headers: Record<string, string>) =>
        ({
          switchToHttp: () => ({
            getRequest: () => ({ headers }),
          }),
        }) as unknown as ExecutionContext;
      try {
        delete process.env.INTERNAL_EDGE_SECRET;
        expect(() => guard.canActivate(mkCtx({}))).toThrow();

        process.env.INTERNAL_EDGE_SECRET = "edge_secret_32_bytes_minimum_value";
        expect(() => guard.canActivate(mkCtx({}))).toThrow();
        expect(() =>
          guard.canActivate(mkCtx({ "x-edge-secret": "wrong" })),
        ).toThrow();
        expect(
          guard.canActivate(
            mkCtx({ "x-edge-secret": "edge_secret_32_bytes_minimum_value" }),
          ),
        ).toBe(true);
      } finally {
        if (prev === undefined) delete process.env.INTERNAL_EDGE_SECRET;
        else process.env.INTERNAL_EDGE_SECRET = prev;
      }
    });

    it("rejects 12-char non-hex strings in ParseObjectIdPipe", () => {
      const pipe = new ParseObjectIdPipe();
      expect(() => pipe.transform("123456789012")).toThrow();
      expect(() => pipe.transform("../etc/passw")).toThrow();
      expect(pipe.transform("507f1f77bcf86cd799439011")).toBe(
        "507f1f77bcf86cd799439011",
      );
    });
  });
});
