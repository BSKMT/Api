import { Logger } from "@nestjs/common";
import type { BirdEmailService } from "../bird/bird-email.service";
import type { BetterAuthUser } from "./better-auth.types";
import { maskEmail } from "../common/utils/log-redact.util";

export function createPasswordResetCallback(
  getEmailService: () => BirdEmailService | null,
  getLandingPageUrl: () => string,
  authLogger: Logger,
) {
  return async ({
    user,
    token,
  }: {
    user: BetterAuthUser;
    token: string;
  }): Promise<void> => {
    const landingPageUrl = getLandingPageUrl();
    const resetUrl = `${landingPageUrl}/restaurar-contrasena#token=${token}`;
    const emailService = getEmailService();

    if (emailService) {
      const ok = await emailService.sendPasswordResetEmail({
        to: user.email,
        name: user.name ?? user.email,
        resetUrl,
      });
      if (!ok) {
        authLogger.error(
          `Password Reset: No se pudo enviar el correo a ${maskEmail(user.email)} — ` +
            "Bird no configurado o la API rechazo el envio.",
        );
      }
    } else {
      authLogger.error(
        `Password Reset: Email service no inyectado — reset email NOT sent to ${maskEmail(user.email)}.`,
      );
    }
  };
}

export function createVerificationEmailCallback(
  getEmailService: () => BirdEmailService | null,
  getLandingPageUrl: () => string,
  authLogger: Logger,
) {
  return async ({
    user,
    token,
  }: {
    user: BetterAuthUser;
    token: string;
  }): Promise<void> => {
    const landingPageUrl = getLandingPageUrl();
    const verificationUrl = `${landingPageUrl}/verificar-correo#token=${token}`;
    const emailService = getEmailService();

    if (emailService) {
      const ok = await emailService.sendVerificationEmail({
        to: user.email,
        name: user.name ?? user.email,
        verificationUrl,
      });
      if (!ok) {
        authLogger.error(
          `Email Verification: No se pudo enviar el correo de verificacion a ${maskEmail(user.email)} — ` +
            "Bird no configurado o la API rechazo el envio.",
        );
      }
    } else {
      authLogger.error(
        `Email Verification: Email service no inyectado — verification email NOT sent to ${maskEmail(user.email)}.`,
      );
    }
  };
}
