/**
 * Plantillas de texto plano para mensajes transaccionales enviados a
 * traves de Bird WhatsApp API (`POST /v1/whatsapp/messages` via
 * `bird.whatsapp.send()`).
 *
 * A diferencia de las plantillas de correo (HTML), los mensajes de
 * WhatsApp son texto plano sin formato. WhatsApp no interpreta HTML,
 * por lo que no hay vector XSS en el cuerpo del mensaje, pero se deben
 * sanitizar caracteres de control para prevenir CRLF injection y
 * limitar la longitud a 4096 caracteres (limite de WhatsApp).
 *
 * Seguridad (OWASP A05:2025 — Injection):
 *  - Se eliminan caracteres de control (CRLF, tabs, null bytes) del
 *    contenido para prevenir log injection y header injection.
 *  - Se trunca el cuerpo a 4096 caracteres (limite de WhatsApp).
 *  - `preview_url` se establece en `false` para evitar que WhatsApp
 *    genere previews de URLs que podrian ser usadas para phishing.
 *  - No se incluyen URLs dinamicas en las plantillas de notificacion.
 */

/** Limite maximo del cuerpo de un mensaje de WhatsApp (texto plano). */
const WHATSAPP_MAX_LEN = 4096;

/**
 * Elimina caracteres de control y normaliza espacios para prevenir
 * CRLF injection (OWASP A05:2025 — Injection, CWE-117).
 */
function sanitizeText(text: string): string {
  return text
    .replace(/[\r\n\t\v\f\0]/g, " ")
    .replaceAll("\u00a0", " ")
    .trim();
}

/** Trunca el texto al limite maximo de WhatsApp con elipsis. */
function truncate(text: string): string {
  if (text.length <= WHATSAPP_MAX_LEN) return text;
  return text.slice(0, WHATSAPP_MAX_LEN - 3) + "...";
}

export function notificationWhatsappTemplate(data: {
  title: string;
  message: string;
}): string {
  const title = sanitizeText(data.title);
  const message = sanitizeText(data.message);

  return truncate(
    [
      "BSK Motorcycle Team",
      "",
      title,
      "",
      message,
      "",
      "BSK Motorcycle Team — Bogota, Colombia.",
      "Este mensaje se envio automaticamente.",
    ].join("\n"),
  );
}
