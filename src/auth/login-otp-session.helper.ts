import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Logger,
  UnauthorizedException,
} from "@nestjs/common";
import { randomBytes } from "node:crypto";
import { Model } from "mongoose";
import { LoginOtpDocument } from "./schemas/login-otp.schema";
import { getAuth, getMongoDb } from "./better-auth";
import { maskEmail } from "../common/utils/log-redact.util";
import {
  extractCookiesFromHeaders,
  encryptSessionCookies,
  extractSessionTokenFromCookies,
} from "./login-otp-crypto.helper";
import { dispatchBirdVerification } from "./login-otp-check.helper";
import { BirdVerifyService } from "../bird-verify/bird-verify.service";

const OTP_PENDING_SESSION_TTL_MS = 10 * 60 * 1000;

export async function markBetterAuthSessionOtpPending(
  cookies: string[],
  remember: boolean,
): Promise<void> {
  const token = extractSessionTokenFromCookies(cookies);
  if (!token) return;
  try {
    const db = getMongoDb();
    await db.collection("session").updateOne(
      { token },
      {
        $set: {
          otpPending: true,
          rememberMe: remember,
          expiresAt: new Date(Date.now() + OTP_PENDING_SESSION_TTL_MS),
        },
      },
    );
  } catch {
    // Non-fatal: session will still be gated by encrypted cookies
  }
}

export async function revokeBetterAuthSessionByCookies(
  cookies: string[],
): Promise<void> {
  const token = extractSessionTokenFromCookies(cookies);
  if (!token) return;
  try {
    const db = getMongoDb();
    await db.collection("session").deleteOne({ token });
  } catch {
    // Best-effort cleanup
  }
}

export async function assertEmailThrottle(
  otpModel: Model<LoginOtpDocument>,
  userEmail: string,
  windowMs: number,
  maxCount: number,
  logger: Logger,
): Promise<void> {
  const recentCount = await otpModel.countDocuments({
    email: userEmail,
    createdAt: { $gt: new Date(Date.now() - windowMs) },
  });
  if (recentCount >= maxCount) {
    logger.warn(
      `Email throttle: ${maskEmail(userEmail)} supero ${maxCount} OTPs en ${windowMs / 1000}s`,
    );
    throw new HttpException(
      "Has solicitado demasiados codigos de verificacion. Espera 5 minutos e intenta de nuevo.",
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}

export async function extractSessionFromAuthResponse(
  authResponse: Response,
  email: string,
  genericError: string,
  logger: Logger,
): Promise<{
  sessionCookies: string[];
  betterAuthId: string;
  userEmail: string;
}> {
  const setCookieHeaders = authResponse.headers
    .getSetCookie()
    .filter((cookie) => !cookie.includes("better-auth.session_data="));
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
    logger.error(
      `Post-auth error: betterAuthId=${betterAuthId || "MISSING"} cookies=${sessionCookies.length}`,
    );
    throw new UnauthorizedException(genericError, {
      cause: `betterAuthId=${betterAuthId || "MISSING"}`,
    });
  }

  return { sessionCookies, betterAuthId, userEmail };
}

export async function authenticateAndExtractSession(
  email: string,
  password: string,
  remember: boolean,
  clientIp: string | undefined,
  userAgent: string | undefined,
  genericError: string,
  logger: Logger,
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
    logger.error(
      `Better Auth signInEmail threw: ${err instanceof Error ? err.message : String(err)}`,
    );
    throw new BadRequestException(
      "Error al procesar la solicitud de inicio de sesión.",
      { cause: err },
    );
  }

  if (authResponse.ok) {
    return await extractSessionFromAuthResponse(
      authResponse,
      email,
      genericError,
      logger,
    );
  }

  const rawBody = await authResponse.text().catch(() => "");
  logger.warn(
    `Better Auth signInEmail returned ${authResponse.status} — body: ${rawBody.slice(0, 300)}`,
  );
  throw new UnauthorizedException(genericError, {
    cause: rawBody,
  });
}

export interface DispatchOtpParams {
  targetEmail: string;
  session: { sessionCookies: string[]; betterAuthId: string };
  sessionEncKey: Buffer;
  windowMs: number;
  maxSends: number;
  errorMessage: string;
  remember?: boolean;
}

export async function executeDispatchOtpAndSave(
  otpModel: Model<LoginOtpDocument>,
  birdVerifyService: BirdVerifyService,
  logger: Logger,
  params: DispatchOtpParams,
): Promise<{ requestId: string }> {
  const {
    targetEmail,
    session,
    sessionEncKey,
    windowMs,
    maxSends,
    errorMessage,
    remember = false,
  } = params;

  await markBetterAuthSessionOtpPending(session.sessionCookies, remember);

  try {
    await assertEmailThrottle(
      otpModel,
      targetEmail,
      windowMs,
      maxSends,
      logger,
    );

    if (!birdVerifyService.isConfigured()) {
      logger.error("Bird Verify no configurado — initiate bloqueado");
      throw new UnauthorizedException(errorMessage, {
        cause: "Bird Verify not configured",
      });
    }
  } catch (err) {
    await revokeBetterAuthSessionByCookies(session.sessionCookies);
    throw err;
  }

  const requestId = randomBytes(16).toString("hex");
  const expiresAt = new Date(Date.now() + 3600 * 1000);
  const encryptedCookies = encryptSessionCookies(
    session.sessionCookies,
    sessionEncKey,
  );

  const otpRecord = await otpModel.create({
    requestId,
    email: targetEmail,
    betterAuthId: session.betterAuthId,
    sessionCookies: encryptedCookies,
    status: "pending",
    attempts: 0,
    expiresAt,
  });

  try {
    await dispatchBirdVerification(
      birdVerifyService,
      otpRecord,
      targetEmail,
      requestId,
      session.betterAuthId,
      logger,
      errorMessage,
    );
  } catch (err) {
    await revokeBetterAuthSessionByCookies(session.sessionCookies);
    throw err;
  }

  return { requestId };
}
