import { Module } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";
import {
  GarageMotorcycle,
  GarageMotorcycleSchema,
} from "./schemas/garage-motorcycle.schema";
import {
  MaintenanceLog,
  MaintenanceLogSchema,
} from "./schemas/maintenance-log.schema";
import { OdometerLog, OdometerLogSchema } from "./schemas/odometer-log.schema";
import {
  AlliedWorkshop,
  AlliedWorkshopSchema,
} from "./schemas/allied-workshop.schema";
import {
  EventRegistration,
  EventRegistrationSchema,
} from "../events/schemas/event-registration.schema";
import { Event, EventSchema } from "../events/schemas/event.schema";
import { Order, OrderSchema } from "../shop/schemas/order.schema";
import { UsersModule } from "../users/users.module";
import { VerifikModule } from "../verifik/verifik.module";
import { GarageService } from "./garage.service";
import { GarageController } from "./garage.controller";

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: GarageMotorcycle.name, schema: GarageMotorcycleSchema },
      { name: MaintenanceLog.name, schema: MaintenanceLogSchema },
      { name: OdometerLog.name, schema: OdometerLogSchema },
      { name: AlliedWorkshop.name, schema: AlliedWorkshopSchema },
      { name: EventRegistration.name, schema: EventRegistrationSchema },
      { name: Event.name, schema: EventSchema },
      { name: Order.name, schema: OrderSchema },
    ]),
    UsersModule,
    VerifikModule,
  ],
  controllers: [GarageController],
  providers: [GarageService],
  exports: [GarageService],
})
export class GarageModule {}
