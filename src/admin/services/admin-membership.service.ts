import {
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from "@nestjs/common";
import { BirdContactService } from "../../bird/bird-contact.service";
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";
import {
  MembershipTransaction,
  MembershipTransactionDocument,
} from "../../membership/schemas/membership-transaction.schema";
import {
  ServiceCreditTransaction,
  ServiceCreditTransactionDocument,
} from "../../membership/schemas/service-credit-transaction.schema";
import { User, UserDocument } from "../../users/schemas/user.schema";
import { NotificationsService } from "../../notifications/notifications.service";
import {
  executeActivateMembership,
  executeExtendMembership,
  executeRevokeMembership,
} from "./admin-membership-lifecycle.helpers";
import {
  executeApproveRefund,
  executeRejectRefund,
} from "./admin-membership-refund.helpers";
import {
  queryTransactions,
  queryMembers,
  queryMemberDetails,
  queryPendingRefunds,
} from "./admin-membership-query.helpers";
import {
  SavingsPlan,
  SavingsPlanDocument,
} from "../../membership/schemas/savings-plan.schema";
import {
  SavingsRefundRequest,
  SavingsRefundRequestDocument,
} from "../../membership/schemas/savings-refund-request.schema";
import {
  ReviewSavingsExtensionDto,
  ReviewSavingsRefundConsoleDto,
  ReviewSavingsRefundFinanceDto,
  ReviewSavingsLegalDto,
} from "../../membership/dto/savings-plan.dto";
import {
  executeListPendingExtensions,
  executeReviewExtension,
  executeListRefundsForConsole,
  executeReviewRefundConsole,
  executeListRefundsForFinance,
  executeReviewRefundFinance,
  executeListLegalEscalations,
  executeReviewLegalEscalation,
} from "./admin-savings.helpers";

@Injectable()
export class AdminMembershipService {
  private readonly logger = new Logger(AdminMembershipService.name);

  constructor(
    @InjectModel(MembershipTransaction.name)
    private readonly transactionModel: Model<MembershipTransactionDocument>,
    @InjectModel(ServiceCreditTransaction.name)
    private readonly creditTransactionModel: Model<ServiceCreditTransactionDocument>,
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    private readonly notificationsService: NotificationsService,
    @InjectModel(SavingsPlan.name)
    private readonly savingsPlanModel: Model<SavingsPlanDocument>,
    @InjectModel(SavingsRefundRequest.name)
    private readonly refundRequestModel: Model<SavingsRefundRequestDocument>,
    @Optional()
    private readonly birdContactService?: BirdContactService,
  ) {}

  async listTransactions(filters: {
    status?: string;
    userId?: string;
    isRenewal?: boolean;
    limit?: number;
    page?: number;
  }) {
    return queryTransactions(this.transactionModel, filters);
  }

  async getTransaction(reference: string) {
    const tx = await this.transactionModel
      .findOne({ reference })
      .select("-webhookEvents")
      .lean();
    if (!tx) {
      throw new NotFoundException("Transacción no encontrada");
    }
    return tx;
  }

  async listMembers(filters: {
    status?: "active" | "expired" | "user";
    limit?: number;
    page?: number;
  }) {
    return queryMembers(this.userModel, filters);
  }

  async getMember(userId: string) {
    return queryMemberDetails(this.userModel, this.transactionModel, userId);
  }

  async activateMembership(userId: string, actorId = "") {
    const result = await executeActivateMembership(
      this.userModel,
      this.notificationsService,
      this.logger,
      userId,
      actorId,
    );
    this.birdContactService?.syncUser(userId).catch(() => {});
    return result;
  }

  async extendMembership(
    userId: string,
    unit: string,
    amount = 1,
    baseDateStr?: string,
    actorId = "",
  ) {
    const result = await executeExtendMembership(
      this.userModel,
      this.notificationsService,
      this.logger,
      userId,
      { unit, amount, baseDateStr, actorId },
    );
    this.birdContactService?.syncUser(userId).catch(() => {});
    return result;
  }

  async revokeMembership(userId: string, actorId = "") {
    const result = await executeRevokeMembership(
      this.userModel,
      this.notificationsService,
      this.logger,
      userId,
      actorId,
    );
    this.birdContactService?.syncUser(userId).catch(() => {});
    return result;
  }

  async listPendingRefunds() {
    return queryPendingRefunds(this.userModel, this.creditTransactionModel);
  }

  async approveRefund(userId: string, actorId = "") {
    return executeApproveRefund(
      this.userModel,
      this.creditTransactionModel,
      this.notificationsService,
      userId,
      actorId,
      this.logger,
    );
  }

  async rejectRefund(userId: string, reason?: string, actorId = "") {
    return executeRejectRefund(
      this.userModel,
      this.creditTransactionModel,
      this.notificationsService,
      userId,
      reason,
      actorId,
      this.logger,
    );
  }

  async listSavingsExtensions() {
    return executeListPendingExtensions(this.savingsPlanModel);
  }

  async reviewSavingsExtension(
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

  async listSavingsRefundsConsole() {
    return executeListRefundsForConsole(this.refundRequestModel);
  }

  async reviewSavingsRefundConsole(
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

  async listSavingsRefundsFinance() {
    return executeListRefundsForFinance(this.refundRequestModel);
  }

  async reviewSavingsRefundFinance(
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

  async listSavingsLegalEscalations() {
    return executeListLegalEscalations(this.refundRequestModel);
  }

  async reviewSavingsLegal(
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
}
