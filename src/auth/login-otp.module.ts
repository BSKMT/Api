import { Module } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";
import { ZohoMailModule } from "../zoho-mail/zoho-mail.module";
import { LoginOtp, LoginOtpSchema } from "./schemas/login-otp.schema";
import { LoginOtpService } from "./login-otp.service";
import { LoginOtpController } from "./login-otp.controller";

@Module({
  imports: [
    ZohoMailModule,
    MongooseModule.forFeature([
      { name: LoginOtp.name, schema: LoginOtpSchema },
    ]),
  ],
  controllers: [LoginOtpController],
  providers: [LoginOtpService],
  exports: [LoginOtpService],
})
export class LoginOtpModule {}
