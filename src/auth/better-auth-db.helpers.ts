import { Logger } from "@nestjs/common";
import { Db } from "mongodb";

const LEGACY_ACCOUNT_ISSUER_INDEX = "account_issuer_accountId_uidx";
const MONGO_INDEX_NOT_FOUND = 27;
const MONGO_NAMESPACE_NOT_FOUND = 26;

function isIgnorableIndexDropError(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const code = (err as { code?: unknown }).code;
  const codeName = (err as { codeName?: unknown }).codeName;
  return (
    code === MONGO_INDEX_NOT_FOUND ||
    code === MONGO_NAMESPACE_NOT_FOUND ||
    codeName === "IndexNotFound" ||
    codeName === "NamespaceNotFound"
  );
}

/**
 * Mantenimiento de índices y limpieza de migraciones de Better Auth 1.7.3+ en MongoDB:
 * - Elimina de forma idempotente el índice único obsoleto `account_issuer_accountId_uidx`
 *   (guía oficial de actualización Better Auth 1.7.3+: `issuer` dejó de escribirse y este
 *   índice provocaría colisiones falsas entre proveedores con el mismo `accountId`).
 * - Asegura índices TTL y de consulta en `session`, `verification` y `rateLimit`.
 */
export async function ensureBetterAuthIndexesAndMigrations(
  mongoDb: Db,
  logger: Logger,
): Promise<void> {
  try {
    await mongoDb.collection("account").dropIndex(LEGACY_ACCOUNT_ISSUER_INDEX);
    logger.log(
      `[BetterAuth 1.7 Migration] Dropped obsolete unique index "${LEGACY_ACCOUNT_ISSUER_INDEX}" on account collection.`,
    );
  } catch (dropErr) {
    if (!isIgnorableIndexDropError(dropErr)) {
      logger.warn(
        `[BetterAuth 1.7 Migration] Could not check/drop "${LEGACY_ACCOUNT_ISSUER_INDEX}": ${dropErr instanceof Error ? dropErr.message : String(dropErr)}`,
      );
    }
  }

  try {
    await Promise.all([
      mongoDb
        .collection("session")
        .createIndex(
          { expiresAt: 1 },
          { expireAfterSeconds: 0, background: true },
        ),
      mongoDb
        .collection("session")
        .createIndex({ userId: 1 }, { background: true }),
      mongoDb
        .collection("verification")
        .createIndex(
          { expiresAt: 1 },
          { expireAfterSeconds: 0, background: true },
        ),
      mongoDb
        .collection("verification")
        .createIndex({ identifier: 1 }, { background: true }),
      mongoDb
        .collection("rateLimit")
        .createIndex({ key: 1 }, { unique: true, background: true }),
      mongoDb
        .collection("rateLimit")
        .createIndex({ lastRequest: 1 }, { background: true }),
    ]);
  } catch (indexErr) {
    logger.warn(
      `Failed to ensure indexes on Better Auth collections: ${indexErr instanceof Error ? indexErr.message : String(indexErr)}`,
    );
  }
}
