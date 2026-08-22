export function maskAmount(_amount: number | string): string {
  return "***";
}

export function maskReference(ref: string): string {
  if (!ref || ref.length < 8) return "***";
  return `${ref.slice(0, 4)}...${ref.slice(-4)}`;
}

export function maskUserId(id: string): string {
  if (!id || id.length < 8) return "***";
  return `${id.slice(0, 4)}...${id.slice(-4)}`;
}

export function maskEmail(email: string): string {
  if (!email?.includes("@")) return "***";
  const [local, domain] = email.split("@");
  if (local.length <= 2) return `***@${domain}`;
  return `${local.slice(0, 2)}***@${domain}`;
}

/** Enmascara un numero de telefono E.164 para logs: +57300***567 */
export function maskPhone(phone: string): string {
  if (!phone || phone.length < 6) return "***";
  return `${phone.slice(0, 5)}***${phone.slice(-3)}`;
}

/**
 * Enmascara un numero de documento de identidad para logs:
 * conserva solo los primeros 2 y ultimos 2 digitos.
 */
export function maskDocument(document: string): string {
  if (!document || document.length < 6) return "***";
  return `${document.slice(0, 2)}***${document.slice(-2)}`;
}

/** M18: Strip CRLF and other control chars to prevent log injection. */
export function sanitizeForLog(value: string): string {
  return value.replace(/[\r\n\t]/g, " ").slice(0, 200);
}
