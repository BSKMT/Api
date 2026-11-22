import { Logger } from "@nestjs/common";
import type {
  AlegraContact,
  AlegraContactCreate,
  ResolvedAlegraContact,
} from "./alegra.interfaces";
import { ALEGRA_KV_PREFIX, ALEGRA_CONTACT_CACHE_TTL } from "./alegra.constants";
import type {
  AlegraDetailedRequestFn,
  AlegraHttpMethod,
} from "./alegra-http.client";
import { maskUserId } from "../common/utils/log-redact.util";
import type { UsersService } from "../users/users.service";
import type { KvCacheService } from "../kv/kv-cache.service";

export type { AlegraHttpMethod };
export type AlegraRequestFn = <T>(
  method: AlegraHttpMethod,
  path: string,
) => Promise<T | null>;

const PERSON_DOC_TYPES = new Set([
  "CC",
  "CE",
  "TI",
  "PASSPORT",
  "PEP",
  "DIE",
  "FOREIGN_NIT",
  "PPT",
]);

function readTrimmedString(
  record: Record<string, unknown>,
  key: string,
): string | undefined {
  const val = record[key];
  return typeof val === "string" && val.trim().length > 0
    ? val.trim()
    : undefined;
}

function normalizeIdForComparison(value: string | null | undefined): string {
  if (!value) return "";
  return value.replace(/[^0-9A-Za-z]/g, "").toUpperCase();
}

export function mapDocumentTypeToAlegra(rawType?: string | null): {
  type: string;
  kindOfPerson: "PERSON_ENTITY" | "LEGAL_ENTITY";
} {
  const clean = (rawType ?? "CC").trim().toUpperCase();
  if (clean === "NIT") {
    return { type: "NIT", kindOfPerson: "LEGAL_ENTITY" };
  }
  if (PERSON_DOC_TYPES.has(clean)) {
    return { type: clean, kindOfPerson: "PERSON_ENTITY" };
  }
  return { type: "CC", kindOfPerson: "PERSON_ENTITY" };
}

function buildPersonNameObject(
  dp: Record<string, unknown>,
  fullName: string,
): AlegraContactCreate["nameObject"] | undefined {
  const firstName = readTrimmedString(dp, "primerNombre");
  const secondName = readTrimmedString(dp, "segundoNombre");
  const lastName = readTrimmedString(dp, "primerApellido");
  const secondLastName = readTrimmedString(dp, "segundoApellido");

  if (firstName && lastName) {
    return {
      firstName: firstName.slice(0, 50),
      ...(secondName ? { secondName: secondName.slice(0, 50) } : {}),
      lastName: lastName.slice(0, 50),
      ...(secondLastName
        ? { secondLastName: secondLastName.slice(0, 50) }
        : {}),
    };
  }

  const tokens = fullName.trim().split(/\s+/).filter(Boolean);
  if (tokens.length < 2) return undefined;
  const primaryLastName =
    tokens.length >= 3 ? (tokens.at(-2) ?? "") : tokens[1];
  const secondaryLastName =
    tokens.length >= 3 ? (tokens.at(-1) ?? "").slice(0, 50) : undefined;
  return {
    firstName: tokens[0].slice(0, 50),
    ...(tokens.length >= 4 ? { secondName: tokens[1].slice(0, 50) } : {}),
    lastName: primaryLastName.slice(0, 50),
    ...(secondaryLastName ? { secondLastName: secondaryLastName } : {}),
  };
}

type AlegraIdentificationObject = NonNullable<
  AlegraContactCreate["identificationObject"]
>;

function buildIdentificationFields(
  rawIdentification: string,
  docType: string,
): {
  identification: string;
  identificationObject: AlegraIdentificationObject;
} {
  const trimmed = rawIdentification.trim().slice(0, 20);
  if (docType === "NIT") {
    const nitMatch = /^(\d{5,15})-(\d)$/.exec(trimmed);
    if (nitMatch) {
      return {
        identification: nitMatch[1],
        identificationObject: {
          type: "NIT",
          number: nitMatch[1],
          dv: nitMatch[2],
        },
      };
    }
  }
  return {
    identification: trimmed,
    identificationObject: {
      type: docType,
      number: trimmed,
    },
  };
}

function buildAddressField(
  ct: Record<string, unknown>,
): AlegraContactCreate["address"] | undefined {
  const city = readTrimmedString(ct, "ciudad")?.slice(0, 100);
  const department = readTrimmedString(ct, "departamento")?.slice(0, 100);
  const address = readTrimmedString(ct, "direccion")?.slice(0, 100);
  if (!city && !department && !address) return undefined;
  return {
    ...(address ? { address } : {}),
    ...(department ? { department } : {}),
    ...(city ? { city } : {}),
    country: "Colombia",
  };
}

export function buildContactData(user: {
  email: string;
  phone?: string | null;
  identityVerification?: {
    fullName: string;
    documentType: string;
    documentNumber: string;
  } | null;
  profile?: Record<string, Record<string, unknown>>;
}): AlegraContactCreate {
  const iv = user.identityVerification;
  const dp = user.profile?.["datos-personales"] ?? {};
  const ct = user.profile?.["contacto"] ?? {};

  const nameParts = [
    readTrimmedString(dp, "primerNombre"),
    readTrimmedString(dp, "segundoNombre"),
    readTrimmedString(dp, "primerApellido"),
    readTrimmedString(dp, "segundoApellido"),
  ]
    .filter(Boolean)
    .join(" ")
    .trim();

  const rawFullName = iv?.fullName?.trim() || nameParts || user.email;
  const fullName = rawFullName.trim() || user.email;

  const identification =
    iv?.documentNumber?.trim() || readTrimmedString(dp, "numeroDocumento");
  const rawDocType =
    iv?.documentType?.trim() || readTrimmedString(dp, "tipoDocumento");
  const docMapping = mapDocumentTypeToAlegra(rawDocType);

  const mobile =
    readTrimmedString(ct, "celular") ||
    user.phone?.trim() ||
    readTrimmedString(ct, "telefono");
  const phonePrimary = readTrimmedString(ct, "telefono") || mobile;

  const contactData: AlegraContactCreate = {
    name: String(fullName).slice(0, 100),
    email: user.email.trim(),
    ...(phonePrimary ? { phonePrimary: phonePrimary.slice(0, 50) } : {}),
    ...(mobile ? { mobile: mobile.slice(0, 50) } : {}),
    type: ["client"],
    status: "active",
    kindOfPerson: docMapping.kindOfPerson,
    regime: "SIMPLIFIED_REGIME",
    settings: { sendElectronicDocuments: true },
  };

  if (docMapping.kindOfPerson === "PERSON_ENTITY") {
    const nameObject = buildPersonNameObject(dp, fullName);
    if (nameObject) {
      contactData.nameObject = nameObject;
    }
  }

  const address = buildAddressField(ct);
  if (address) {
    contactData.address = address;
  }

  if (identification) {
    const idFields = buildIdentificationFields(identification, docMapping.type);
    contactData.identification = idFields.identification;
    contactData.identificationObject = idFields.identificationObject;
  }

  return contactData;
}

function isUsableClientContact(contact: AlegraContact): boolean {
  if (contact.status === "inactive") return false;
  if (Array.isArray(contact.type) && contact.type.length > 0) {
    return contact.type.includes("client");
  }
  return true;
}

export async function findContactByEmail(
  makeRequest: AlegraRequestFn,
  email: string,
): Promise<AlegraContact | null> {
  const contacts = await makeRequest<AlegraContact[]>(
    "GET",
    `/contacts?query=${encodeURIComponent(email.trim())}&limit=10`,
  );
  if (!contacts || !Array.isArray(contacts)) return null;
  const target = email.trim().toLowerCase();
  return (
    contacts.find(
      (c) =>
        isUsableClientContact(c) && c.email?.trim().toLowerCase() === target,
    ) ?? null
  );
}

export async function findContactByIdentification(
  makeRequest: AlegraRequestFn,
  identification: string,
): Promise<AlegraContact | null> {
  const contacts = await makeRequest<AlegraContact[]>(
    "GET",
    `/contacts?query=${encodeURIComponent(identification.trim())}&limit=10`,
  );
  if (!contacts || !Array.isArray(contacts)) return null;
  const target = normalizeIdForComparison(identification);
  return (
    contacts.find(
      (c) =>
        isUsableClientContact(c) &&
        normalizeIdForComparison(c.identification) === target,
    ) ?? null
  );
}

export async function tryCreateContact(
  makeDetailedRequest: AlegraDetailedRequestFn,
  contactData: AlegraContactCreate,
  logger: Logger,
): Promise<string | null> {
  const res = await makeDetailedRequest<AlegraContact>(
    "POST",
    "/contacts",
    contactData,
  );

  if (res.ok && res.data?.id) {
    logger.log(`Alegra contact created: contactId=${res.data.id}`);
    return String(res.data.id);
  }

  if (res.status === 400 && res.errorText) {
    try {
      const error = JSON.parse(res.errorText) as {
        code?: number;
        contactId?: string | number;
      };
      if (error.code === 2006 && error.contactId) {
        logger.log(
          `Alegra contact already exists — reusing contactId=${error.contactId}`,
        );
        return String(error.contactId);
      }
    } catch {
      // Non-JSON error response — ignore
    }
  }

  return null;
}

export async function resolveOrEnsureContact(
  userId: string,
  usersService: UsersService,
  kvCache: KvCacheService,
  makeRequest: AlegraRequestFn,
  makeDetailedRequest: AlegraDetailedRequestFn,
  logger: Logger,
): Promise<ResolvedAlegraContact | null> {
  const user = await usersService.findById(userId);
  if (!user) {
    logger.warn(
      `Cannot create Alegra contact — user not found: ${maskUserId(userId)}`,
    );
    return null;
  }

  const userEmail = user.email?.trim() || null;
  const cacheKey = `${ALEGRA_KV_PREFIX}contact:${userId}`;
  const cachedId = await kvCache.get<string>(cacheKey, true);
  if (cachedId) {
    return { contactId: cachedId, email: userEmail };
  }

  const contactData = buildContactData(user);

  const existingByEmail = userEmail
    ? await findContactByEmail(makeRequest, userEmail)
    : null;
  if (existingByEmail?.id) {
    const contactId = String(existingByEmail.id);
    await kvCache.set(cacheKey, contactId, ALEGRA_CONTACT_CACHE_TTL, true);
    logger.log(
      `Alegra contact found by email: user=${maskUserId(userId)} contactId=${contactId}`,
    );
    return { contactId, email: existingByEmail.email?.trim() || userEmail };
  }

  if (contactData.identification) {
    const existingById = await findContactByIdentification(
      makeRequest,
      contactData.identification,
    );
    if (existingById?.id) {
      const contactId = String(existingById.id);
      await kvCache.set(cacheKey, contactId, ALEGRA_CONTACT_CACHE_TTL, true);
      logger.log(
        `Alegra contact found by identification: user=${maskUserId(userId)} contactId=${contactId}`,
      );
      return { contactId, email: existingById.email?.trim() || userEmail };
    }
  }

  const created = await tryCreateContact(
    makeDetailedRequest,
    contactData,
    logger,
  );
  if (created) {
    await kvCache.set(cacheKey, created, ALEGRA_CONTACT_CACHE_TTL, true);
    logger.log(
      `Alegra contact ready: user=${maskUserId(userId)} contactId=${created}`,
    );
    return { contactId: created, email: userEmail };
  }

  logger.warn(
    `Failed to create/find Alegra contact for user=${maskUserId(userId)}`,
  );
  return null;
}
