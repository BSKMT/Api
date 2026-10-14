import { Injectable, Logger } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";
import {
  SavingsPlan,
  SavingsPlanDocument,
} from "../schemas/savings-plan.schema";
import {
  SavingsRefundRequest,
  SavingsRefundRequestDocument,
} from "../schemas/savings-refund-request.schema";
import {
  MembershipTransaction,
  MembershipTransactionDocument,
} from "../schemas/membership-transaction.schema";
import { User, UserDocument } from "../../users/schemas/user.schema";
import { UsersService } from "../../users/users.service";
import { NotificationsService } from "../../notifications/notifications.service";
import { SystemPricingConfigService } from "../../admin/services/system-pricing-config.service";
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
import {
  getOrCreateUserSavingsPlan,
  computeSavingsPlanSummary,
  computeCompleteBalanceContext,
} from "./savings-plan-summary.helpers";
import {
  executeRequestRefund,
  executeAppealRefund,
  executeEscalateToLegal,
} from "./savings-plan-refund.helpers";
import {
  executeRequestExtension,
  executeReinstateMembership,
} from "./savings-plan-reinstate.helpers";
import {
  executeReviewExtension,
  executeReviewRefundConsole,
  executeListPendingExtensions,
  executeListRefundsForConsole,
} from "../../admin/services/admin-savings-extension.helpers";
import {
  executeReviewRefundFinance,
  executeReviewLegalEscalation,
  executeListRefundsForFinance,
  executeListLegalEscalations,
} from "../../admin/services/admin-savings-refund.helpers";

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

  async getOrCreateUserSavingsPlan(
    userId: string,
  ): Promise<SavingsPlanDocument> {
    return getOrCreateUserSavingsPlan(
      this.savingsPlanModel,
      this.usersService,
      this.pricingConfigService,
      userId,
    );
  }

  async getSavingsPlanSummary(userId: string) {
    return computeSavingsPlanSummary(
      this.savingsPlanModel,
      this.refundRequestModel,
      this.userModel,
      this.usersService,
      this.pricingConfigService,
      userId,
    );
  }

  async getCompleteBalanceContext(userId: string) {
    return computeCompleteBalanceContext(
      this.savingsPlanModel,
      this.refundRequestModel,
      this.userModel,
      this.usersService,
      this.pricingConfigService,
      userId,
    );
  }

  async requestExtension(userId: string, dto: RequestSavingsExtensionDto) {
    const plan = await this.getOrCreateUserSavingsPlan(userId);
    return executeRequestExtension(
      plan,
      this.notificationsService,
      userId,
      dto,
      this.logger,
    );
  }

  async reviewExtension(
    planId: string,
    dto: ReviewSavingsExtensionDto,
    actorId = "",
  ) {
    return executeReviewExtension(
      this.savingsPlanModel,
      this.userModel,
      this.notificationsService,
      planId,
      dto,
      actorId,
    );
  }

  async requestRefund(userId: string, dto: RequestSavingsRefundDto) {
    const plan = await this.getOrCreateUserSavingsPlan(userId);
    return executeRequestRefund(
      plan,
      this.refundRequestModel,
      this.notificationsService,
      userId,
      dto,
    );
  }

  async reviewRefundConsole(
    requestId: string,
    dto: ReviewSavingsRefundConsoleDto,
    actorId = "",
  ) {
    return executeReviewRefundConsole(
      this.refundRequestModel,
      this.notificationsService,
      requestId,
      dto,
      actorId,
    );
  }

  async reviewRefundFinance(
    requestId: string,
    dto: ReviewSavingsRefundFinanceDto,
    actorId = "",
  ) {
    return executeReviewRefundFinance(
      this.refundRequestModel,
      this.savingsPlanModel,
      this.notificationsService,
      requestId,
      dto,
      actorId,
    );
  }

  async appealRefund(userId: string, dto: AppealSavingsRefundDto) {
    return executeAppealRefund(
      this.refundRequestModel,
      this.notificationsService,
      userId,
      dto,
    );
  }

  async escalateToLegalCommittee(userId: string, dto: EscalateSavingsLegalDto) {
    return executeEscalateToLegal(
      this.refundRequestModel,
      this.notificationsService,
      userId,
      dto,
    );
  }

  async reviewLegalEscalation(
    requestId: string,
    dto: ReviewSavingsLegalDto,
    actorId = "",
  ) {
    return executeReviewLegalEscalation(
      this.refundRequestModel,
      this.savingsPlanModel,
      this.notificationsService,
      requestId,
      dto,
      actorId,
    );
  }

  async reinstateMembership(userId: string) {
    const summary = await this.getSavingsPlanSummary(userId);
    return executeReinstateMembership(
      this.savingsPlanModel,
      this.usersService,
      this.notificationsService,
      userId,
      summary,
    );
  }

  async listPendingExtensions() {
    return executeListPendingExtensions(this.savingsPlanModel);
  }

  async listRefundsForConsole() {
    return executeListRefundsForConsole(this.refundRequestModel);
  }

  async listRefundsForFinance() {
    return executeListRefundsForFinance(this.refundRequestModel);
  }

  async listLegalEscalations() {
    return executeListLegalEscalations(this.refundRequestModel);
  }
}
