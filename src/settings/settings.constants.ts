export const NOTIF_CHANNELS = ["email", "sms", "whatsapp", "push"] as const;

export const DEFAULT_SETTINGS = {
  notifications: {
    channels: { email: true, sms: true, whatsapp: false, push: false },
    categories: {
      "Rodadas y eventos": {
        email: true,
        sms: true,
        whatsapp: true,
        push: true,
      },
      "ARPHA 24/7": { email: true, sms: true, whatsapp: false, push: true },
      "Tienda BSK": { email: true, sms: false, whatsapp: false, push: false },
      "Academia Ready To Ride": {
        email: true,
        sms: false,
        whatsapp: true,
        push: false,
      },
      "Membresia y pagos": {
        email: true,
        sms: true,
        whatsapp: false,
        push: false,
      },
      "Comunidad BSK": {
        email: false,
        sms: false,
        whatsapp: true,
        push: false,
      },
    },
  },
  privacy: {
    profileVisible: true,
    showLocation: true,
    allowFriendRequests: false,
    shareStats: true,
    showMotorcycle: true,
  },
  appearance: {
    theme: "dark",
    density: "comfortable",
    language: "es-CO",
  },
  dashboard: {
    defaultView: "/panel",
    widgets: {
      "proximos-eventos": true,
      "cursos-en-progreso": true,
      "resumen-actividad": true,
      "actualizaciones-recientes": false,
      "accesos-rapidos": true,
      "banner-membresia": true,
    },
  },
};

export interface SessionRow {
  id: string;
  token: string;
  userId: string;
  expiresAt: Date;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface LeanUser {
  _id: { toString(): string };
  email: string;
  role: string;
  profileCompleted: boolean;
  emailVerified: boolean;
  legalConsentAccepted: boolean;
  isActive: boolean;
  membershipLevel?: string | null;
  membershipStartDate?: Date | null;
  membershipExpiryDate?: Date | null;
  membershipPaymentPlan?: string | null;
  betterAuthId?: string;
  profile?: Record<string, Record<string, unknown>>;
  settings?: Record<string, unknown>;
  accountDeletionRequested?: boolean;
  accountDeletionRequestedAt?: Date | null;
  createdAt?: Date;
  updatedAt?: Date;
}
