import { Module } from "@nestjs/common";
import { ThrottlerModule } from "@nestjs/throttler";
import { ProfileController } from "./profile.controller";
import { UsersModule } from "../users/users.module";
import { BirdVerifyModule } from "../bird-verify/bird-verify.module";
import { BirdModule } from "../bird/bird.module";
import { ChannelVerificationService } from "./channel-verification.service";

@Module({
  imports: [UsersModule, BirdModule, BirdVerifyModule, ThrottlerModule],
  controllers: [ProfileController],
  providers: [ChannelVerificationService],
})
export class ProfileModule {}
