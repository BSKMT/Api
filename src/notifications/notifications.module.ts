import { Module } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";
import {
  Notification,
  NotificationSchema,
} from "./schemas/notification.schema";
import { NotificationsService } from "./notifications.service";
import { NotificationsController } from "./notifications.controller";
import { UsersModule } from "../users/users.module";
import { BirdModule } from "../bird/bird.module";

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Notification.name, schema: NotificationSchema },
    ]),
    UsersModule,
    BirdModule,
  ],
  controllers: [NotificationsController],
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
