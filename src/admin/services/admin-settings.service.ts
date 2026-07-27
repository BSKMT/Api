import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";
import { User, UserDocument, UserRole } from "../../users/schemas/user.schema";
import { NotificationsService } from "../../notifications/notifications.service";
import {
  NotificationType,
  NotificationPriority,
} from "../../notifications/schemas/notification.schema";
import { getMongoDb } from "../../auth/better-auth";
@Injectable()
export class AdminSettingsService {
  private readonly logger = new Logger(AdminSettingsService.name);

  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    private readonly notificationsService: NotificationsService,
  ) {}

  async listDeletionRequests() {
    const users = (await this.userModel
      .find({ accountDeletionRequested: true })
      .select("email role membershipLevel accountDeletionRequestedAt profile")
      .lean()) as unknown as {
      _id: { toString(): string };
      email: string;
      role: string;
      membershipLevel?: string | null;
      accountDeletionRequestedAt?: Date | null;
      profile?: Record<string, Record<string, unknown>>;
      createdAt?: Date;
    }[];

    return {
      count: users.length,
      requests: users.map((u) => ({
        userId: String(u._id),
        email: u.email,
        role: u.role,
        membershipLevel: u.membershipLevel,
        requestedAt: u.accountDeletionRequestedAt,
        createdAt: u.createdAt,
        primerNombre:
          (u.profile?.["datos-personales"] as Record<string, unknown>)
            ?.primerNombre ?? "",
        primerApellido:
          (u.profile?.["datos-personales"] as Record<string, unknown>)
            ?.primerApellido ?? "",
      })),
    };
  }

  async approveDeletion(userId: string, actorId: string) {
    const user = await this.userModel.findById(userId).lean();
    if (!user) throw new NotFoundException("Usuario no encontrado");
    if (!user.accountDeletionRequested) {
      throw new BadRequestException(
        "Este usuario no ha solicitado eliminacion",
      );
    }

    // ADM-17: Prevent deleting the last admin account
    if ((user.role as UserRole) === UserRole.ADMIN) {
      const adminCount = await this.userModel.countDocuments({
        role: UserRole.ADMIN,
      });
      if (adminCount <= 1) {
        throw new BadRequestException(
          "No se puede eliminar la última cuenta de administrador",
        );
      }
    }

    const db = getMongoDb();

    try {
      await db.collection("user").deleteOne({ id: user.betterAuthId });
      await db.collection("session").deleteMany({ userId: user.betterAuthId });
    } catch (err) {
      this.logger.error(`Failed to delete better-auth data: ${err}`);
      throw new BadRequestException(
        "No se pudo eliminar completamente la cuenta de autenticación. Intenta de nuevo.",
      );
    }

    // M-3: the previous implementation only dropped the Better Auth
    // user + session; the user's PII persisted in every business
    // collection (orders, event/couse registrations, transactions,
    // ARPHA requests, notifications). Ley 1581 / GDPR Art. 17 right
    // to erasure requires removal of personal data unless retention
    // is legally required — so we redact PII fields ($unset
    // payerEmail, companionData, shippingAddress) while KEEPING the
    // bare-row audit trail keyed by userId (which no longer resolves
    // to any user document).
    try {
      await db.collection("transactions").updateMany(
        { userId },
        {
          $unset: {
            payerEmail: "",
            "companionData.fullName": "",
            "companionData.documentId": "",
            "companionData.phone": "",
            "companionData.email": "",
          },
        },
      );
      await db
        .collection("membershiptransactions")
        .updateMany({ userId }, { $unset: { payerEmail: "" } });
      await db
        .collection("eventregistrations")
        .updateMany({ userId }, { $set: { companionData: null } });
      await db
        .collection("courseenrollments")
        .updateMany({ userId }, { $set: { certificateId: null } });
      await db.collection("arpha_requests").updateMany(
        { userId },
        {
          $unset: {
            requesterEmail: "",
            requesterName: "",
            requesterPhone: "",
          },
        },
      );
      await db.collection("orders").updateMany(
        { userId },
        {
          $unset: {
            shippingAddress: "",
            customerEmail: "",
            customerPhone: "",
          },
        },
      );
      // Notifications are wholly personal — drop them since they have
      // no audit value beyond informing the (now-deleted) user.
      await db.collection("notifications").deleteMany({ userId });
      // Service credit transactions: redact the description since it
      // may contain PII; keep the amount / reference for audit.
      await db
        .collection("servicecredittransactions")
        .updateMany(
          { userId },
          { $set: { description: "[redacted on account deletion]" } },
        );
    } catch (err) {
      // Best-effort — log loudly but do NOT block the deletion; the
      // critical step (removing the user record) already succeeded.
      this.logger.error(
        `approveDeletion: PII redaction partial failure for userId=${userId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    await this.userModel.deleteOne({ _id: userId });

    this.logger.log(
      `Account permanently deleted by admin: userId=${userId} email=${user.email} actor=${actorId}`,
    );
    return { success: true, message: "Cuenta eliminada permanentemente" };
  }

  async rejectDeletion(userId: string, actorId = "") {
    const user = await this.userModel.findById(userId);
    if (!user) throw new NotFoundException("Usuario no encontrado");
    if (!user.accountDeletionRequested) {
      throw new BadRequestException(
        "Este usuario no ha solicitado eliminacion",
      );
    }

    user.accountDeletionRequested = false;
    user.accountDeletionRequestedAt = null;
    await user.save();

    try {
      await this.notificationsService.create({
        userId,
        type: NotificationType.ACCOUNT_DELETION_REJECTED,
        title: "Solicitud de eliminacion rechazada",
        message:
          "Un administrador ha revisado tu solicitud de eliminacion de cuenta y no se ha aprobado. Tu cuenta sigue activa.",
        priority: NotificationPriority.HIGH,
        metadata: { adminAction: true, deletionRejected: true },
      });
    } catch {
      // notifications may fail if user has no notification schema
    }

    this.logger.log(
      `Account deletion rejected by admin: userId=${userId} actor=${actorId}`,
    );
    return { success: true, message: "Solicitud rechazada, cuenta reactivada" };
  }
}
