import { Module } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";
import { PaymentsController } from "./payments.controller";
import { PaymentsService } from "./payments.service";
import { Transaction, TransactionSchema } from "./schemas/transaction.schema";
import { EventsModule } from "../events/events.module";

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Transaction.name, schema: TransactionSchema },
    ]),
    EventsModule,
  ],
  controllers: [PaymentsController],
  providers: [PaymentsService],
})
export class PaymentsModule {}
