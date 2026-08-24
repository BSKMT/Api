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

/**
 * BirdNotifyService — Dispatcher multicanal de notificaciones.
 *
 * Lee las preferencias de notificacion del usuario desde MongoDB
 * (`user.settings.notifications`) y envia el mensaje por los canales
 * que el usuario tenga activados (email, SMS y/o WhatsApp).
 *
 * Reglas:
 *  - Si `channels.email`     es true  → envia correo via BirdEmailService.
 *  - Si `channels.sms`       es true  AND el usuario tiene telefono → envia SMS.
 *  - Si `channels.whatsapp`  es true  AND el usuario tiene telefono → envia WhatsApp.
 *  - Si la categoria tiene overrides (per-category), estos tienen
 *    precedencia sobre los channels globales.
 *  - Si ningun canal esta activo, no se envia nada pero se persista
 *    la notificacion in-app (la In-App siempre se guarda).
 *  - El envio por cada canal es best-effort: un fallo en un canal no
 *    bloquea el otro ni el flujo principal del negocio.
 *
 * Seguridad (OWASP A07:2025):
 *  - Los logs enmascaran email y telefono del destinatario.
 *  - Las preferencias se leen de la DB, no se pasan del cliente.
 *  - WhatsApp requiere un numero E.164 conectado a un WABA; si el
 *    sender no esta configurado, el canal degrada a no-op (A10).
 *  - WhatsApp free-form requiere ventana de servicio abierta (24h);
 *    si esta cerrada, Bird acepta pero falla asincronamente — el
 *    fallo se maneja como best-effort (A10).
 */

/** Forma de `user.settings.notifications`. */
interface NotificationSettings {
  channels?: {
    email?: boolean;
    sms?: boolean;
    whatsapp?: boolean;
    push?: boolean;
  };
  categories?: Record<
    string,
    {
      email?: boolean;
      sms?: boolean;
      whatsapp?: boolean;
      push?: boolean;
    }
  >;
}

/** Extras del usuario necesarios para el dispatch. */
interface UserNotifyInfo {
  email: string;
  phone: string | null;
  phoneVerified: boolean;
  emailVerified: boolean;
  settings: {
    notifications?: NotificationSettings;
  };
}

@Injectable()
export class BirdNotifyService {
  private readonly logger = new Logger(BirdNotifyService.name);

  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    private readonly emailService: BirdEmailService,
    private readonly smsService: BirdSmsService,
    private readonly whatsappService: BirdWhatsappService,
  ) {}

  /**
   * Carga los datos del usuario necesarios para despachar notificaciones.
   */
  private async loadUser(userId: string): Promise<UserNotifyInfo | null> {
    const user = await this.userModel.findById(userId).lean();
    if (!user) return null;

    const settings = (user.settings ?? {}) as {
      notifications?: NotificationSettings;
    };

    const phone = this.extractPhone(user);

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

  /**
   * Extrae el telefono del perfil del usuario. El telefono se almacena
   * en el campo `phone` del esquema (añadido para SMS) o, si no existe,
   * en `profile.contacto.telefono`.
   */
  private extractPhone(user: unknown): string | null {
    const u = user as {
      phone?: string | null;
      profile?: Record<string, Record<string, unknown>>;
    };
    const trimmedPhone = u.phone?.trim();
    if (trimmedPhone) return trimmedPhone;
    const contacto = u.profile?.["contacto"];
    if (contacto) {
      const tel =
        contacto["telefono"] ??
        contacto["celular"] ??
        contacto["whatsapp"] ??
        contacto["phone"];
      if (typeof tel === "string" && tel.trim()) return tel.trim();
    }
    return null;
  }

  /**
   * Determina si un canal specifico esta habilitado, considerando
   * overrides por categoria.
   */
  private isChannelEnabled(
    settings: NotificationSettings | undefined,
    channel: "email" | "sms" | "whatsapp",
    category?: string,
  ): boolean {
    if (!settings) return channel === "email"; // default: email on
    const globalEnabled = settings.channels?.[channel] ?? false;
    if (!category || !settings.categories?.[category]) return globalEnabled;
    const catOverride = settings.categories[category];
    return catOverride[channel] ?? globalEnabled;
  }

  /**
   * Despacha una notificacion por email, SMS y/o WhatsApp segun las
   * preferencias del usuario. Todos los envios son best-effort (nunca
   * lanzan).
   *
   * @param userId   ID del usuario (MongoDB _id).
   * @param title    Titulo de la notificacion.
   * @param message  Cuerpo del mensaje.
   * @param category Categoria opcional para overrides por categoria
   *                  (ej: "Membresia y pagos").
   */
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

    const emailEnabled = this.isChannelEnabled(
      notifSettings,
      "email",
      data.category,
    );
    const smsEnabled = this.isChannelEnabled(
      notifSettings,
      "sms",
      data.category,
    );
    const whatsappEnabled = this.isChannelEnabled(
      notifSettings,
      "whatsapp",
      data.category,
    );

    if (emailEnabled && user.emailVerified) {
      const email = user.email;
      this.emailService
        .sendNotificationEmail({
          to: email,
          title: data.title,
          message: data.message,
        })
        .then((ok) => {
          if (!ok) {
            this.logger.warn(
              `No se pudo enviar el correo a ${maskEmail(email)}`,
            );
          }
        })
        .catch((err: unknown) => {
          this.logger.warn(
            `Error correo notif a ${maskEmail(email)}: ${sanitizeForLog(err instanceof Error ? err.message : String(err))}`,
          );
        });
    } else if (emailEnabled && !user.emailVerified) {
      this.logger.debug(
        `Email habilitado pero usuario ${data.userId} sin correo verificado — skip`,
      );
    }

    if (smsEnabled && user.phone && user.phoneVerified) {
      const phone = user.phone;
      this.smsService
        .sendNotificationSms({
          to: phone,
          title: data.title,
          message: data.message,
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
    } else if (smsEnabled && user.phone && !user.phoneVerified) {
      this.logger.debug(
        `SMS habilitado pero usuario ${data.userId} sin telefono verificado — skip`,
      );
    } else if (smsEnabled && !user.phone) {
      this.logger.debug(
        `SMS habilitado pero usuario ${data.userId} sin telefono`,
      );
    }

    if (whatsappEnabled && user.phone && user.phoneVerified) {
      const phone = user.phone;
      this.whatsappService
        .sendNotificationWhatsapp({
          to: phone,
          title: data.title,
          message: data.message,
        })
        .then((ok) => {
          if (!ok) {
            this.logger.warn(
              `No se pudo enviar WhatsApp a ${maskPhone(phone)}`,
            );
          }
        })
        .catch((err: unknown) => {
          this.logger.warn(
            `Error WhatsApp notif a ${maskPhone(phone)}: ${sanitizeForLog(err instanceof Error ? err.message : String(err))}`,
          );
        });
    } else if (whatsappEnabled && user.phone && !user.phoneVerified) {
      this.logger.debug(
        `WhatsApp habilitado pero usuario ${data.userId} sin telefono verificado — skip`,
      );
    } else if (whatsappEnabled && !user.phone) {
      this.logger.debug(
        `WhatsApp habilitado pero usuario ${data.userId} sin telefono — skip`,
      );
    }
  }
}
