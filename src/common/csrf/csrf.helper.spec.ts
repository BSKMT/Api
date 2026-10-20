import { describe, it, expect } from "@jest/globals";
import {
  generateCsrfToken,
  verifyCsrfToken,
  validateDoubleSubmitCsrf,
} from "./csrf.helper";

describe("CsrfHelper (NIST CSF 2.0 PR.PS-06)", () => {
  const secret = "test-secret-at-least-32-chars-long-for-hmac!";

  it("genera un token con formato random.hmac_signature", () => {
    const token = generateCsrfToken(secret);
    expect(typeof token).toBe("string");
    expect(token.includes(".")).toBe(true);
    const [raw, sig] = token.split(".");
    expect(raw).toHaveLength(48);
    expect(sig).toHaveLength(64);
  });

  it("verifica exitosamente un token legítimo", () => {
    const token = generateCsrfToken(secret);
    expect(verifyCsrfToken(token, secret)).toBe(true);
  });

  it("rechaza tokens manipulados o alterados", () => {
    const token = generateCsrfToken(secret);
    const tampered = token.slice(0, -4) + "0000";
    expect(verifyCsrfToken(tampered, secret)).toBe(false);
  });

  it("rechaza tokens firmados con una clave diferente", () => {
    const token = generateCsrfToken("another-secret-key-32-characters!!");
    expect(verifyCsrfToken(token, secret)).toBe(false);
  });

  it("rechaza tokens malformados, vacíos o nulos", () => {
    expect(verifyCsrfToken("", secret)).toBe(false);
    expect(verifyCsrfToken(undefined, secret)).toBe(false);
    expect(verifyCsrfToken("no-dots-here", secret)).toBe(false);
    expect(verifyCsrfToken(".only-dot", secret)).toBe(false);
    expect(verifyCsrfToken("ends-with-dot.", secret)).toBe(false);
  });

  it("valida exitosamente el patrón Double Submit Cookie cuando header y cookie coinciden", () => {
    const token = generateCsrfToken(secret);
    expect(validateDoubleSubmitCsrf(token, token, secret)).toBe(true);
  });

  it("rechaza Double Submit Cookie si el token en header no coincide con la cookie", () => {
    const tokenHeader = generateCsrfToken(secret);
    const tokenCookie = generateCsrfToken(secret);
    expect(validateDoubleSubmitCsrf(tokenHeader, tokenCookie, secret)).toBe(
      false,
    );
  });

  it("rechaza Double Submit Cookie si falta el header o la cookie", () => {
    const token = generateCsrfToken(secret);
    expect(validateDoubleSubmitCsrf(undefined, token, secret)).toBe(false);
    expect(validateDoubleSubmitCsrf(token, undefined, secret)).toBe(false);
  });
});
