import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  EmailVerificationEmail,
  type EmailVerificationEmailProps,
} from "./email-verification";
import {
  PasswordResetEmail,
  type PasswordResetEmailProps,
} from "./password-reset";
import { NotificationEmail, type NotificationEmailProps } from "./notification";
import {
  ContactInternalEmail,
  type ContactInternalEmailProps,
} from "./contact-internal";
import { TicketNotificationEmail } from "./ticket-notification";

export { EmailLayout, type EmailLayoutProps } from "./email-layout";
export {
  EmailVerificationEmail,
  type EmailVerificationEmailProps,
} from "./email-verification";
export {
  PasswordResetEmail,
  type PasswordResetEmailProps,
} from "./password-reset";
export { NotificationEmail, type NotificationEmailProps } from "./notification";
export {
  ContactInternalEmail,
  type ContactInternalEmailProps,
} from "./contact-internal";
export {
  TicketNotificationEmail,
  type TicketNotificationEmailProps,
} from "./ticket-notification";

export interface RenderedEmailResult {
  html: string;
  text: string;
}

/**
 * Convierte un marcado HTML en una versión de texto plano legible para
 * clientes de correo que no soportan HTML o para accesibilidad.
 */
function htmlToPlainText(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<head[^>]*>[\s\S]*?<\/head>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/h[1-6]>/gi, "\n\n")
    .replace(
      /<a\s+[^>]*href=["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi,
      "$2 ($1)",
    )
    .replace(/<[^>]+>/g, "")
    .replaceAll("&nbsp;", " ")
    .replaceAll("&bull;", "•")
    .replaceAll("&copy;", "©")
    .replace(/&[a-z0-9]+;/gi, " ")
    .replace(/\n\s*\n\s*\n/g, "\n\n")
    .trim();
}

/**
 * Renderiza de forma segura un elemento de React Email a HTML completo con Doctype y texto plano.
 */
export function renderReactEmail(
  element: React.ReactElement,
): Promise<RenderedEmailResult> {
  const markup = renderToStaticMarkup(element);
  const html = markup.startsWith("<!DOCTYPE")
    ? markup
    : `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">\n${markup}`;
  const text = htmlToPlainText(markup);
  return Promise.resolve({ html, text });
}

/**
 * Renderiza el correo de verificación de cuenta de Better Auth con React Email.
 */
export function renderEmailVerification(
  props: EmailVerificationEmailProps,
): Promise<RenderedEmailResult> {
  return renderReactEmail(React.createElement(EmailVerificationEmail, props));
}

/**
 * Renderiza el correo de restablecimiento de contraseña de Better Auth con React Email.
 */
export function renderPasswordReset(
  props: PasswordResetEmailProps,
): Promise<RenderedEmailResult> {
  return renderReactEmail(React.createElement(PasswordResetEmail, props));
}

/**
 * Renderiza una notificación transaccional del sistema con React Email.
 */
export function renderNotification(
  props: NotificationEmailProps,
): Promise<RenderedEmailResult> {
  return renderReactEmail(React.createElement(NotificationEmail, props));
}

/**
 * Renderiza el correo interno para el equipo BSK con los datos del formulario de contacto.
 */
export function renderContactInternal(
  props: ContactInternalEmailProps,
): Promise<RenderedEmailResult> {
  return renderReactEmail(React.createElement(ContactInternalEmail, props));
}

/**
 * Renderiza el correo de confirmación de registro y ticket de asistencia con React Email.
 */
export function renderTicketNotification(
  props: import("./ticket-notification").TicketNotificationEmailProps & {
    slug?: string;
  },
): Promise<RenderedEmailResult> {
  return renderReactEmail(React.createElement(TicketNotificationEmail, props));
}
