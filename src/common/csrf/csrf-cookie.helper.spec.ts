import { describe, it, expect, afterEach } from "@jest/globals";
import type { CookieOptions } from "express";
import {
  CSRF_COOKIE_NAME,
  CSRF_COOKIE_MAX_AGE_MS,
  resolveCsrfSecret,
  issueCsrfCookie,
  extractCsrfCookieTokens,
} from "./csrf-cookie.helper";
import { generateCsrfToken, validateDoubleSubmitCsrf } from "./csrf.helper";

describe("CsrfCookieHelper", () => {
  const origNodeEnv = process.env.NODE_ENV;
  const origCsrfSecret = process.env.CSRF_SECRET;
  const origAuthSecret = process.env.BETTER_AUTH_SECRET;

  afterEach(() => {
    process.env.NODE_ENV = origNodeEnv;
    process.env.CSRF_SECRET = origCsrfSecret;
    process.env.BETTER_AUTH_SECRET = origAuthSecret;
  });

  it("prioriza CSRF_SECRET y falla en producción sin secretos configurados", () => {
    process.env.NODE_ENV = "production";
    delete process.env.CSRF_SECRET;
    delete process.env.BETTER_AUTH_SECRET;
    expect(() => resolveCsrfSecret()).toThrow(
      "CSRF_SECRET or BETTER_AUTH_SECRET is required in production",
    );
    expect(resolveCsrfSecret("cfg-secret", "auth-secret")).toBe("cfg-secret");
    expect(resolveCsrfSecret(undefined, "auth-secret")).toBe("auth-secret");
  });

  it("fija cookie bskmt.csrf accesible por JS y retorna el token emitido", () => {
    process.env.NODE_ENV = "production";
    const calls: Array<{ name: string; value: string; options: unknown }> = [];
    const mockRes = {
      cookie: (name: string, value: string, options: CookieOptions) => {
        calls.push({ name, value, options });
        return mockRes;
      },
    };
    const secret = "unit-test-csrf-secret-at-least-32-chars!!";
    const token = issueCsrfCookie(mockRes, secret);

    expect(calls).toHaveLength(1);
    expect(calls[0].name).toBe(CSRF_COOKIE_NAME);
    expect(calls[0].value).toBe(token);
    expect(calls[0].options).toEqual({
      httpOnly: false,
      secure: true,
      sameSite: "lax",
      domain: ".bskmt.com",
      path: "/",
      maxAge: CSRF_COOKIE_MAX_AGE_MS,
    });
    expect(validateDoubleSubmitCsrf(token, token, secret)).toBe(true);
  });

  it("extrae múltiples cookies bskmt.csrf e ignora codificación porcentual malformada sin lanzar excepción", () => {
    const t1 = generateCsrfToken("unit-test-csrf-secret-at-least-32-chars!!");
    const t2 = generateCsrfToken("unit-test-csrf-secret-at-least-32-chars!!");
    const rawHeader = `better-auth.session_token=abc; bskmt.csrf=%ZZbad; bskmt.csrf=${encodeURIComponent(t1)}; bskmt.csrf=${t2}`;

    const parsed = extractCsrfCookieTokens(rawHeader);
    expect(parsed.hasCookieEntry).toBe(true);
    expect(parsed.tokens).toEqual([t1, t2]);
  });

  it("indica hasCookieEntry=true incluso si la única cookie bskmt.csrf está malformada (fail-closed)", () => {
    const parsed = extractCsrfCookieTokens("bskmt.csrf=%E0%A4%A");
    expect(parsed.hasCookieEntry).toBe(true);
    expect(parsed.tokens).toEqual([]);
  });
});
