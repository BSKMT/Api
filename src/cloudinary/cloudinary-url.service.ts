import {
  Injectable,
  Inject,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { v2 as CloudinaryType } from "cloudinary";
import { CLOUDINARY } from "./cloudinary.constants";
import type {
  OptimizedUrlOptions,
  UploadSignatureResult,
  PublicConfigResult,
} from "./cloudinary.types";

@Injectable()
export class CloudinaryUrlService {
  constructor(
    @Inject(CLOUDINARY) private readonly cloudinary: typeof CloudinaryType,
    private readonly configService: ConfigService,
  ) {}

  generateUploadSignature(
    paramsToSign: Record<string, unknown> = {},
  ): UploadSignatureResult {
    const apiSecret =
      this.configService.get<string>("CLOUDINARY_API_SECRET") ||
      this.cloudinary.config().api_secret;
    const apiKey =
      this.configService.get<string>("CLOUDINARY_API_KEY") ||
      this.cloudinary.config().api_key;
    const cloudName =
      this.configService.get<string>("CLOUDINARY_CLOUD_NAME") ||
      this.cloudinary.config().cloud_name;

    if (!apiSecret || !apiKey || !cloudName) {
      throw new ServiceUnavailableException(
        "Credenciales de Cloudinary incompletas.",
      );
    }

    const timestamp = Math.round(new Date().getTime() / 1000);
    const signature = this.cloudinary.utils.api_sign_request(
      { ...paramsToSign, timestamp },
      apiSecret,
    );

    return {
      signature,
      timestamp,
      apiKey,
      cloudName,
    };
  }

  getOptimizedUrl(
    publicIdOrUrl: string,
    options?: OptimizedUrlOptions,
  ): string {
    if (!publicIdOrUrl) return "";

    if (
      publicIdOrUrl.startsWith("http") &&
      !publicIdOrUrl.includes("cloudinary.com")
    ) {
      return publicIdOrUrl;
    }

    let publicId = publicIdOrUrl;
    const uploadMatch = publicIdOrUrl.match(
      /\/upload\/(?:v\d+\/)?(.+?)(?:\.[a-zA-Z0-9]+)?$/,
    );
    if (uploadMatch) {
      publicId = uploadMatch[1];
    }

    const transformation: Record<string, unknown> = {
      fetch_format: options?.format || "auto",
      quality: options?.quality || "auto",
    };

    if (options?.width) transformation.width = options.width;
    if (options?.height) transformation.height = options.height;
    if (options?.crop) transformation.crop = options.crop;
    if (options?.gravity) transformation.gravity = options.gravity;

    return this.cloudinary.url(publicId, {
      secure: true,
      transformation: [transformation],
    });
  }

  getPublicConfig(): PublicConfigResult {
    const cloudName =
      this.configService.get<string>("CLOUDINARY_CLOUD_NAME") ||
      this.cloudinary.config().cloud_name ||
      "";
    const uploadPreset =
      this.configService.get<string>("CLOUDINARY_UPLOAD_PRESET") || "";

    return {
      cloudName,
      uploadPreset,
    };
  }
}
