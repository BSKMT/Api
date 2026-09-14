import { ConflictException } from "@nestjs/common";
import { Model } from "mongoose";
import type { UserDocument } from "./schemas/user.schema";
import {
  getColombiaDate,
  generateOfficialNumber,
} from "./users-official-number.helper";

export async function executeCreateUser(
  userModel: Model<UserDocument>,
  betterAuthId: string,
  email: string,
): Promise<UserDocument> {
  const existing = await userModel.findOne({ betterAuthId }).lean();
  if (existing) {
    throw new ConflictException("El usuario ya existe en la base de datos");
  }

  const officialNumber = await generateOfficialNumber(userModel, false);

  const created = new userModel({
    email: email.toLowerCase(),
    betterAuthId,
    role: "user",
    profileCompleted: false,
    completedSections: [],
    profile: {
      "membresia-ecosistema": {
        numeroMiembro: officialNumber,
        fechaIngreso: getColombiaDate(),
      },
    },
  });

  return created.save();
}
