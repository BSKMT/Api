/** Forma de `user.settings.notifications`. */
export interface NotificationSettings {
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
export interface UserNotifyInfo {
  email: string;
  phone: string | null;
  phoneVerified: boolean;
  emailVerified: boolean;
  settings: {
    notifications?: NotificationSettings;
  };
}

/**
 * Extrae el telefono del perfil del usuario.
 */
export function extractPhone(user: unknown): string | null {
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
 * Determina si un canal especifico esta habilitado, considerando
 * overrides por categoria.
 */
export function isChannelEnabled(
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
