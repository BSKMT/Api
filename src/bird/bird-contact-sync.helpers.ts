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
import { normalizePhoneNumberHelper } from "./bird-contact-extraction.helpers";
import type { BirdClientInstance } from "./bird-realtime.interfaces";

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
  const email = params.email.trim().toLowerCase();
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
  const removeAudienceIds = params.targetAudienceId
    ? []
    : classification.removeAudienceIds;

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

  if (removeAudienceIds.length > 0) {
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
      errors.push({ email: res.email, error: res.error || "Desconocido" });
    }
  }

  logger.log(
    `[BirdContactService] Sincronización masiva completada: ${synced} exitosos, ${failed} fallidos de un total de ${users.length}.`,
  );

  return { total: users.length, synced, failed, errors };
}
