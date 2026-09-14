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
  primerNombre?: string;
  segundoNombre?: string;
  primerApellido?: string;
  segundoApellido?: string;
  country?: string;
  birthDate?: string;
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

export interface AuthInstance {
  handler: (request: Request) => Promise<Response>;
  api: {
    getSession: (params: {
      headers: AuthHeaders;
    }) => Promise<BetterAuthSessionData | null>;
    changePassword: (params: {
      body: { currentPassword: string; newPassword: string };
      headers: AuthHeaders;
    }) => Promise<unknown>;
    signInEmail: SignInEmailFn;
  };
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
