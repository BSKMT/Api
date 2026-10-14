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
  ReviewSavingsRefundFinanceDto,
  ReviewSavingsLegalDto,
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

export async function executeListRefundsForFinance(
  refundRequestModel: Model<SavingsRefundRequestDocument>,
) {
  return refundRequestModel
    .find({
      status: SavingsRefundStatus.PENDING_FINANCE_APPROVAL,
    })
    .populate("userId", "name email phone internalCode")
    .sort({ "consoleReview.reviewedAt": -1 });
}

export async function executeReviewRefundFinance(
  refundRequestModel: Model<SavingsRefundRequestDocument>,
  savingsPlanModel: Model<SavingsPlanDocument>,
  notificationsService: NotificationsService,
  requestId: string,
  dto: ReviewSavingsRefundFinanceDto,
  actorId = "",
) {
  const req = await refundRequestModel.findById(requestId);
  if (!req)
    throw new NotFoundException("Solicitud de reembolso no encontrada.");

  const now = new Date();
  const docRadicado =
    dto.radicadoDocument ||
    `DOC-FIN-${now.getFullYear()}-${Math.floor(10000 + Math.random() * 90000)}`;

  if (dto.approved) {
    req.status = SavingsRefundStatus.APPROVED;
    req.financeReview = {
      reviewedBy: actorId,
      reviewedAt: now,
      status: "approved",
      notes: dto.notes,
      radicadoDocument: docRadicado,
    };
    req.timeline.push({
      timestamp: now,
      actor: "GERENCIA_FINANCIERA",
      action: "APROBACION_Y_DISPERSION_FINANCIERA",
      details: `${dto.notes}. Radicado soporte: ${docRadicado}`,
      radicado: docRadicado,
    });
    await req.save();

    if (req.savingsPlanId) {
      await savingsPlanModel.updateOne(
        { _id: req.savingsPlanId },
        { $set: { status: SavingsPlanStatus.REFUNDED, totalAmountSaved: 0 } },
      );
    }

    await notificationsService.create({
      userId: req.userId,
      type: NotificationType.MEMBERSHIP_PAYMENT_REJECTED,
      title: "¡Reembolso aprobado por Gerencia Financiera!",
      message: `Tu reembolso por ${req.netRefundAmount.toLocaleString("es-CO")} COP fue autorizado mediante radicado ${docRadicado}. La dispersión bancaria ha sido programada.`,
      priority: NotificationPriority.HIGH,
      notifyCategory: "Membresia y pagos",
    });

    return {
      success: true,
      status: req.status,
      radicadoDocument: docRadicado,
      notes: dto.notes,
    };
  } else {
    req.status = SavingsRefundStatus.REJECTED;
    req.financeReview = {
      reviewedBy: actorId,
      reviewedAt: now,
      status: "rejected",
      notes: dto.notes,
      radicadoDocument: docRadicado,
    };
    req.timeline.push({
      timestamp: now,
      actor: "GERENCIA_FINANCIERA",
      action: "OBJECION_FINANCIERA_RADICADA",
      details: `${dto.notes}. Radicado objeción: ${docRadicado}`,
      radicado: docRadicado,
    });
    await req.save();

    await notificationsService.create({
      userId: req.userId,
      type: NotificationType.MEMBERSHIP_PAYMENT_REJECTED,
      title: "Reembolso no autorizado por Gerencia Financiera",
      message: `La Gerencia Financiera emitió concepto no favorable bajo radicado ${docRadicado}. Motivo: ${dto.notes}. Tienes derecho a apelar hasta 3 veces saneando estas objeciones.`,
      priority: NotificationPriority.HIGH,
      notifyCategory: "Membresia y pagos",
    });

    return {
      success: true,
      status: req.status,
      radicadoDocument: docRadicado,
      notes: dto.notes,
    };
  }
}

export async function executeListLegalEscalations(
  refundRequestModel: Model<SavingsRefundRequestDocument>,
) {
  return refundRequestModel
    .find({
      status: SavingsRefundStatus.LEGAL_ESCALATED,
    })
    .populate("userId", "name email phone internalCode")
    .sort({ "legalEscalation.escalatedAt": -1 });
}

export async function executeReviewLegalEscalation(
  refundRequestModel: Model<SavingsRefundRequestDocument>,
  savingsPlanModel: Model<SavingsPlanDocument>,
  notificationsService: NotificationsService,
  requestId: string,
  dto: ReviewSavingsLegalDto,
  _actorId = "",
) {
  const req = await refundRequestModel.findById(requestId);
  if (!req) throw new NotFoundException("Solicitud no encontrada.");

  const now = new Date();
  const legalRadicado =
    dto.committeeRadicado ||
    `RES-LEG-${now.getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;

  if (dto.approved) {
    req.status = SavingsRefundStatus.LEGAL_RESOLVED_APPROVED;
    req.legalEscalation.decision = "approved";
    req.legalEscalation.decisionDate = now;
    req.legalEscalation.committeeNotes = dto.notes;
    req.legalEscalation.committeeRadicado = legalRadicado;

    req.timeline.push({
      timestamp: now,
      actor: "COMITE_LEGAL_BSKMT",
      action: "FALLO_RECONOCIMIENTO_DERECHOS",
      details: `${dto.notes}. Resolución: ${legalRadicado}`,
      radicado: legalRadicado,
    });
    await req.save();

    if (req.savingsPlanId) {
      await savingsPlanModel.updateOne(
        { _id: req.savingsPlanId },
        { $set: { status: SavingsPlanStatus.REFUNDED, totalAmountSaved: 0 } },
      );
    }

    await notificationsService.create({
      userId: req.userId,
      type: NotificationType.MEMBERSHIP_PAYMENT_REJECTED,
      title: "Fallo favorable: Comité de Asuntos Legales",
      message: `El Comité de Asuntos Legales de BSKMT falló a favor de tu solicitud bajo Resolución ${legalRadicado}. Se procederá con la restitución de tus fondos.`,
      priority: NotificationPriority.HIGH,
      notifyCategory: "Membresia y pagos",
    });

    return { success: true, status: req.status, resolution: legalRadicado };
  } else {
    req.status = SavingsRefundStatus.LEGAL_RESOLVED_REJECTED;
    req.legalEscalation.decision = "rejected";
    req.legalEscalation.decisionDate = now;
    req.legalEscalation.committeeNotes = dto.notes;
    req.legalEscalation.committeeRadicado = legalRadicado;

    req.timeline.push({
      timestamp: now,
      actor: "COMITE_LEGAL_BSKMT",
      action: "FALLO_RATIFICACION_DECISION_BSKMT",
      details: `${dto.notes}. Resolución: ${legalRadicado}`,
      radicado: legalRadicado,
    });
    await req.save();

    await notificationsService.create({
      userId: req.userId,
      type: NotificationType.MEMBERSHIP_PAYMENT_REJECTED,
      title: "Resolución final: Comité de Asuntos Legales",
      message: `El Comité de Asuntos Legales emitió decisión definitiva ratificando la posición de BSKMT bajo Resolución ${legalRadicado}. Se agota la vía interna. Motivo: ${dto.notes}.`,
      priority: NotificationPriority.HIGH,
      notifyCategory: "Membresia y pagos",
    });

    return { success: true, status: req.status, resolution: legalRadicado };
  }
}
