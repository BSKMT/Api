import { Module } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";
import { UsersModule } from "../users/users.module";
import {
  ArphaRequest,
  ArphaRequestSchema,
} from "../arpha/schemas/arpha-request.schema";
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
import { Order, OrderSchema } from "../shop/schemas/order.schema";
import { User, UserSchema } from "../users/schemas/user.schema";

import { GestionArphaController } from "./controllers/gestion-arpha.controller";
import { GestionEventosController } from "./controllers/gestion-eventos.controller";
import { GestionCursosController } from "./controllers/gestion-cursos.controller";
import { GestionTiendaController } from "./controllers/gestion-tienda.controller";
import { GestionMembresiasController } from "./controllers/gestion-membresias.controller";

import { GestionArphaService } from "./services/gestion-arpha.service";

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ArphaRequest.name, schema: ArphaRequestSchema },
      { name: Event.name, schema: EventSchema },
      { name: EventRegistration.name, schema: EventRegistrationSchema },
      { name: Course.name, schema: CourseSchema },
      { name: CourseEnrollment.name, schema: CourseEnrollmentSchema },
      { name: Order.name, schema: OrderSchema },
      { name: User.name, schema: UserSchema },
    ]),
    UsersModule,
  ],
  controllers: [
    GestionArphaController,
    GestionEventosController,
    GestionCursosController,
    GestionTiendaController,
    GestionMembresiasController,
  ],
  providers: [GestionArphaService],
  exports: [GestionArphaService],
})
export class GestionModule {}
