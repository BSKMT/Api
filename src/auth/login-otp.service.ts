import {
  Injectable,
  Logger,
  BadRequestException,
  UnauthorizedException,
} from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";
import { randomBytes, createHash } from "crypto";
import { LoginOtp, LoginOtpDocument } from "./schemas/login-otp.schema";
import { EmailService } from "../zoho-mail/email.service";

/**
 * LoginOtpService — Implementa el flujo de verificación por correo obligatorio.
 *
 * Flujo:
 *  1. `initiateLogin()` — Valida las credenciales del usuario haciendo una
 *     petición server-to-server a Better Auth `/sign-in/email`. Si la
 *     autenticacion es exitosa, captura las cookies de sesion de la respuesta, las
 * almacena junto con un código alfanumérico de 6 caracteres (hasheado),
 * y envia el codigo por correo electronico. La sesion NO se entrega al
 * cliente en este punto.
 *  2. `verifyOtp()` — Verifica el código ingresado por el usuario. Si es
 *     correcto, devuelve las cookies de sesión para que el proxy las
 *     establezca en el navegador del cliente.
 *
 * Seguridad (OWASP A07:2025 — Authentication Failures):
 *  - Rate limiting en los endpoints del controller.
 *  - Código hasheado con SHA-256 antes de almacenarlo (CWE-256/CWE-327).
 *  - Expiración automática a los 5 minutos (TTL index en MongoDB).
 *  - Máximo 5 intentos de verificación por OTP.
 *  - Email no revelado si el usuario no existe (respuesta genérica).
 *  - Cookies de sesión almacenadas asociadas al código, no expuestas hasta
 *    la verificación exitosa.
 *  - Cleanup automático: MongoDB elimina documentos expirados via TTL index.
 */
@Injectable()
export class LoginOtpService {
  private readonly logger = new Logger(LoginOtpService.name);
  private readonly MAX_ATTEMPTS = 5;
  private readonly OTP_LENGTH = 6;
  private readonly OTP_TTL_SECONDS = 300;

  constructor(
    @InjectModel(LoginOtp.name)
    private readonly otpModel: Model<LoginOtpDocument>,
    private readonly emailService: EmailService,
  ) {}

  /**
   * Genera un código alfanumérico de 6 caracteres (sólo mayúsculas + dígitos
   * para evitar ambigüedades visuales entre 0/O, 1/I/l, etc.).
   */
  private generateOtpCode(): string {
    const charset = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    const chars: string[] = [];
    const bytes = randomBytes(this.OTP_LENGTH);
    for (let i = 0; i < this.OTP_LENGTH; i++) {
      chars.push(charset[bytes[i] % charset.length]);
    }
    return chars.join("");
  }

  /**
   * Hashea el código con SHA-256 antes de guardarlo en la base de datos
   * para que un atacante con acceso de lectura a la colección no obtenga
   * códigos en texto plano (CWE-256).
   */
  private hashCode(code: string): string {
    return createHash("sha256").update(code).digest("hex");
  }

  private generateRequestId(): string {
    return randomBytes(16).toString("hex");
  }

  /**
   * Captura las cookies Set-Cookie de la respuesta HTTP de Better Auth.
   * Extrae `name=value` de cada Set-Cookie, descartando atributos (Path,
   * HttpOnly, etc.), para poder reconstruir las cookies en el proxy.
   */
  private extractCookies(setCookieHeaders: string[]): string[] {
    const cookies: string[] = [];
    for (const sc of setCookieHeaders) {
      const semi = sc.indexOf(";");
      const pair = (semi === -1 ? sc : sc.slice(0, semi)).trim();
      const eq = pair.indexOf("=");
      if (eq > 0) {
        cookies.push(pair);
      }
    }
    return cookies;
  }

  /**
   * Inicia el login OTP — Valida credenciales, genera codigo y envia correo.
   *
   * @returns `{ requestId }` — el cliente usa este ID en el paso de verificación.
   */
  async initiateLogin(
    email: string,
    password: string,
    rememberMeStr?: string,
  ): Promise<{ requestId: string }> {
    const rememberMe = rememberMeStr === "true" || rememberMeStr === "1";

    const baseUrl =
      process.env.BETTER_AUTH_URL ??
      (process.env.NODE_ENV === "production"
        ? "https://api.bskmt.com"
        : "http://localhost:3000");

    /**
     * Origin confiable para la petición server-to-server a Better Auth.
     *
     * Node.js `fetch` (undici) añade automáticamente `Sec-Fetch-Mode: cors`
     * a toda petición saliente. Better Auth interpreta la presencia de
     * cualquier cabecera Sec-Fetch-* como indicador de una petición
     * iniciada por el navegador y, en consecuencia, fuerza la validación
     * del Origin (`validateOrigin(ctx, true)` en `origin-check.mjs`).
     * Si el Origin falta, Better Auth devuelve `403 MISSING_OR_NULL_ORIGIN`,
     * que el LoginOtpService convierte en el 401 genérico
     * "No se pudo iniciar sesión. Verifica tus credenciales."
     *
     * Este Origin debe ser:
     *   1. Confiable para el middleware CSRF de NestJS (`allowedOrigins`
     *      en `main.ts`, que incluye `CORS_ORIGIN`).
     *   2. Confiable para Better Auth (`trustedOrigins` en `better-auth.ts`,
     *      que lista explícitamente `https://bskmt.com`).
     *
     * Usamos `CORS_ORIGIN` (con `LANDING_PAGE_URL` como respaldo) porque
     * ambas capas de seguridad ya lo aceptan. No usamos `baseUrl` (la
     * propia URL de la API) porque el middleware CSRF de NestJS no lo
     * incluye en `allowedOrigins`.
     */
    const trustedOrigin =
      process.env.CORS_ORIGIN ??
      process.env.LANDING_PAGE_URL ??
      (process.env.NODE_ENV === "production"
        ? "https://bskmt.com"
        : "http://localhost:4321");

    let apiResponse: Response;
    try {
      apiResponse = await fetch(`${baseUrl}/api/auth/sign-in/email`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: trustedOrigin,
        },
        body: JSON.stringify({ email, password, rememberMe }),
      });
    } catch {
      this.logger.error(
        "No se pudo conectar con Better Auth para validar credenciales",
      );
      throw new BadRequestException(
        "Error al procesar la solicitud de inicio de sesión.",
      );
    }

    if (!apiResponse.ok) {
      const rawBody = await apiResponse.text().catch(() => "");
      this.logger.warn(
        `Better Auth /sign-in/email returned ${apiResponse.status} — body: ${rawBody.slice(0, 300)}`,
      );
      let errorBody: Record<string, unknown> = {};
      try {
        errorBody = JSON.parse(rawBody) as Record<string, unknown>;
      } catch {
        // rawBody is not JSON (e.g., Cloudflare block page) — leave errorBody empty
      }
      const errorCode = errorBody["code"] as string | undefined;
      const message = errorBody["message"] as string | undefined;

      if (
        errorCode === "INVALID_PASSWORD" ||
        errorCode === "INVALID_EMAIL_OR_PASSWORD" ||
        (message && /invalid|incorrect|not found/i.test(message))
      ) {
        throw new UnauthorizedException(
          "Credenciales inválidas. Verifica tu correo y contraseña.",
        );
      }

      if (errorCode === "EMAIL_NOT_VERIFIED") {
        throw new UnauthorizedException(
          "Tu correo electrónico no ha sido verificado. Verifica tu correo antes de iniciar sesión.",
        );
      }

      throw new UnauthorizedException(
        "No se pudo iniciar sesión. Verifica tus credenciales.",
      );
    }

    const setCookieHeaders = apiResponse.headers.getSetCookie();
    const sessionCookies = JSON.stringify(
      this.extractCookies(setCookieHeaders),
    );

    const body = (await apiResponse.json().catch(() => ({}))) as {
      user?: { id?: string; email?: string; name?: string };
    };
    const betterAuthId = body.user?.id ?? "";
    const userEmail = body.user?.email ?? email.toLowerCase();
    const userName = body.user?.name ?? userEmail;

    if (!betterAuthId) {
      this.logger.error(
        "Better Auth no devolvió el ID de usuario en el sign-in",
      );
      throw new BadRequestException(
        "Error al procesar la solicitud de inicio de sesión.",
      );
    }

    const code = this.generateOtpCode();
    const codeHash = this.hashCode(code);
    const requestId = this.generateRequestId();
    const expiresAt = new Date(Date.now() + this.OTP_TTL_SECONDS * 1000);

    await this.otpModel.create({
      requestId,
      email: userEmail,
      betterAuthId,
      codeHash,
      sessionCookies,
      status: "pending",
      attempts: 0,
      expiresAt,
    });

    const ok = await this.emailService.sendLoginOtpEmail({
      to: userEmail,
      name: userName,
      code,
      expiresInMinutes: 5,
    });
    if (!ok) {
      this.logger.error(
        `No se pudo enviar el codigo OTP de login a ${userEmail} (Zoho no configurado o fallo)`,
      );
      throw new BadRequestException(
        "No se pudo enviar el codigo de verificacion en este momento.",
      );
    }

    return { requestId };
  }

  /**
   * Verifica el código OTP y, si es válido, devuelve las cookies de sesión
   * capturadas para que el proxy las establezca en el navegador del cliente.
   *
   * @returns `{ cookies: string[] }` — pares `name=value` de las cookies.
   */
  async verifyOtp(
    requestId: string,
    code: string,
  ): Promise<{ cookies: string[] }> {
    const otpRecord = await this.otpModel.findOne({
      requestId,
      status: "pending",
    });

    if (!otpRecord) {
      throw new BadRequestException(
        "El código de verificación no existe, ya fue utilizado o ha expirado.",
      );
    }

    if (otpRecord.expiresAt.getTime() < Date.now()) {
      otpRecord.status = "expired";
      await otpRecord.save();
      throw new BadRequestException(
        "El código de verificación ha expirado. Solicita uno nuevo.",
      );
    }

    if (otpRecord.attempts >= this.MAX_ATTEMPTS) {
      otpRecord.status = "expired";
      await otpRecord.save();
      this.logger.warn(
        `OTP superó el máximo de intentos: ${requestId} / ${otpRecord.email}`,
      );
      throw new BadRequestException(
        "Has superado el máximo de intentos. Solicita un nuevo código.",
      );
    }

    const codeHash = this.hashCode(code.toUpperCase());

    if (codeHash !== otpRecord.codeHash) {
      otpRecord.attempts += 1;
      await otpRecord.save();
      const remaining = this.MAX_ATTEMPTS - otpRecord.attempts;
      throw new BadRequestException(
        `Código de verificación incorrecto. Te quedan ${remaining} intento(s).`,
      );
    }

    otpRecord.status = "verified";
    await otpRecord.save();

    return {
      cookies: JSON.parse(otpRecord.sessionCookies) as string[],
    };
  }

  /**
   * Marca como expirados todos los OTP pendientes para un email.
   * Utilidad para cleanup o cuando el usuario intenta de nuevo.
   */
  async invalidatePending(email: string): Promise<void> {
    await this.otpModel.updateMany(
      { email: email.toLowerCase(), status: "pending" },
      { status: "expired" },
    );
  }
}
