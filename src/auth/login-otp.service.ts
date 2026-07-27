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
import {
  randomBytes,
  createHmac,
  timingSafeEqual,
  createCipheriv,
  createDecipheriv,
  scryptSync,
} from "node:crypto";
import { LoginOtp, LoginOtpDocument } from "./schemas/login-otp.schema";
import { EmailService } from "../zoho-mail/email.service";
import { getAuth } from "./better-auth";

/**
 * LoginOtpService — Implementa el flujo de verificacion por correo
 * obligatorio (login en dos pasos: credenciales + codigo OTP por email).
 *
 * Flujo:
 *  1. `initiateLogin()` — Valida las credenciales del usuario llamando
 *     **en proceso** a Better Auth `auth.api.signInEmail()` (sin HTTP
 *     roundtrip). Si la autenticacion es exitosa, captura las cookies de
 *     sesion, las **cifra con AES-256-GCM** antes de persistirlas,
 *     genera un codigo alfanumerico de 6 caracteres (hasheado con
 *     **HMAC-SHA-256 + server key**), aplica **throttle per-email**
 *     (anti mailbox flooding) y envia el codigo por correo.
 *     La sesion NO se entrega al cliente en este punto.
 *  2. `verifyOtp()` — Verifica el codigo (comparacion **timing-safe**).
 *     Si es correcto, **desencripta** y devuelve las cookies de sesion
 *     para que el proxy las establezca en el navegador del cliente.
 *
 * Seguridad (alineado con OWASP A07:2025 — Authentication Failures y
 * A04:2025 — Cryptographic Failures):
 *
 *  - **Throttle per-IP** en los endpoints del controller (ThrottlerGuard).
 *  - **Throttle per-email** dentro del servicio: max 3 solicitudes / 5 min,
 *    defensa contra mailbox flooding con rotacion de IPs.
 *  - Codigo hasheado con **HMAC-SHA-256 + server key** (derivada via
 *    scrypt de `BETTER_AUTH_SECRET`). Sin la server key, un atacante con
 *    acceso de lectura a la coleccion no puede brute-forcear el hash
 *    offline (CWE-256/CWE-327, A04:2025).
 *  - Comparacion del hash con **timingSafeEqual** (timing-attack safe).
 *  - Cookies de sesion **cifradas en reposo** con AES-256-GCM (no se
 *    almacenan cookies raw en MongoDB; un breach de BD solo no las revela).
 *  - **Mascara anti-enumeracion**: todos los errores post-autenticacion
 *    (fallo de envio de email, ID usuario faltante) se devuelven con el
 *    mismo mensaje generico "Credenciales invalidas" para cerrar el
 *    oracle de enumeracion de cuentas.
 *  - Expiracion automatica a los 5 minutos (TTL index en MongoDB).
 *  - Maximo 5 intentos de verificacion por OTP.
 *  - HTTP status semanticamente precisos:
 *    `GoneException` (410) para codigo expirado/consumido,
 *    `UnauthorizedException` (401) para codigo incorrecto,
 *    `HttpException` 429 para maximo de intentos / email throttle.
 *  - `cause` en excepciones para error chaining (NestJS exception-filters).
 *  - **trust proxy** habilitado en `main.ts` para obtener la IP real
 *    del cliente detras de Cloudflare.
 *  - Email no revelado si el usuario no existe (mensaje generico).
 *  - Cookies de sesion no expuestas hasta verificacion exitosa.
 *  - Cleanup automatico: MongoDB elimina documentos expirados via TTL
 *    index.
 */
@Injectable()
export class LoginOtpService {
  private readonly logger = new Logger(LoginOtpService.name);
  private readonly MAX_ATTEMPTS = 5;
  private readonly OTP_LENGTH = 6;
  private readonly OTP_TTL_SECONDS = 300;

  /** Ventana de throttle per-email para initiate. */
  private readonly EMAIL_INITIATE_WINDOW_MS = 5 * 60 * 1000;
  /** Maximo de solicitudes OTP por email dentro de la ventana. */
  private readonly EMAIL_INITIATE_MAX = 3;

  /** Clave HMAC para hashear codigos OTP (32 bytes). */
  private readonly otpHmacKey: Buffer;
  /** Clave AES-256-GCM para cifrar cookies de sesion (32 bytes). */
  private readonly sessionEncKey: Buffer;

  constructor(
    @InjectModel(LoginOtp.name)
    private readonly otpModel: Model<LoginOtpDocument>,
    private readonly emailService: EmailService,
  ) {
    const secret = process.env.BETTER_AUTH_SECRET;
    if (!secret) {
      throw new Error(
        "BETTER_AUTH_SECRET environment variable is required for OTP hashing and session encryption",
      );
    }
    this.otpHmacKey = scryptSync(secret, "otp-hmac-v1", 32);
    this.sessionEncKey = scryptSync(secret, "session-cookies-v1", 32);
  }

  /**
   * Genera un codigo alfanumerico de 6 caracteres (solo mayusculas +
   * digitos, sin caracteres ambiguos como 0/O, 1/I/l).
   * Entropia: 32^6 ~= 2^30 bits — suficiente con HMAC + throttle.
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
   * Hashea el codigo con **HMAC-SHA-256 + server key** antes de guardarlo.
   *
   * A diferencia de `createHash("sha256")` (SHA-256 puro), HMAC requiere
   * la server key (derivada via scrypt de `BETTER_AUTH_SECRET`). Sin la
   * key, un atacante con acceso de lectura a la coleccion no puede
   * brute-forcear el hash offline aunque conozca el charset y longitud
   * (CWE-256/CWE-327, OWASP A04:2025).
   */
  private hashCode(code: string): string {
    return createHmac("sha256", this.otpHmacKey).update(code).digest("hex");
  }

  /**
   * Comparacion **timing-safe** de dos hashes hex — evita timing attacks
   * en la verificacion del codigo OTP (CWE-208).
   */
  private safeHashEqual(inputHash: string, storedHash: string): boolean {
    const a = Buffer.from(inputHash, "hex");
    const b = Buffer.from(storedHash, "hex");
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  }

  /**
   * Cifra el array de cookies de sesion con **AES-256-GCM** antes de
   * persistirlo en MongoDB.
   *
   * Formato almacenado: `iv:tag:ciphertext` (hex). El tag de
   * autenticaciondetecta tampering. Sin la server key (derivada de
   * `BETTER_AUTH_SECRET` via scrypt), un atacante con acceso de lectura
   * a la BD no puede obtener las cookies validas.
   */
  private encryptSessionCookies(cookies: string[]): string {
    const plaintext = JSON.stringify(cookies);
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.sessionEncKey, iv);
    const ct = Buffer.concat([
      cipher.update(plaintext, "utf8"),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();
    return `${iv.toString("hex")}:${tag.toString("hex")}:${ct.toString("hex")}`;
  }

  /**
   * Desencripta las cookies de sesion desde el formato `iv:tag:ciphertext`.
   * Devuelve array vacio si el ciphertext fue tampered o la key no coincide.
   */
  private decryptSessionCookies(stored: string): string[] {
    const parts = stored.split(":");
    if (parts.length !== 3) return [];
    try {
      const iv = Buffer.from(parts[0], "hex");
      const tag = Buffer.from(parts[1], "hex");
      const ct = Buffer.from(parts[2], "hex");
      const decipher = createDecipheriv("aes-256-gcm", this.sessionEncKey, iv);
      decipher.setAuthTag(tag);
      const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
      return JSON.parse(pt.toString("utf8")) as string[];
    } catch (err) {
      this.logger.error(
        `Failed to decrypt session cookies (tamper or key mismatch): ${err instanceof Error ? err.message : String(err)}`,
      );
      return [];
    }
  }

  private generateRequestId(): string {
    return randomBytes(16).toString("hex");
  }

  /**
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
   * Mensaje generico unico para todos los errores de credenciales y
   * post-autenticacion. Mismo mensaje para cerrar el oracle de
   * enumeracion de cuentas (OWASP A07:2025 — line 101).
   */
  private static readonly GENERIC_AUTH_ERROR =
    "Credenciales inválidas. Verifica tu correo y contraseña.";

  /**
   * Inicia el login OTP — Valida credenciales, genera codigo y envia correo.
   *
   * @returns `{ requestId }` — el cliente usa este ID en el paso de verificacion.
   */
  async initiateLogin(
    email: string,
    password: string,
    rememberMe?: boolean,
  ): Promise<{ requestId: string }> {
    const remember = rememberMe === true;

    /**
     * Llama a Better Auth **en proceso** (sin HTTP roundtrip) para
     * validar credenciales y obtener las cookies de sesion.
     *
     * Antes se usaba `fetch(...)`, pero en produccion esa peticion salia
     * por el proxy de Cloudflare que la bloqueaba con un challenge
     * ("Just a moment..."), devolviendo un 403 con HTML.
     *
     * La API en proceso `auth.api.signInEmail({ asResponse: true })`
     * ejecuta el mismo handler pero sin red, evitando Cloudflare, el
     * middleware CSRF (que se omite cuando no hay `request`) y los
     * problemas con undici (`Sec-Fetch-Mode: cors`).
     */
    let authResponse: Response;
    try {
      const auth = await getAuth();
      authResponse = await auth.api.signInEmail({
        body: { email, password, rememberMe: remember },
        asResponse: true,
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

    if (!authResponse.ok) {
      const rawBody = await authResponse.text().catch(() => "");
      this.logger.warn(
        `Better Auth signInEmail returned ${authResponse.status} — body: ${rawBody.slice(0, 300)}`,
      );
      let errorBody: Record<string, unknown> = {};
      try {
        errorBody = JSON.parse(rawBody) as Record<string, unknown>;
      } catch {
        // Body is not JSON — leave errorBody empty
      }
      const errorCode = errorBody["code"] as string | undefined;
      const message = errorBody["message"] as string | undefined;

      if (errorCode === "EMAIL_NOT_VERIFIED") {
        throw new UnauthorizedException(
          "Tu correo electrónico no ha sido verificado. Verifica tu correo antes de iniciar sesión.",
          { cause: rawBody },
        );
      }

      // Todos los demas errores (credenciales invalidas, usuario no
      // encontrado, etc.) se mapean al mismo mensaje generico para
      // prevenir enumeracion de cuentas.
      if (
        errorCode === "INVALID_PASSWORD" ||
        errorCode === "INVALID_EMAIL_OR_PASSWORD" ||
        errorCode === "USER_NOT_FOUND" ||
        errorCode === "CREDENTIAL_ACCOUNT_NOT_FOUND" ||
        (message && /invalid|incorrect|not found/i.test(message)) ||
        !errorCode
      ) {
        throw new UnauthorizedException(LoginOtpService.GENERIC_AUTH_ERROR, {
          cause: rawBody,
        });
      }

      throw new UnauthorizedException(LoginOtpService.GENERIC_AUTH_ERROR, {
        cause: rawBody,
      });
    }

    const setCookieHeaders = authResponse.headers.getSetCookie();
    const sessionCookies = this.extractCookies(setCookieHeaders);

    const body = (await authResponse.json().catch(() => ({}))) as {
      user?: { id?: string; email?: string; name?: string };
    };
    const betterAuthId = body.user?.id ?? "";
    const userEmail = body.user?.email ?? email.toLowerCase();
    const userName = body.user?.name ?? userEmail;

    /**
     * Mascara anti-enumeracion: si Better Auth autentico pero no
     * devolvio userId o cookies, se enmascara como "credenciales
     * invalidas" — no revela que las credenciales eran validas.
     */
    if (!betterAuthId || sessionCookies.length === 0) {
      this.logger.error(
        `Post-auth error: betterAuthId=${betterAuthId || "MISSING"} cookies=${sessionCookies.length}`,
      );
      throw new UnauthorizedException(LoginOtpService.GENERIC_AUTH_ERROR, {
        cause: `betterAuthId=${betterAuthId || "MISSING"}`,
      });
    }

    /**
     * Throttle per-email (defensa contra mailbox flooding con rotacion
     * de IPs). Cuenta cuantas OTPs se han creado para este email en
     * los ultimos 5 minutos.
     */
    const recentCount = await this.otpModel.countDocuments({
      email: userEmail,
      createdAt: { $gt: new Date(Date.now() - this.EMAIL_INITIATE_WINDOW_MS) },
    });
    if (recentCount >= this.EMAIL_INITIATE_MAX) {
      this.logger.warn(
        `Email throttle: ${userEmail} supero ${this.EMAIL_INITIATE_MAX} OTPs en ${this.EMAIL_INITIATE_WINDOW_MS / 1000}s`,
      );
      throw new HttpException(
        "Has solicitado demasiados codigos de verificacion. Espera 5 minutos e intenta de nuevo.",
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const code = this.generateOtpCode();
    const codeHash = this.hashCode(code);
    const requestId = this.generateRequestId();
    const expiresAt = new Date(Date.now() + this.OTP_TTL_SECONDS * 1000);
    const encryptedCookies = this.encryptSessionCookies(sessionCookies);

    await this.otpModel.create({
      requestId,
      email: userEmail,
      betterAuthId,
      codeHash,
      sessionCookies: encryptedCookies,
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
      // Mascara: no revelar que las credenciales eran validas.
      throw new UnauthorizedException(LoginOtpService.GENERIC_AUTH_ERROR, {
        cause: "Email send failure",
      });
    }

    return { requestId };
  }

  /**
   * Verifica el codigo OTP y, si es valido, desencripta y devuelve las
   * cookies de sesion para que el proxy las establezca en el navegador
   * del cliente.
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
      throw new GoneException(
        "El código de verificación no existe, ya fue utilizado o ha expirado.",
      );
    }

    if (otpRecord.expiresAt.getTime() < Date.now()) {
      otpRecord.status = "expired";
      await otpRecord.save();
      throw new GoneException(
        "El código de verificación ha expirado. Solicita uno nuevo.",
      );
    }

    if (otpRecord.attempts >= this.MAX_ATTEMPTS) {
      otpRecord.status = "expired";
      await otpRecord.save();
      this.logger.warn(
        `OTP supero el maximo de intentos: ${requestId} / ${otpRecord.email}`,
      );
      throw new HttpException(
        "Has superado el máximo de intentos. Solicita un nuevo código.",
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const inputHash = this.hashCode(code.toUpperCase());

    if (!this.safeHashEqual(inputHash, otpRecord.codeHash)) {
      otpRecord.attempts += 1;
      await otpRecord.save();
      const remaining = this.MAX_ATTEMPTS - otpRecord.attempts;
      throw new UnauthorizedException(
        `Código incorrecto. Te quedan ${remaining} intento(s).`,
      );
    }

    otpRecord.status = "verified";
    await otpRecord.save();

    const cookies = this.decryptSessionCookies(otpRecord.sessionCookies);
    if (cookies.length === 0) {
      this.logger.error(
        `Failed to decrypt session cookies for verified OTP: ${requestId}`,
      );
      throw new GoneException(
        "El código de verificación ha expirado. Solicita uno nuevo.",
      );
    }

    return { cookies };
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
