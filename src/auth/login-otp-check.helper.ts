import {
  Logger,
  GoneException,
  UnauthorizedException,
  HttpException,
  HttpStatus,
} from "@nestjs/common";
import { LoginOtpDocument } from "./schemas/login-otp.schema";
import {
  BirdVerifyService,
  type BirdCheckResult,
} from "../bird-verify/bird-verify.service";
import { getMongoDb } from "./better-auth";
import {
  decryptSessionCookies,
  extractCookiesFromHeaders,
  extractSessionTokenFromCookies,
} from "./login-otp-crypto.helper";
import { rewriteSessionSetCookieMaxAge } from "./better-auth-cookie.helper";
import { maskEmail } from "../common/utils/log-redact.util";

const STANDARD_SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24h when rememberMe=false
const REMEMBERED_MEMBER_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7d matching Better Auth config
const PRIVILEGED_SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24h cap for staff/admin/superadmin
const PRIVILEGED_ROLES = new Set(["admin", "superadmin", "gestor"]);

export async function revokeEncryptedOtpSession(
  otpRecord: LoginOtpDocument,
  sessionEncKey: Buffer,
  logger?: Logger,
): Promise<void> {
  try {
    const rawCookies = decryptSessionCookies(
      otpRecord.sessionCookies,
      sessionEncKey,
      logger,
    );
    const token = extractSessionTokenFromCookies(rawCookies);
    if (!token) return;
    const db = getMongoDb();
    await db.collection("session").deleteOne({ token });
  } catch {
    // Best-effort cleanup
  }
}

async function promoteBetterAuthSessionOnOtpSuccess(
  rawCookies: string[],
  betterAuthId?: string,
): Promise<{ maxAgeSeconds?: number }> {
  const token = extractSessionTokenFromCookies(rawCookies);
  if (!token) return {};
  try {
    const db = getMongoDb();
    const existingSession = await db
      .collection("session")
      .findOne({ token }, { projection: { rememberMe: 1, userId: 1 } });
    const rememberMe = existingSession?.rememberMe === true;

    let isPrivileged = false;
    const lookupBaId =
      betterAuthId ||
      (typeof existingSession?.userId === "string"
        ? existingSession.userId
        : undefined);
    if (lookupBaId) {
      const userDoc = await db
        .collection("users")
        .findOne(
          { betterAuthId: lookupBaId },
          { projection: { role: 1, subrol: 1 } },
        );
      if (userDoc) {
        const role = typeof userDoc["role"] === "string" ? userDoc["role"] : "";
        const subrol: unknown = userDoc["subrol"];
        isPrivileged =
          PRIVILEGED_ROLES.has(role) ||
          (typeof subrol === "string" && subrol.trim().length > 0);
      }
    }

    let ttlMs = STANDARD_SESSION_TTL_MS;
    if (rememberMe) {
      ttlMs = isPrivileged
        ? PRIVILEGED_SESSION_TTL_MS
        : REMEMBERED_MEMBER_SESSION_TTL_MS;
    }

    await db.collection("session").updateOne(
      { token },
      {
        $set: {
          expiresAt: new Date(Date.now() + ttlMs),
        },
        $unset: {
          otpPending: "",
          rememberMe: "",
        },
      },
    );
    return {
      maxAgeSeconds: rememberMe ? Math.floor(ttlMs / 1000) : undefined,
    };
  } catch {
    return {};
  }
}

export async function dispatchBirdVerification(
  birdVerifyService: BirdVerifyService,
  otpRecord: LoginOtpDocument,
  userEmail: string,
  requestId: string,
  betterAuthId: string,
  logger: Logger,
  genericAuthError: string,
): Promise<void> {
  try {
    const birdResult = await birdVerifyService.createEmailVerification(
      userEmail,
      { requestId, betterAuthId },
    );
    otpRecord.birdVerificationId = birdResult.id;
    await otpRecord.save();
    logger.log(
      `Bird verification created: ${birdResult.id} for ${maskEmail(userEmail)} (status: ${birdResult.status})`,
    );
  } catch (err) {
    otpRecord.status = "expired";
    await otpRecord.save();
    const errMsg = err instanceof Error ? err.message : String(err);
    logger.error(
      `Bird createEmailVerification failed for ${maskEmail(userEmail)}: ${errMsg}`,
    );
    if (/rate|429|too many|retry/i.test(errMsg)) {
      throw new HttpException(
        "El servicio de verificacion estan saturado. Intenta de nuevo en un minuto.",
        HttpStatus.TOO_MANY_REQUESTS,
        { cause: err },
      );
    }
    throw new UnauthorizedException(genericAuthError, {
      cause: "Bird Verify send failure",
    });
  }
}

export async function handleBirdCheckError(
  err: unknown,
  otpRecord: LoginOtpDocument,
  requestId: string,
  logger: Logger,
  sessionEncKey?: Buffer,
): Promise<never> {
  const errMsg = err instanceof Error ? err.message : String(err);

  if (/404|not found|no verification/i.test(errMsg)) {
    otpRecord.status = "expired";
    await otpRecord.save();
    if (sessionEncKey) {
      await revokeEncryptedOtpSession(otpRecord, sessionEncKey, logger);
    }
    logger.warn(
      `Bird check returned 404 (resolved/expired) for requestId=${requestId} birdId=${otpRecord.birdVerificationId ?? "n/a"}`,
    );
    throw new GoneException(
      "El código de verificación no existe, ya fue utilizado o ha expirado.",
      { cause: err },
    );
  }

  if (/429|rate|too many|retry/i.test(errMsg)) {
    logger.warn(
      `Bird check rate-limited for requestId=${requestId}: ${errMsg}`,
    );
    throw new HttpException(
      "Has realizado demasiados intentos. Espera un minuto e intenta de nuevo.",
      HttpStatus.TOO_MANY_REQUESTS,
      { cause: err },
    );
  }

  logger.error(
    `Bird checkEmailVerification failed for requestId=${requestId}: ${errMsg}`,
  );
  throw new HttpException(
    "El servicio de verificacion no esta disponible. Intenta de nuevo.",
    HttpStatus.SERVICE_UNAVAILABLE,
    { cause: err },
  );
}

export async function assertNotTerminalOrThrow(
  otpRecord: LoginOtpDocument,
  requestId: string,
  birdResult: BirdCheckResult,
  logger: Logger,
  sessionEncKey?: Buffer,
): Promise<void> {
  const reason = birdResult.reason;
  const status = birdResult.status;
  const isTerminal =
    reason === "expired" ||
    reason === "attempts_exhausted" ||
    status === "expired" ||
    status === "failed" ||
    status === "blocked" ||
    status === "canceled";

  if (!isTerminal) return;

  otpRecord.status = "expired";
  await otpRecord.save();
  if (sessionEncKey) {
    await revokeEncryptedOtpSession(otpRecord, sessionEncKey, logger);
  }
  logger.warn(
    `Bird verification resolved terminally: requestId=${requestId} reason=${reason} status=${status}`,
  );
  const userMsg =
    reason === "attempts_exhausted" || status === "failed"
      ? "Has superado el máximo de intentos. Solicita un nuevo código."
      : "El código de verificación ha expirado. Solicita uno nuevo.";
  throw new GoneException(userMsg);
}

export async function processBirdCheckResult(
  otpRecord: LoginOtpDocument,
  requestId: string,
  birdResult: BirdCheckResult,
  sessionEncKey: Buffer,
  logger: Logger,
): Promise<{ cookies: string[]; setCookieHeaders: string[] }> {
  if (birdResult.success) {
    const updated = await otpRecord
      .model("LoginOtp")
      .findOneAndUpdate(
        { _id: otpRecord._id, status: "pending" },
        { $set: { status: "verified", verifiedAt: new Date() } },
        { new: true },
      );
    if (!updated) {
      throw new GoneException("El código de verificación ya fue procesado.");
    }

    const rawCookies = decryptSessionCookies(
      otpRecord.sessionCookies,
      sessionEncKey,
      logger,
    );
    if (rawCookies.length === 0) {
      logger.error(
        `Failed to decrypt session cookies for verified OTP: ${requestId}`,
      );
      throw new GoneException(
        "El código de verificación ha expirado. Solicita uno nuevo.",
      );
    }

    const { maxAgeSeconds } = await promoteBetterAuthSessionOnOtpSuccess(
      rawCookies,
      otpRecord.betterAuthId,
    );

    const isProd = process.env.NODE_ENV === "production";
    const normalizedSetCookies = rawCookies.map((sc) => {
      if (sc.includes(";")) return sc;
      return `${sc}; Path=/; SameSite=Lax; HttpOnly${isProd ? "; Secure" : ""}`;
    });
    const setCookieHeaders = rewriteSessionSetCookieMaxAge(
      normalizedSetCookies,
      maxAgeSeconds,
    );
    const cookies = extractCookiesFromHeaders(rawCookies);
    return { cookies, setCookieHeaders };
  }

  await assertNotTerminalOrThrow(
    otpRecord,
    requestId,
    birdResult,
    logger,
    sessionEncKey,
  );

  await otpRecord.save();
  const remaining = birdResult.attemptsRemaining;
  const remainingMsg =
    typeof remaining === "number" && remaining > 0
      ? `Código incorrecto. Te quedan ${remaining} intento(s).`
      : "Código incorrecto.";
  throw new UnauthorizedException(remainingMsg);
}
