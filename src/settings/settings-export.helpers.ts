import { NotFoundException } from "@nestjs/common";
import { Model } from "mongoose";
import { UserDocument } from "../users/schemas/user.schema";
import { getMongoDb } from "../auth/better-auth";
import type { LeanUser } from "./settings.constants";

export async function buildUserDataExport(
  userModel: Model<UserDocument>,
  userId: string,
) {
  const user = (await userModel.findById(userId).lean()) as unknown as LeanUser;

  if (!user) throw new NotFoundException("Usuario no encontrado");

  let authData: Record<string, unknown> | null = null;
  try {
    const db = getMongoDb();
    const betterAuthUser = await db
      .collection("user")
      .findOne({ id: user.betterAuthId });
    if (betterAuthUser) {
      authData = {
        id: betterAuthUser.id,
        email: betterAuthUser.email,
        emailVerified: betterAuthUser.emailVerified,
        name: betterAuthUser.name,
        createdAt: betterAuthUser.createdAt,
      };
    }
  } catch {
    // ignore
  }

  return {
    exportedAt: new Date().toISOString(),
    user: {
      id: user._id.toString(),
      email: user.email,
      role: user.role,
      profileCompleted: user.profileCompleted,
      emailVerified: user.emailVerified,
      legalConsentAccepted: user.legalConsentAccepted,
      isActive: user.isActive,
      membershipLevel: user.membershipLevel,
      membershipStartDate: user.membershipStartDate,
      membershipExpiryDate: user.membershipExpiryDate,
      membershipPaymentPlan: user.membershipPaymentPlan,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    },
    authData,
    profile: user.profile,
    settings: user.settings ?? {},
    accountDeletionRequested: user.accountDeletionRequested,
    accountDeletionRequestedAt: user.accountDeletionRequestedAt,
  };
}
