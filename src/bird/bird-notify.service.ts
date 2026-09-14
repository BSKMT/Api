import { Injectable, Logger } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";
import { User, UserDocument } from "../users/schemas/user.schema";
import { BirdEmailService } from "./bird-email.service";
import { BirdSmsService } from "./bird-sms.service";
import { BirdWhatsappService } from "./bird-whatsapp.service";
import {
  maskEmail,
  maskPhone,
  sanitizeForLog,
} from "../common/utils/log-redact.util";
import {
  type NotificationSettings,
  type UserNotifyInfo,
  extractPhone,
  isChannelEnabled,
} from "./bird-notify.helpers";

@Injectable()
export class BirdNotifyService {
  private readonly logger = new Logger(BirdNotifyService.name);

  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    private readonly emailService: BirdEmailService,
    private readonly smsService: BirdSmsService,
    private readonly whatsappService: BirdWhatsappService,
  ) {}

  private async loadUser(userId: string): Promise<UserNotifyInfo | null> {
    const user = await this.userModel.findById(userId).lean();
    if (!user) return null;

    const settings = (user.settings ?? {}) as {
      notifications?: NotificationSettings;
    };

    const phone = extractPhone(user);

    return {
      email: user.email,
      phone,
      phoneVerified:
        (user as { phoneVerified?: boolean }).phoneVerified ?? false,
      emailVerified:
        (user as { emailVerified?: boolean }).emailVerified ?? false,
      settings,
    };
  }

  async notify(data: {
    userId: string;
    title: string;
    message: string;
    category?: string;
  }): Promise<void> {
    const user = await this.loadUser(data.userId);
    if (!user) {
      this.logger.warn(`notify: usuario ${data.userId} no encontrado`);
      return;
    }

    const notifSettings = user.settings.notifications;
    const { title, message, category, userId } = data;

    if (isChannelEnabled(notifSettings, "email", category)) {
      this.dispatchEmailNotification(user, title, message, userId);
    }
    if (isChannelEnabled(notifSettings, "sms", category)) {
      this.dispatchSmsNotification(user, title, message, userId);
    }
    if (isChannelEnabled(notifSettings, "whatsapp", category)) {
      this.dispatchWhatsappNotification(user, title, message, userId);
    }
  }

  private dispatchEmailNotification(
    user: UserNotifyInfo,
    title: string,
    message: string,
    userId: string,
  ): void {
    if (!user.emailVerified) {
      this.logger.debug(
        `Email habilitado pero usuario ${userId} sin correo verificado — skip`,
      );
      return;
    }
    const email = user.email;
    this.emailService
      .sendNotificationEmail({
        to: email,
        title,
        message,
      })
      .then((ok) => {
        if (!ok) {
          this.logger.warn(`No se pudo enviar el correo a ${maskEmail(email)}`);
        }
      })
      .catch((err: unknown) => {
        this.logger.warn(
          `Error correo notif a ${maskEmail(email)}: ${sanitizeForLog(err instanceof Error ? err.message : String(err))}`,
        );
      });
  }

  private dispatchSmsNotification(
    user: UserNotifyInfo,
    title: string,
    message: string,
    userId: string,
  ): void {
    if (!user.phone) {
      this.logger.debug(`SMS habilitado pero usuario ${userId} sin telefono`);
      return;
    }
    if (!user.phoneVerified) {
      this.logger.debug(
        `SMS habilitado pero usuario ${userId} sin telefono verificado — skip`,
      );
      return;
    }
    const phone = user.phone;
    this.smsService
      .sendNotificationSms({
        to: phone,
        title,
        message,
      })
      .then((ok) => {
        if (!ok) {
          this.logger.warn(`No se pudo enviar SMS a ${maskPhone(phone)}`);
        }
      })
      .catch((err: unknown) => {
        this.logger.warn(
          `Error SMS notif a ${maskPhone(phone)}: ${sanitizeForLog(err instanceof Error ? err.message : String(err))}`,
        );
      });
  }

  private dispatchWhatsappNotification(
    user: UserNotifyInfo,
    title: string,
    message: string,
    userId: string,
  ): void {
    if (!user.phone) {
      this.logger.debug(
        `WhatsApp habilitado pero usuario ${userId} sin telefono — skip`,
      );
      return;
    }
    if (!user.phoneVerified) {
      this.logger.debug(
        `WhatsApp habilitado pero usuario ${userId} sin telefono verificado — skip`,
      );
      return;
    }
    const phone = user.phone;
    this.whatsappService
      .sendNotificationWhatsapp({
        to: phone,
        title,
        message,
      })
      .then((ok) => {
        if (!ok) {
          this.logger.warn(`No se pudo enviar WhatsApp a ${maskPhone(phone)}`);
        }
      })
      .catch((err: unknown) => {
        this.logger.warn(
          `Error WhatsApp notif a ${maskPhone(phone)}: ${sanitizeForLog(err instanceof Error ? err.message : String(err))}`,
        );
      });
  }
}
