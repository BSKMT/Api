import { Module } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";
import { BirdVerifyModule } from "../bird-verify/bird-verify.module";
import { LoginOtp, LoginOtpSchema } from "./schemas/login-otp.schema";
import { LoginOtpService } from "./login-otp.service";
import { LoginOtpController } from "./login-otp.controller";

/**
 * LoginOtpModule — Flujo de login en dos pasos (credenciales + codigo OTP).
 *
 * Delega la generacion, entrega y verificacion del codigo a Bird Verify a
 * traves de {@link BirdVerifyModule}, que es un servicio HTTP stateless — no
 * requiere DB propia. Las cookies de sesion se siguen cifrando localmente
 * con AES-256-GCM y persistiendo en MongoDB.
 *
 * Los flujos de verificacion de email (Better Auth `emailVerification`) y
 * reset de password usan `BirdEmailService` (no OTP), configurado via
 * `AuthModule` → `BirdModule`.
 */
@Module({
  imports: [
    BirdVerifyModule,
    MongooseModule.forFeature([
      { name: LoginOtp.name, schema: LoginOtpSchema },
    ]),
  ],
  controllers: [LoginOtpController],
  providers: [LoginOtpService],
  exports: [LoginOtpService],
})
export class LoginOtpModule {}
