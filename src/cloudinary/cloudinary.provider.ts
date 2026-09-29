import { ConfigService } from "@nestjs/config";
import { v2 as cloudinary } from "cloudinary";
import { CLOUDINARY } from "./cloudinary.constants";

export const CloudinaryProvider = {
  provide: CLOUDINARY,
  inject: [ConfigService],
  useFactory: (configService: ConfigService) => {
    const cloudinaryUrl = configService.get<string>("CLOUDINARY_URL");
    const cloudName = configService.get<string>("CLOUDINARY_CLOUD_NAME");
    const apiKey = configService.get<string>("CLOUDINARY_API_KEY");
    const apiSecret = configService.get<string>("CLOUDINARY_API_SECRET");

    if (cloudinaryUrl) {
      cloudinary.config({
        cloudinary_url: cloudinaryUrl,
        secure: true,
      });
    } else if (cloudName) {
      cloudinary.config({
        cloud_name: cloudName,
        api_key: apiKey,
        api_secret: apiSecret,
        secure: true,
      });
    }

    return cloudinary;
  },
};
