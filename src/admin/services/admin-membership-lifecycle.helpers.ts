import { Logger, NotFoundException, BadRequestException } from "@nestjs/common";
import { Model } from "mongoose";
import { UserDocument, UserRole } from "../../users/schemas/user.schema";
import { NotificationsService } from "../../notifications/notifications.service";
import {
  NotificationType,
  NotificationPriority,
} from "../../notifications/schemas/notification.schema";
import {
  calculateActivationExpiry,
  calculateExtensionExpiry,
} from "./admin-membership.helpers";

export async function executeActivateMembership(
  userModel: Model<UserDocument>,
  notificationsService: NotificationsService,
  logger: Logger,
  userId: string,
  actorId = "",
) {
  const user = await userModel.findById(userId);
  if (!user) {
    throw new NotFoundException("Usuario no encontrado");
  }

  const { baseDate, expiry } = calculateActivationExpiry(
    user.membershipExpiryDate,
  );

  user.role = UserRole.MEMBER;
  user.membershipLevel = "Legend";
  user.membershipStartDate = user.membershipStartDate ?? baseDate;
  user.membershipPaymentPlan = user.membershipPaymentPlan ?? "single";
  user.installmentsPaid = user.installmentsPaid ?? 12;
  user.membershipExpiryDate = expiry;
  user.membershipGracePeriodEnd = null;
  user.membershipExpired = false;
  await user.save();

  await notificationsService.create({
    userId,
    type: NotificationType.MEMBERSHIP_ACTIVATED,
    title: "Membresía activada por administración",
    message: `Un administrador activó tu membresía Legend hasta el ${expiry.toLocaleDateString("es-CO")}.`,
    priority: NotificationPriority.HIGH,
    metadata: { adminAction: true, newExpiry: expiry.toISOString() },
  });

  logger.log(
    `Membership admin-activated: user=${userId} expiry=${expiry.toISOString()} actor=${actorId}`,
  );
  return {
    userId,
    role: user.role,
    membershipLevel: user.membershipLevel,
    membershipExpiryDate: user.membershipExpiryDate,
    membershipPaymentPlan: user.membershipPaymentPlan,
  };
}

export async function executeExtendMembership(
  userModel: Model<UserDocument>,
  notificationsService: NotificationsService,
  logger: Logger,
  userId: string,
  unit: string,
  amount = 1,
  baseDateStr?: string,
  actorId = "",
) {
  const user = await userModel.findById(userId);
  if (!user) {
    throw new NotFoundException("Usuario no encontrado");
  }
  if ((user.role as UserRole) !== UserRole.MEMBER) {
    throw new BadRequestException(
      "El usuario no tiene membresía activa para extender",
    );
  }

  const expiry = calculateExtensionExpiry(
    user.membershipExpiryDate,
    unit,
    amount,
    baseDateStr,
  );

  user.membershipExpiryDate = expiry;
  user.membershipGracePeriodEnd = null;
  user.membershipExpired = false;
  await user.save();

  await notificationsService.create({
    userId,
    type: NotificationType.MEMBERSHIP_ACTIVATED,
    title: "Membresía extendida por administración",
    message: `Un administrador extendió tu membresía Legend hasta el ${expiry.toLocaleDateString("es-CO")}.`,
    priority: NotificationPriority.MEDIUM,
    metadata: { adminAction: true, unit, newExpiry: expiry.toISOString() },
  });

  logger.log(
    `Membership admin-extended: user=${userId} unit=${unit} newExpiry=${expiry.toISOString()} actor=${actorId}`,
  );
  return { userId, membershipExpiryDate: user.membershipExpiryDate };
}

export async function executeRevokeMembership(
  userModel: Model<UserDocument>,
  notificationsService: NotificationsService,
  logger: Logger,
  userId: string,
  actorId = "",
) {
  const user = await userModel.findById(userId);
  if (!user) {
    throw new NotFoundException("Usuario no encontrado");
  }

  user.role = UserRole.USER;
  user.membershipLevel = null;
  user.membershipStartDate = null;
  user.membershipExpiryDate = null;
  user.membershipPaymentPlan = null;
  user.installmentsPaid = 0;
  user.membershipGracePeriodEnd = null;
  user.membershipExpired = true;
  user.renewalInstallmentsPaid = 0;
  await user.save();

  await notificationsService.create({
    userId,
    type: NotificationType.MEMBERSHIP_REVOKED,
    title: "Membresía revocada por administración",
    message:
      "Un administrador revocó tu membresía Legend. Si crees que es un error, contáctanos.",
    priority: NotificationPriority.HIGH,
    metadata: { adminAction: true },
  });

  logger.log(`Membership admin-revoked: user=${userId} actor=${actorId}`);
  return { userId, role: user.role };
}
