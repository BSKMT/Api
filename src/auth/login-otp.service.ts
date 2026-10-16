import { Injectable, Logger, GoneException } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";
import { LoginOtp, LoginOtpDocument } from "./schemas/login-otp.schema";
import { User, UserDocument } from "../users/schemas/user.schema";
import {
  BirdVerifyService,
  type BirdCheckResult,
} from "../bird-verify/bird-verify.service";
import { deriveSessionEncryptionKey } from "./login-otp-crypto.helper";
import {
  handleBirdCheckError,
  processBirdCheckResult,
} from "./login-otp-check.helper";
import {
  authenticateAndExtractSession,
  executeDispatchOtpAndSave,
} from "./login-otp-session.helper";
import {
  findAndValidateFasciaUser,
  findAndValidateConsoleUser,
  findAndValidateSuperAdminUser,
} from "./login-otp-portals.helper";

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

  private async authenticateAndDispatch(
    authEmail: string,
    targetEmail: string,
    password: string,
    remember: boolean,
    clientIp?: string,
    userAgent?: string,
    errorMessage: string = LoginOtpService.GENERIC_AUTH_ERROR,
  ): Promise<{ requestId: string }> {
    const session = await authenticateAndExtractSession(
      authEmail,
      password,
      remember,
      clientIp,
      userAgent,
      errorMessage,
      this.logger,
    );

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
      },
    );
  }

  async initiateLogin(
    email: string,
    password: string,
    rememberMe?: boolean,
    clientIp?: string,
    userAgent?: string,
  ): Promise<{ requestId: string }> {
    const normalizedEmail = (email ?? "").toLowerCase().trim();
    const user = await this.userModel
      .findOne({
        $or: [
          { email: normalizedEmail },
          { "contractorInfo.correoInstitucional": normalizedEmail },
          { "profile.contacto.correoInstitucional": normalizedEmail },
        ],
      })
      .lean();

    const authEmail = user?.email || normalizedEmail;
    return this.authenticateAndDispatch(
      authEmail,
      normalizedEmail,
      password,
      rememberMe === true,
      clientIp,
      userAgent,
    );
  }

  async initiateFasciaLogin(
    username: string,
    password: string,
    rememberMe?: boolean,
    clientIp?: string,
    userAgent?: string,
  ): Promise<{ requestId: string }> {
    const { authEmail, targetEmail } = await findAndValidateFasciaUser(
      this.userModel,
      username,
      this.logger,
    );

    return this.authenticateAndDispatch(
      authEmail,
      targetEmail,
      password,
      rememberMe === true,
      clientIp,
      userAgent,
      "Error al iniciar sesión en Fascia. Verifica tus credenciales.",
    );
  }

  async initiateConsoleLogin(
    email: string,
    username: string,
    password: string,
    rememberMe?: boolean,
    clientIp?: string,
    userAgent?: string,
  ): Promise<{ requestId: string }> {
    const { authEmail, targetEmail } = await findAndValidateConsoleUser(
      this.userModel,
      email,
      username,
      this.logger,
    );

    return this.authenticateAndDispatch(
      authEmail,
      targetEmail,
      password,
      rememberMe === true,
      clientIp,
      userAgent,
      "Error al iniciar sesión en la Consola Administrativa.",
    );
  }

  async initiateSuperAdminLogin(
    email: string,
    username: string,
    password: string,
    rememberMe?: boolean,
    clientIp?: string,
    userAgent?: string,
  ): Promise<{ requestId: string }> {
    const { authEmail, targetEmail } = await findAndValidateSuperAdminUser(
      this.userModel,
      email,
      username,
      this.logger,
    );

    return this.authenticateAndDispatch(
      authEmail,
      targetEmail,
      password,
      rememberMe === true,
      clientIp,
      userAgent,
      "Error al iniciar sesión como Superadministrador.",
    );
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
