import { Logger } from "@nestjs/common";
import type { AlegraContact, AlegraContactCreate } from "./alegra.interfaces";
import {
  ALEGRA_DEFAULT_TIMEOUT_MS,
  ALEGRA_KV_PREFIX,
  ALEGRA_CONTACT_CACHE_TTL,
} from "./alegra.constants";
import { maskUserId } from "../common/utils/log-redact.util";
import type { UsersService } from "../users/users.service";
import type { KvCacheService } from "../kv/kv-cache.service";

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

  const fullName =
    iv?.fullName ??
    [dp["primerNombre"], dp["primerApellido"]].filter(Boolean).join(" ") ??
    user.email;

  const identification =
    iv?.documentNumber ??
    (typeof dp["numeroDocumento"] === "string"
      ? dp["numeroDocumento"]
      : undefined);

  const phone =
    user.phone ??
    (typeof ct["telefono"] === "string" ? ct["telefono"] : undefined);

  const city = typeof ct["ciudad"] === "string" ? ct["ciudad"] : undefined;
  const addr =
    typeof ct["direccion"] === "string" ? ct["direccion"] : undefined;

  return {
    name: String(fullName).slice(0, 100),
    identification: identification
      ? String(identification).slice(0, 20)
      : undefined,
    email: user.email,
    phonePrimary: phone ? String(phone).slice(0, 50) : undefined,
    type: ["client"],
    status: "active",
    address: {
      city: city ? String(city).slice(0, 100) : undefined,
      address: addr ? String(addr).slice(0, 100) : undefined,
    },
  };
}

export async function findContactByEmail(
  makeRequest: <T>(
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
    path: string,
  ) => Promise<T | null>,
  email: string,
): Promise<AlegraContact | null> {
  const contacts = await makeRequest<AlegraContact[]>(
    "GET",
    `/contacts?query=${encodeURIComponent(email)}&limit=5`,
  );
  if (!contacts || !Array.isArray(contacts)) return null;
  return (
    contacts.find((c) => c.email?.toLowerCase() === email.toLowerCase()) ?? null
  );
}

export async function findContactByIdentification(
  makeRequest: <T>(
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
    path: string,
  ) => Promise<T | null>,
  identification: string,
): Promise<AlegraContact | null> {
  const contacts = await makeRequest<AlegraContact[]>(
    "GET",
    `/contacts?query=${encodeURIComponent(identification)}&limit=5`,
  );
  if (!contacts || !Array.isArray(contacts)) return null;
  return contacts.find((c) => c.identification === identification) ?? null;
}

export async function tryCreateContact(
  baseUrl: string,
  authHeader: string,
  contactData: AlegraContactCreate,
  logger: Logger,
): Promise<string | null> {
  const url = `${baseUrl}/contacts`;
  const timeoutMs =
    Number(process.env.ALEGRA_TIMEOUT_MS) || ALEGRA_DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: authHeader,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(contactData),
      signal: controller.signal,
    });

    if (res.ok) {
      const created = (await res.json()) as AlegraContact;
      if (created?.id) {
        logger.log(`Alegra contact created: contactId=${created.id}`);
        return String(created.id);
      }
      return null;
    }

    const text = await res.text().catch(() => "");
    logger.warn(
      `Alegra API POST /contacts returned ${res.status}: ${text.slice(0, 300)}`,
    );

    if (res.status === 400) {
      try {
        const error = JSON.parse(text) as {
          code?: number;
          contactId?: string;
        };
        if (error.code === 2006 && error.contactId) {
          logger.log(
            `Alegra contact already exists — using contactId=${error.contactId} from error response`,
          );
          return String(error.contactId);
        }
      } catch {
        // JSON parse failed — ignore
      }
    }

    return null;
  } catch (err: unknown) {
    logger.warn(
      `Alegra API POST /contacts failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export async function resolveOrEnsureContact(
  userId: string,
  usersService: UsersService,
  kvCache: KvCacheService,
  makeRequest: <T>(
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
    path: string,
  ) => Promise<T | null>,
  baseUrl: string,
  authHeader: string,
  logger: Logger,
): Promise<string | null> {
  const user = await usersService.findById(userId);
  if (!user) {
    logger.warn(
      `Cannot create Alegra contact — user not found: ${maskUserId(userId)}`,
    );
    return null;
  }

  const cacheKey = `${ALEGRA_KV_PREFIX}contact:${userId}`;
  const cachedId = await kvCache.get<string>(cacheKey, true);
  if (cachedId) return cachedId;

  const contactData = buildContactData(user);

  const existingByEmail = await findContactByEmail(makeRequest, user.email);
  if (existingByEmail) {
    await kvCache.set(
      cacheKey,
      String(existingByEmail.id),
      ALEGRA_CONTACT_CACHE_TTL,
      true,
    );
    logger.log(
      `Alegra contact found by email: user=${maskUserId(userId)} contactId=${existingByEmail.id}`,
    );
    return String(existingByEmail.id);
  }

  if (contactData.identification) {
    const existingById = await findContactByIdentification(
      makeRequest,
      contactData.identification,
    );
    if (existingById) {
      await kvCache.set(
        cacheKey,
        String(existingById.id),
        ALEGRA_CONTACT_CACHE_TTL,
        true,
      );
      logger.log(
        `Alegra contact found by identification: user=${maskUserId(userId)} contactId=${existingById.id}`,
      );
      return String(existingById.id);
    }
  }

  const created = await tryCreateContact(
    baseUrl,
    authHeader,
    contactData,
    logger,
  );
  if (created) {
    await kvCache.set(cacheKey, created, ALEGRA_CONTACT_CACHE_TTL, true);
    logger.log(
      `Alegra contact ready: user=${maskUserId(userId)} contactId=${created}`,
    );
    return created;
  }

  logger.warn(
    `Failed to create/find Alegra contact for user=${maskUserId(userId)}`,
  );
  return null;
}
