import {
  Injectable,
  Logger,
  BadRequestException,
  UnauthorizedException,
  GoneException,
  HttpException,
  HttpStatus,
} from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";
import { randomBytes } from "node:crypto";
import { LoginOtp, LoginOtpDocument } from "./schemas/login-otp.schema";
import { User, UserDocument, UserRole } from "../users/schemas/user.schema";
import {
  BirdVerifyService,
  type BirdCheckResult,
} from "../bird-verify/bird-verify.service";
import { getAuth } from "./better-auth";
import { maskEmail } from "../common/utils/log-redact.util";
import {
  deriveSessionEncryptionKey,
  encryptSessionCookies,
  extractCookiesFromHeaders,
} from "./login-otp-crypto.helper";
import {
  dispatchBirdVerification,
  handleBirdCheckError,
  processBirdCheckResult,
} from "./login-otp-check.helper";

@Injectable()
export class LoginOtpService {
  private readonly logger = new Logger(LoginOtpService.name);

  private readonly EMAIL_INITIATE_WINDOW_MS = 5 * 60 * 1000;
  private readonly EMAIL_INITIATE_MAX = 3;
  private readonly sessionEncKey: Buffer;

  private static readonly GENERIC_AUTH_ERROR =
    "Credenciales inválidas. Verifica tu correo y contraseña.";

  constructor(
    @InjectModel(LoginOtp.name)
    private readonly otpModel: Model<LoginOtpDocument>,
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    private readonly birdVerifyService: BirdVerifyService,
  ) {
    const secret = process.env.BETTER_AUTH_SECRET;
    if (!secret) {
      throw new Error(
        "BETTER_AUTH_SECRET environment variable is required for session encryption",
      );
    }
    this.sessionEncKey = deriveSessionEncryptionKey(secret);
  }

  private generateRequestId(): string {
    return randomBytes(16).toString("hex");
  }

  private async dispatchOtpAndSave(
    targetEmail: string,
    session: { sessionCookies: string[]; betterAuthId: string },
    errorMessage: string = LoginOtpService.GENERIC_AUTH_ERROR,
  ): Promise<{ requestId: string }> {
    await this.assertEmailThrottle(targetEmail);

    if (!this.birdVerifyService.isConfigured()) {
      this.logger.error(
        "Bird Verify no configurado (BIRD_API_KEY ausente) — initiate bloqueado",
      );
      throw new UnauthorizedException(errorMessage, {
        cause: "Bird Verify not configured",
      });
    }

    const requestId = this.generateRequestId();
    const expiresAt = new Date(Date.now() + 3600 * 1000);
    const encryptedCookies = encryptSessionCookies(
      session.sessionCookies,
      this.sessionEncKey,
    );

    const otpRecord = await this.otpModel.create({
      requestId,
      email: targetEmail,
      betterAuthId: session.betterAuthId,
      sessionCookies: encryptedCookies,
      status: "pending",
      attempts: 0,
      expiresAt,
    });

    await dispatchBirdVerification(
      this.birdVerifyService,
      otpRecord,
      targetEmail,
      requestId,
      session.betterAuthId,
      this.logger,
      errorMessage,
    );

    return { requestId };
  }

  /**
   * Login estándar para New-panel (dash.bskmt.com):
   * Requiere correo y contraseña. Envía OTP al correo de la cuenta.
   */
  async initiateLogin(
    email: string,
    password: string,
    rememberMe?: boolean,
    clientIp?: string,
    userAgent?: string,
  ): Promise<{ requestId: string }> {
    const remember = rememberMe === true;

    const session = await this.authenticateAndExtractSession(
      email,
      password,
      remember,
      clientIp,
      userAgent,
    );

    return this.dispatchOtpAndSave(session.userEmail, session);
  }

  /**
   * Login para BSK Fascia (panel.bskmt.com - Hub de Operaciones y Colaboradores):
   * Requiere Nombre de Usuario + Contraseña.
   * Valida que el colaborador tenga un subrol asignado o rol de gestión.
   * Envía el código OTP a su correo institucional (o correo registrado).
   */
  async initiateFasciaLogin(
    username: string,
    password: string,
    rememberMe?: boolean,
    clientIp?: string,
    userAgent?: string,
  ): Promise<{ requestId: string }> {
    const normalizedUsername = (username ?? "").toLowerCase().trim();
    if (!normalizedUsername) {
      throw new BadRequestException("El nombre de usuario es obligatorio.");
    }

    const user = await this.userModel.findOne({ username: normalizedUsername }).lean();
    if (!user) {
      this.logger.warn(`Fascia login fallido: usuario "${normalizedUsername}" no encontrado.`);
      throw new UnauthorizedException("Credenciales inválidas. Verifica tu usuario y contraseña.");
    }

    if (user.isActive === false) {
      throw new UnauthorizedException(
        "Tu cuenta de colaborador se encuentra inactiva. Contacta al área de talento humano.",
      );
    }

    if (user.accountDeletionRequested === true) {
      throw new UnauthorizedException(
        "Esta cuenta está en proceso de eliminación.",
      );
    }

    // Regla de acceso para Fascia (panel.bskmt.com):
    // Exclusivo para Gestores (campo y oficina) o administradores / superadministradores
    const isGestor =
      user.role === UserRole.GESTOR || Boolean(user.subrol);
    const isAdminOrSuper =
      user.role === UserRole.ADMIN || user.role === UserRole.SUPERADMIN;

    if (!isGestor && !isAdminOrSuper) {
      this.logger.warn(
        `Fascia login bloqueado: usuario "${normalizedUsername}" (${user.email}) no tiene rol de gestor (rol: ${user.role}, subrol: ${user.subrol}).`,
      );
      throw new UnauthorizedException(
        "Acceso restringido: Esta cuenta no posee rol de Gestor (Campo u Oficina) asignado para panel.bskmt.com.",
      );
    }

    const targetEmail = (
      user.contractorInfo?.correoInstitucional || user.email
    ).toLowerCase();

    const session = await this.authenticateAndExtractSession(
      user.email,
      password,
      rememberMe === true,
      clientIp,
      userAgent,
    );

    return this.dispatchOtpAndSave(
      targetEmail,
      session,
      "Error al iniciar sesión en Fascia. Verifica tus credenciales.",
    );
  }

  /**
   * Login para BSK Console (console.bskmt.com - Consola Ejecutiva de Administración):
   * Requisito Cuádruple ESTRICTO: Correo Electrónico + Nombre de Usuario + Contraseña + OTP.
   * Solo acceden usuarios con rol 'admin' o 'superadmin'.
   * Envía el OTP al correo corporativo del contratista / administrador.
   */
  async initiateConsoleLogin(
    email: string,
    username: string,
    password: string,
    rememberMe?: boolean,
    clientIp?: string,
    userAgent?: string,
  ): Promise<{ requestId: string }> {
    const normalizedEmail = (email ?? "").toLowerCase().trim();
    const normalizedUsername = (username ?? "").toLowerCase().trim();

    if (!normalizedEmail || !normalizedUsername) {
      throw new BadRequestException(
        "Tanto el correo electrónico como el nombre de usuario son obligatorios.",
      );
    }

    const user = await this.userModel
      .findOne({ email: normalizedEmail, username: normalizedUsername })
      .lean();

    if (!user) {
      this.logger.warn(
        `Console login fallido: no coincide email "${normalizedEmail}" con usuario "${normalizedUsername}".`,
      );
      throw new UnauthorizedException(
        "Credenciales administrativas inválidas. Verifica tu correo, usuario y contraseña.",
      );
    }

    if (user.isActive === false) {
      throw new UnauthorizedException(
        "Cuenta administrativa inactiva. Contacta a un Superadministrador.",
      );
    }

    if (user.accountDeletionRequested === true) {
      throw new UnauthorizedException(
        "Esta cuenta está en proceso de eliminación.",
      );
    }

    // Límite estricto: ÚNICAMENTE roles 'admin' o 'superadmin'
    if (user.role !== UserRole.ADMIN && user.role !== UserRole.SUPERADMIN) {
      this.logger.warn(
        `Console login bloqueado: usuario "${normalizedUsername}" tiene rol "${user.role}" (requiere admin o superadmin).`,
      );
      throw new UnauthorizedException(
        "Acceso restringido: Esta cuenta no posee privilegios administrativos ejecutivos.",
      );
    }

    const targetEmail = (
      user.contractorInfo?.correoInstitucional || user.email
    ).toLowerCase();

    const session = await this.authenticateAndExtractSession(
      user.email,
      password,
      rememberMe === true,
      clientIp,
      userAgent,
    );

    return this.dispatchOtpAndSave(
      targetEmail,
      session,
      "Error al iniciar sesión en la Consola Administrativa.",
    );
  }

  /**
   * Login para BSK Superadmin (New-BSKMT - Dueños y Propietarios):
   * Requisito de máxima seguridad: Correo Electrónico + Nombre de Usuario + Contraseña + OTP.
   * Acceso exclusivo para el rol 'superadmin'.
   */
  async initiateSuperAdminLogin(
    email: string,
    username: string,
    password: string,
    rememberMe?: boolean,
    clientIp?: string,
    userAgent?: string,
  ): Promise<{ requestId: string }> {
    const normalizedEmail = (email ?? "").toLowerCase().trim();
    const normalizedUsername = (username ?? "").toLowerCase().trim();

    if (!normalizedEmail || !normalizedUsername) {
      throw new BadRequestException(
        "Tanto el correo electrónico como el nombre de usuario son obligatorios.",
      );
    }

    const user = await this.userModel
      .findOne({ email: normalizedEmail, username: normalizedUsername })
      .lean();

    if (!user) {
      this.logger.warn(
        `Superadmin login fallido: credenciales no coinciden para "${normalizedEmail}".`,
      );
      throw new UnauthorizedException("Credenciales de superadministrador inválidas.");
    }

    if (user.isActive === false) {
      throw new UnauthorizedException(
        "Cuenta de superadministrador inactiva.",
      );
    }

    if (user.role !== UserRole.SUPERADMIN) {
      this.logger.warn(
        `Superadmin login denegado: usuario "${normalizedUsername}" no tiene rol 'superadmin' (rol actual: ${user.role}).`,
      );
      throw new UnauthorizedException(
        "Acceso denegado: Esta cuenta no posee privilegios de Superadministrador (Owner).",
      );
    }

    const targetEmail = (
      user.contractorInfo?.correoInstitucional || user.email
    ).toLowerCase();

    const session = await this.authenticateAndExtractSession(
      user.email,
      password,
      rememberMe === true,
      clientIp,
      userAgent,
    );

    return this.dispatchOtpAndSave(
      targetEmail,
      session,
      "Error al iniciar sesión como Superadministrador.",
    );
  }

  private async authenticateAndExtractSession(
    email: string,
    password: string,
    remember: boolean,
    clientIp?: string,
    userAgent?: string,
  ): Promise<{
    sessionCookies: string[];
    betterAuthId: string;
    userEmail: string;
  }> {
    let authResponse: Response;
    try {
      const auth = await getAuth();
      const headers = new Headers();
      if (clientIp) headers.set("x-forwarded-for", clientIp);
      if (userAgent) headers.set("user-agent", userAgent);
      authResponse = await auth.api.signInEmail({
        body: { email, password, rememberMe: remember },
        asResponse: true,
        headers,
      });
    } catch (err) {
      this.logger.error(
        `Better Auth signInEmail threw: ${err instanceof Error ? err.message : String(err)}`,
      );
      throw new BadRequestException(
        "Error al procesar la solicitud de inicio de sesión.",
        { cause: err },
      );
    }

    if (authResponse.ok) {
      return await this.extractSessionFromAuthResponse(authResponse, email);
    }

    const rawBody = await authResponse.text().catch(() => "");
    this.logger.warn(
      `Better Auth signInEmail returned ${authResponse.status} — body: ${rawBody.slice(0, 300)}`,
    );
    throw new UnauthorizedException(LoginOtpService.GENERIC_AUTH_ERROR, {
      cause: rawBody,
    });
  }

  private async extractSessionFromAuthResponse(
    authResponse: Response,
    email: string,
  ): Promise<{
    sessionCookies: string[];
    betterAuthId: string;
    userEmail: string;
  }> {
    const setCookieHeaders = authResponse.headers.getSetCookie();
    // Preserve full Set-Cookie header directives (HttpOnly, Secure, SameSite, Path)
    const sessionCookies =
      setCookieHeaders.length > 0
        ? setCookieHeaders
        : extractCookiesFromHeaders(setCookieHeaders);

    const body = (await authResponse.json().catch(() => ({}))) as {
      user?: { id?: string; email?: string };
    };
    const betterAuthId = body.user?.id ?? "";
    const userEmail = body.user?.email ?? email.toLowerCase();

    if (!betterAuthId || sessionCookies.length === 0) {
      this.logger.error(
        `Post-auth error: betterAuthId=${betterAuthId || "MISSING"} cookies=${sessionCookies.length}`,
      );
      throw new UnauthorizedException(LoginOtpService.GENERIC_AUTH_ERROR, {
        cause: `betterAuthId=${betterAuthId || "MISSING"}`,
      });
    }

    return { sessionCookies, betterAuthId, userEmail };
  }

  private async assertEmailThrottle(userEmail: string): Promise<void> {
    const recentCount = await this.otpModel.countDocuments({
      email: userEmail,
      createdAt: { $gt: new Date(Date.now() - this.EMAIL_INITIATE_WINDOW_MS) },
    });
    if (recentCount >= this.EMAIL_INITIATE_MAX) {
      this.logger.warn(
        `Email throttle: ${maskEmail(userEmail)} supero ${this.EMAIL_INITIATE_MAX} OTPs en ${this.EMAIL_INITIATE_WINDOW_MS / 1000}s`,
      );
      throw new HttpException(
        "Has solicitado demasiados codigos de verificacion. Espera 5 minutos e intenta de nuevo.",
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  async verifyOtp(
    requestId: string,
    code: string,
  ): Promise<{ cookies: string[]; setCookieHeaders: string[] }> {
    const otpRecord = await this.otpModel.findOne({
      requestId,
      status: "pending",
    });

    if (!otpRecord) {
      throw new GoneException(
        "El código de verificación no existe, ya fue utilizado o ha expirado.",
      );
    }

    // F-07: Validar límite local de intentos antes de invocar a Bird Verify
    if (otpRecord.attempts >= 5) {
      otpRecord.status = "expired";
      await otpRecord.save();
      throw new GoneException(
        "Has superado el máximo de intentos permitidos. Solicita un nuevo código.",
      );
    }

    let birdResult: BirdCheckResult;
    try {
      birdResult = await this.birdVerifyService.checkEmailVerification(
        otpRecord.email,
        code,
      );
    } catch (err) {
      return await handleBirdCheckError(err, otpRecord, requestId, this.logger);
    }

    return await processBirdCheckResult(
      otpRecord,
      requestId,
      birdResult,
      this.sessionEncKey,
      this.logger,
    );
  }

  async invalidatePending(email: string): Promise<void> {
    await this.otpModel.updateMany(
      { email: email.toLowerCase(), status: "pending" },
      { status: "expired" },
    );
  }
}
