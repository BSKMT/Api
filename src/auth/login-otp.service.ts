import {
  Injectable,
  Logger,
  UnauthorizedException,
  GoneException,
  BadRequestException,
} from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";
import { LoginOtp, LoginOtpDocument } from "./schemas/login-otp.schema";
import { User, UserDocument } from "../users/schemas/user.schema";
import { BirdVerifyService } from "../bird-verify/bird-verify.service";
import { deriveSessionEncryptionKey } from "./login-otp-crypto.helper";
import { revokeEncryptedOtpSession } from "./login-otp-check.helper";
import {
  authenticateAndExtractSession,
  executeDispatchOtpAndSave,
  revokeBetterAuthSessionByCookies,
  assertEmailThrottle,
} from "./login-otp-session.helper";
import {
  findAndValidateStandardUser,
  findAndValidateFasciaUser,
  findAndValidateConsoleUser,
  findAndValidateSuperAdminUser,
  executeVerifyOtp,
} from "./login-otp-portals.helper";
import { verifyTurnstileToken } from "../common/utils/turnstile.util";
import { maskEmail } from "../common/utils/log-redact.util";

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

  private async authenticateAndDispatch(params: {
    authEmail: string;
    targetEmail: string;
    password: string;
    remember?: boolean;
    clientIp?: string;
    userAgent?: string;
    errorMessage?: string;
    isEligible?: boolean;
  }): Promise<{ requestId: string }> {
    const {
      authEmail,
      targetEmail,
      password,
      remember = false,
      clientIp,
      userAgent,
      errorMessage = LoginOtpService.GENERIC_AUTH_ERROR,
      isEligible = true,
    } = params;

    const session = await authenticateAndExtractSession(
      authEmail,
      password,
      remember,
      clientIp,
      userAgent,
      errorMessage,
      this.logger,
    );

    if (!isEligible) {
      await revokeBetterAuthSessionByCookies(session.sessionCookies);
      this.logger.warn(
        `Login OTP bloqueado tras verificar contraseña: cuenta no elegible o sin rol requerido para el portal (${maskEmail(targetEmail)}).`,
      );
      throw new UnauthorizedException(errorMessage);
    }

    return executeDispatchOtpAndSave(
      this.otpModel,
      this.birdVerifyService,
      this.logger,
      {
        targetEmail,
        session,
        sessionEncKey: this.sessionEncKey,
        windowMs: this.EMAIL_INITIATE_WINDOW_MS,
        maxSends: this.EMAIL_INITIATE_MAX,
        errorMessage,
        remember,
      },
    );
  }

  async initiateLogin(
    email: string,
    password: string,
    rememberMe?: boolean,
    clientIp?: string,
    userAgent?: string,
    turnstileToken?: string,
  ): Promise<{ requestId: string }> {
    await verifyTurnstileToken(turnstileToken, clientIp, this.logger);
    const candidate = await findAndValidateStandardUser(this.userModel, email);
    return this.authenticateAndDispatch({
      ...candidate,
      password,
      remember: rememberMe === true,
      clientIp,
      userAgent,
    });
  }

  async initiateFasciaLogin(
    username: string,
    password: string,
    rememberMe?: boolean,
    clientIp?: string,
    userAgent?: string,
    turnstileToken?: string,
  ): Promise<{ requestId: string }> {
    await verifyTurnstileToken(turnstileToken, clientIp, this.logger);
    const candidate = await findAndValidateFasciaUser(
      this.userModel,
      username,
      this.logger,
    );
    return this.authenticateAndDispatch({
      ...candidate,
      password,
      remember: rememberMe === true,
      clientIp,
      userAgent,
      errorMessage:
        "Error al iniciar sesión en Fascia. Verifica tus credenciales.",
    });
  }

  async initiateConsoleLogin(
    email: string,
    username: string,
    password: string,
    rememberMe?: boolean,
    clientIp?: string,
    userAgent?: string,
    turnstileToken?: string,
  ): Promise<{ requestId: string }> {
    await verifyTurnstileToken(turnstileToken, clientIp, this.logger);
    const candidate = await findAndValidateConsoleUser(
      this.userModel,
      email,
      username,
      this.logger,
    );
    return this.authenticateAndDispatch({
      ...candidate,
      password,
      remember: rememberMe === true,
      clientIp,
      userAgent,
      errorMessage: "Error al iniciar sesión en la Consola Administrativa.",
    });
  }

  async initiateSuperAdminLogin(
    email: string,
    username: string,
    password: string,
    rememberMe?: boolean,
    clientIp?: string,
    userAgent?: string,
    turnstileToken?: string,
  ): Promise<{ requestId: string }> {
    await verifyTurnstileToken(turnstileToken, clientIp, this.logger);
    const candidate = await findAndValidateSuperAdminUser(
      this.userModel,
      email,
      username,
      this.logger,
    );
    return this.authenticateAndDispatch({
      ...candidate,
      password,
      remember: rememberMe === true,
      clientIp,
      userAgent,
      errorMessage: "Error al iniciar sesión como Superadministrador.",
    });
  }

  async verifyOtp(
    requestId: string,
    code: string,
  ): Promise<{ cookies: string[]; setCookieHeaders: string[] }> {
    return executeVerifyOtp({
      otpModel: this.otpModel,
      birdVerifyService: this.birdVerifyService,
      requestId,
      code,
      sessionEncKey: this.sessionEncKey,
      logger: this.logger,
    });
  }

  async resendOtp(requestId: string): Promise<{
    message: string;
    requestId: string;
    expiresInSeconds: number;
    maskedEmail: string;
  }> {
    const otpRecord = await this.otpModel.findOne({
      requestId,
      status: "pending",
    });
    if (!otpRecord) {
      throw new GoneException(
        "La solicitud de verificación no existe o ha expirado.",
      );
    }

    await assertEmailThrottle(
      this.otpModel,
      otpRecord.email,
      this.EMAIL_INITIATE_WINDOW_MS,
      this.EMAIL_INITIATE_MAX,
      this.logger,
    );

    if (!this.birdVerifyService.isConfigured()) {
      throw new BadRequestException("Servicio de verificación no disponible.");
    }

    const birdRes = await this.birdVerifyService.createEmailVerification(
      otpRecord.email,
      {
        purpose: "login_resend",
        requestId,
      },
    );

    otpRecord.birdVerificationId = birdRes.id;
    await otpRecord.save();

    return {
      message: "Nuevo código de seguridad enviado.",
      requestId,
      expiresInSeconds: 300,
      maskedEmail: maskEmail(otpRecord.email),
    };
  }

  async invalidatePending(email: string): Promise<void> {
    const normalized = email.toLowerCase();
    const pendingRecords = await this.otpModel.find({
      email: normalized,
      status: "pending",
    });
    await Promise.all(
      pendingRecords.map((rec: LoginOtpDocument) =>
        revokeEncryptedOtpSession(rec, this.sessionEncKey, this.logger),
      ),
    );
    await this.otpModel.updateMany(
      { email: normalized, status: "pending" },
      { status: "expired" },
    );
  }
}
