import { Module, Global } from "@nestjs/common";
import { UsersModule } from "../users/users.module";
import { AuthController } from "./auth.controller";
import { SessionGuard } from "./session.guard";

/**
 * AuthModule — Better Auth integration for NestJS.
 *
 * Global module so `SessionGuard` is available to all controllers
 * without each feature module needing to import AuthModule.
 */
@Global()
@Module({
  imports: [UsersModule],
  controllers: [AuthController],
  providers: [SessionGuard],
  exports: [SessionGuard],
})
export class AuthModule {}