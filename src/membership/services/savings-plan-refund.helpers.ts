import { randomInt } from "node:crypto";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import { Model } from "mongoose";
import {
  SavingsPlanDocument,
  SavingsPlanStatus,
} from "../schemas/savings-plan.schema";
import {
  SavingsRefundRequestDocument,
  SavingsRefundStatus,
} from "../schemas/savings-refund-request.schema";
import { NotificationsService } from "../../notifications/notifications.service";
import {
  NotificationType,
  NotificationPriority,
} from "../../notifications/schemas/notification.schema";
import {
  RequestSavingsRefundDto,
  AppealSavingsRefundDto,
  EscalateSavingsLegalDto,
} from "../dto/savings-plan.dto";

const ALLOWED_REFUND_PLAN_STATUSES = new Set<SavingsPlanStatus>([
  SavingsPlanStatus.ACTIVE,
  SavingsPlanStatus.GRACE_PERIOD_1,
  SavingsPlanStatus.EXTENSION_REQUESTED,
  SavingsPlanStatus.GRACE_PERIOD_2,
  SavingsPlanStatus.LAPSED_TEMPORARY,
]);

export async function executeRequestRefund(
  plan: SavingsPlanDocument,
  refundRequestModel: Model<SavingsRefundRequestDocument>,
  notificationsService: NotificationsService,
  userId: string,
  dto: RequestSavingsRefundDto,
) {
  if (
    !ALLOWED_REFUND_PLAN_STATUSES.has(plan.status) ||
    plan.installmentsPaid >= 12
  ) {
    throw new BadRequestException(
      "No es posible solicitar reembolso sobre un plan completado, ya reembolsado o no elegible.",
    );
  }
  if (plan.totalAmountSaved <= 0) {
    throw new BadRequestException(
      "No tienes saldo ahorrado para solicitar reembolso.",
    );
  }

  const existingPending = await refundRequestModel.findOne({
    userId,
    status: {
      $in: [
        SavingsRefundStatus.PENDING_CONSOLE_REVIEW,
        SavingsRefundStatus.PENDING_FINANCE_APPROVAL,
        SavingsRefundStatus.APPEALED,
        SavingsRefundStatus.LEGAL_ESCALATED,
      ],
    },
  });
  if (existingPending) {
    throw new BadRequestException(
      `Ya tienes una solicitud de reembolso en trámite bajo el radicado ${existingPending.radicadoNumber}.`,
    );
  }

  const now = new Date();
  const radicadoSeq = randomInt(1000, 10000);
  const radicadoNumber = `RAD-BSK-FIN-${plan.seasonYear}-${radicadoSeq}`;

  const totalSavedAmount = plan.totalAmountSaved;
  const retentionPercentage = 20;
  const retentionAmount = Math.round(totalSavedAmount * 0.2);
  const netRefundAmount = totalSavedAmount - retentionAmount;

  const refundRequest = await refundRequestModel.create({
    radicadoNumber,
    userId,
    savingsPlanId: String(plan._id),
    totalSavedAmount,
    retentionPercentage,
    retentionAmount,
    netRefundAmount,
    bankDetails: {
      bankName: dto.bankName,
      accountType: dto.accountType,
      accountNumber: dto.accountNumber,
      accountHolderName: dto.accountHolderName,
      identificationType: dto.identificationType,
      identificationNumber: dto.identificationNumber,
    },
    status: SavingsRefundStatus.PENDING_CONSOLE_REVIEW,
    consoleReview: {
      status: "none",
      notes: "",
      reviewedBy: "",
      reviewedAt: null,
    },
    financeReview: {
      status: "none",
      notes: "",
      reviewedBy: "",
      reviewedAt: null,
      radicadoDocument: "",
    },
    appealCount: 0,
    maxAppeals: 3,
    appeals: [],
    legalEscalation: { decision: "none" },
    timeline: [
      {
        timestamp: now,
        actor: "USUARIO",
        action: "RADICACION_INICIAL",
        details: `Radicación inicial de reembolso por ${netRefundAmount.toLocaleString("es-CO")} COP (80% de ${totalSavedAmount.toLocaleString("es-CO")} COP ahorrados).`,
        radicado: radicadoNumber,
      },
    ],
  });

  plan.status = SavingsPlanStatus.REFUND_REQUESTED;
  await plan.save();

  await notificationsService.create({
    userId,
    type: NotificationType.MEMBERSHIP_PAYMENT_REJECTED,
    title: "Solicitud de reembolso radicada",
    message: `Tu solicitud fue radicada con el número ${radicadoNumber}. Se liquidará el 80% (${netRefundAmount.toLocaleString("es-CO")} COP) previa revisión de la Dirección de Membresías y Gerencia Financiera.`,
    priority: NotificationPriority.HIGH,
    metadata: { radicadoNumber, netRefundAmount },
    notifyCategory: "Membresia y pagos",
  });

  return {
    success: true,
    radicadoNumber,
    totalSavedAmount,
    retentionAmount,
    netRefundAmount,
    status: refundRequest.status,
  };
}

export async function executeAppealRefund(
  refundRequestModel: Model<SavingsRefundRequestDocument>,
  notificationsService: NotificationsService,
  userId: string,
  dto: AppealSavingsRefundDto,
) {
  const req = await refundRequestModel.findOne({
    _id: dto.refundRequestId,
    userId,
  });
  if (!req) {
    throw new NotFoundException("Solicitud de reembolso no encontrada.");
  }

  if (req.appealCount >= req.maxAppeals) {
    throw new BadRequestException(
      "Has alcanzado el límite máximo de 3 apelaciones. Puedes elevar tu caso formalmente ante el Comité de Asuntos Legales y Protección del Consumidor de BSKMT.",
    );
  }

  const nextAppealNum = req.appealCount + 1;
  const now = new Date();

  req.appealCount = nextAppealNum;
  req.status = SavingsRefundStatus.APPEALED;
  req.appeals.push({
    appealNumber: nextAppealNum,
    appealedAt: now,
    userExplanation: dto.explanation,
    status: "pending",
  });

  req.timeline.push({
    timestamp: now,
    actor: "USUARIO",
    action: `APELACION_${nextAppealNum}_RADICADA`,
    details: dto.explanation,
    radicado: req.radicadoNumber,
  });

  await req.save();

  await notificationsService.create({
    userId,
    type: NotificationType.MEMBERSHIP_GRACE_PERIOD,
    title: `Apelación #${nextAppealNum} radicada`,
    message: `Tu apelación #${nextAppealNum} de 3 para el radicado ${req.radicadoNumber} fue registrada y entró a revisión de la Dirección de Membresías y Gerencia Financiera.`,
    priority: NotificationPriority.HIGH,
    notifyCategory: "Membresia y pagos",
  });

  return {
    success: true,
    appealNumber: nextAppealNum,
    status: req.status,
    appealsRemaining: req.maxAppeals - nextAppealNum,
  };
}

export async function executeEscalateToLegal(
  refundRequestModel: Model<SavingsRefundRequestDocument>,
  notificationsService: NotificationsService,
  userId: string,
  dto: EscalateSavingsLegalDto,
) {
  const req = await refundRequestModel.findOne({
    _id: dto.refundRequestId,
    userId,
  });
  if (!req) {
    throw new NotFoundException("Solicitud de reembolso no encontrada.");
  }

  if (
    req.appealCount < req.maxAppeals &&
    req.status !== SavingsRefundStatus.REJECTED
  ) {
    throw new BadRequestException(
      "Para acudir al Comité de Asuntos Legales debes haber agotado la instancia de apelaciones ordinarias.",
    );
  }

  const now = new Date();
  req.status = SavingsRefundStatus.LEGAL_ESCALATED;
  req.legalEscalation = {
    escalatedAt: now,
    userStatement: dto.statement,
    decision: "none",
    committeeNotes: "",
    committeeRadicado: "",
    decisionDate: null,
  };

  req.timeline.push({
    timestamp: now,
    actor: "USUARIO",
    action: "ESCALAMIENTO_COMITE_LEGAL",
    details: dto.statement,
    radicado: req.radicadoNumber,
  });

  await req.save();

  await notificationsService.create({
    userId,
    type: NotificationType.MEMBERSHIP_GRACE_PERIOD,
    title: "Caso escalado al Comité Legal BSKMT",
    message: `Tu solicitud ${req.radicadoNumber} fue formalmente remitida al Comité de Asuntos Legales y Protección del Consumidor de BSKMT para resolución de última instancia.`,
    priority: NotificationPriority.HIGH,
    notifyCategory: "Membresia y pagos",
  });

  return {
    success: true,
    status: req.status,
    legalEscalation: req.legalEscalation,
  };
}
