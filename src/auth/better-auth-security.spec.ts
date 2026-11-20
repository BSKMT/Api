import { Logger } from "@nestjs/common";
import type { Request } from "express";
import type { Db } from "mongodb";
import type { Model } from "mongoose";
import {
  extractAllSessionTokensFromSetCookies,
  extractSessionTokenFromCookieHeader,
  extractSessionTokenFromSetCookies,
  hasSessionTokenCookie,
  rewriteSessionSetCookieMaxAge,
  safeDecodeCookieValue,
} from "./better-auth-cookie.helper";
import {
  ANDROID_APP_PASSKEY_ORIGIN,
  getPasskeyOrigins,
  getTrustedOrigins,
} from "./better-auth-config.helpers";
import { ensureBetterAuthIndexesAndMigrations } from "./better-auth-db.helpers";
import { createBetterAuthHooks } from "./better-auth-hooks";
import {
  findAndValidateConsoleUser,
  findAndValidateFasciaUser,
  findAndValidateSuperAdminUser,
} from "./login-otp-portals.helper";
import { applyVerifiedCloudflareIp } from "../bootstrap/security";
import { SENSITIVE_AUTH_PATHS } from "../bootstrap/auth-handler";
import { VERIFIED_CLIENT_IP_HEADER } from "./better-auth";
import type { UserDocument } from "../users/schemas/user.schema";
import type { BetterAuthSession } from "./better-auth.types";

describe("Better Auth Security & Quality Remediation Suite", () => {
  describe("Safe Better Auth cookie parsing and Max-Age rewriting", () => {
    it("decodes valid URL-encoded cookies and never throws URIError on malformed percent sequences", () => {
      expect(safeDecodeCookieValue("tok123.sig%3D%3D")).toBe("tok123.sig==");
      expect(safeDecodeCookieValue("tok123.%ZZ%2")).toBe("tok123.%ZZ%2");
      expect(
        extractSessionTokenFromCookieHeader(
          "__Secure-better-auth.session_token=abc123.%ZZ; other=1",
        ),
      ).toBe("abc123");
    });

    it("matches session token cookies strictly by exact cookie name", () => {
      expect(hasSessionTokenCookie("better-auth.session_token=tok.sig")).toBe(
        true,
      );
      expect(
        hasSessionTokenCookie(
          "foo=bar; __Secure-better-auth.session_token=tok.sig",
        ),
      ).toBe(true);
      expect(
        hasSessionTokenCookie("evil_better-auth.session_token=tok.sig"),
      ).toBe(false);
      expect(hasSessionTokenCookie("better-auth.session_token=")).toBe(false);
    });

    it("extracts session tokens safely from Set-Cookie arrays", () => {
      const headers = [
        "bskmt.csrf=csrf_val; Path=/",
        "__Secure-better-auth.session_token=rawtok_1.sig%3D; Path=/; HttpOnly; Secure; Max-Age=604800",
        "better-auth.session_token=rawtok_2.%ZZ; Path=/",
      ];
      expect(extractSessionTokenFromSetCookies(headers)).toBe("rawtok_1");
      expect(extractAllSessionTokensFromSetCookies(headers)).toEqual([
        "rawtok_1",
        "rawtok_2",
      ]);
    });

    it("caps privileged session Max-Age and strips Max-Age/Expires when rememberMe=false", () => {
      const headers = [
        "__Secure-better-auth.session_token=tok.sig; Path=/; HttpOnly; Secure; Max-Age=604800; Expires=Wed, 27 Nov 2026 00:00:00 GMT",
        "bskmt.csrf=csrf_1; Path=/; Max-Age=604800",
      ];

      const capped = rewriteSessionSetCookieMaxAge(headers, 86400);
      expect(capped[0]).toContain("Max-Age=86400");
      expect(capped[0]).not.toContain("Max-Age=604800");
      expect(capped[0]).not.toContain("Expires=");
      expect(capped[1]).toBe(headers[1]);

      const ephemeral = rewriteSessionSetCookieMaxAge(headers, undefined);
      expect(ephemeral[0]).not.toContain("Max-Age=");
      expect(ephemeral[0]).not.toContain("Expires=");
      expect(ephemeral[1]).toBe(headers[1]);
    });
  });

  describe("Passkey & Trusted Origins configuration", () => {
    const prevNodeEnv = process.env.NODE_ENV;
    const prevExtra = process.env.PASSKEY_EXTRA_ORIGINS;

    afterEach(() => {
      process.env.NODE_ENV = prevNodeEnv;
      if (prevExtra === undefined) delete process.env.PASSKEY_EXTRA_ORIGINS;
      else process.env.PASSKEY_EXTRA_ORIGINS = prevExtra;
    });

    it("includes Android app origin and www.bskmt.com and validates PASSKEY_EXTRA_ORIGINS in prod", () => {
      process.env.NODE_ENV = "production";
      process.env.PASSKEY_EXTRA_ORIGINS =
        "https://staging.bskmt.com, http://evil.example.com, android:apk-key-hash:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

      const passkeyOrigins = getPasskeyOrigins();
      expect(passkeyOrigins).toContain("https://www.bskmt.com");
      expect(passkeyOrigins).toContain(ANDROID_APP_PASSKEY_ORIGIN);
      expect(passkeyOrigins).toContain("https://staging.bskmt.com");
      expect(passkeyOrigins).toContain(
        "android:apk-key-hash:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      );
      expect(passkeyOrigins).not.toContain("http://evil.example.com");

      const trusted = getTrustedOrigins();
      expect(trusted).toContain("https://www.bskmt.com");
      expect(trusted).not.toContain("http://localhost:3000");
    });
  });

  describe("Better Auth 1.7.3+ MongoDB index cleanup and rateLimit indexes", () => {
    it("drops obsolete account_issuer_accountId_uidx idempotently without backfilling issuer", async () => {
      const dropIndex = jest.fn().mockRejectedValue({ code: 27 });
      const updateMany = jest.fn();
      const createIndex = jest.fn().mockResolvedValue("ok");

      const mockDb = {
        collection: jest.fn((name: string) => {
          if (name === "account") {
            return { dropIndex, updateMany };
          }
          return { createIndex };
        }),
      } as unknown as Db;

      const warn = jest.fn();
      const logger = {
        log: jest.fn(),
        warn,
        error: jest.fn(),
      } as unknown as Logger;

      await ensureBetterAuthIndexesAndMigrations(mockDb, logger);

      expect(dropIndex).toHaveBeenCalledWith("account_issuer_accountId_uidx");
      expect(updateMany).not.toHaveBeenCalled();
      expect(createIndex).toHaveBeenCalledWith(
        { key: 1 },
        { unique: true, background: true },
      );
      expect(createIndex).toHaveBeenCalledWith(
        { lastRequest: 1 },
        { background: true },
      );
      expect(warn).not.toHaveBeenCalled();
    });
  });

  describe("Database hooks fail-closed OTP & APIError semantics", () => {
    class MockApiError extends Error {
      constructor(
        public readonly status: string,
        public readonly body?: { message?: string },
      ) {
        super(body?.message ?? status);
      }
    }

    it("throws structured APIError(BAD_REQUEST) for disallowed email domains", () => {
      const mockDb = {
        collection: jest.fn(),
      } as unknown as Db;
      const logger = {
        log: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
      } as unknown as Logger;

      const hooks = createBetterAuthHooks(
        mockDb,
        logger,
        undefined,
        MockApiError,
      );

      expect(() =>
        hooks.user.create.before({
          id: "u1",
          email: "pilot@disposable-mail.xyz",
          emailVerified: false,
          name: "Pilot",
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
      ).toThrow(MockApiError);
    });

    it("marks non-staff /sign-in/email sessions otpPending=true atomically and aborts staff passkey sessions", async () => {
      const findOne = jest
        .fn()
        .mockResolvedValueOnce({ role: "member", subrol: null })
        .mockResolvedValueOnce({ role: "admin", subrol: null });

      const mockDb = {
        collection: jest.fn(() => ({ findOne })),
      } as unknown as Db;
      const logger = {
        log: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
      } as unknown as Logger;

      const hooks = createBetterAuthHooks(mockDb, logger);
      const baseSession: BetterAuthSession = {
        id: "s1",
        token: "tok1",
        expiresAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
        userId: "ba1",
      };

      const memberResult = await hooks.session.create.before(baseSession, {
        path: "/sign-in/email",
      });
      expect(memberResult).toEqual({
        data: expect.objectContaining({
          otpPending: true,
        }) as BetterAuthSession,
      });

      const staffPasskeyResult = await hooks.session.create.before(
        baseSession,
        {
          path: "/passkey/verify-authentication",
        },
      );
      expect(staffPasskeyResult).toBe(false);
    });
  });

  describe("Constant-time staff portal login candidate lookup (anti-enumeration)", () => {
    const mockUserModel = {
      findOne: jest.fn(() => ({ lean: jest.fn().mockResolvedValue(null) })),
    } as unknown as Model<UserDocument>;
    const logger = {
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    } as unknown as Logger;

    it("returns ineligible dummy candidate instead of throwing early when staff account does not exist", async () => {
      const fascia = await findAndValidateFasciaUser(
        mockUserModel,
        "unknown_staff",
        logger,
      );
      expect(fascia.isEligible).toBe(false);
      expect(fascia.authEmail).toContain("@invalid.bskmt.local");

      const consoleCandidate = await findAndValidateConsoleUser(
        mockUserModel,
        "nobody@bskmt.com",
        "unknown_admin",
        logger,
      );
      expect(consoleCandidate.isEligible).toBe(false);
      expect(consoleCandidate.authEmail).toContain("@invalid.bskmt.local");

      const superCandidate = await findAndValidateSuperAdminUser(
        mockUserModel,
        "nobody@bskmt.com",
        "unknown_super",
        logger,
      );
      expect(superCandidate.isEligible).toBe(false);
      expect(superCandidate.authEmail).toContain("@invalid.bskmt.local");
    });
  });

  describe("Verified client IP header injection and sensitive auth paths", () => {
    it("overwrites spoofed x-bskmt-client-ip and strips untrusted cf-connecting-ip", () => {
      const untrustedReq = {
        headers: {
          [VERIFIED_CLIENT_IP_HEADER]: "1.2.3.4",
          "cf-connecting-ip": "5.6.7.8",
        },
        ip: "198.51.100.10",
        socket: { remoteAddress: "198.51.100.10" },
      } as unknown as Request;

      const untrustedResolved = applyVerifiedCloudflareIp(untrustedReq, false);
      expect(untrustedResolved).toBe("198.51.100.10");
      expect(untrustedReq.headers["cf-connecting-ip"]).toBeUndefined();
      expect(untrustedReq.headers[VERIFIED_CLIENT_IP_HEADER]).toBe(
        "198.51.100.10",
      );

      const trustedReq = {
        headers: {
          [VERIFIED_CLIENT_IP_HEADER]: "1.2.3.4",
          "cf-connecting-ip": "203.0.113.42",
        },
        ip: "198.51.100.10",
        socket: { remoteAddress: "198.51.100.10" },
      } as unknown as Request;

      const trustedResolved = applyVerifiedCloudflareIp(trustedReq, true);
      expect(trustedResolved).toBe("203.0.113.42");
      expect(trustedReq.headers[VERIFIED_CLIENT_IP_HEADER]).toBe(
        "203.0.113.42",
      );
    });

    it("covers passkey registration, email verification, and all 2FA routes in SENSITIVE_AUTH_PATHS", () => {
      expect(SENSITIVE_AUTH_PATHS.has("/verify-email")).toBe(true);
      expect(
        SENSITIVE_AUTH_PATHS.has("/passkey/generate-register-options"),
      ).toBe(true);
      expect(SENSITIVE_AUTH_PATHS.has("/passkey/verify-registration")).toBe(
        true,
      );
      expect(SENSITIVE_AUTH_PATHS.has("/two-factor/verify-backup-code")).toBe(
        true,
      );
      expect(SENSITIVE_AUTH_PATHS.has("/two-factor/enable")).toBe(true);
      expect(SENSITIVE_AUTH_PATHS.has("/two-factor/disable")).toBe(true);
      expect(SENSITIVE_AUTH_PATHS.has("/two-factor/send-otp")).toBe(true);
    });
  });
});
