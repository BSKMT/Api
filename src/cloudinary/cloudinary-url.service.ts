import {
  Injectable,
  Inject,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { UploadApiResponse, v2 as CloudinaryType } from "cloudinary";
import { CLOUDINARY } from "./cloudinary.constants";
import type {
  CloudinaryUploadResult,
  UploadOptions,
  OptimizedUrlOptions,
  UploadSignatureResult,
  PublicConfigResult,
} from "./cloudinary.types";

export function mapCloudinaryUploadResponse(
  result: UploadApiResponse,
): CloudinaryUploadResult {
  return {
    publicId: result.public_id,
    url: result.url,
    secureUrl: result.secure_url,
    format: result.format,
    width: result.width,
    height: result.height,
    bytes: result.bytes,
    resourceType: result.resource_type,
  };
}

export function buildCloudinaryUploadOptions(
  options: UploadOptions,
): Record<string, unknown> {
  const folderName = options.folder
    ? `bskmt/${options.folder}`
    : "bskmt/general";
  const entries: string[] = [];
  if (options.folder) entries.push(`bsk_module=${options.folder}`);
  if (options.metadata) {
    for (const [k, v] of Object.entries(options.metadata)) {
      if (v) entries.push(`${k}=${v}`);
    }
  }
  const metadataString = entries.length > 0 ? entries.join("|") : undefined;
  return {
    folder: folderName,
    public_id: options.publicId,
    tags: options.tags || ["bskmt"],
    resource_type: options.resourceType || "auto",
    sanitize: true,
    transformation: options.transformation || [
      { quality: "auto", fetch_format: "auto" },
    ],
    ...(metadataString ? { metadata: metadataString } : {}),
    ...(options.context ? { context: options.context } : {}),
  };
}

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

    const safeParams: Record<string, unknown> = {};
    if (
      typeof paramsToSign.folder === "string" &&
      /^[a-zA-Z0-9/_-]+$/.test(paramsToSign.folder) &&
      !paramsToSign.folder.includes("..")
    ) {
      safeParams.folder = paramsToSign.folder.startsWith("bskmt/")
        ? paramsToSign.folder
        : `bskmt/${paramsToSign.folder}`;
    } else {
      safeParams.folder = "bskmt/general";
    }
    if (typeof paramsToSign.tags === "string") {
      safeParams.tags = paramsToSign.tags;
    }
    safeParams.overwrite = "false";

    const timestamp = Math.round(Date.now() / 1000);
    const signature = this.cloudinary.utils.api_sign_request(
      { ...safeParams, timestamp },
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
    const uploadMatch = /\/upload\/(?:v\d+\/)?(.+?)(?:\.[a-zA-Z0-9]+)?$/.exec(
      publicIdOrUrl,
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
