import { Injectable, Logger } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model, Types } from "mongoose";
import { BirdService } from "./bird.service";
import { User, UserDocument, UserRole } from "../users/schemas/user.schema";
import { maskEmail } from "../common/utils/log-redact.util";
import type {
  SyncContactParams,
  SyncContactResult,
  SyncBatchResult,
  BirdContactCustomData,
} from "./bird-contact.interfaces";

export const DEFAULT_BIRD_AUDIENCES = {
  USERS: "adn_01m10ftkpeeyz9hmdk1ahy3s1h", // usuarios bskmt
  MEMBERS: "adn_01m10fv8axe26v3v646cmwj63s", // miembros bskmt
  EMPLOYEES: "adn_01m5g854wbe05snnxfb17zct16", // empleados bskmt
  ADMINS: "adn_01m10fw0chfqfseb3c4260yghq", // administradores bskmt
};

@Injectable()
export class BirdContactService {
  private readonly logger = new Logger(BirdContactService.name);

  readonly audienceUsersId: string;
  readonly audienceMembersId: string;
  readonly audienceEmployeesId: string;
  readonly audienceAdminsId: string;

  constructor(
    private readonly birdService: BirdService,
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
  ) {
    this.audienceUsersId =
      process.env.BIRD_AUDIENCE_USERS_ID || DEFAULT_BIRD_AUDIENCES.USERS;
    this.audienceMembersId =
      process.env.BIRD_AUDIENCE_MEMBERS_ID || DEFAULT_BIRD_AUDIENCES.MEMBERS;
    this.audienceEmployeesId =
      process.env.BIRD_AUDIENCE_EMPLOYEES_ID ||
      DEFAULT_BIRD_AUDIENCES.EMPLOYEES;
    this.audienceAdminsId =
      process.env.BIRD_AUDIENCE_ADMINS_ID || DEFAULT_BIRD_AUDIENCES.ADMINS;
  }

  /**
   * Normaliza un número telefónico a formato internacional E.164.
   * Soporta formato colombiano estándar (móviles de 10 dígitos iniciando en 3 -> +573...).
   */
  normalizePhoneNumber(rawPhone?: string | null): string | null {
    if (!rawPhone || typeof rawPhone !== "string") return null;
    const cleaned = rawPhone.replace(/[^\d+]/g, "").trim();
    if (!cleaned) return null;

    if (cleaned.startsWith("+")) {
      const digitsOnly = cleaned.slice(1);
      return digitsOnly.length >= 7 && digitsOnly.length <= 15 ? cleaned : null;
    }

    if (cleaned.startsWith("57") && cleaned.length === 12) {
      return `+${cleaned}`;
    }

    if (cleaned.length === 10 && cleaned.startsWith("3")) {
      return `+57${cleaned}`;
    }

    if (cleaned.length === 10) {
      return `+57${cleaned}`;
    }

    return null;
  }

  /**
   * Clasifica al usuario dentro del ecosistema BSKMT para determinar
   * su audiencia objetivo, audiencias de las que debe ser removido,
   * y las propiedades personalizadas para Bird CRM.
   */
  private parseDate(val: unknown): Date | null {
    if (val instanceof Date) return val;
    if (typeof val === "string" && val.trim()) {
      const d = new Date(val);
      return Number.isNaN(d.getTime()) ? null : d;
    }
    return null;
  }

  private calculateMembershipStatus(
    role: UserRole,
    membershipLevel: string,
    membershipExpired: boolean,
    expiryDate: Date | null,
    graceDate: Date | null,
  ): "active" | "grace_period" | "expired" | "none" {
    if (role !== UserRole.MEMBER && !membershipLevel) {
      return "none";
    }
    const now = new Date();
    if (graceDate && graceDate > now) {
      return "grace_period";
    }
    if (membershipExpired || (expiryDate && expiryDate < now)) {
      return "expired";
    }
    return "active";
  }

  private resolveTargetAudience(
    role: UserRole,
    subrol: string,
    hasContractorInfo: boolean,
    isMember: boolean,
  ): { targetAudienceId: string; removeAudienceIds: string[] } {
    if (role === UserRole.SUPERADMIN || role === UserRole.ADMIN) {
      return {
        targetAudienceId: this.audienceAdminsId,
        removeAudienceIds: [this.audienceUsersId],
      };
    }
    if (
      hasContractorInfo ||
      Boolean(subrol) ||
      role === UserRole.GESTOR ||
      role === UserRole.ROAD_CAPTAIN ||
      role === UserRole.EVENT_MANAGER ||
      role === UserRole.MODERATOR
    ) {
      return {
        targetAudienceId: this.audienceEmployeesId,
        removeAudienceIds: [this.audienceUsersId],
      };
    }
    if (isMember) {
      return {
        targetAudienceId: this.audienceMembersId,
        removeAudienceIds: [this.audienceUsersId],
      };
    }
    return {
      targetAudienceId: this.audienceUsersId,
      removeAudienceIds: [this.audienceMembersId],
    };
  }

  private extractMemberNumber(
    user: Partial<UserDocument | User | Record<string, unknown>>,
  ): string {
    const rawMemberNumber =
      (user.profile as Record<string, Record<string, unknown>>)?.[
        "membresia-ecosistema"
      ]?.["numeroMiembro"] ??
      (user as Record<string, unknown>)["numeroMiembro"];

    if (typeof rawMemberNumber === "string") {
      return rawMemberNumber.trim();
    }
    if (typeof rawMemberNumber === "number") {
      return String(rawMemberNumber);
    }
    return "";
  }

  /**
   * Clasifica al usuario dentro del ecosistema BSKMT para determinar
   * su audiencia objetivo, audiencias de las que debe ser removido,
   * y las propiedades personalizadas para Bird CRM.
   */
  classifyUserAudiences(
    user: Partial<UserDocument | User | Record<string, unknown>>,
  ) {
    const rawRole = user.role;
    const userRoleStr = typeof rawRole === "string" ? rawRole : "";
    const role: UserRole = Object.values(UserRole).includes(
      userRoleStr as UserRole,
    )
      ? (userRoleStr as UserRole)
      : UserRole.USER;
    const subrol = typeof user.subrol === "string" ? user.subrol : "";
    const hasContractorInfo = Boolean(user.contractorInfo);
    const membershipLevel =
      typeof user.membershipLevel === "string" ? user.membershipLevel : "";

    const expiryDate = this.parseDate(user.membershipExpiryDate);
    const graceDate = this.parseDate(user.membershipGracePeriodEnd);
    const membershipExpired = Boolean(user.membershipExpired);

    const membershipStatus = this.calculateMembershipStatus(
      role,
      membershipLevel,
      membershipExpired,
      expiryDate,
      graceDate,
    );

    const isMember =
      membershipStatus === "active" || membershipStatus === "grace_period";

    const { targetAudienceId, removeAudienceIds } = this.resolveTargetAudience(
      role,
      subrol,
      hasContractorInfo,
      isMember,
    );

    const memberNumber = this.extractMemberNumber(user);

    const customData: BirdContactCustomData = {
      role,
      subrol: subrol || "",
      membership: isMember,
      membership_status: membershipStatus,
      membership_level: membershipLevel || "",
      membership_expiry: expiryDate
        ? expiryDate.toISOString().split("T")[0]
        : "",
      member_number: memberNumber,
    };

    return {
      targetAudienceId,
      removeAudienceIds,
      isMember,
      membershipStatus,
      customData,
    };
  }

  /**
   * Sincroniza un contacto en Bird CRM vía la API oficial batch.
   * La operación es un upsert idempotente: crea o actualiza, y asigna
   * la audiencia en una sola llamada de red atómica.
   */
  async syncContact(params: SyncContactParams): Promise<SyncContactResult> {
    if (!this.birdService.isConfigured()) {
      this.logger.debug(
        `Bird no está configurado. Omitiendo sync de contacto para ${maskEmail(params.email)}.`,
      );
      return { success: false, error: "Bird no configurado" };
    }

    const email = params.email.trim().toLowerCase();
    const phone_number = this.normalizePhoneNumber(params.phone);

    const rawRole = params.role;
    const userRoleStr = typeof rawRole === "string" ? rawRole : "";
    const role: UserRole = Object.values(UserRole).includes(
      userRoleStr as UserRole,
    )
      ? (userRoleStr as UserRole)
      : UserRole.USER;

    const classification = this.classifyUserAudiences({
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

    try {
      const client = await this.birdService.getClient();

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
        this.logger.warn(
          `[BirdContactService] Error al sincronizar ${maskEmail(email)}: ${errorMsg}`,
        );
        return {
          success: false,
          status: "failed",
          error: errorMsg,
          audienceId: targetAudienceId,
        };
      }

      const contactId = entryResult.contact_id;

      // Si el contacto ya existía y cambió de segmento, remover de audiencias anteriores
      if (contactId && removeAudienceIds.length > 0) {
        for (const oldAudienceId of removeAudienceIds) {
          client.audiences
            .removeContact(oldAudienceId, contactId)
            .catch((rmErr) => {
              this.logger.debug(
                `No se pudo remover contacto ${contactId} de audiencia anterior ${oldAudienceId}: ${rmErr instanceof Error ? rmErr.message : String(rmErr)}`,
              );
            });
        }
      }

      // Si tenemos un externalId correspondiente a un ObjectId de MongoDB, persistir birdContactId
      if (
        contactId &&
        params.externalId &&
        Types.ObjectId.isValid(params.externalId)
      ) {
        await this.userModel
          .updateOne(
            { _id: new Types.ObjectId(params.externalId) },
            { $set: { birdContactId: contactId } },
          )
          .catch((dbErr) => {
            this.logger.warn(
              `No se pudo guardar birdContactId en MongoDB para ${maskEmail(email)}: ${dbErr instanceof Error ? dbErr.message : String(dbErr)}`,
            );
          });
      }

      this.logger.log(
        `[BirdContactService] Contacto ${maskEmail(email)} sincronizado en Bird CRM (${entryResult.status}, id=${contactId}, audiencia=${targetAudienceId}).`,
      );

      return {
        success: true,
        contactId,
        status: entryResult.status,
        audienceId: targetAudienceId,
      };
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `[BirdContactService] Excepción al sincronizar contacto ${maskEmail(email)}: ${errMsg}`,
      );
      return {
        success: false,
        error: errMsg,
        audienceId: targetAudienceId,
      };
    }
  }

  private async resolveUserDoc(
    userOrId: string | UserDocument | Record<string, unknown>,
  ): Promise<Record<string, unknown> | null> {
    if (typeof userOrId === "string") {
      const found = Types.ObjectId.isValid(userOrId)
        ? await this.userModel.findById(userOrId).lean()
        : await this.userModel
            .findOne({ email: userOrId.toLowerCase() })
            .lean();
      return found ? (found as unknown as Record<string, unknown>) : null;
    }
    if (userOrId && typeof userOrId === "object") {
      return (
        typeof (userOrId as UserDocument).toObject === "function"
          ? (userOrId as UserDocument).toObject()
          : userOrId
      ) as Record<string, unknown>;
    }
    return null;
  }

  private extractNames(
    datosPersonales: Record<string, unknown>,
    userDoc: Record<string, unknown>,
    identityVerification: Record<string, unknown>,
  ): { primerNombre: string | null; primerApellido: string | null } {
    const primerNombre =
      (typeof datosPersonales["primerNombre"] === "string"
        ? datosPersonales["primerNombre"]
        : "") ||
      (typeof userDoc["primerNombre"] === "string"
        ? userDoc["primerNombre"]
        : "");
    const segundoNombre =
      typeof datosPersonales["segundoNombre"] === "string"
        ? datosPersonales["segundoNombre"]
        : "";
    const primerApellido =
      (typeof datosPersonales["primerApellido"] === "string"
        ? datosPersonales["primerApellido"]
        : "") ||
      (typeof userDoc["primerApellido"] === "string"
        ? userDoc["primerApellido"]
        : "");
    const segundoApellido =
      typeof datosPersonales["segundoApellido"] === "string"
        ? datosPersonales["segundoApellido"]
        : "";

    const fullFirstName = [primerNombre, segundoNombre]
      .filter(Boolean)
      .join(" ");
    const fullLastName = [primerApellido, segundoApellido]
      .filter(Boolean)
      .join(" ");

    const rawName = userDoc["name"];
    const fallbackName = typeof rawName === "string" ? rawName.trim() : "";
    const fallbackFirstName = fallbackName ? fallbackName.split(" ")[0] : "";

    const ivFullName =
      typeof identityVerification["fullName"] === "string"
        ? identityVerification["fullName"].trim()
        : "";

    let ivFirstName = "";
    if (typeof identityVerification["firstName"] === "string") {
      ivFirstName = identityVerification["firstName"].trim();
    } else if (ivFullName) {
      ivFirstName = ivFullName.split(" ")[0] || "";
    }

    let ivLastName = "";
    if (typeof identityVerification["lastName"] === "string") {
      ivLastName = identityVerification["lastName"].trim();
    } else if (ivFullName) {
      ivLastName = ivFullName.split(" ").slice(1).join(" ");
    }

    const primerNombreVal: string | null =
      fullFirstName || fallbackFirstName || ivFirstName || null;
    const primerApellidoVal: string | null = fullLastName || ivLastName || null;

    return { primerNombre: primerNombreVal, primerApellido: primerApellidoVal };
  }

  private extractPhone(
    userDoc: Record<string, unknown>,
    contacto: Record<string, unknown>,
  ): string | null {
    if (typeof userDoc["phone"] === "string" && userDoc["phone"]) {
      return userDoc["phone"];
    }
    if (typeof contacto["celular"] === "string" && contacto["celular"]) {
      return contacto["celular"];
    }
    if (
      typeof userDoc["pendingPhone"] === "string" &&
      userDoc["pendingPhone"]
    ) {
      return userDoc["pendingPhone"];
    }
    return null;
  }

  private extractExternalId(userDoc: Record<string, unknown>): string | null {
    const rawId = userDoc["_id"];
    if (typeof rawId === "string" && rawId) {
      return rawId;
    }
    if (
      rawId &&
      typeof (rawId as { toString?: () => string }).toString === "function"
    ) {
      return (rawId as { toString(): string }).toString();
    }
    return null;
  }

  private extractDocumentNumber(
    datosPersonales: Record<string, unknown>,
    identityVerification: Record<string, unknown>,
  ): string | null {
    const rawDocNumber =
      identityVerification["documentNumber"] ??
      datosPersonales["numeroDocumento"];
    if (typeof rawDocNumber === "string" && rawDocNumber.trim()) {
      return rawDocNumber.trim();
    }
    if (typeof rawDocNumber === "number") {
      return String(rawDocNumber);
    }
    return null;
  }

  /**
   * Sincroniza un usuario de MongoDB completo a Bird CRM extrayendo
   * automáticamente todos sus datos de perfil (personales, contacto,
   * membresía, roles y permisos).
   */
  async syncUser(
    userOrId: string | UserDocument | Record<string, unknown>,
  ): Promise<SyncContactResult> {
    const userDoc = await this.resolveUserDoc(userOrId);
    if (!userDoc) {
      return { success: false, error: "Datos de usuario inválidos" };
    }

    const rawEmail = userDoc["email"];
    if (typeof rawEmail !== "string" || !rawEmail.trim()) {
      return { success: false, error: "Datos de usuario inválidos" };
    }
    const email = rawEmail.trim();

    const profile =
      (userDoc["profile"] as Record<string, Record<string, unknown>>) || {};
    const datosPersonales = profile["datos-personales"] || {};
    const contacto = profile["contacto"] || {};
    const identityVerification =
      (userDoc["identityVerification"] as Record<string, unknown>) || {};

    const { primerNombre, primerApellido } = this.extractNames(
      datosPersonales,
      userDoc,
      identityVerification,
    );

    const phone = this.extractPhone(userDoc, contacto);
    const externalId = this.extractExternalId(userDoc);
    const documentNumber = this.extractDocumentNumber(
      datosPersonales,
      identityVerification,
    );

    const rawCity =
      contacto["ciudad"] ?? contacto["city"] ?? contacto["municipio"];
    const city = typeof rawCity === "string" ? rawCity.trim() : null;

    const classification = this.classifyUserAudiences(userDoc);

    return this.syncContact({
      email,
      primerNombre,
      primerApellido,
      phone,
      role: (userDoc["role"] as string) || UserRole.USER,
      subrol: (userDoc["subrol"] as string) || null,
      membershipLevel: (userDoc["membershipLevel"] as string) || null,
      membershipExpired: Boolean(userDoc["membershipExpired"]),
      membershipExpiryDate:
        (userDoc["membershipExpiryDate"] as Date | string) || null,
      membershipGracePeriodEnd:
        (userDoc["membershipGracePeriodEnd"] as Date | string) || null,
      memberNumber: classification.customData.member_number,
      city,
      documentNumber,
      externalId,
      targetAudienceId: classification.targetAudienceId,
    });
  }

  /**
   * Sincroniza masivamente todos los usuarios existentes en MongoDB hacia
   * Bird CRM. Útil para migraciones iniciales o sincronizaciones periódicas.
   */
  async syncAllUsers(): Promise<SyncBatchResult> {
    const users = await this.userModel.find({}).lean();
    let synced = 0;
    let failed = 0;
    const errors: Array<{ email: string; error: string }> = [];

    this.logger.log(
      `[BirdContactService] Iniciando sincronización masiva de ${users.length} usuarios a Bird CRM...`,
    );

    const BATCH_SIZE = 5;
    const chunks: (typeof users)[] = [];
    for (let i = 0; i < users.length; i += BATCH_SIZE) {
      chunks.push(users.slice(i, i + BATCH_SIZE));
    }

    const allResults = await chunks.reduce<
      Promise<Array<{ email: string; success: boolean; error?: string }>>
    >(async (accPromise, chunk) => {
      const acc = await accPromise;
      const chunkResults = await Promise.all(
        chunk.map(async (u) => {
          try {
            const res = await this.syncUser(u);
            return { email: u.email, success: res.success, error: res.error };
          } catch (err) {
            return {
              email: u.email,
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

    this.logger.log(
      `[BirdContactService] Sincronización masiva completada: ${synced} exitosos, ${failed} fallidos de un total de ${users.length}.`,
    );

    return {
      total: users.length,
      synced,
      failed,
      errors,
    };
  }

  /**
   * Elimina un contacto de Bird CRM cuando un usuario solicita borrado
   * de su cuenta en el ecosistema BSKMT.
   */
  async deleteContact(contactId: string): Promise<boolean> {
    if (!this.birdService.isConfigured() || !contactId) return false;
    try {
      const client = await this.birdService.getClient();
      await client.contacts.delete(contactId);
      this.logger.log(
        `[BirdContactService] Contacto ${contactId} eliminado en Bird CRM.`,
      );
      return true;
    } catch (err) {
      this.logger.warn(
        `[BirdContactService] No se pudo eliminar contacto ${contactId} en Bird: ${err instanceof Error ? err.message : String(err)}`,
      );
      return false;
    }
  }
}
