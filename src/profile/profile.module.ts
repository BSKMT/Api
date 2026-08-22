import { Module } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";
import { ThrottlerModule } from "@nestjs/throttler";
import { ProfileController } from "./profile.controller";
import { PublicProfileController } from "./public-profile.controller";
import { IdentityVerificationController } from "./identity-verification.controller";
import { User, UserSchema } from "../users/schemas/user.schema";
import { BirdVerifyModule } from "../bird-verify/bird-verify.module";
import { BirdModule } from "../bird/bird.module";
import { VerifikModule } from "../verifik/verifik.module";
import { ChannelVerificationService } from "./channel-verification.service";
import { IdentityVerificationService } from "./identity-verification.service";

@Module({
  imports: [
    MongooseModule.forFeature([{ name: User.name, schema: UserSchema }]),
    BirdModule,
    BirdVerifyModule,
    VerifikModule,
    ThrottlerModule,
  ],
  controllers: [
    ProfileController,
    PublicProfileController,
    IdentityVerificationController,
  ],
  providers: [ChannelVerificationService, IdentityVerificationService],
})
export class ProfileModule {}
