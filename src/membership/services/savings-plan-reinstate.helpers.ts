import { BadRequestException, NotFoundException, Logger } from "@nestjs/common";
import { Model } from "mongoose";
import {
  SavingsPlanDocument,
  SavingsPlanStatus,
} from "../schemas/savings-plan.schema";
import { UsersService } from "../../users/users.service";
import { NotificationsService } from "../../notifications/notifications.service";
import {
  NotificationType,
  NotificationPriority,
} from "../../notifications/schemas/notification.schema";
import { MEMBERSHIP_DURATION_MS } from "../membership.constants";
import { RequestSavingsExtensionDto } from "../dto/savings-plan.dto";

export async function executeRequestExtension(
  plan: SavingsPlanDocument,
  notificationsService: NotificationsService,
  userId: string,
  dto: RequestSavingsExtensionDto,
  logger: Logger,
) {
  if (plan.status === SavingsPlanStatus.COMPLETED) {
    throw new BadRequestException("Tu plan de ahorro ya está completado.");
  }
  if (plan.extensionRequest?.status === "pending") {
    throw new BadRequestException(
      "Ya tienes una solicitud de prórroga en revisión por la Dirección de Membresías.",
    );
  }
  if (plan.status === SavingsPlanStatus.GRACE_PERIOD_2) {
    throw new BadRequestException(
      "Ya te fue concedida la ampliación de 1 mes de gracia adicional.",
    );
  }

  plan.status = SavingsPlanStatus.EXTENSION_REQUESTED;
  plan.extensionRequest = {
    requestedAt: new Date(),
    reason: dto.reason,
    status: "pending",
    directorNotes: "",
    reviewedBy: "",
    reviewedAt: null,
  };
  await plan.save();

  await notificationsService.create({
    userId,
    type: NotificationType.MEMBERSHIP_GRACE_PERIOD,
    title: "Solicitud de prórroga radicada",
    message:
      "Tu solicitud de 1 mes de gracia adicional fue radicada con éxito y está en revisión por la Dirección de Membresías.",
    priority: NotificationPriority.HIGH,
    notifyCategory: "Membresia y pagos",
  });

  logger.log(`Savings extension requested by user ${userId}`);
  return {
    success: true,
    message:
      "Solicitud de prórroga radicada exitosamente ante la Dirección de Membresías.",
    extensionRequest: plan.extensionRequest,
  };
}

export async function executeReinstateMembership(
  savingsPlanModel: Model<SavingsPlanDocument>,
  usersService: UsersService,
  notificationsService: NotificationsService,
  userId: string,
  summary: {
    canReinstate: boolean;
    seasonYear: number;
  },
) {
  if (!summary.canReinstate) {
    throw new BadRequestException(
      "No cumples con las condiciones para reincorporación (debes tener al menos 12 cuotas completas y estar en la ventana de renovación oficial).",
    );
  }

  const plan = await savingsPlanModel.findOne({
    userId,
    seasonYear: summary.seasonYear,
  });
  if (!plan) throw new NotFoundException("Plan de ahorro no encontrado.");

  const now = new Date();
  const expiry = new Date(now.getTime() + MEMBERSHIP_DURATION_MS);

  const totalInstallments = plan.installmentsPaid;
  const excess = Math.max(0, totalInstallments - 12);

  plan.status = SavingsPlanStatus.COMPLETED;
  plan.reinstatedAt = now;
  plan.completedAt = now;
  plan.excessInstallments = excess;
  await plan.save();

  await usersService.activateMembership(userId, now, expiry, "installments");

  if (excess > 0) {
    const nextSeason = summary.seasonYear + 1;
    const existingNextPlan = await savingsPlanModel.findOne({
      userId,
      seasonYear: nextSeason,
    });
    if (!existingNextPlan) {
      await savingsPlanModel.create({
        userId,
        seasonYear: nextSeason,
        isRenewal: true,
        targetInstallments: 12,
        installmentsPaid: excess,
        totalAmountSaved: excess * plan.installmentAmount,
        installmentAmount: plan.installmentAmount,
        status: SavingsPlanStatus.ACTIVE,
      });
    }
  }

  await notificationsService.create({
    userId,
    type: NotificationType.MEMBERSHIP_ACTIVATED,
    title: "¡Reingreso oficial exitoso a Hermandad Legends!",
    message: `Has completado tu reingreso en la ventana preferencial de renovación. Tu membresía está activa hasta el ${expiry.toLocaleDateString("es-CO")}.${
      excess > 0
        ? ` Tus ${excess} cuotas adicionales fueron acreditadas a tu nuevo plan de ahorro ${summary.seasonYear + 1}.`
        : ""
    }`,
    priority: NotificationPriority.HIGH,
    notifyCategory: "Membresia y pagos",
  });

  return {
    success: true,
    membershipExpiresAt: expiry,
    excessInstallmentsCredited: excess,
    nextSeasonYear: excess > 0 ? summary.seasonYear + 1 : null,
  };
}
