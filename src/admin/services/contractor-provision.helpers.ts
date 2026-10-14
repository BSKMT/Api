import { BadRequestException, ConflictException, Logger } from "@nestjs/common";
import { Model } from "mongoose";
import { UserDocument, UserRole } from "../../users/schemas/user.schema";
import { getAuth, getMongoDb } from "../../auth/better-auth";
import { generateBskmtUsername } from "../../common/utils/username-generator.util";
import {
  NormalizedStaffPayload,
  buildStaffProfileUpdate,
  buildStaffContractorInfo,
} from "./contractor-payload.helpers";

export interface ProvisionStaffOptions {
  userModel: Model<UserDocument>;
  norm: NormalizedStaffPayload;
  role: UserRole;
  subrol?: string | null;
  adminPermissions?: string[];
  tipoContrato: string;
  creatorUserId: string;
  logger: Logger;
}

export async function generateUniqueUsername(
  userModel: Model<UserDocument>,
  cedula: string,
  primerNombre: string,
  primerApellido: string,
): Promise<{ username: string; internalCode: string }> {
  let attempts = 0;
  while (attempts < 10) {
    const generated = generateBskmtUsername(
      cedula,
      primerNombre,
      primerApellido,
    );
    const exists = await userModel
      .findOne({ username: generated.username })
      .lean();
    if (!exists) {
      return {
        username: generated.username,
        internalCode: generated.internalCode,
      };
    }
    attempts++;
  }
  throw new ConflictException(
    "No fue posible generar un nombre de usuario único tras 10 intentos.",
  );
}

export async function createBetterAuthAccount(
  email: string,
  password: string,
  fullName: string,
  primerNombre: string,
  segundoNombre: string | undefined,
  primerApellido: string,
  segundoApellido: string | undefined,
  logger: Logger,
): Promise<string> {
  const auth = await getAuth();
  let betterAuthId = "";

  try {
    const authRes = await auth.api.signUpEmail({
      body: {
        email: email.toLowerCase(),
        password,
        name: fullName,
        primerNombre,
        segundoNombre: segundoNombre || "",
        primerApellido,
        segundoApellido: segundoApellido || "",
      },
    });

    betterAuthId = authRes?.user?.id || "";
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    logger.error(`Error en auth.api.signUpEmail para ${email}: ${errMsg}`);
    throw new BadRequestException(
      `Error al registrar credenciales de Better Auth: ${errMsg}`,
    );
  }

  if (!betterAuthId) {
    const rawUser = await getMongoDb()
      .collection("user")
      .findOne({ email: email.toLowerCase() });
    if (rawUser) {
      betterAuthId = String(rawUser._id);
    } else {
      throw new BadRequestException(
        "No se pudo obtener el identificador de usuario de Better Auth.",
      );
    }
  }

  await getMongoDb()
    .collection("user")
    .updateOne(
      { email: email.toLowerCase() },
      { $set: { emailVerified: true } },
    );

  return betterAuthId;
}

export async function provisionStaffUser(options: ProvisionStaffOptions) {
  const {
    userModel,
    norm,
    role,
    subrol,
    adminPermissions,
    tipoContrato,
    creatorUserId,
    logger,
  } = options;

  const { username, internalCode } = await generateUniqueUsername(
    userModel,
    norm.cedula,
    norm.primerNombre,
    norm.primerApellido,
  );

  const fullName =
    `${norm.primerNombre} ${norm.segundoNombre ? norm.segundoNombre + " " : ""}${norm.primerApellido} ${norm.segundoApellido || ""}`.trim();
  const betterAuthId = await createBetterAuthAccount(
    norm.email,
    norm.password,
    fullName,
    norm.primerNombre,
    norm.segundoNombre,
    norm.primerApellido,
    norm.segundoApellido,
    logger,
  );

  const contractorInfo = buildStaffContractorInfo(
    norm,
    subrol,
    tipoContrato,
    creatorUserId,
  );

  const updateFields: Record<string, unknown> = {
    email: norm.email,
    betterAuthId,
    username,
    internalCode,
    role,
    subrol,
    contractorInfo,
    emailVerified: true,
    isActive: true,
    profileCompleted: true,
    ...buildStaffProfileUpdate(norm),
  };

  if (adminPermissions) {
    updateFields.adminPermissions = adminPermissions;
  }

  const updatedUser = await userModel.findOneAndUpdate(
    { $or: [{ email: norm.email }, { betterAuthId }] },
    { $set: updateFields },
    { new: true, upsert: true },
  );

  await getMongoDb()
    .collection("user")
    .updateOne({ email: norm.email }, { $set: { username, role } });

  logger.log(
    `Personal provisionado: role="${role}", username="${username}", email="${norm.email}" por=${creatorUserId}`,
  );

  return {
    _id: updatedUser._id,
    username,
    email: norm.email,
    role,
    subrol,
    contractorInfo,
  };
}
