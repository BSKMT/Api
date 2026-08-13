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
  createCipheriv,
  createDecipheriv,
  scryptSync,
} from "node:crypto";
import { LoginOtp, LoginOtpDocument } from "./schemas/login-otp.schema";
import { BirdVerifyService } from "../bird-verify/bird-verify.service";
import { getAuth } from "./better-auth";
import { maskEmail } from "../common/utils/log-redact.util";

/**
 * LoginOtpService — Implementa el flujo de verificacion por codigo (login en
 * dos pasos: credenciales + codigo OTP por correo) usando **Bird Verify**.
 *
 * Flujo:
 *  1. `initiateLogin()` — Valida las credenciales del usuario llamando
 *     **en proceso** a Better Auth `auth.api.signInEmail()` (sin HTTP
 *     roundtrip). Si la autenticacion es exitosa, captura las cookies de
 *     sesion, las **cifra con AES-256-GCM** antes de persistirlas, llama
 *     a Bird Verify `POST /v1/verify/verifications` para que Bird genere
 *     y envie un codigo numerico de un solo uso, aplica **throttle per-email**
 *     (anti mailbox flooding) y devuelve `{ requestId }`. La sesion NO se
 *     entrega al cliente en este punto.
 *  2. `verifyOtp()` — Llama a Bird Verify `POST /v1/verify/verifications/check`
 *     con el codigo ingresado por el usuario. Si Bird devuelve `success: true`,
 *     **desencripta** y devuelve las cookies de sesion para que el proxy las
 *     establezca en el navegador del cliente. Si Bird devuelve `success: false`,
 *     mapea el `reason` a HTTP status semanticos.
 *
 * Cambios respecto a la version Zoho:
 *  - Ya no se genera, hashea, ni compara el codigo localmente — Bird Verify
 *    hace todo eso. La app nunca maneja el codigo en texto plano.
 *  - Ya no se envia el correo manualmente — Bird lo entrega.
 *  - Se mantiene el cifrado AES-256-GCM de las cookies de sesion.
 *  - Se mantiene el throttle per-email (capa adicional sobre el cap de
 *    Bird de 5 sends/recipient/hora).
 *  - Se mantiene la mascara anti-enumeracion (mensaje generico unico).
 *
 * Seguridad (alineado con OWASP A07:2025 — Authentication Failures y
 * A04:2025 — Cryptographic Failures):
 *
 *  - **Throttle per-IP** en los endpoints del controller (ThrottlerGuard).
 *  - **Throttle per-email** dentro del servicio: max 3 solicitudes / 5 min,
 *    defensa contra mailbox flooding con rotacion de IPs. Capa adicional sobre
 *    el cap nativo de Bird (5 sends/recipient/hora).
 *  - El codigo OTP nunca se almacena en MongoDB (Bird guarda solo un hash).
 *  - Cookies de sesion **cifradas en reposo** con AES-256-GCM (no se
 *    almacenan cookies raw en MongoDB; un breach de BD solo no las revela).
 *  - **Mascara anti-enumeracion**: todos los errores post-autenticacion
 *    (fallo de envio de Bird, ID usuario faltante) se devuelven con el mismo
 *    mensaje generico "Credenciales invalidas" para cerrar el oracle de
 *    enumeracion de cuentas (OWASP A07:2025 line 101).
 *  - HTTP status semanticamente precisos:
 *    `GoneException` (410) para codigo expirado / verificacion ya resuelta,
 *    `UnauthorizedException` (401) para codigo incorrecto (con intentos
 *    restantes),
 *    `HttpException` 429 para rate-limit de Bird o throttle per-email.
 *  - `cause` en excepciones para error chaining (NestJS exception-filters).
 *  - **trust proxy** habilitado en `main.ts` para obtener la IP real del
 *    cliente detras de Cloudflare.
 *  - Email no revelado si el usuario no existe (mensaje generico).
 *  - Cookies de sesion no expuestas hasta verificacion exitosa.
 *  - Cleanup automatico: MongoDB elimina documentos expirados via TTL index.
 */
@Injectable()
export class LoginOtpService {
  private readonly logger = new Logger(LoginOtpService.name);

  /** Ventana de throttle per-email para initiate. */
  private readonly EMAIL_INITIATE_WINDOW_MS = 5 * 60 * 1000;
  /** Maximo de solicitudes OTP por email dentro de la ventana (capa sobre Bird). */
  private readonly EMAIL_INITIATE_MAX = 3;

  /** Clave AES-256-GCM para cifrar cookies de sesion (32 bytes). */
  private readonly sessionEncKey: Buffer;

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
    this.sessionEncKey = scryptSync(secret, "session-cookies-v1", 32);
  }

  /**
   * Cifra el array de cookies de sesion con **AES-256-GCM** antes de
   * persistirlo en MongoDB.
   *
   * Formato almacenado: `iv:tag:ciphertext` (hex). El tag de autenticacion
   * detecta tampering. Sin la server key (derivada de `BETTER_AUTH_SECRET`
   * via scrypt), un atacante con acceso de lectura a la BD no puede obtener
   * las cookies validas (OWASP A04:2025).
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
   * post-autenticacion. Mismo mensaje para cerrar el oracle de enumeracion
   * de cuentas (OWASP A07:2025 — line 101).
   */
  private static readonly GENERIC_AUTH_ERROR =
    "Credenciales inválidas. Verifica tu correo y contraseña.";

  /**
   * Inicia el login OTP — Valida credenciales, cifra las cookies de sesion,
   * persiste el registro en MongoDB y pide a Bird Verify que genere y envie
   * un codigo numerico al correo del usuario.
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
     * Llama a Better Auth **en proceso** (sin HTTP roundtrip) para validar
     * credenciales y obtener las cookies de sesion.
     *
     * Antes se usaba `fetch(...)`, pero en produccion esa peticion salia por
     * el proxy de Cloudflare que la bloqueaba con un challenge ("Just a
     * moment..."), devolviendo un 403 con HTML.
     *
     * La API en proceso `auth.api.signInEmail({ asResponse: true })` ejecuta
     * el mismo handler pero sin red, evitando Cloudflare, el middleware CSRF
     * (que se omite cuando no hay `request`) y los problemas con undici
     * (`Sec-Fetch-Mode: cors`).
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
        /**
         * M-14: EMAIL_NOT_VERIFIED is only emitted after Better Auth has
         * already validated the password — so it leaks valid credentials
         * to an attacker probing accounts. Mask it externally as the
         * generic auth failure but tag the cause server-side for ops
         * triage. The legitimate user can still trigger a fresh
         * verification link via the dedicated "Verificar correo" flow
         * on the landing page.
         */
        this.logger.warn(
          `Account email not verified (masked as generic auth error to close credential oracle)`,
        );
        throw new UnauthorizedException(LoginOtpService.GENERIC_AUTH_ERROR, {
          cause: "EMAIL_NOT_VERIFIED",
        });
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
     * Mascara anti-enumeracion: si Better Auth autentico pero no devolvio
     * userId o cookies, se enmascara como "credenciales invalidas" — no
     * revela que las credenciales eran validas.
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
     * Throttle per-email (defensa contra mailbox flooding con rotacion de
     * IPs). Cuenta cuantas OTPs se han creado para este email en los
     * ultimos 5 minutos. Capa adicional sobre el cap nativo de Bird de
     * 5 sends/recipient/hora.
     */
    const recentCount = await this.otpModel.countDocuments({
      email: userEmail,
      createdAt: { $gt: new Date(Date.now() - this.EMAIL_INITIATE_WINDOW_MS) },
    });
    if (recentCount >= this.EMAIL_INITIATE_MAX) {
      // M-17: mask the email in logs to avoid PII leaks into the log stream.
      this.logger.warn(
        `Email throttle: ${maskEmail(userEmail)} supero ${this.EMAIL_INITIATE_MAX} OTPs en ${this.EMAIL_INITIATE_WINDOW_MS / 1000}s`,
      );
      throw new HttpException(
        "Has solicitado demasiados codigos de verificacion. Espera 5 minutos e intenta de nuevo.",
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    /**
     * Si Bird Verify no esta configurado (falta BIRD_API_KEY), se enmascara
     * como "credenciales invalidas" — cerrar el oracle de enumeracion y no
     * revelar el estado interno del servicio de verificacion.
     */
    if (!this.birdVerifyService.isConfigured()) {
      this.logger.error(
        "Bird Verify no configurado (BIRD_API_KEYausente) — initiate bloqueado",
      );
      throw new UnauthorizedException(LoginOtpService.GENERIC_AUTH_ERROR, {
        cause: "Bird Verify not configured",
      });
    }

    const requestId = this.generateRequestId();
    const expiresAt = new Date(Date.now() + 3600 * 1000);
    const encryptedCookies = this.encryptSessionCookies(sessionCookies);

    /**
     * Persistir primero el registro en MongoDB antes de llamar a Bird,
     * para que exista siempre un slot donde recuperar las cookies al
     * verificar. Si Bird falla, se marcara el registro como expired.
     */
    const otpRecord = await this.otpModel.create({
      requestId,
      email: userEmail,
      betterAuthId,
      sessionCookies: encryptedCookies,
      status: "pending",
      attempts: 0,
      expiresAt,
    });

    /**
     * Llama a Bird Verify `POST /v1/verify/verifications` para que Bird
     * genere un codigo numerico y lo envie al correo del usuario. Bird
     * identifica la verificacion por `to.email`, asi que el check
     * posterior se hara con el mismo email.
     *
     * El SDK inyecta `Idempotency-Key` automaticamente, asi que un timeout
     * que reintentara la llamada no enviara dos codigos al usuario.
     */
    let birdId: string | undefined;
    try {
      const birdResult = await this.birdVerifyService.createEmailVerification(
        userEmail,
        {
          requestId,
          betterAuthId,
        },
      );
      birdId = birdResult.id;
      this.logger.log(
        `Bird verification created: ${birdId} for ${maskEmail(userEmail)} (status: ${birdResult.status})`,
      );
    } catch (err) {
      /**
       * Bird rechazo la peticion (rate-limit, dest no valido, etc.) o fallo
       * la red. Marcar el registro como expired (no verificable) y devolver
       * un error generico al cliente (cierre del oracle de enumeracion).
       */
      otpRecord.status = "expired";
      await otpRecord.save();
      this.logger.error(
        `Bird createEmailVerification failed for ${maskEmail(userEmail)}: ${err instanceof Error ? err.message : String(err)}`,
      );
      const errMsg = err instanceof Error ? err.message : String(err);
      if (/rate|429|too many|retry/i.test(errMsg)) {
        throw new HttpException(
          "El servicio de verificacion estan saturado. Intenta de nuevo en un minuto.",
          HttpStatus.TOO_MANY_REQUESTS,
          { cause: err },
        );
      }
      throw new UnauthorizedException(LoginOtpService.GENERIC_AUTH_ERROR, {
        cause: "Bird Verify send failure",
      });
    }

    if (birdId) {
      otpRecord.birdVerificationId = birdId;
      await otpRecord.save();
    }

    // `userName` se mantiene para compatibilidad futura (logs / metricas);
    // Bird envia el correo bajo su propio template de Authifly OTP, asi que
    // no se necesita aqui.
    void userName;

    return { requestId };
  }

  /**
   * Verifica el codigo OTP via Bird Verify y, si es valido, desencripta y
   * devuelve las cookies de sesion para que el proxy las establezca en el
   * navegador del cliente.
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

    /**
     * Llama a Bird Verify `POST /v1/verify/verifications/check` con el
     * codigo que el usuario ingreso. Bird identifica la verificacion por
     * el mismo `to.email` usado al crearla, asi que no se necesita
     * el `birdVerificationId` (pero se loguea si esta disponible).
     *
     * Bird devuelve:
     *  - `200` con `success: true/false` (los codigos incorrectos son 200,
     *    no errores).
     *  - `404` si la verificacion ya resolvio (verified/expired/failed).
     *  - `429` si el caller supera el rate cap (10 checks/recipient/min).
     */
    let birdResult;
    try {
      birdResult = await this.birdVerifyService.checkEmailVerification(
        otpRecord.email,
        code,
      );
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);

      /**
       * 404 de Bird = verificacion ya resuelta o expirada. Marcar el
       * registro como expired y devolver 410 al cliente.
       */
      if (/404|not found|no verification/i.test(errMsg)) {
        otpRecord.status = "expired";
        await otpRecord.save();
        this.logger.warn(
          `Bird check returned 404 (resolved/expired) for requestId=${requestId} birdId=${otpRecord.birdVerificationId ?? "n/a"}`,
        );
        throw new GoneException(
          "El código de verificación no existe, ya fue utilizado o ha expirado.",
          { cause: err },
        );
      }

      /**
       * 429 de Bird = rate-limit (10 checks/recipient/min). Devolver 429
       * al cliente con el mensaje apropiado.
       */
      if (/429|rate|too many|retry/i.test(errMsg)) {
        this.logger.warn(
          `Bird check rate-limited for requestId=${requestId}: ${errMsg}`,
        );
        throw new HttpException(
          "Has realizado demasiados intentos. Espera un minuto e intenta de nuevo.",
          HttpStatus.TOO_MANY_REQUESTS,
          { cause: err },
        );
      }

      /**
       * Otros errores (red, 5xx, etc.) — no marcar el registro como
       * expired (puede ser un fallo transitorio). Devolver 503.
       */
      this.logger.error(
        `Bird checkEmailVerification failed for requestId=${requestId}: ${errMsg}`,
      );
      throw new HttpException(
        "El servicio de verificacion no esta disponible. Intenta de nuevo.",
        HttpStatus.SERVICE_UNAVAILABLE,
        { cause: err },
      );
    }

    if (birdResult.success) {
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
     * Bird devolvio `success: false` con un `reason`:
     *  - `incorrect_code`    → 401 Unauthorized (con intentos restantes)
     *  - `expired`           → 410 Gone
     *  - `attempts_exhausted` → 410 Gone (verificacion fallida)
     *  - otro (open enum)    → tratar como terminal = 410 Gone
     */
    otpRecord.attempts += 1;
    const reason = birdResult.reason;
    const isTerminal =
      reason === "expired" ||
      reason === "attempts_exhausted" ||
      birdResult.status === "expired" ||
      birdResult.status === "failed" ||
      birdResult.status === "blocked" ||
      birdResult.status === "canceled";

    if (isTerminal) {
      otpRecord.status = "expired";
      await otpRecord.save();
      this.logger.warn(
        `Bird verification resolved terminally: requestId=${requestId} reason=${reason} status=${birdResult.status}`,
      );
      const userMsg =
        reason === "attempts_exhausted" || birdResult.status === "failed"
          ? "Has superado el máximo de intentos. Solicita un nuevo código."
          : "El código de verificación ha expirado. Solicita uno nuevo.";
      throw new GoneException(userMsg);
    }

    // incorrect_code (o reason no terminal)
    await otpRecord.save();
    const remaining = birdResult.attemptsRemaining;
    const remainingMsg =
      typeof remaining === "number" && remaining > 0
        ? `Código incorrecto. Te quedan ${remaining} intento(s).`
        : "Código incorrecto.";
    throw new UnauthorizedException(remainingMsg);
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
