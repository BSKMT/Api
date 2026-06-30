import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { APP_GUARD } from "@nestjs/core";
import { MongooseModule } from "@nestjs/mongoose";
import { ScheduleModule } from "@nestjs/schedule";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import { AuthModule } from "./auth/auth.module";
import { B2bModule } from "./b2b/b2b.module";
import { configValidationSchema } from "./config/config.validation";
import { ContactModule } from "./contact/contact.module";
import { EventsModule } from "./events/events.module";
import { MembershipModule } from "./membership/membership.module";
import { MembershipExpirationModule } from "./membership/membership-expiration.module";
import { NotificationsModule } from "./notifications/notifications.module";
import { PanelModule } from "./panel/panel.module";
import { PaymentsModule } from "./payments/payments.module";
import { ProfileModule } from "./profile/profile.module";
import { UsersModule } from "./users/users.module";
import { ArphaModule } from "./arpha/arpha.module";
import { ShopModule } from "./shop/shop.module";
import { AdminModule } from "./admin/admin.module";
import { ZohoMailModule } from "./zoho-mail/zoho-mail.module";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validationSchema: configValidationSchema,
      validationOptions: { abortEarly: true },
    }),
    MongooseModule.forRootAsync({
      useFactory: () => ({
        uri: process.env.MONGODB_URI!,
      }),
    }),
    ScheduleModule.forRoot(),
    ThrottlerModule.forRoot([
      {
        name: "short",
        ttl: 1000,
        limit: 3,
      },
      {
        name: "medium",
        ttl: 10000,
        limit: 20,
      },
      {
        name: "long",
        ttl: 60000,
        limit: 100,
      },
    ]),
    AuthModule,
    UsersModule,
    ProfileModule,
    PanelModule,
    B2bModule,
    EventsModule,
    PaymentsModule,
    MembershipModule,
    MembershipExpirationModule,
    NotificationsModule,
    ArphaModule,
    ShopModule,
    AdminModule,
    ZohoMailModule,
    ContactModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
