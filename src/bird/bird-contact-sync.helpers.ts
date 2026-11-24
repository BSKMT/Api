import { Logger } from "@nestjs/common";
import { UserRole } from "../users/schemas/user.schema";
import { maskEmail } from "../common/utils/log-redact.util";
import type {
  SyncContactParams,
  SyncContactResult,
  SyncBatchResult,
  BirdContactCustomData,
} from "./bird-contact.interfaces";
import type { BirdAudienceConfig } from "./bird-contact-classification.helpers";
import { classifyUserAudiencesHelper } from "./bird-contact-classification.helpers";
import {
  normalizePhoneNumberHelper,
  extractNamesHelper,
  extractPhoneHelper,
  extractExternalIdHelper,
  extractDocumentNumberHelper,
} from "./bird-contact-extraction.helpers";
import { isSyntheticInboundEmail, formatBirdError } from "./bird-email.helpers";
import type { BirdClientInstance } from "./bird-realtime.interfaces";

const CONTACTS_BATCH_CHUNK_SIZE = 100;

interface BatchContactCandidate {
  email: string;
  externalId: string | null;
  targetAudienceId: string;
  removeAudienceIds: string[];
  entry: {
    email: string;
    phone_number?: string;
    first_name?: string;
    last_name?: string;
    external_id?: string;
    data: BirdContactCustomData;
  };
}

function getManagedAudienceIds(audiences: BirdAudienceConfig): string[] {
  return [
    audiences.usersId,
    audiences.membersId,
    audiences.employeesId,
    audiences.adminsId,
  ];
}

export async function executeSyncContactHelper(
  client: BirdClientInstance,
  audiences: BirdAudienceConfig,
  params: SyncContactParams,
  persistBirdContactId: (
    externalId: string,
    contactId: string,
  ) => Promise<void>,
  logger: Logger,
): Promise<SyncContactResult> {
  const email = (params.email || "").trim().toLowerCase();
  if (!email || isSyntheticInboundEmail(email)) {
    return {
      success: false,
      status: "failed",
      error: "Correo inválido o sintético de canal entrante omitido",
    };
  }

  const phone_number = normalizePhoneNumberHelper(params.phone);
  const rawRole = params.role;
  const userRoleStr = typeof rawRole === "string" ? rawRole : "";
  const role: UserRole = Object.values(UserRole).includes(
    userRoleStr as UserRole,
  )
    ? (userRoleStr as UserRole)
    : UserRole.USER;

  const classification = classifyUserAudiencesHelper(audiences, {
    role,
    subrol: params.subrol || "",
    membershipLevel: params.membershipLevel || "",
    membershipExpired: params.membershipExpired,
    membershipExpiryDate: params.membershipExpiryDate,
    membershipGracePeriodEnd: params.membershipGracePeriodEnd,
    numeroMiembro: params.memberNumber,
  });

  const targetAudienceId =
    params.targetAudienceId || classification.targetAudienceId;
  const removeAudienceIds = params.skipAudienceCleanup
    ? []
    : getManagedAudienceIds(audiences).filter((id) => id !== targetAudienceId);

  const customData: BirdContactCustomData = {
    ...classification.customData,
    city: params.city || "",
    document_number: params.documentNumber || "",
  };

  const batchPayload = {
    match_on: "email" as const,
    data_mode: "merge" as const,
    audience_ids: [targetAudienceId],
    contacts: [
      {
        email,
        phone_number: phone_number || undefined,
        first_name: params.primerNombre?.trim() || undefined,
        last_name: params.primerApellido?.trim() || undefined,
        external_id: params.externalId || undefined,
        data: customData,
      },
    ],
  };

  const response = await client.contacts.batch(batchPayload);
  const entryResult = response?.data?.[0];

  if (!entryResult) {
    throw new Error("Respuesta vacía de Bird Contacts Batch API");
  }

  if (entryResult.status === "failed") {
    const errorMsg =
      entryResult.error?.message ||
      `Fallo al sincronizar contacto (${entryResult.error?.code || "desconocido"})`;
    logger.warn(
      `[BirdContactService] Error al sincronizar ${maskEmail(email)}: ${errorMsg}`,
    );
    return {
      success: false,
      status: "failed",
      error: errorMsg,
      audienceId: targetAudienceId,
    };
  }

  const contactId = entryResult.contact_id as string;
  if (params.externalId && contactId) {
    await persistBirdContactId(params.externalId, contactId);
  }

  if (removeAudienceIds.length > 0 && contactId) {
    await Promise.allSettled(
      removeAudienceIds.map((removeId) =>
        client.audiences.removeContact(removeId, contactId),
      ),
    );
  }

  logger.log(
    `[BirdContactService] Contacto ${maskEmail(email)} sincronizado en Bird CRM (${entryResult.status}, id=${contactId}, audiencia=${targetAudienceId}).`,
  );

  return {
    success: true,
    contactId,
    status: entryResult.status,
    audienceId: targetAudienceId,
  };
}

function buildBatchCandidate(
  audiences: BirdAudienceConfig,
  userDoc: Record<string, unknown>,
): BatchContactCandidate | null {
  const rawEmail = userDoc["email"];
  if (typeof rawEmail !== "string") return null;
  const email = rawEmail.trim().toLowerCase();
  if (!email || isSyntheticInboundEmail(email)) return null;

  const profile =
    (userDoc["profile"] as Record<string, Record<string, unknown>>) || {};
  const datosPersonales = profile["datos-personales"] || {};
  const contacto = profile["contacto"] || {};
  const identityVerification =
    (userDoc["identityVerification"] as Record<string, unknown>) || {};

  const { primerNombre, primerApellido } = extractNamesHelper(
    datosPersonales,
    userDoc,
    identityVerification,
  );
  const phone = normalizePhoneNumberHelper(
    extractPhoneHelper(userDoc, contacto),
  );
  const externalId = extractExternalIdHelper(userDoc);
  const documentNumber = extractDocumentNumberHelper(
    datosPersonales,
    identityVerification,
  );
  const rawCity =
    contacto["ciudad"] ?? contacto["city"] ?? contacto["municipio"];
  const city = typeof rawCity === "string" ? rawCity.trim() : "";

  const classification = classifyUserAudiencesHelper(audiences, userDoc);

  return {
    email,
    externalId,
    targetAudienceId: classification.targetAudienceId,
    removeAudienceIds: classification.removeAudienceIds,
    entry: {
      email,
      phone_number: phone || undefined,
      first_name: primerNombre?.trim() || undefined,
      last_name: primerApellido?.trim() || undefined,
      external_id: externalId || undefined,
      data: {
        ...classification.customData,
        city,
        document_number: documentNumber || "",
      },
    },
  };
}

async function removeContactsFromStaleAudiences(
  client: BirdClientInstance,
  removeAudienceIds: string[],
  contactIds: string[],
): Promise<void> {
  if (removeAudienceIds.length === 0 || contactIds.length === 0) return;

  await Promise.allSettled(
    removeAudienceIds.map(async (audienceId) => {
      if (typeof client.audiences.removeContacts === "function") {
        await client.audiences.removeContacts(audienceId, {
          contact_ids: contactIds,
        });
        return;
      }
      await Promise.allSettled(
        contactIds.map((cId) =>
          client.audiences.removeContact(audienceId, cId),
        ),
      );
    }),
  );
}

async function processAudienceBatchChunk(
  client: BirdClientInstance,
  audienceId: string,
  removeAudienceIds: string[],
  chunk: BatchContactCandidate[],
  persistBirdContactId: (
    externalId: string,
    contactId: string,
  ) => Promise<void>,
): Promise<{
  synced: number;
  failed: number;
  errors: Array<{ email: string; error: string }>;
}> {
  let synced = 0;
  let failed = 0;
  const errors: Array<{ email: string; error: string }> = [];

  try {
    const response = await client.contacts.batch({
      match_on: "email",
      data_mode: "merge",
      audience_ids: [audienceId],
      contacts: chunk.map((c) => c.entry),
    });

    const results = response?.data ?? [];
    const syncedContactIds: string[] = [];
    const persistPromises: Promise<void>[] = [];

    for (let i = 0; i < chunk.length; i++) {
      const candidate = chunk[i];
      const entryRes = results[i];
      if (!entryRes || entryRes.status === "failed" || !entryRes.contact_id) {
        failed++;
        errors.push({
          email: maskEmail(candidate.email),
          error:
            entryRes?.error?.message || "Fallo al sincronizar contacto en lote",
        });
        continue;
      }
      synced++;
      syncedContactIds.push(entryRes.contact_id);
      if (candidate.externalId) {
        persistPromises.push(
          persistBirdContactId(candidate.externalId, entryRes.contact_id),
        );
      }
    }

    await Promise.allSettled(persistPromises);
    await removeContactsFromStaleAudiences(
      client,
      removeAudienceIds,
      syncedContactIds,
    );
  } catch (err: unknown) {
    const errMsg = formatBirdError(err);
    failed += chunk.length;
    for (const candidate of chunk) {
      errors.push({ email: maskEmail(candidate.email), error: errMsg });
    }
  }

  return { synced, failed, errors };
}

export async function executeSyncAllUsersBatchHelper(
  client: BirdClientInstance,
  audiences: BirdAudienceConfig,
  users: Record<string, unknown>[],
  persistBirdContactId: (
    externalId: string,
    contactId: string,
  ) => Promise<void>,
  logger: Logger,
): Promise<SyncBatchResult> {
  logger.log(
    `[BirdContactService] Iniciando sincronización masiva por lotes de ${users.length} usuarios a Bird CRM...`,
  );

  const grouped = new Map<string, BatchContactCandidate[]>();
  let synced = 0;
  let failed = 0;
  const errors: Array<{ email: string; error: string }> = [];

  for (const userDoc of users) {
    const candidate = buildBatchCandidate(audiences, userDoc);
    if (!candidate) {
      failed++;
      errors.push({
        email: "[invalid]",
        error: "Datos de usuario inválidos o correo sintético",
      });
      continue;
    }
    const list = grouped.get(candidate.targetAudienceId) ?? [];
    list.push(candidate);
    grouped.set(candidate.targetAudienceId, list);
  }

  for (const [audienceId, candidates] of grouped.entries()) {
    const removeAudienceIds = candidates[0]?.removeAudienceIds ?? [];
    for (let i = 0; i < candidates.length; i += CONTACTS_BATCH_CHUNK_SIZE) {
      const chunk = candidates.slice(i, i + CONTACTS_BATCH_CHUNK_SIZE);
      const chunkRes = await processAudienceBatchChunk(
        client,
        audienceId,
        removeAudienceIds,
        chunk,
        persistBirdContactId,
      );
      synced += chunkRes.synced;
      failed += chunkRes.failed;
      errors.push(...chunkRes.errors);
    }
  }

  logger.log(
    `[BirdContactService] Sincronización masiva completada: ${synced} exitosos, ${failed} fallidos de un total de ${users.length}.`,
  );

  return { total: users.length, synced, failed, errors };
}

export async function executeSyncAllUsersHelper<T extends { email?: string }>(
  users: T[],
  syncUserFn: (user: T) => Promise<SyncContactResult>,
  logger: Logger,
): Promise<SyncBatchResult> {
  let synced = 0;
  let failed = 0;
  const errors: Array<{ email: string; error: string }> = [];

  logger.log(
    `[BirdContactService] Iniciando sincronización masiva de ${users.length} usuarios a Bird CRM...`,
  );

  const BATCH_SIZE = 5;
  const chunks: T[][] = [];
  for (let i = 0; i < users.length; i += BATCH_SIZE) {
    chunks.push(users.slice(i, i + BATCH_SIZE));
  }

  const allResults = await chunks.reduce<
    Promise<Array<{ email: string; success: boolean; error?: string }>>
  >(async (accPromise, chunk) => {
    const acc = await accPromise;
    const chunkResults = await Promise.all(
      chunk.map(async (u) => {
        const userEmail = u.email || "";
        try {
          const res = await syncUserFn(u);
          return { email: userEmail, success: res.success, error: res.error };
        } catch (err) {
          return {
            email: userEmail,
            success: false,
            error: err instanceof Error ? err.message : String(err),
          };
        }
      }),
    );
    return acc.concat(chunkResults);
  }, Promise.resolve([]));

  for (const res of allResults) {
    if (res.success) {
      synced++;
    } else {
      failed++;
      errors.push({
        email: maskEmail(res.email),
        error: res.error || "Desconocido",
      });
    }
  }

  logger.log(
    `[BirdContactService] Sincronización masiva completada: ${synced} exitosos, ${failed} fallidos de un total de ${users.length}.`,
  );

  return { total: users.length, synced, failed, errors };
}
