import { Injectable, Logger, Optional } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { InjectModel } from "@nestjs/mongoose";
import { Model, Types } from "mongoose";
import { BirdService } from "./bird.service";
import { User, UserDocument, UserRole } from "../users/schemas/user.schema";
import { maskEmail } from "../common/utils/log-redact.util";
import type { EnvironmentConfig } from "../config/config.interface";
import type {
  SyncContactParams,
  SyncContactResult,
  SyncBatchResult,
} from "./bird-contact.interfaces";
import {
  DEFAULT_BIRD_AUDIENCES,
  classifyUserAudiencesHelper,
  type BirdAudienceConfig,
} from "./bird-contact-classification.helpers";
import {
  normalizePhoneNumberHelper,
  resolveUserDocHelper,
  extractNamesHelper,
  extractPhoneHelper,
  extractExternalIdHelper,
  extractDocumentNumberHelper,
} from "./bird-contact-extraction.helpers";
import {
  executeSyncContactHelper,
  executeSyncAllUsersHelper,
} from "./bird-contact-sync.helpers";

export { DEFAULT_BIRD_AUDIENCES };

@Injectable()
export class BirdContactService {
  private readonly logger = new Logger(BirdContactService.name);
  private readonly audiences: BirdAudienceConfig;

  constructor(
    private readonly birdService: BirdService,
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    @Optional()
    private readonly configService?: ConfigService<EnvironmentConfig>,
  ) {
    this.audiences = {
      usersId:
        this.configService?.get("BIRD_AUDIENCE_USERS_ID", {
          infer: true,
        }) || DEFAULT_BIRD_AUDIENCES.USERS,
      membersId:
        this.configService?.get("BIRD_AUDIENCE_MEMBERS_ID", {
          infer: true,
        }) || DEFAULT_BIRD_AUDIENCES.MEMBERS,
      employeesId:
        this.configService?.get("BIRD_AUDIENCE_EMPLOYEES_ID", {
          infer: true,
        }) || DEFAULT_BIRD_AUDIENCES.EMPLOYEES,
      adminsId:
        this.configService?.get("BIRD_AUDIENCE_ADMINS_ID", {
          infer: true,
        }) || DEFAULT_BIRD_AUDIENCES.ADMINS,
    };
  }

  normalizePhoneNumber(rawPhone?: string | null): string | null {
    return normalizePhoneNumberHelper(rawPhone);
  }

  classifyUserAudiences(
    user: Partial<UserDocument | User | Record<string, unknown>>,
  ) {
    return classifyUserAudiencesHelper(this.audiences, user);
  }

  async syncContact(params: SyncContactParams): Promise<SyncContactResult> {
    if (!this.birdService.isConfigured()) {
      this.logger.debug(
        `Bird no está configurado. Omitiendo sync de contacto para ${maskEmail(params.email)}.`,
      );
      return { success: false, error: "Bird no configurado" };
    }

    try {
      const client = await this.birdService.getClient();
      return await executeSyncContactHelper(
        client,
        this.audiences,
        params,
        (extId, cId) => this.persistBirdContactId(extId, cId),
        this.logger,
      );
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `[BirdContactService] Excepción al sincronizar contacto ${maskEmail(params.email)}: ${errMsg}`,
      );
      return { success: false, error: errMsg };
    }
  }

  async syncUser(
    userOrId: string | UserDocument | Record<string, unknown>,
  ): Promise<SyncContactResult> {
    const userDoc = await resolveUserDocHelper(this.userModel, userOrId);
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

    const { primerNombre, primerApellido } = extractNamesHelper(
      datosPersonales,
      userDoc,
      identityVerification,
    );

    const phone = extractPhoneHelper(userDoc, contacto);
    const externalId = extractExternalIdHelper(userDoc);
    const documentNumber = extractDocumentNumberHelper(
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

  async syncAllUsers(): Promise<SyncBatchResult> {
    const users = await this.userModel.find({}).lean();
    return executeSyncAllUsersHelper(
      users,
      (u) => this.syncUser(u as unknown as Record<string, unknown>),
      this.logger,
    );
  }

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

  private async persistBirdContactId(
    externalId: string,
    contactId: string,
  ): Promise<void> {
    try {
      if (!Types.ObjectId.isValid(externalId)) return;
      await this.userModel.updateOne(
        { _id: externalId, birdContactId: { $ne: contactId } },
        { $set: { birdContactId: contactId } },
      );
    } catch (err) {
      this.logger.debug(
        `No se pudo persistir birdContactId para usuario ${externalId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
