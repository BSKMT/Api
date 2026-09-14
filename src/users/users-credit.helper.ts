import { NotFoundException } from "@nestjs/common";
import { Model } from "mongoose";
import {
  UserDocument,
  UserRole,
  CreditType,
  PartialPaymentCredit,
} from "./schemas/user.schema";

export async function executeActivateMembership(
  userModel: Model<UserDocument>,
  userId: string,
  startDate: Date,
  expiryDate: Date,
  paymentPlan: string,
): Promise<UserDocument> {
  const user = await userModel.findById(userId);
  if (!user) {
    throw new NotFoundException("Usuario no encontrado");
  }

  user.role = UserRole.MEMBER;
  user.membershipLevel = "Legend";
  user.membershipStartDate = startDate;
  user.membershipExpiryDate = expiryDate;
  user.membershipPaymentPlan = paymentPlan;
  user.installmentsPaid = paymentPlan === "single" ? 12 : user.installmentsPaid;
  user.renewalInstallmentsPaid = 0;
  user.membershipGracePeriodEnd = null;
  user.membershipExpired = false;

  return user.save();
}

export async function executeUpdatePartialPaymentCredit(
  userModel: Model<UserDocument>,
  userId: string,
  credit: PartialPaymentCredit,
): Promise<void> {
  await userModel.updateOne({ _id: userId }, { partialPaymentCredit: credit });
}

export async function executeUpdatePartialPaymentCreditIfType(
  userModel: Model<UserDocument>,
  userId: string,
  expectedType: CreditType,
  newCredit: PartialPaymentCredit,
): Promise<boolean> {
  const result = await userModel.updateOne(
    {
      _id: userId,
      "partialPaymentCredit.type": expectedType,
    },
    { $set: { partialPaymentCredit: newCredit } },
  );
  return result.modifiedCount > 0;
}

export async function executeIncrementPartialPaymentCreditUsedAmount(
  userModel: Model<UserDocument>,
  userId: string,
  increment: number,
  expectedUsedAmount: number,
): Promise<UserDocument | null> {
  return userModel.findOneAndUpdate(
    {
      _id: userId,
      "partialPaymentCredit.usedAmount": expectedUsedAmount,
    },
    { $inc: { "partialPaymentCredit.usedAmount": increment } },
    { new: true },
  );
}

export async function executeCreatePartialPaymentCredit(
  userModel: Model<UserDocument>,
  userId: string,
  amount: number,
  installmentsPaid: number,
): Promise<void> {
  const credit: PartialPaymentCredit = {
    amount,
    installmentsPaid,
    originalCurrency: "COP",
    createdAt: new Date(),
    type: CreditType.PENDING,
    usedAmount: 0,
    expiresAt: null,
    refundRequestedAt: null,
    convertedAt: null,
    notes: `Crédito generado por ${installmentsPaid} cuotas de renovación no completadas`,
  };

  await userModel.updateOne({ _id: userId }, { partialPaymentCredit: credit });
}

export async function executeClearPartialPaymentCredit(
  userModel: Model<UserDocument>,
  userId: string,
): Promise<void> {
  await userModel.updateOne({ _id: userId }, { partialPaymentCredit: null });
}

export async function executeRevertPartialPaymentCredit(
  userModel: Model<UserDocument>,
  userId: string,
  amount: number,
): Promise<boolean> {
  if (amount <= 0) return true;
  const result = await userModel.findOneAndUpdate(
    {
      _id: userId,
      "partialPaymentCredit.usedAmount": { $gte: amount },
    },
    { $inc: { "partialPaymentCredit.usedAmount": -amount } },
    { new: true },
  );
  if (result) return true;

  await userModel.updateOne(
    { _id: userId, "partialPaymentCredit.usedAmount": { $lt: 0 } },
    { $set: { "partialPaymentCredit.usedAmount": 0 } },
  );
  return false;
}
