import { Module } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";
import { PanelController } from "./panel.controller";
import { UsersModule } from "../users/users.module";
import {
  EventRegistration,
  EventRegistrationSchema,
} from "../events/schemas/event-registration.schema";
import {
  CourseEnrollment,
  CourseEnrollmentSchema,
} from "../events/schemas/course-enrollment.schema";
import {
  ArphaRequest,
  ArphaRequestSchema,
} from "../arpha/schemas/arpha-request.schema";
import { Order, OrderSchema } from "../shop/schemas/order.schema";

@Module({
  imports: [
    UsersModule,
    MongooseModule.forFeature([
      { name: EventRegistration.name, schema: EventRegistrationSchema },
      { name: CourseEnrollment.name, schema: CourseEnrollmentSchema },
      { name: ArphaRequest.name, schema: ArphaRequestSchema },
      { name: Order.name, schema: OrderSchema },
    ]),
  ],
  controllers: [PanelController],
})
export class PanelModule {}
