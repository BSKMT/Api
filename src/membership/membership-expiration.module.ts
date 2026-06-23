import { Module } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";
import { MembershipExpirationService } from "./services/membership-expiration.service";
import { User, UserSchema } from "../users/schemas/user.schema";
import { NotificationsModule } from "../notifications/notifications.module";

@Module({
  imports: [
    MongooseModule.forFeature([{ name: User.name, schema: UserSchema }]),
    NotificationsModule,
  ],
  providers: [MembershipExpirationService],
  exports: [MembershipExpirationService],
})
export class MembershipExpirationModule {}
