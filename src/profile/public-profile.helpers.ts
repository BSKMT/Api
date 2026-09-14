import type { Request } from "express";
import { getAuth } from "../auth/better-auth";

/**
 * Extracts the userId from the Better Auth session cookie if present.
 */
export async function getUserIdFromSession(
  req: Request,
): Promise<string | null> {
  const cookieHeader = req.headers.cookie ?? "";
  if (!cookieHeader) return null;
  if (!cookieHeader.includes("better-auth.session_token")) return null;
  try {
    const auth = await getAuth();
    const headers = new Headers();
    headers.set("cookie", cookieHeader);
    const session = await auth.api.getSession({ headers });
    return session?.user?.id ?? null;
  } catch {
    return null;
  }
}

/**
 * Derives a display name from the profile's datos-personales section.
 */
export function deriveDisplayName(
  profile: Record<string, Record<string, unknown>>,
  email: string,
): string {
  const personal = profile["datos-personales"] ?? {};
  const primerNombre = personal.primerNombre as string | undefined;
  const primerApellido = personal.primerApellido as string | undefined;
  if (primerNombre && primerApellido)
    return `${primerNombre} ${primerApellido}`;
  if (primerNombre) return primerNombre;
  if (primerApellido) return primerApellido;
  return email ? email.split("@")[0] : "Piloto";
}

/**
 * Reads a boolean privacy flag from user's settings.
 */
export function privacyFlag(
  user: Record<string, unknown>,
  key: string,
  fallback: boolean,
): boolean {
  const settings = user.settings as Record<string, unknown> | undefined;
  const privacy = settings?.privacy as Record<string, boolean> | undefined;
  if (privacy && typeof privacy[key] === "boolean") return privacy[key];
  return fallback;
}

export function str(
  section: Record<string, unknown> | undefined,
  field: string,
): string {
  const v = section?.[field];
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  return "";
}

export function num(
  section: Record<string, unknown> | undefined,
  field: string,
): number | null {
  const v = section?.[field];
  return typeof v === "number" ? v : null;
}

export function buildPrivacyFlags(user: unknown) {
  const record = user as Record<string, unknown>;
  return {
    profileVisible: privacyFlag(record, "profileVisible", true),
    showLocation: privacyFlag(record, "showLocation", true),
    allowFriendRequests: privacyFlag(record, "allowFriendRequests", false),
    shareStats: privacyFlag(record, "shareStats", true),
    showMotorcycle: privacyFlag(record, "showMotorcycle", true),
  };
}

export function buildOptionalSections(
  profile: Record<string, Record<string, unknown>>,
  privacy: ReturnType<typeof buildPrivacyFlags>,
  isOwner: boolean,
): Record<string, unknown> {
  const sections: Record<string, unknown> = {};

  if (isOwner || privacy.showMotorcycle) {
    const moto = profile["motocicleta"];
    sections["motorcycle"] = moto
      ? {
          marcaMoto: str(moto, "marcaMoto"),
          lineaMoto: str(moto, "lineaMoto"),
          anioMoto: num(moto, "anioMoto"),
          cilindraje: num(moto, "cilindraje"),
          colorMoto: str(moto, "colorMoto"),
          tipoMoto: str(moto, "tipoMoto"),
        }
      : null;

    const equip = profile["equipamiento"];
    sections["equipment"] = equip
      ? {
          cascoMarca: str(equip, "cascoMarca"),
          cascoCertificacion: str(equip, "cascoCertificacion"),
          chaquetaTipo: str(equip, "chaquetaTipo"),
          pantalonTipo: str(equip, "pantalonTipo"),
          guantes: str(equip, "guantes"),
          botasTipo: str(equip, "botasTipo"),
          proteccionEspalda: str(equip, "proteccionEspalda"),
          airbagVest: str(equip, "airbagVest"),
          intercomunicador: str(equip, "intercomunicador"),
          camaraAccion: str(equip, "camaraAccion"),
        }
      : null;
  }

  if (isOwner || privacy.showLocation) {
    const contacto = profile["contacto"];
    sections["location"] = contacto
      ? {
          ciudad: str(contacto, "ciudad"),
          departamento: str(contacto, "departamento"),
        }
      : null;
  }

  if (isOwner || privacy.shareStats) {
    const exp = profile["experiencia-motera"];
    sections["stats"] = exp
      ? {
          anosExperiencia: num(exp, "anosExperiencia"),
          kilometrosMensuales: num(exp, "kilometrosMensuales"),
          tipoConduccionPreferido: str(exp, "tipoConduccionPreferido"),
          disponibilidadRodadas: str(exp, "disponibilidadRodadas"),
        }
      : null;
  }

  return sections;
}
