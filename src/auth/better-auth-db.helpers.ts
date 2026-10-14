import { Logger } from "@nestjs/common";
import { Db } from "mongodb";

export async function ensureBetterAuthIndexesAndMigrations(
  mongoDb: Db,
  logger: Logger,
): Promise<void> {
  try {
    const migrationResult = await mongoDb.collection("account").updateMany(
      {
        providerId: "credential",
        $or: [{ issuer: { $exists: false } }, { issuer: null }, { issuer: "" }],
      },
      {
        $set: { issuer: "local:credential" },
      },
    );
    if (migrationResult.modifiedCount > 0) {
      logger.log(
        `[BetterAuth 1.7 Migration] Backfilled issuer="local:credential" on ${migrationResult.modifiedCount} legacy credential account(s).`,
      );
    }
  } catch (migrationErr) {
    logger.error(
      `[BetterAuth 1.7 Migration] Failed to backfill account issuer: ${migrationErr instanceof Error ? migrationErr.message : String(migrationErr)}`,
    );
  }

  try {
    await mongoDb
      .collection("session")
      .createIndex(
        { expiresAt: 1 },
        { expireAfterSeconds: 0, background: true },
      );
    await mongoDb
      .collection("session")
      .createIndex({ userId: 1 }, { background: true });
  } catch (indexErr) {
    logger.warn(
      `Failed to ensure indexes on session collection: ${indexErr instanceof Error ? indexErr.message : String(indexErr)}`,
    );
  }
}
