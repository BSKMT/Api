export interface BetterAuthCoreModule {
  betterAuth: (options: Record<string, unknown>) => AuthInstance;
}

export interface BetterAuthMongoModule {
  mongodbAdapter: (db: unknown, opts: Record<string, unknown>) => unknown;
}

export interface BetterAuthUser {
  id: string;
  email: string;
  emailVerified: boolean;
  name: string;
  image?: string | null;
  createdAt: Date;
  updatedAt: Date;
  role?: string;
  username?: string;
  primerNombre?: string;
  segundoNombre?: string;
  primerApellido?: string;
  segundoApellido?: string;
  country?: string;
  birthDate?: string;
}

export type AuthPortal = "standard" | "fascia" | "console" | "superadmin";

export const VALID_AUTH_PORTALS: ReadonlySet<AuthPortal> = new Set<AuthPortal>([
  "standard",
  "fascia",
  "console",
  "superadmin",
]);

export function normalizeAuthPortal(value: unknown): AuthPortal {
  if (typeof value === "string") {
    const normalized = value.toLowerCase().trim() as AuthPortal;
    if (VALID_AUTH_PORTALS.has(normalized)) {
      return normalized;
    }
  }
  return "standard";
}

export interface BetterAuthSession {
  id: string;
  token: string;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
  userId: string;
  ipAddress?: string | null;
  userAgent?: string | null;
  otpPending?: boolean;
  authPortal?: AuthPortal | string | null;
}

export interface BetterAuthSessionData {
  session: BetterAuthSession;
  user: BetterAuthUser;
}

export type AuthHeaders =
  Headers | Record<string, string | string[] | undefined>;

export interface SignInEmailBaseParams {
  body: { email: string; password: string; rememberMe?: boolean };
  headers?: AuthHeaders;
}

export interface SignInEmailAsResponseParams extends SignInEmailBaseParams {
  asResponse: true;
}

export interface SignInEmailDataParams extends SignInEmailBaseParams {
  asResponse?: false;
}

export interface SignInEmailFn {
  (params: SignInEmailAsResponseParams): Promise<Response>;
  (params: SignInEmailDataParams): Promise<unknown>;
}

export interface BetterAuthPasswordHasher {
  hash: (password: string) => Promise<string>;
  verify: (data: { hash: string; password: string }) => Promise<boolean>;
}

export interface BetterAuthContextLike {
  password: BetterAuthPasswordHasher;
}

export type BetterAuthApiErrorCtor = new (
  status: string,
  body?: { message?: string; code?: string },
) => Error;

export interface AuthInstance {
  handler: (request: Request) => Promise<Response>;
  api: {
    getSession: (params: {
      headers: AuthHeaders;
      query?: { disableCookieCache?: boolean };
    }) => Promise<BetterAuthSessionData | null>;
    changePassword: (params: {
      body: {
        currentPassword: string;
        newPassword: string;
        revokeOtherSessions?: boolean;
      };
      headers: AuthHeaders;
    }) => Promise<unknown>;
    signInEmail: SignInEmailFn;
    signUpEmail: (params: {
      body: {
        email: string;
        password: string;
        name: string;
        [key: string]: unknown;
      };
      headers?: AuthHeaders;
    }) => Promise<{
      user?: BetterAuthUser;
      session?: BetterAuthSession;
    } | null>;
  };
  $context: Promise<BetterAuthContextLike>;
  options: unknown;
  $ERROR_CODES: Record<string, string>;
  $Infer: {
    Session: BetterAuthSessionData;
  };
}

export type BetterAuthFn = (options: Record<string, unknown>) => AuthInstance;
export type MongodbAdapterFn = (
  db: unknown,
  opts: Record<string, unknown>,
) => unknown;

export interface BetterAuthDeps {
  betterAuth: BetterAuthFn;
  mongodbAdapter: MongodbAdapterFn;
}
