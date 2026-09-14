import { Logger } from "@nestjs/common";
import { Model } from "mongoose";
import { MembershipTransactionDocument } from "./schemas/membership-transaction.schema";
import { UsersService } from "../users/users.service";
import {
  maskAmount,
  maskReference,
  maskUserId,
} from "../common/utils/log-redact.util";

export async function sweepAbandonedPaymentsHelper(
  deps: {
    transactionModel: Model<MembershipTransactionDocument>;
    usersService: UsersService;
    logger: Logger;
  },
  now: Date = new Date(),
): Promise<{ swept: number; creditReverted: number }> {
  const PENDING_TTL_MS = 48 * 60 * 60 * 1000;
  const cutoff = new Date(now.getTime() - PENDING_TTL_MS);

  const abandoned = await deps.transactionModel
    .find({
      status: "PENDING",
      createdAt: { $lt: cutoff },
      benefitGranted: false,
    })
    .limit(500);

  let swept = 0;
  let creditReverted = 0;

  for (const tx of abandoned) {
    const updated = await deps.transactionModel.findOneAndUpdate(
      { _id: tx._id, status: "PENDING" },
      { $set: { status: "VOIDED" } },
      { new: true },
    );
    if (!updated) continue;

    swept++;

    if (tx.creditUsedAmount > 0 && !updated.creditReverted) {
      const reverted = await deps.usersService.revertPartialPaymentCredit(
        tx.userId,
        tx.creditUsedAmount,
      );
      if (reverted) {
        await deps.transactionModel.updateOne(
          { _id: updated._id, creditReverted: false },
          { $set: { creditReverted: true } },
        );
        creditReverted += tx.creditUsedAmount;
        deps.logger.log(
          `Credit reverted by sweeper: user=${maskUserId(tx.userId)} amount=${maskAmount(tx.creditUsedAmount)} ref=${maskReference(tx.reference)}`,
        );
      }
    }
  }

  deps.logger.log(
    `Pending sweeper: ${swept} VOIDED, ${maskAmount(creditReverted)} COP reverted`,
  );
  return { swept, creditReverted };
}
