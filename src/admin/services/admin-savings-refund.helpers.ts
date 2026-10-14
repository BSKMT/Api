import { NotFoundException } from "@nestjs/common";
import { Model } from "mongoose";
import {
  SavingsPlanDocument,
  SavingsPlanStatus,
} from "../../membership/schemas/savings-plan.schema";
import {
  SavingsRefundRequestDocument,
  SavingsRefundStatus,
} from "../../membership/schemas/savings-refund-request.schema";
import { NotificationsService } from "../../notifications/notifications.service";
import {
  NotificationType,
  NotificationPriority,
} from "../../notifications/schemas/notification.schema";
import {
  ReviewSavingsRefundFinanceDto,
  ReviewSavingsLegalDto,
} from "../../membership/dto/savings-plan.dto";

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
