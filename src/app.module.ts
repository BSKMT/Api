import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { APP_GUARD } from "@nestjs/core";
import { MongooseModule } from "@nestjs/mongoose";
import { ScheduleModule } from "@nestjs/schedule";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import { AuthModule } from "./auth/auth.module";
import { SessionGuard } from "./auth/session.guard";
import { B2bModule } from "./b2b/b2b.module";
import { validateConfig } from "./config/config.validation";
import { ContactModule } from "./contact/contact.module";
import { EventsModule } from "./events/events.module";
import { KvModule } from "./kv/kv.module";
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
import { SettingsModule } from "./settings/settings.module";
import { BirdModule } from "./bird/bird.module";
import { AlegraModule } from "./alegra/alegra.module";
import { GarageModule } from "./garage/garage.module";
import { GestionModule } from "./gestion/gestion.module";
import { AppController } from "./app.controller";
import { CloudinaryModule } from "./cloudinary/cloudinary.module";
import { ObserveModule } from "./observe";

@Module({
  controllers: [AppController],
  imports: [
    ObserveModule.forRoot({
      appKey: process.env.OBSERVE_APP_KEY!,
      appSecret: process.env.OBSERVE_APP_SECRET!,
      serviceId: "bskmt-api",
    }),
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateConfig,
    }),
    MongooseModule.forRootAsync({
      useFactory: () => ({
        uri: process.env.MONGODB_URI!,
      }),
    }),
    ScheduleModule.forRoot(),
    KvModule,
    ThrottlerModule.forRoot([
      {
        name: "default",
        ttl: 60000,
        limit: 20,
      },
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
    SettingsModule,
    BirdModule,
    ContactModule,
    AlegraModule,
    GarageModule,
    GestionModule,
    CloudinaryModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    /**
     * M-12: SessionGuard runs as a global guard so any future controller
     * that forgets `@UseGuards(SessionGuard)` defaults to requiring a
     * valid session rather than defaulting open. Routes may opt out via
     * `@Public()` (webhooks, login endpoints, Vercel-cron endpoints).
     * The guard's canActivate already short-circuits on `@Public()`.
     */
    {
      provide: APP_GUARD,
      useClass: SessionGuard,
    },
  ],
})
export class AppModule {}
