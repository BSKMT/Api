import "multer";
import {
  Injectable,
  Inject,
  Logger,
  BadRequestException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  UploadApiResponse,
  UploadApiErrorResponse,
  v2 as CloudinaryType,
  TransformationOptions,
} from "cloudinary";
import { Readable } from "node:stream";
import { CLOUDINARY } from "./cloudinary.constants";

export interface CloudinaryUploadResult {
  publicId: string;
  url: string;
  secureUrl: string;
  format: string;
  width: number;
  height: number;
  bytes: number;
  resourceType: string;
}

export interface UploadOptions {
  folder?: string;
  tags?: string[];
  publicId?: string;
  transformation?: TransformationOptions | TransformationOptions[];
  resourceType?: "image" | "video" | "raw" | "auto";
  metadata?: Record<string, string>;
  context?: Record<string, string>;
}

@Injectable()
export class CloudinaryService {
  private readonly logger = new Logger(CloudinaryService.name);

  constructor(
    @Inject(CLOUDINARY) private readonly cloudinary: typeof CloudinaryType,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Check if Cloudinary is properly configured.
   */
  public isConfigured(): boolean {
    const cloudName =
      this.configService.get<string>("CLOUDINARY_CLOUD_NAME") ||
      this.cloudinary.config().cloud_name;
    return Boolean(cloudName);
  }

  /**
   * Uploads an in-memory buffer via stream directly to Cloudinary.
   */
  async uploadBuffer(
    buffer: Buffer,
    options: UploadOptions = {},
  ): Promise<CloudinaryUploadResult> {
    if (!this.isConfigured()) {
      this.logger.error("Cloudinary credentials are not configured.");
      throw new ServiceUnavailableException(
        "El servicio de almacenamiento multimedia (Cloudinary) no está configurado.",
      );
    }

    const folderName = options.folder
      ? `bskmt/${options.folder}`
      : "bskmt/general";

    const metadataEntries: string[] = [];
    if (options.folder) {
      metadataEntries.push(`bsk_module=${options.folder}`);
    }
    if (options.metadata) {
      for (const [k, v] of Object.entries(options.metadata)) {
        if (v) metadataEntries.push(`${k}=${v}`);
      }
    }
    const metadataString =
      metadataEntries.length > 0 ? metadataEntries.join("|") : undefined;

    return new Promise((resolve, reject) => {
      const uploadStream = this.cloudinary.uploader.upload_stream(
        {
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
        },
        (error?: UploadApiErrorResponse, result?: UploadApiResponse) => {
          if (error || !result) {
            this.logger.error(
              `Cloudinary upload error: ${error?.message || "Unknown error"}`,
              error?.stack,
            );
            return reject(
              new BadRequestException(
                `Error al subir archivo a Cloudinary: ${error?.message || "Error desconocido"}`,
              ),
            );
          }

          resolve({
            publicId: result.public_id,
            url: result.url,
            secureUrl: result.secure_url,
            format: result.format,
            width: result.width,
            height: result.height,
            bytes: result.bytes,
            resourceType: result.resource_type,
          });
        },
      );

      const stream = new Readable();
      stream.push(buffer);
      stream.push(null);
      stream.pipe(uploadStream);
    });
  }

  /**
   * Upload an Express.Multer.File object.
   */
  async uploadFile(
    file: Express.Multer.File,
    options: UploadOptions = {},
  ): Promise<CloudinaryUploadResult> {
    if (!file || !file.buffer) {
      throw new BadRequestException(
        "No se ha proporcionado un archivo válido.",
      );
    }
    return this.uploadBuffer(file.buffer, options);
  }

  /**
   * Upload a base64 encoded data URI string (e.g. data:image/png;base64,...).
   */
  async uploadBase64(
    base64Data: string,
    options: UploadOptions = {},
  ): Promise<CloudinaryUploadResult> {
    if (!this.isConfigured()) {
      throw new ServiceUnavailableException(
        "El servicio de almacenamiento multimedia no está configurado.",
      );
    }

    const folderName = options.folder
      ? `bskmt/${options.folder}`
      : "bskmt/general";

    const metadataEntries: string[] = [];
    if (options.folder) {
      metadataEntries.push(`bsk_module=${options.folder}`);
    }
    if (options.metadata) {
      for (const [k, v] of Object.entries(options.metadata)) {
        if (v) metadataEntries.push(`${k}=${v}`);
      }
    }
    const metadataString =
      metadataEntries.length > 0 ? metadataEntries.join("|") : undefined;

    try {
      const result = await this.cloudinary.uploader.upload(base64Data, {
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
      });

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
    } catch (err: any) {
      this.logger.error(`Error uploading base64 to Cloudinary: ${err.message}`);
      throw new BadRequestException(
        `Error al subir imagen: ${err.message || "Error desconocido"}`,
      );
    }
  }

  /**
   * Deletes an asset by its public_id.
   */
  async deleteFile(
    publicId: string,
    options: { resourceType?: "image" | "video" | "raw" } = {},
  ): Promise<{ result: string }> {
    if (!this.isConfigured()) {
      throw new ServiceUnavailableException(
        "El servicio de almacenamiento multimedia no está configurado.",
      );
    }

    try {
      const res = await this.cloudinary.uploader.destroy(publicId, {
        resource_type: options.resourceType || "image",
      });
      return res;
    } catch (err: any) {
      this.logger.error(`Error deleting asset ${publicId}: ${err.message}`);
      throw new BadRequestException(
        `Error al eliminar archivo de Cloudinary: ${err.message}`,
      );
    }
  }

  /**
   * Generates a signature for authenticated client-side uploads.
   * Useful for Next.js CldUploadWidget or Android MediaManager direct uploads.
   */
  generateUploadSignature(paramsToSign: Record<string, any> = {}): {
    signature: string;
    timestamp: number;
    apiKey: string;
    cloudName: string;
  } {
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

  /**
   * Builds an optimized URL with f_auto, q_auto and optional resizing.
   */
  getOptimizedUrl(
    publicIdOrUrl: string,
    options?: {
      width?: number;
      height?: number;
      crop?: string;
      gravity?: string;
      quality?: string | number;
      format?: string;
    },
  ): string {
    if (!publicIdOrUrl) return "";

    // If it's already a full non-Cloudinary URL, return as is
    if (
      publicIdOrUrl.startsWith("http") &&
      !publicIdOrUrl.includes("cloudinary.com")
    ) {
      return publicIdOrUrl;
    }

    // Extract publicId if a full Cloudinary URL was passed
    let publicId = publicIdOrUrl;
    const uploadMatch = publicIdOrUrl.match(
      /\/upload\/(?:v\d+\/)?(.+?)(?:\.[a-zA-Z0-9]+)?$/,
    );
    if (uploadMatch) {
      publicId = uploadMatch[1];
    }

    const transformation: Record<string, any> = {
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

  /**
   * Returns public configuration for clients.
   */
  getPublicConfig(): { cloudName: string; uploadPreset: string } {
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
