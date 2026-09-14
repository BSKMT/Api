import { Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Model } from "mongoose";
import type { EnvironmentConfig } from "../config/config.interface";
import type { MembershipTransactionDocument } from "./schemas/membership-transaction.schema";
import type { ServiceCreditTransactionDocument } from "./schemas/service-credit-transaction.schema";
import type { UsersService } from "../users/users.service";
import type { NotificationsService } from "../notifications/notifications.service";
import type { AlegraService } from "../alegra/alegra.service";
import type { SystemPricingConfigService } from "../admin/services/system-pricing-config.service";

export interface MembershipActivationDeps {
  transactionModel: Model<MembershipTransactionDocument>;
  usersService: UsersService;
  notificationsService: NotificationsService;
  alegraService: AlegraService;
  logger: Logger;
}

export interface MembershipCreationDeps {
  transactionModel: Model<MembershipTransactionDocument>;
  creditTransactionModel: Model<ServiceCreditTransactionDocument>;
  usersService: UsersService;
  pricingConfigService: SystemPricingConfigService;
  configService: ConfigService<EnvironmentConfig>;
  logger: Logger;
  processApprovedPayment: (t: MembershipTransactionDocument) => Promise<void>;
}
