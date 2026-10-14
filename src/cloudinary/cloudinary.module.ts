import { Module } from "@nestjs/common";
import { CloudinaryProvider } from "./cloudinary.provider";
import { CloudinaryService } from "./cloudinary.service";
import { CloudinaryUrlService } from "./cloudinary-url.service";
import { CloudinaryController } from "./cloudinary.controller";

@Module({
  controllers: [CloudinaryController],
  providers: [CloudinaryProvider, CloudinaryService, CloudinaryUrlService],
  exports: [CloudinaryProvider, CloudinaryService, CloudinaryUrlService],
})
export class CloudinaryModule {}
