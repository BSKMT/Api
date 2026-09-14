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
import { decryptSessionCookies } from "./login-otp-crypto.helper";
import { maskEmail } from "../common/utils/log-redact.util";

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
): Promise<never> {
  const errMsg = err instanceof Error ? err.message : String(err);

  if (/404|not found|no verification/i.test(errMsg)) {
    otpRecord.status = "expired";
    await otpRecord.save();
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
): Promise<{ cookies: string[] }> {
  if (birdResult.success) {
    otpRecord.status = "verified";
    await otpRecord.save();

    const cookies = decryptSessionCookies(
      otpRecord.sessionCookies,
      sessionEncKey,
      logger,
    );
    if (cookies.length === 0) {
      logger.error(
        `Failed to decrypt session cookies for verified OTP: ${requestId}`,
      );
      throw new GoneException(
        "El código de verificación ha expirado. Solicita uno nuevo.",
      );
    }
    return { cookies };
  }

  otpRecord.attempts += 1;
  await assertNotTerminalOrThrow(otpRecord, requestId, birdResult, logger);

  await otpRecord.save();
  const remaining = birdResult.attemptsRemaining;
  const remainingMsg =
    typeof remaining === "number" && remaining > 0
      ? `Código incorrecto. Te quedan ${remaining} intento(s).`
      : "Código incorrecto.";
  throw new UnauthorizedException(remainingMsg);
}
