import { Module } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";
import { ThrottlerModule } from "@nestjs/throttler";
import { ProfileController } from "./profile.controller";
import { User, UserSchema } from "../users/schemas/user.schema";
import { BirdVerifyModule } from "../bird-verify/bird-verify.module";
import { BirdModule } from "../bird/bird.module";
import { ChannelVerificationService } from "./channel-verification.service";

@Module({
  imports: [
    MongooseModule.forFeature([{ name: User.name, schema: UserSchema }]),
    BirdModule,
    BirdVerifyModule,
    ThrottlerModule,
  ],
  controllers: [ProfileController],
  providers: [ChannelVerificationService],
})
export class ProfileModule {}
