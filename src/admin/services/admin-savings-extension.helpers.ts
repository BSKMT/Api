import { NotFoundException, BadRequestException } from "@nestjs/common";
import { Model } from "mongoose";
import {
  SavingsPlanDocument,
  SavingsPlanStatus,
} from "../../membership/schemas/savings-plan.schema";
import {
  SavingsRefundRequestDocument,
  SavingsRefundStatus,
} from "../../membership/schemas/savings-refund-request.schema";
import { UserDocument, UserRole } from "../../users/schemas/user.schema";
import { NotificationsService } from "../../notifications/notifications.service";
import {
  NotificationType,
  NotificationPriority,
} from "../../notifications/schemas/notification.schema";
import {
  ReviewSavingsExtensionDto,
  ReviewSavingsRefundConsoleDto,
} from "../../membership/dto/savings-plan.dto";

export async function executeListPendingExtensions(
  savingsPlanModel: Model<SavingsPlanDocument>,
) {
  return savingsPlanModel
    .find({
      status: SavingsPlanStatus.EXTENSION_REQUESTED,
      "extensionRequest.status": "pending",
    })
    .populate("userId", "name email phone internalCode")
    .sort({ "extensionRequest.requestedAt": -1 });
}

export async function executeReviewExtension(
  savingsPlanModel: Model<SavingsPlanDocument>,
  userModel: Model<UserDocument>,
  notificationsService: NotificationsService,
  planId: string,
  dto: ReviewSavingsExtensionDto,
  actorId = "",
) {
  const plan = await savingsPlanModel.findById(planId);
  if (!plan) throw new NotFoundException("Plan de ahorro no encontrado.");
  if (plan.extensionRequest?.status !== "pending") {
    throw new BadRequestException(
      "El plan no tiene una solicitud de prórroga pendiente.",
    );
  }

  const now = new Date();
  if (dto.approved) {
    const g2 = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    plan.status = SavingsPlanStatus.GRACE_PERIOD_2;
    plan.gracePeriod2ExpiresAt = g2;
    plan.extensionRequest.status = "approved";
    plan.extensionRequest.reviewedAt = now;
    plan.extensionRequest.reviewedBy = actorId;
    plan.extensionRequest.directorNotes =
      dto.notes || "Prórroga de 1 mes de gracia aprobada.";

    await plan.save();

    await notificationsService.create({
      userId: plan.userId,
      type: NotificationType.MEMBERSHIP_GRACE_PERIOD,
      title: "¡Prórroga de gracia aprobada!",
      message: `La Dirección de Membresías aprobó tu prórroga de 1 mes. Tienes hasta el ${g2.toLocaleDateString("es-CO")} para completar el 100% de tu anualidad.`,
      priority: NotificationPriority.HIGH,
      notifyCategory: "Membresia y pagos",
    });

    return {
      success: true,
      status: "approved",
      gracePeriod2ExpiresAt: g2,
      notes: plan.extensionRequest.directorNotes,
    };
  } else {
    plan.status = SavingsPlanStatus.LAPSED_TEMPORARY;
    plan.extensionRequest.status = "rejected";
    plan.extensionRequest.reviewedAt = now;
    plan.extensionRequest.reviewedBy = actorId;
    plan.extensionRequest.directorNotes =
      dto.notes || "Solicitud de prórroga no aprobada.";

    await plan.save();

    await userModel.updateOne(
      { _id: plan.userId, role: UserRole.MEMBER },
      { $set: { role: UserRole.USER } },
    );

    await notificationsService.create({
      userId: plan.userId,
      type: NotificationType.MEMBERSHIP_REVOKED,
      title: "Solicitud de prórroga denegada",
      message: `La Dirección de Membresías no aprobó la prórroga adicional. Motivo: ${plan.extensionRequest.directorNotes}. Puedes solicitar el reintegro de tus fondos o continuar abonando para la siguiente temporada.`,
      priority: NotificationPriority.HIGH,
      notifyCategory: "Membresia y pagos",
    });

    return {
      success: true,
      status: "rejected",
      notes: plan.extensionRequest.directorNotes,
    };
  }
}

export async function executeListRefundsForConsole(
  refundRequestModel: Model<SavingsRefundRequestDocument>,
) {
  return refundRequestModel
    .find({
      status: {
        $in: [
          SavingsRefundStatus.PENDING_CONSOLE_REVIEW,
          SavingsRefundStatus.APPEALED,
        ],
      },
    })
    .populate("userId", "name email phone internalCode")
    .sort({ createdAt: -1 });
}

export async function executeReviewRefundConsole(
  refundRequestModel: Model<SavingsRefundRequestDocument>,
  notificationsService: NotificationsService,
  requestId: string,
  dto: ReviewSavingsRefundConsoleDto,
  actorId = "",
) {
  const req = await refundRequestModel.findById(requestId);
  if (!req)
    throw new NotFoundException("Solicitud de reembolso no encontrada.");

  const now = new Date();
  if (dto.approved) {
    req.status = SavingsRefundStatus.PENDING_FINANCE_APPROVAL;
    req.consoleReview = {
      reviewedBy: actorId,
      reviewedAt: now,
      status: "approved",
      notes: dto.notes,
    };
    req.timeline.push({
      timestamp: now,
      actor: "DIRECCION_MEMBRESIAS",
      action: "AVAL_PRELIMINAR_APROBADO",
      details: dto.notes,
      radicado: req.radicadoNumber,
    });
    await req.save();

    await notificationsService.create({
      userId: req.userId,
      type: NotificationType.MEMBERSHIP_GRACE_PERIOD,
      title: "Reembolso: Aval de Membresías emitido",
      message: `La Dirección de Membresías dio concepto favorable a tu radicado ${req.radicadoNumber}. Pasó a autorización de la Gerencia Financiera en New-BSKMT.`,
      priority: NotificationPriority.MEDIUM,
      notifyCategory: "Membresia y pagos",
    });

    return { success: true, status: req.status, notes: dto.notes };
  } else {
    req.status = SavingsRefundStatus.REJECTED;
    req.consoleReview = {
      reviewedBy: actorId,
      reviewedAt: now,
      status: "rejected",
      notes: dto.notes,
    };
    req.timeline.push({
      timestamp: now,
      actor: "DIRECCION_MEMBRESIAS",
      action: "RECHAZO_MEMBRESIAS",
      details: dto.notes,
      radicado: req.radicadoNumber,
    });
    await req.save();

    await notificationsService.create({
      userId: req.userId,
      type: NotificationType.MEMBERSHIP_PAYMENT_REJECTED,
      title: "Reembolso: Observaciones de Membresías",
      message: `Tu solicitud ${req.radicadoNumber} no fue aprobada por la Dirección de Membresías. Observaciones: ${dto.notes}. Puedes apelar y sanear estas observaciones.`,
      priority: NotificationPriority.HIGH,
      notifyCategory: "Membresia y pagos",
    });

    return { success: true, status: req.status, notes: dto.notes };
  }
}
