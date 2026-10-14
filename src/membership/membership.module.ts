import { Module } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";
import { MembershipController } from "./membership.controller";
import { SavingsPlanController } from "./savings-plan.controller";
import { MembershipService } from "./membership.service";
import {
  MembershipTransaction,
  MembershipTransactionSchema,
} from "./schemas/membership-transaction.schema";
import {
  ServiceCreditTransaction,
  ServiceCreditTransactionSchema,
} from "./schemas/service-credit-transaction.schema";
import { UsersModule } from "../users/users.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { AdminModule } from "../admin/admin.module";

import { SavingsPlan, SavingsPlanSchema } from "./schemas/savings-plan.schema";
import {
  SavingsRefundRequest,
  SavingsRefundRequestSchema,
} from "./schemas/savings-refund-request.schema";
import { User, UserSchema } from "../users/schemas/user.schema";
import { SavingsPlanService } from "./services/savings-plan.service";

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: MembershipTransaction.name, schema: MembershipTransactionSchema },
      {
        name: ServiceCreditTransaction.name,
        schema: ServiceCreditTransactionSchema,
      },
      { name: SavingsPlan.name, schema: SavingsPlanSchema },
      { name: SavingsRefundRequest.name, schema: SavingsRefundRequestSchema },
      { name: User.name, schema: UserSchema },
    ]),
    UsersModule,
    NotificationsModule,
    AdminModule,
  ],
  controllers: [MembershipController, SavingsPlanController],
  providers: [MembershipService, SavingsPlanService],
  exports: [MembershipService, SavingsPlanService, MongooseModule],
})
export class MembershipModule {}
