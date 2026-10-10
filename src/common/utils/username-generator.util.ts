import { randomInt } from "node:crypto";

/**
 * Normalizes text to ASCII lowercase without accents or special characters.
 */
function normalizeAscii(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

export interface GeneratedBskmtUsername {
  username: string;
  last4Digits: string;
  initials: string;
  internalCode: string;
}

/**
 * Generates an internal BSKMT username based on the official specification:
 *   bskmt + 4 últimos dígitos de la cédula + iniciales del nombre completo + código interno de 7 dígitos aleatorio
 *
 * Example:
 *   Nombres: "James Andres", Apellidos: "Cespedes Ibarra", Cédula: "1031165404"
 *   -> "bskmt5404jaci" + 7 dígitos aleatorios (ej. "bskmt5404jaci1849204")
 */
export function generateBskmtUsername(
  cedula: string,
  nombres: string,
  apellidos: string,
  explicitInternalCode?: string,
): GeneratedBskmtUsername {
  // 1. Extraer los últimos 4 dígitos de la cédula
  const digitsOnly = cedula.replace(/\D/g, "");
  const last4Digits =
    digitsOnly.length >= 4 ? digitsOnly.slice(-4) : digitsOnly.padStart(4, "0");

  // 2. Extraer las iniciales del nombre completo en minúscula
  const cleanNombres = normalizeAscii(nombres);
  const cleanApellidos = normalizeAscii(apellidos);

  const words = [
    ...cleanNombres.split(/\s+/),
    ...cleanApellidos.split(/\s+/),
  ].filter((w) => w.length > 0);

  const initials = words.map((w) => w[0]).join("");

  // 3. Código interno de 7 dígitos aleatorio (o el explícito si se provee)
  const internalCode =
    explicitInternalCode && /^\d{7}$/.test(explicitInternalCode)
      ? explicitInternalCode
      : String(randomInt(1000000, 10000000));

  const username = `bskmt${last4Digits}${initials}${internalCode}`;

  return {
    username,
    last4Digits,
    initials,
    internalCode,
  };
}
