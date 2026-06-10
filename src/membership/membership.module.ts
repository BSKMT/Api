import { Module } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";
import { MembershipController } from "./membership.controller";
import { MembershipService } from "./membership.service";
import {
  MembershipTransaction,
  MembershipTransactionSchema,
} from "./schemas/membership-transaction.schema";
import { UsersModule } from "../users/users.module";

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: MembershipTransaction.name, schema: MembershipTransactionSchema },
    ]),
    UsersModule,
  ],
  controllers: [MembershipController],
  providers: [MembershipService],
  exports: [MembershipService],
})
export class MembershipModule {}
