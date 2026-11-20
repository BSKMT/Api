export const USER_ADDITIONAL_FIELDS = {
  role: {
    type: "string",
    defaultValue: "user",
    input: false,
    required: false,
  },
  username: {
    type: "string",
    defaultValue: "",
    input: true,
    required: false,
  },
  primerNombre: {
    type: "string",
    defaultValue: "",
    input: true,
    required: false,
  },
  segundoNombre: {
    type: "string",
    defaultValue: "",
    input: true,
    required: false,
  },
  primerApellido: {
    type: "string",
    defaultValue: "",
    input: true,
    required: false,
  },
  segundoApellido: {
    type: "string",
    defaultValue: "",
    input: true,
    required: false,
  },
  country: {
    type: "string",
    defaultValue: "",
    input: true,
    required: false,
  },
  birthDate: {
    type: "string",
    defaultValue: "",
    input: true,
    required: false,
  },
} as const;

export const SESSION_ADDITIONAL_FIELDS = {
  otpPending: {
    type: "boolean",
    defaultValue: false,
    input: false,
    required: false,
  },
} as const;

/**
 * Origen WebAuthn derivado del certificado SHA-256 oficial de `com.bskmt.app`
 * publicado en `/.well-known/assetlinks.json`.
 */
export const ANDROID_APP_PASSKEY_ORIGIN =
  "android:apk-key-hash:XYhIcAkghTM_KBoaDvInR-Gqc9LqtWBML119DLBRBUs";

const ANDROID_ORIGIN_REGEX = /^android:apk-key-hash:[A-Za-z0-9_-]{43}$/;

function parseExtraPasskeyOrigins(isProduction: boolean): string[] {
  const raw = process.env.PASSKEY_EXTRA_ORIGINS?.trim();
  if (!raw) return [];
  const origins: string[] = [];
  for (const entry of raw.split(",")) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    if (ANDROID_ORIGIN_REGEX.test(trimmed)) {
      origins.push(trimmed);
      continue;
    }
    try {
      const parsed = new URL(trimmed);
      if (isProduction) {
        if (
          parsed.protocol === "https:" &&
          parsed.hostname !== "localhost" &&
          parsed.hostname !== "127.0.0.1"
        ) {
          origins.push(parsed.origin);
        }
      } else if (
        parsed.protocol === "https:" ||
        (parsed.protocol === "http:" &&
          (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1"))
      ) {
        origins.push(parsed.origin);
      }
    } catch {
      // Ignorar entradas malformadas
    }
  }
  return origins;
}

export function getTrustedOrigins(): string[] {
  const productionOrigins = [
    "https://bskmt.com",
    "https://www.bskmt.com",
    "https://dash.bskmt.com",
    "https://console.bskmt.com",
    "https://panel.bskmt.com",
    "https://super.bskmt.com",
  ];
  if (process.env.NODE_ENV === "production") {
    return productionOrigins;
  }
  return [
    ...productionOrigins,
    "http://localhost:3000",
    "http://localhost:4321",
    "http://localhost:4322",
    "http://localhost:4323",
    "http://localhost:4324",
    "http://localhost:4325",
  ];
}

export function getPasskeyOrigins(): string[] {
  const isProduction = process.env.NODE_ENV === "production";
  const baseOrigins = [
    ...getTrustedOrigins(),
    ANDROID_APP_PASSKEY_ORIGIN,
    ...parseExtraPasskeyOrigins(isProduction),
  ];
  return Array.from(new Set(baseOrigins));
}
