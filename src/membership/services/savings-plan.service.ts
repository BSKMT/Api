import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";
import {
  SavingsPlan,
  SavingsPlanDocument,
  SavingsPlanStatus,
} from "../schemas/savings-plan.schema";
import {
  SavingsRefundRequest,
  SavingsRefundRequestDocument,
  SavingsRefundStatus,
} from "../schemas/savings-refund-request.schema";
import {
  MembershipTransaction,
  MembershipTransactionDocument,
} from "../schemas/membership-transaction.schema";
import { User, UserDocument, UserRole } from "../../users/schemas/user.schema";
import { UsersService } from "../../users/users.service";
import { NotificationsService } from "../../notifications/notifications.service";
import { SystemPricingConfigService } from "../../admin/services/system-pricing-config.service";
import {
  NotificationType,
  NotificationPriority,
} from "../../notifications/schemas/notification.schema";
import {
  INSTALLMENTS_TOTAL,
  INSTALLMENT_AMOUNT,
  MEMBERSHIP_DURATION_MS,
} from "../membership.constants";
import {
  RequestSavingsExtensionDto,
  RequestSavingsRefundDto,
  AppealSavingsRefundDto,
  EscalateSavingsLegalDto,
  ReviewSavingsExtensionDto,
  ReviewSavingsRefundConsoleDto,
  ReviewSavingsRefundFinanceDto,
  ReviewSavingsLegalDto,
} from "../dto/savings-plan.dto";

@Injectable()
export class SavingsPlanService {
  private readonly logger = new Logger(SavingsPlanService.name);

  constructor(
    @InjectModel(SavingsPlan.name)
    private readonly savingsPlanModel: Model<SavingsPlanDocument>,
    @InjectModel(SavingsRefundRequest.name)
    private readonly refundRequestModel: Model<SavingsRefundRequestDocument>,
    @InjectModel(MembershipTransaction.name)
    private readonly transactionModel: Model<MembershipTransactionDocument>,
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    private readonly usersService: UsersService,
    private readonly notificationsService: NotificationsService,
    private readonly pricingConfigService: SystemPricingConfigService,
  ) {}

  /**
   * Obtiene o crea el plan de ahorro activo del usuario para la temporada actual.
   */
  async getOrCreateUserSavingsPlan(
    userId: string,
  ): Promise<SavingsPlanDocument> {
    const pricingConfig = await this.pricingConfigService.getConfig();
    const seasonYear = pricingConfig.seasonYear ?? 2027;
    const user = await this.usersService.findById(userId);
    if (!user) throw new NotFoundException("Usuario no encontrado.");

    let plan = await this.savingsPlanModel.findOne({ userId, seasonYear });
    if (!plan) {
      const isMember = user.role === (UserRole.MEMBER as string);
      const installmentsPaid = isMember
        ? (user.renewalInstallmentsPaid ?? 0)
        : (user.installmentsPaid ?? 0);
      const instAmount =
        pricingConfig.membership?.installmentAmount ?? INSTALLMENT_AMOUNT;

      plan = await this.savingsPlanModel.create({
        userId,
        seasonYear,
        isRenewal: isMember,
        targetInstallments: INSTALLMENTS_TOTAL,
        installmentsPaid,
        totalAmountSaved: installmentsPaid * instAmount,
        installmentAmount: instAmount,
        status: SavingsPlanStatus.ACTIVE,
      });
    }

    return plan;
  }

  /**
   * Resumen completo del estado del plan de ahorro, reglas de gracia y acciones disponibles.
   */
  async getSavingsPlanSummary(userId: string) {
    const plan = await this.getOrCreateUserSavingsPlan(userId);
    const pricingConfig = await this.pricingConfigService.getConfig();
    const campaign = pricingConfig.campaign;
    const now = new Date();
    const nowMs = now.getTime();

    // Verificación de ventana de campaña
    const renewalEnd = campaign?.renewalEndDate || campaign?.endDate;
    const renewalEndMs = renewalEnd ? new Date(renewalEnd).getTime() : null;
    const renewalStart = campaign?.renewalStartDate || campaign?.startDate;
    const renewalStartMs = renewalStart
      ? new Date(renewalStart).getTime()
      : null;

    // Lógica de período de gracia automático (1 mes) si cerró la ventana de renovación y no completó
    let currentStatus = plan.status;
    let gracePeriod1ExpiresAt = plan.gracePeriod1ExpiresAt;

    if (
      plan.isRenewal &&
      renewalEndMs &&
      nowMs > renewalEndMs &&
      plan.installmentsPaid < plan.targetInstallments &&
      currentStatus === SavingsPlanStatus.ACTIVE
    ) {
      // Activar automáticamente Mes de Gracia 1 (30 días tras el cierre de renovación)
      const g1 = new Date(renewalEndMs + 30 * 24 * 60 * 60 * 1000);
      plan.gracePeriod1ExpiresAt = g1;
      gracePeriod1ExpiresAt = g1;

      if (nowMs <= g1.getTime()) {
        plan.status = SavingsPlanStatus.GRACE_PERIOD_1;
        currentStatus = SavingsPlanStatus.GRACE_PERIOD_1;
      } else if (!plan.gracePeriod2ExpiresAt) {
        // Expiró el mes de gracia 1 sin completar ni prórroga
        plan.status = SavingsPlanStatus.LAPSED_TEMPORARY;
        currentStatus = SavingsPlanStatus.LAPSED_TEMPORARY;
      }
      await plan.save();
    }

    // Si está en Mes de Gracia 2 y venció
    if (
      currentStatus === SavingsPlanStatus.GRACE_PERIOD_2 &&
      plan.gracePeriod2ExpiresAt &&
      nowMs > new Date(plan.gracePeriod2ExpiresAt).getTime() &&
      plan.installmentsPaid < plan.targetInstallments
    ) {
      plan.status = SavingsPlanStatus.LAPSED_TEMPORARY;
      currentStatus = SavingsPlanStatus.LAPSED_TEMPORARY;
      await plan.save();

      // Perder calidad de miembro en el modelo User si no completó
      await this.userModel.updateOne(
        { _id: userId, role: UserRole.MEMBER },
        { $set: { role: UserRole.USER } },
      );
    }

    const remainingInstallments = Math.max(
      0,
      plan.targetInstallments - plan.installmentsPaid,
    );
    const remainingBalance = remainingInstallments * plan.installmentAmount;
    const progressPercent = Math.min(
      100,
      Math.round((plan.installmentsPaid / plan.targetInstallments) * 100),
    );

    const isInGrace1 =
      currentStatus === SavingsPlanStatus.GRACE_PERIOD_1 &&
      !!gracePeriod1ExpiresAt &&
      nowMs <= new Date(gracePeriod1ExpiresAt).getTime();

    const isInGrace2 =
      currentStatus === SavingsPlanStatus.GRACE_PERIOD_2 &&
      !!plan.gracePeriod2ExpiresAt &&
      nowMs <= new Date(plan.gracePeriod2ExpiresAt).getTime();

    const isInGrace = isInGrace1 || isInGrace2;

    // En mes de gracia NO se permiten abonos parciales, solo completar el 100%
    const canPaySingleInstallment =
      currentStatus === SavingsPlanStatus.ACTIVE && !isInGrace;

    const canCompleteBalance =
      (currentStatus === SavingsPlanStatus.ACTIVE || isInGrace) &&
      remainingInstallments > 0;

    // Prórroga solicitada a New-Console
    const canRequestExtension =
      (currentStatus === SavingsPlanStatus.GRACE_PERIOD_1 ||
        (renewalEndMs && nowMs > renewalEndMs && plan.installmentsPaid < 12)) &&
      (!plan.extensionRequest ||
        plan.extensionRequest.status === "none" ||
        plan.extensionRequest.status === "rejected") &&
      currentStatus !== SavingsPlanStatus.GRACE_PERIOD_2;

    // Reembolso del 80% (cuando venció el plazo o lapsed_temporary o en gracia)
    const activeRefund = await this.refundRequestModel
      .findOne({
        userId,
        status: {
          $nin: [
            SavingsRefundStatus.APPROVED,
            SavingsRefundStatus.LEGAL_RESOLVED_REJECTED,
          ],
        },
      })
      .sort({ createdAt: -1 });

    const canRequestRefund =
      (currentStatus === SavingsPlanStatus.LAPSED_TEMPORARY ||
        currentStatus === SavingsPlanStatus.GRACE_PERIOD_1 ||
        currentStatus === SavingsPlanStatus.GRACE_PERIOD_2) &&
      plan.totalAmountSaved > 0 &&
      !activeRefund;

    // Reingreso en ventana de renovación para quienes continuaron ahorrando
    const isRenewalWindowOpen =
      renewalStartMs &&
      renewalEndMs &&
      nowMs >= renewalStartMs &&
      nowMs <= renewalEndMs;

    const canReinstate =
      (currentStatus === SavingsPlanStatus.LAPSED_TEMPORARY ||
        currentStatus === SavingsPlanStatus.ACTIVE) &&
      plan.installmentsPaid >= 12 &&
      isRenewalWindowOpen;

    return {
      seasonYear: plan.seasonYear,
      isRenewal: plan.isRenewal,
      targetInstallments: plan.targetInstallments,
      installmentsPaid: plan.installmentsPaid,
      totalAmountSaved: plan.totalAmountSaved,
      installmentAmount: plan.installmentAmount,
      remainingInstallments,
      remainingBalance,
      progressPercent,
      status: currentStatus,
      excessInstallments: plan.excessInstallments,
      isInGracePeriod: isInGrace,
      gracePeriod1ExpiresAt: plan.gracePeriod1ExpiresAt,
      gracePeriod2ExpiresAt: plan.gracePeriod2ExpiresAt,
      canPaySingleInstallment,
      canCompleteBalance,
      canRequestExtension,
      canRequestRefund,
      canReinstate,
      isRenewalWindowOpen,
      extensionRequest: plan.extensionRequest,
      activeRefund,
    };
  }

  /**
   * Pago del 100% de una vez (liquidar saldo pendiente durante el mes de gracia o activo).
   */
  async getCompleteBalanceContext(userId: string) {
    const summary = await this.getSavingsPlanSummary(userId);
    if (!summary.canCompleteBalance || summary.remainingBalance <= 0) {
      throw new BadRequestException(
        "No tienes saldo pendiente o tu plan no admite liquidación completa en este momento.",
      );
    }

    return {
      userId,
      seasonYear: summary.seasonYear,
      remainingInstallments: summary.remainingInstallments,
      remainingBalance: summary.remainingBalance,
      targetInstallments: summary.targetInstallments,
      installmentsPaid: summary.installmentsPaid,
      isRenewal: summary.isRenewal,
      isInGracePeriod: summary.isInGracePeriod,
      description: `BSKMT — Liquidación 100% Plan Ahorro (${summary.remainingInstallments} cuotas restantes)`,
    };
  }

  /**
   * Solicitar ampliación de 1 mes (2do mes de gracia) enviada a Dirección de Membresías en New-Console.
   */
  async requestExtension(userId: string, dto: RequestSavingsExtensionDto) {
    const plan = await this.getOrCreateUserSavingsPlan(userId);
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

    await this.notificationsService.create({
      userId,
      type: NotificationType.MEMBERSHIP_GRACE_PERIOD,
      title: "Solicitud de prórroga radicada",
      message:
        "Tu solicitud de 1 mes de gracia adicional fue radicada con éxito y está en revisión por la Dirección de Membresías.",
      priority: NotificationPriority.HIGH,
      notifyCategory: "Membresia y pagos",
    });

    this.logger.log(`Savings extension requested by user ${userId}`);
    return {
      success: true,
      message:
        "Solicitud de prórroga radicada exitosamente ante la Dirección de Membresías.",
      extensionRequest: plan.extensionRequest,
    };
  }

  /**
   * Revisión de prórroga por la Dirección de Membresías en New-Console.
   */
  async reviewExtension(
    planId: string,
    dto: ReviewSavingsExtensionDto,
    actorId = "",
  ) {
    const plan = await this.savingsPlanModel.findById(planId);
    if (!plan) throw new NotFoundException("Plan de ahorro no encontrado.");
    if (plan.extensionRequest?.status !== "pending") {
      throw new BadRequestException(
        "El plan no tiene una solicitud de prórroga pendiente.",
      );
    }

    const now = new Date();
    if (dto.approved) {
      // 30 días adicionales
      const g2 = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
      plan.status = SavingsPlanStatus.GRACE_PERIOD_2;
      plan.gracePeriod2ExpiresAt = g2;
      plan.extensionRequest.status = "approved";
      plan.extensionRequest.reviewedAt = now;
      plan.extensionRequest.reviewedBy = actorId;
      plan.extensionRequest.directorNotes =
        dto.notes || "Prórroga de 1 mes de gracia aprobada.";

      await plan.save();

      await this.notificationsService.create({
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

      // Pérdida de calidad de socio en User
      await this.userModel.updateOne(
        { _id: plan.userId, role: UserRole.MEMBER },
        { $set: { role: UserRole.USER } },
      );

      await this.notificationsService.create({
        userId: plan.userId,
        type: NotificationType.MEMBERSHIP_REVOKED,
        title: "Solicitud de prórroga denegada",
        message: `La Dirección de Membresías no aprobó la prórroga adicional. Motivo: ${plan.extensionRequest.directorNotes}. Puedes solicitar el reintegro de tus fondos o continuar ahorrando para la siguiente temporada.`,
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

  /**
   * Radicar solicitud de reembolso del 80% (con 20% retención por gastos operativos y custodia).
   */
  async requestRefund(userId: string, dto: RequestSavingsRefundDto) {
    const plan = await this.getOrCreateUserSavingsPlan(userId);
    if (plan.totalAmountSaved <= 0) {
      throw new BadRequestException(
        "No tienes saldo ahorrado para solicitar reembolso.",
      );
    }

    const existingPending = await this.refundRequestModel.findOne({
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
    const radicadoSeq = Math.floor(1000 + Math.random() * 9000);
    const radicadoNumber = `RAD-BSK-FIN-${plan.seasonYear}-${radicadoSeq}`;

    const totalSavedAmount = plan.totalAmountSaved;
    const retentionPercentage = 20;
    const retentionAmount = Math.round(totalSavedAmount * 0.2);
    const netRefundAmount = totalSavedAmount - retentionAmount;

    const refundRequest = await this.refundRequestModel.create({
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

    await this.notificationsService.create({
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

  /**
   * Nivel 1: Revisión y aval de la Dirección de Membresías en New-Console.
   */
  async reviewRefundConsole(
    requestId: string,
    dto: ReviewSavingsRefundConsoleDto,
    actorId = "",
  ) {
    const req = await this.refundRequestModel.findById(requestId);
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

      await this.notificationsService.create({
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

      await this.notificationsService.create({
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

  /**
   * Nivel 2: Autorización de la Gerencia Financiera (Superadministrador Financiero en New-BSKMT).
   */
  async reviewRefundFinance(
    requestId: string,
    dto: ReviewSavingsRefundFinanceDto,
    actorId = "",
  ) {
    const req = await this.refundRequestModel.findById(requestId);
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

      // Actualizar plan a reembolsado
      if (req.savingsPlanId) {
        await this.savingsPlanModel.updateOne(
          { _id: req.savingsPlanId },
          { $set: { status: SavingsPlanStatus.REFUNDED, totalAmountSaved: 0 } },
        );
      }

      await this.notificationsService.create({
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

      await this.notificationsService.create({
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

  /**
   * Apelar solicitud rechazada (hasta 3 veces).
   */
  async appealRefund(userId: string, dto: AppealSavingsRefundDto) {
    const req = await this.refundRequestModel.findOne({
      _id: dto.refundRequestId,
      userId,
    });
    if (!req)
      throw new NotFoundException("Solicitud de reembolso no encontrada.");

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

    await this.notificationsService.create({
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

  /**
   * Escalar caso al Comité de Asuntos Legales y Protección del Consumidor de BSKMT.
   */
  async escalateToLegalCommittee(userId: string, dto: EscalateSavingsLegalDto) {
    const req = await this.refundRequestModel.findOne({
      _id: dto.refundRequestId,
      userId,
    });
    if (!req)
      throw new NotFoundException("Solicitud de reembolso no encontrada.");

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

    await this.notificationsService.create({
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

  /**
   * Resolución del Comité de Asuntos Legales y Protección del Consumidor de BSKMT.
   */
  async reviewLegalEscalation(
    requestId: string,
    dto: ReviewSavingsLegalDto,
    _actorId = "",
  ) {
    const req = await this.refundRequestModel.findById(requestId);
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
        await this.savingsPlanModel.updateOne(
          { _id: req.savingsPlanId },
          { $set: { status: SavingsPlanStatus.REFUNDED, totalAmountSaved: 0 } },
        );
      }

      await this.notificationsService.create({
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

      await this.notificationsService.create({
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

  /**
   * Reincorporación / Reintegro en la siguiente temporada para quienes continuaron ahorrando.
   * IMPORTANTE: Utiliza las FECHAS DE RENOVACIÓN (socios antiguos), respetando su antigüedad.
   */
  async reinstateMembership(userId: string) {
    const summary = await this.getSavingsPlanSummary(userId);
    if (!summary.canReinstate) {
      throw new BadRequestException(
        "No cumples con las condiciones para reincorporación (debes tener al menos 12 cuotas completas y estar en la ventana de renovación oficial).",
      );
    }

    const plan = await this.savingsPlanModel.findOne({
      userId,
      seasonYear: summary.seasonYear,
    });
    if (!plan) throw new NotFoundException("Plan de ahorro no encontrado.");

    const now = new Date();
    const expiry = new Date(now.getTime() + MEMBERSHIP_DURATION_MS);

    // Consumir 12 cuotas para el reingreso
    const totalInstallments = plan.installmentsPaid;
    const excess = Math.max(0, totalInstallments - 12);

    plan.status = SavingsPlanStatus.COMPLETED;
    plan.reinstatedAt = now;
    plan.completedAt = now;
    plan.excessInstallments = excess;
    await plan.save();

    // Activar membresía con rol MEMBER
    await this.usersService.activateMembership(
      userId,
      now,
      expiry,
      "installments",
    );

    // Si existen cuotas excedentes (ej. 16 cuotas = 12 consumidas + 4 restantes):
    // Se inicia automáticamente el nuevo plan de ahorro para el siguiente año
    if (excess > 0) {
      const nextSeason = summary.seasonYear + 1;
      const existingNextPlan = await this.savingsPlanModel.findOne({
        userId,
        seasonYear: nextSeason,
      });
      if (!existingNextPlan) {
        await this.savingsPlanModel.create({
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

    await this.notificationsService.create({
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

  /**
   * Métodos para administradores: listar solicitudes de prórroga y reembolsos.
   */
  async listPendingExtensions() {
    return this.savingsPlanModel
      .find({
        status: SavingsPlanStatus.EXTENSION_REQUESTED,
        "extensionRequest.status": "pending",
      })
      .populate("userId", "name email phone internalCode")
      .sort({ "extensionRequest.requestedAt": -1 });
  }

  async listRefundsForConsole() {
    return this.refundRequestModel
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

  async listRefundsForFinance() {
    return this.refundRequestModel
      .find({
        status: SavingsRefundStatus.PENDING_FINANCE_APPROVAL,
      })
      .populate("userId", "name email phone internalCode")
      .sort({ "consoleReview.reviewedAt": -1 });
  }

  async listLegalEscalations() {
    return this.refundRequestModel
      .find({
        status: SavingsRefundStatus.LEGAL_ESCALATED,
      })
      .populate("userId", "name email phone internalCode")
      .sort({ "legalEscalation.escalatedAt": -1 });
  }
}
