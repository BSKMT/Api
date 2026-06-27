import { Module } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";
import { AdminEventsController } from "./controllers/admin-events.controller";
import { AdminCoursesController } from "./controllers/admin-courses.controller";
import { AdminShopController } from "./controllers/admin-shop.controller";
import { AdminArphaController } from "./controllers/admin-arpha.controller";
import { AdminMembershipController } from "./controllers/admin-membership.controller";
import { AdminEventsService } from "./services/admin-events.service";
import { AdminCoursesService } from "./services/admin-courses.service";
import { AdminShopService } from "./services/admin-shop.service";
import { AdminArphaService } from "./services/admin-arpha.service";
import { AdminMembershipService } from "./services/admin-membership.service";
import { Event, EventSchema } from "../events/schemas/event.schema";
import {
  EventRegistration,
  EventRegistrationSchema,
} from "../events/schemas/event-registration.schema";
import { Course, CourseSchema } from "../events/schemas/course.schema";
import {
  CourseEnrollment,
  CourseEnrollmentSchema,
} from "../events/schemas/course-enrollment.schema";
import { Product, ProductSchema } from "../shop/schemas/product.schema";
import { Order, OrderSchema } from "../shop/schemas/order.schema";
import {
  ArphaRequest,
  ArphaRequestSchema,
} from "../arpha/schemas/arpha-request.schema";
import {
  MembershipTransaction,
  MembershipTransactionSchema,
} from "../membership/schemas/membership-transaction.schema";
import {
  ServiceCreditTransaction,
  ServiceCreditTransactionSchema,
} from "../membership/schemas/service-credit-transaction.schema";
import { User, UserSchema } from "../users/schemas/user.schema";
import { NotificationsModule } from "../notifications/notifications.module";
import { UsersModule } from "../users/users.module";

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Event.name, schema: EventSchema },
      { name: EventRegistration.name, schema: EventRegistrationSchema },
      { name: Course.name, schema: CourseSchema },
      { name: CourseEnrollment.name, schema: CourseEnrollmentSchema },
      { name: Product.name, schema: ProductSchema },
      { name: Order.name, schema: OrderSchema },
      { name: ArphaRequest.name, schema: ArphaRequestSchema },
      {
        name: MembershipTransaction.name,
        schema: MembershipTransactionSchema,
      },
      {
        name: ServiceCreditTransaction.name,
        schema: ServiceCreditTransactionSchema,
      },
      { name: User.name, schema: UserSchema },
    ]),
    NotificationsModule,
    UsersModule,
  ],
  controllers: [
    AdminEventsController,
    AdminCoursesController,
    AdminShopController,
    AdminArphaController,
    AdminMembershipController,
  ],
  providers: [
    AdminEventsService,
    AdminCoursesService,
    AdminShopService,
    AdminArphaService,
    AdminMembershipService,
  ],
})
export class AdminModule {}
