import { Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Model } from "mongoose";
import { TransactionDocument } from "./schemas/transaction.schema";
import { EventsService } from "../events/events.service";
import { UsersService } from "../users/users.service";
import type { EnvironmentConfig } from "../config/config.interface";

export interface EventCoursePaymentDeps {
  transactionModel: Model<TransactionDocument>;
  configService: ConfigService<EnvironmentConfig>;
  eventsService: EventsService;
  usersService: UsersService;
  logger: Logger;
  assertNoPendingForPurpose: (
    userId: string,
    purpose: string,
    slug: string,
  ) => Promise<void>;
  linkPaymentByPurpose: (transaction: TransactionDocument) => Promise<void>;
  processAlegraInvoicing: (transaction: TransactionDocument) => Promise<void>;
}

export { createEventPaymentHelper } from "./payments-event.helpers";
export { createCoursePaymentHelper } from "./payments-course.helpers";
