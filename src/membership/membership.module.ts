import { Module } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";
import { MembershipController } from "./membership.controller";
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

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: MembershipTransaction.name, schema: MembershipTransactionSchema },
      {
        name: ServiceCreditTransaction.name,
        schema: ServiceCreditTransactionSchema,
      },
    ]),
    UsersModule,
  ],
  controllers: [MembershipController],
  providers: [MembershipService],
  exports: [MembershipService],
})
export class MembershipModule {}
