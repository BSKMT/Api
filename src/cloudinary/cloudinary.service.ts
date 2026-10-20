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
} from "cloudinary";
import { Readable } from "node:stream";
import { CLOUDINARY } from "./cloudinary.constants";
import { CloudinaryUrlService } from "./cloudinary-url.service";
import type {
  CloudinaryUploadResult,
  UploadOptions,
  OptimizedUrlOptions,
  UploadSignatureResult,
  PublicConfigResult,
} from "./cloudinary.types";

export type {
  CloudinaryUploadResult,
  UploadOptions,
  OptimizedUrlOptions,
  UploadSignatureResult,
  PublicConfigResult,
};

@Injectable()
export class CloudinaryService {
  private readonly logger = new Logger(CloudinaryService.name);

  constructor(
    @Inject(CLOUDINARY) private readonly cloudinary: typeof CloudinaryType,
    private readonly configService: ConfigService,
    private readonly urlService: CloudinaryUrlService,
  ) {}

  public isConfigured(): boolean {
    const cloudName =
      this.configService.get<string>("CLOUDINARY_CLOUD_NAME") ||
      this.cloudinary.config().cloud_name;
    return Boolean(cloudName);
  }

  private buildMetadataString(options: UploadOptions): string | undefined {
    const entries: string[] = [];
    if (options.folder) {
      entries.push(`bsk_module=${options.folder}`);
    }
    if (options.metadata) {
      for (const [k, v] of Object.entries(options.metadata)) {
        if (v) entries.push(`${k}=${v}`);
      }
    }
    return entries.length > 0 ? entries.join("|") : undefined;
  }

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
    const metadataString = this.buildMetadataString(options);
    const timeoutMs =
      this.configService.get<number>("CLOUDINARY_TIMEOUT_MS") ?? 30000;

    return new Promise((resolve, reject) => {
      let isSettled = false;

      // NIST CSF 2.0 PR.IR-04 & GV.SC-07: Resiliencia ante fallos/stalling de terceros
      const timer = setTimeout(() => {
        if (isSettled) return;
        isSettled = true;
        try {
          uploadStream.destroy(
            new Error("Timeout en Cloudinary upload_stream"),
          );
        } catch {
          // Ignore stream destruction errors
        }
        this.logger.error(
          `Timeout de comunicación con Cloudinary (${timeoutMs}ms) al subir buffer`,
        );
        reject(
          new ServiceUnavailableException(
            "Tiempo de espera agotado al comunicar con el servicio de almacenamiento multimedia (Cloudinary).",
          ),
        );
      }, timeoutMs);

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
          if (isSettled) return;
          isSettled = true;
          clearTimeout(timer);

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

  async uploadFile(
    file: Express.Multer.File,
    options: UploadOptions = {},
  ): Promise<CloudinaryUploadResult> {
    if (!file?.buffer) {
      throw new BadRequestException(
        "No se ha proporcionado un archivo válido.",
      );
    }
    return this.uploadBuffer(file.buffer, options);
  }

  async uploadBase64(
    base64Data: string,
    options: UploadOptions = {},
  ): Promise<CloudinaryUploadResult> {
    if (!this.isConfigured()) {
      throw new ServiceUnavailableException(
        "El servicio de almacenamiento multimedia no está configurado.",
      );
    }

    if (
      typeof base64Data !== "string" ||
      !/^data:(image\/(jpeg|png|webp|gif)|application\/pdf);base64,[A-Za-z0-9+/=]+$/.test(
        base64Data,
      )
    ) {
      throw new BadRequestException(
        "Formato inválido: solo se aceptan cadenas Data URI base64 de imágenes (JPEG, PNG, WebP, GIF) o PDF.",
      );
    }

    const folderName = options.folder
      ? `bskmt/${options.folder}`
      : "bskmt/general";
    const metadataString = this.buildMetadataString(options);

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
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Error uploading base64 to Cloudinary: ${msg}`);
      throw new BadRequestException(
        `Error al subir imagen: ${msg || "Error desconocido"}`,
      );
    }
  }

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
      return (await this.cloudinary.uploader.destroy(publicId, {
        resource_type: options.resourceType || "image",
      })) as { result: string };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Error deleting asset ${publicId}: ${msg}`);
      throw new BadRequestException(
        `Error al eliminar archivo de Cloudinary: ${msg}`,
      );
    }
  }

  generateUploadSignature(
    paramsToSign: Record<string, unknown> = {},
  ): UploadSignatureResult {
    return this.urlService.generateUploadSignature(paramsToSign);
  }

  getOptimizedUrl(
    publicIdOrUrl: string,
    options?: OptimizedUrlOptions,
  ): string {
    return this.urlService.getOptimizedUrl(publicIdOrUrl, options);
  }

  getPublicConfig(): PublicConfigResult {
    return this.urlService.getPublicConfig();
  }
}
