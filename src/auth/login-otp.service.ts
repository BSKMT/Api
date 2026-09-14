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

    await this.assertEmailThrottle(session.userEmail);

    if (!this.birdVerifyService.isConfigured()) {
      this.logger.error(
        "Bird Verify no configurado (BIRD_API_KEY ausente) — initiate bloqueado",
      );
      throw new UnauthorizedException(LoginOtpService.GENERIC_AUTH_ERROR, {
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
      email: session.userEmail,
      betterAuthId: session.betterAuthId,
      sessionCookies: encryptedCookies,
      status: "pending",
      attempts: 0,
      expiresAt,
    });

    await dispatchBirdVerification(
      this.birdVerifyService,
      otpRecord,
      session.userEmail,
      requestId,
      session.betterAuthId,
      this.logger,
      LoginOtpService.GENERIC_AUTH_ERROR,
    );

    return { requestId };
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
    const sessionCookies = extractCookiesFromHeaders(setCookieHeaders);

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
  ): Promise<{ cookies: string[] }> {
    const otpRecord = await this.otpModel.findOne({
      requestId,
      status: "pending",
    });

    if (!otpRecord) {
      throw new GoneException(
        "El código de verificación no existe, ya fue utilizado o ha expirado.",
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
