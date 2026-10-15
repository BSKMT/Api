/**
 * Plantillas HTML y SMS para los mensajes transaccionales enviados a
 * traves de Bird. Todas usan un diseno minimalista, accesible y
 * responsivo, alineado con la identidad visual de BSK Motorcycle Team.
 *
 * Seguridad (OWASP A05:2025 — Injection):
 *  - Todas las funciones de plantilla escapan los metacaracteres HTML
 *    con `escapeHtml()` para prevenir XSS en el contenido del correo.
 *  - Las URL pasadas a atributos `href` tambien se escapan.
 *  - Las plantillas SMS son texto plano (sin HTML) y se truncan a 160
 *    caracteres para mantenerse en un segmento GSM-7.
 */

const HTML_ESCAPE_MAP: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#x27;",
};

const HTML_ESCAPE_PATTERN = /[&<>"']/g;

function escapeHtml(str: string): string {
  return str.replace(
    HTML_ESCAPE_PATTERN,
    (char) => HTML_ESCAPE_MAP[char] ?? char,
  );
}

const SHELL = (title: string, body: string): string => `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(title)}</title>
</head>
<body style="margin:0;padding:0;background-color:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0f172a;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f8fafc;padding:32px 0;">
    <tr>
      <td align="center">
        <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08);">
          <tr>
            <td style="background-color:#0f172a;padding:24px 32px;text-align:center;">
              <span style="font-size:18px;font-weight:700;letter-spacing:0.08em;color:#ffffff;">BSK MOTORCYCLE TEAM</span>
            </td>
          </tr>
          <tr>
            <td style="padding:32px;">${body}</td>
          </tr>
          <tr>
            <td style="padding:0 32px 24px;">
              <p style="margin:0;font-size:11px;line-height:1.6;color:#64748b;text-align:center;border-top:1px solid #e2e8f0;padding-top:16px;">
                <strong>Organizaci&oacute;n Motera S.A.S.</strong> &bull; NIT 901.444.877-6<br />
                Domicilio Principal: Bogot&aacute; D.C., Colombia &bull; C&aacute;mara de Comercio de Bogot&aacute;<br />
                Mensaje transaccional autom&aacute;tico. Protecci&oacute;n de datos (Ley 1581 de 2012): datos@bskmt.com
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

const HEADING = (text: string): string =>
  `<h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;color:#0f172a;">${escapeHtml(text)}</h1>`;
const PARAGRAPH = (text: string): string =>
  `<p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:#334155;">${escapeHtml(text)}</p>`;
const META_ROW = (label: string, value: string): string =>
  `<tr><td style="padding:6px 12px;font-size:13px;font-weight:600;color:#0f172a;background:#f1f5f9;border:1px solid #e2e8f0;white-space:nowrap;">${escapeHtml(label)}</td><td style="padding:6px 12px;font-size:13px;color:#334155;border:1px solid #e2e8f0;">${escapeHtml(value)}</td></tr>`;

// ── HTML Email Templates ───────────────────────────────────────────

export function contactInternalTemplate(data: {
  name: string;
  email: string;
  subject: string;
  message: string;
  source?: string;
}): string {
  const rows = [
    META_ROW("Nombre", data.name),
    META_ROW("Correo", data.email),
    META_ROW("Asunto", data.subject),
  ];
  if (data.source) {
    rows.push(META_ROW("Origen", data.source));
  }

  return SHELL(
    "Nuevo mensaje de contacto",
    `${HEADING("Nuevo mensaje desde el formulario de contacto")}
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 16px;border-collapse:collapse;width:100%;">
      ${rows.join("")}
    </table>
    <p style="margin:8px 0 6px;font-size:13px;font-weight:600;color:#0f172a;">Mensaje</p>
    <blockquote style="margin:0;padding:12px 16px;background:#f8fafc;border-left:3px solid #dc2626;font-size:14px;line-height:1.6;color:#334155;white-space:pre-wrap;">${escapeHtml(data.message)}</blockquote>`,
  );
}

export function notificationTemplate(data: {
  title: string;
  message: string;
}): string {
  return SHELL(data.title, `${HEADING(data.title)}${PARAGRAPH(data.message)}`);
}

export function emailVerificationTemplate(data: {
  name: string;
  verificationUrl: string;
}): string {
  const heading = HEADING(`Hola ${data.name}, verifica tu correo`);
  const safeUrl = escapeHtml(data.verificationUrl);
  return SHELL(
    "Verifica tu correo electronico",
    `${heading}
    ${PARAGRAPH("Has creado una cuenta en BSK Motorcycle Team. Confirma tu direccion de correo electronico para activar tu cuenta y acceder al panel de miembro.")}
    <p style="margin:24px 0;">
      <a href="${safeUrl}" style="display:inline-block;background-color:#dc2626;color:#ffffff;font-size:14px;font-weight:600;letter-spacing:0.05em;text-transform:uppercase;padding:12px 32px;border-radius:9999px;text-decoration:none;">
        Verificar correo
      </a>
    </p>
    ${PARAGRAPH("Si no puedes ver el boton, copia y pega el siguiente enlace en tu navegador:")}
    <p style="margin:8px 0 0;font-size:13px;line-height:1.5;color:#64748b;word-break:break-all;">${safeUrl}</p>
    ${PARAGRAPH("Si no creaste una cuenta en BSK Motorcycle Team, puedes ignorar este correo de forma segura.")}`,
  );
}

export function passwordResetTemplate(data: {
  name: string;
  resetUrl: string;
}): string {
  const heading = HEADING(`Hola ${data.name}`);
  const safeUrl = escapeHtml(data.resetUrl);
  return SHELL(
    "Restablece tu contrasena",
    `${heading}
    ${PARAGRAPH("Has solicitado restablecer tu contrasena de acceso a BSK Motorcycle Team. Haz clic en el siguiente boton para establecer una nueva contrasena:")}
    <p style="margin:24px 0;">
      <a href="${safeUrl}" style="display:inline-block;background-color:#dc2626;color:#ffffff;font-size:14px;font-weight:600;letter-spacing:0.05em;text-transform:uppercase;padding:12px 32px;border-radius:9999px;text-decoration:none;">
        Restablecer contrasena
      </a>
    </p>
    ${PARAGRAPH("Si no puedes ver el boton, copia y pega el siguiente enlace en tu navegador:")}
    <p style="margin:8px 0 0;font-size:13px;line-height:1.5;color:#64748b;word-break:break-all;">${safeUrl}</p>
    ${PARAGRAPH("Este enlace expirara en 1 hora por razones de seguridad. Si no solicitaste este cambio, puedes ignorar este correo de forma segura.")}`,
  );
}

export function ticketNotificationTemplate(data: {
  recipientName: string;
  type: "EVENT" | "COURSE";
  title: string;
  checkInCode: string;
  qrDataUrl: string;
  dateText: string;
  timeText?: string;
  locationText?: string;
  meetingPointText?: string;
  coordinatorName?: string;
  panelUrl: string;
}): string {
  const safeName = escapeHtml(data.recipientName);
  const safeTitle = escapeHtml(data.title);
  const safeCode = escapeHtml(data.checkInCode);
  const safeDate = escapeHtml(data.dateText);
  const safeLoc = escapeHtml(
    data.meetingPointText || data.locationText || "Punto oficial BSK",
  );
  const safeUrl = escapeHtml(data.panelUrl);
  const typeLabel = data.type === "EVENT" ? "Evento" : "Curso";

  return SHELL(
    `Confirmación de Registro y Ticket - ${safeTitle}`,
    `${HEADING(`¡Tu registro en ${safeTitle} está confirmado!`)}
    ${PARAGRAPH(`Hola ${safeName}, tu cupo para el ${typeLabel.toLowerCase()} <strong>${safeTitle}</strong> ha sido confirmado exitosamente.`)}
    <div style="background-color:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:16px;margin:16px 0;">
      <p style="margin:0 0 8px;font-size:13px;color:#1e293b;"><strong>Fecha:</strong> ${safeDate} ${data.timeText ? `· ${escapeHtml(data.timeText)}` : ""}</p>
      <p style="margin:0 0 8px;font-size:13px;color:#1e293b;"><strong>Lugar / Encuentro:</strong> ${safeLoc}</p>
      ${data.coordinatorName ? `<p style="margin:0;font-size:13px;color:#1e293b;"><strong>Coordinador:</strong> ${escapeHtml(data.coordinatorName)}</p>` : ""}
    </div>
    <div style="background-color:#ffffff;border:2px dashed #cbd5e1;border-radius:16px;padding:20px;text-align:center;margin:20px 0;">
      <p style="margin:0 0 12px;color:#dc2626;font-size:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;">PASE DIGITAL DE ASISTENCIA</p>
      <img src="${data.qrDataUrl}" width="180" height="180" alt="QR Asistencia" style="display:block;margin:0 auto 12px;" />
      <p style="margin:0;font-family:Courier,monospace;font-size:22px;font-weight:800;color:#0f172a;">${safeCode}</p>
      <p style="margin:4px 0 0;font-size:11px;color:#64748b;">Presenta este código al coordinador en campo</p>
    </div>
    <p style="background-color:#f1f5f9;border-left:4px solid #38bdf8;padding:10px 14px;border-radius:4px;font-size:12px;color:#334155;">
      📎 <strong>Ticket PDF adjunto:</strong> Hemos adjuntado tu ticket oficial en formato PDF para que puedas guardarlo o imprimirlo.
    </p>
    <p style="margin:24px 0;text-align:center;">
      <a href="${safeUrl}" style="display:inline-block;background-color:#dc2626;color:#ffffff;font-size:14px;font-weight:600;letter-spacing:0.05em;text-transform:uppercase;padding:12px 32px;border-radius:9999px;text-decoration:none;">
        Ver en el Panel BSK
      </a>
    </p>`,
  );
}

// ── SMS Text Templates ─────────────────────────────────────────────
//
// SMS messages are billed per segment (160 GSM-7 chars, 70 UCS-2).
// Keep templates under 160 chars to stay in one segment.
const SMS_MAX_LEN = 160;

function truncateSms(text: string): string {
  if (text.length <= SMS_MAX_LEN) return text;
  return text.slice(0, SMS_MAX_LEN - 3) + "...";
}

export function notificationSmsTemplate(data: {
  title: string;
  message: string;
}): string {
  return truncateSms(`BSKMT: ${data.title}. ${data.message}`);
}
