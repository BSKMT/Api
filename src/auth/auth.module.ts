import { Module, Global } from "@nestjs/common";
import { UsersModule } from "../users/users.module";
import { BirdModule } from "../bird/bird.module";
import { AuthController } from "./auth.controller";
import { SessionGuard } from "./session.guard";
import { LoginOtpModule } from "./login-otp.module";

/**
 * AuthModule — Better Auth integration for NestJS.
 *
 * Global module so `SessionGuard` is available to all controllers
 * without each feature module needing to import AuthModule.
 */
@Global()
@Module({
  imports: [UsersModule, BirdModule, LoginOtpModule],
  controllers: [AuthController],
  providers: [SessionGuard],
  exports: [SessionGuard],
})
export class AuthModule {}
