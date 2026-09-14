import { BadRequestException, NotFoundException } from "@nestjs/common";
import { Model } from "mongoose";
import { UserDocument, REQUIRED_PROFILE_SECTIONS } from "./schemas/user.schema";
import { UpdateProfileSectionDto } from "../profile/dto/update-profile-section.dto";
import { DeleteProfileSectionDto } from "../profile/dto/delete-profile-section.dto";
import {
  getColombiaDate,
  generateOfficialNumber,
  syncPhoneIfChanged,
  resetIdentityIfDocumentChanged,
} from "./users-official-number.helper";

export async function executeEnsureOfficialNumber(
  userModel: Model<UserDocument>,
  user: UserDocument | Record<string, unknown>,
): Promise<string> {
  const profile =
    (user as { profile?: Record<string, Record<string, unknown>> }).profile ??
    {};
  const memSection = profile["membresia-ecosistema"] ?? {};
  const currentNum =
    typeof memSection.numeroMiembro === "string"
      ? memSection.numeroMiembro
      : "";
  const isMember =
    (user as { membershipLevel?: string }).membershipLevel === "Legend";
  const expectedPrefix = isMember ? "901412" : "901411";

  if (new RegExp(String.raw`^${expectedPrefix}\d{4}$`).test(currentNum)) {
    return currentNum;
  }

  let suffix: string | undefined;
  const match10 = /^90141[12](\d{4})$/.exec(currentNum);
  if (match10) {
    suffix = match10[1];
  }

  const newNumber = await generateOfficialNumber(userModel, isMember, suffix);

  const userId = (user as { _id?: string })._id;
  if (userId) {
    memSection.numeroMiembro = newNumber;
    if (!memSection.fechaIngreso) {
      memSection.fechaIngreso = getColombiaDate();
    }
    profile["membresia-ecosistema"] = memSection;
    await userModel.updateOne(
      { _id: userId },
      { $set: { "profile.membresia-ecosistema": memSection } },
    );
  }

  return newNumber;
}

async function ensureMembershipSectionOnComplete(
  userModel: Model<UserDocument>,
  user: UserDocument,
  profile: Record<string, unknown>,
): Promise<void> {
  const memSection =
    (profile["membresia-ecosistema"] as Record<string, unknown> | undefined) ??
    {};
  memSection.fechaIngreso ??= getColombiaDate();
  const numMiembro =
    typeof memSection.numeroMiembro === "string"
      ? memSection.numeroMiembro
      : "";
  if (!numMiembro || !/^90141[12]\d{4}$/.test(numMiembro)) {
    const isMember = user.membershipLevel === "Legend";
    memSection.numeroMiembro = await generateOfficialNumber(
      userModel,
      isMember,
    );
  }
  profile["membresia-ecosistema"] = memSection;
}

function handleSectionPreUpdates(
  user: UserDocument,
  sectionId: string,
  sanitizedData: Record<string, unknown>,
): void {
  if (sectionId === "contacto") {
    syncPhoneIfChanged(user, sanitizedData);
  } else if (sectionId === "datos-personales" && user.identityVerified) {
    resetIdentityIfDocumentChanged(user, sanitizedData);
  }
}

function applySectionToProfile(
  profile: Record<string, unknown>,
  sectionId: string,
  sanitizedData: Record<string, unknown>,
): void {
  if (sectionId === "membresia-ecosistema") {
    const existing =
      (profile[sectionId] as Record<string, unknown> | undefined) ?? {};
    profile[sectionId] = { ...existing, ...sanitizedData };
  } else {
    profile[sectionId] = sanitizedData;
  }
}

export async function executeUpdateProfileSection(
  userModel: Model<UserDocument>,
  userId: string,
  sectionId: string,
  sectionData: Record<string, unknown>,
): Promise<UserDocument> {
  if (!UpdateProfileSectionDto.isValidSectionId(sectionId)) {
    throw new BadRequestException(`Sección inválida: ${sectionId}`);
  }
  const sanitizedData = UpdateProfileSectionDto.sanitize(
    sectionData,
    sectionId,
  );
  const user = await userModel.findById(userId);
  if (!user) {
    throw new NotFoundException("Usuario no encontrado");
  }

  handleSectionPreUpdates(user, sectionId, sanitizedData);

  const profile = user.profile ?? {};
  applySectionToProfile(profile, sectionId, sanitizedData);

  const completedSections = [...(user.completedSections ?? [])];
  if (!completedSections.includes(sectionId)) {
    completedSections.push(sectionId);
  }

  const profileCompleted = REQUIRED_PROFILE_SECTIONS.every((s) =>
    completedSections.includes(s),
  );

  if (profileCompleted && !user.profileCompleted) {
    await ensureMembershipSectionOnComplete(userModel, user, profile);
  }

  user.profile = profile;
  user.completedSections = completedSections;
  user.profileCompleted = profileCompleted;
  user.markModified("profile");

  return user.save();
}

export async function executeDeleteProfileSection(
  userModel: Model<UserDocument>,
  userId: string,
  sectionId: string,
): Promise<UserDocument> {
  if (!DeleteProfileSectionDto.isValidSectionId(sectionId)) {
    throw new BadRequestException(`Sección inválida: ${sectionId}`);
  }
  const user = await userModel.findById(userId);
  if (!user) {
    throw new NotFoundException("Usuario no encontrado");
  }

  const profile = user.profile ?? {};
  profile[sectionId] = {};

  const completedSections = (user.completedSections ?? []).filter(
    (s) => s !== sectionId,
  );

  const profileCompleted = REQUIRED_PROFILE_SECTIONS.every((s) =>
    completedSections.includes(s),
  );

  user.profile = profile;
  user.completedSections = completedSections;
  user.profileCompleted = profileCompleted;
  user.markModified("profile");

  return user.save();
}
