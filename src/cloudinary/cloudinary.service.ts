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
import {
  CloudinaryUrlService,
  mapCloudinaryUploadResponse,
  buildCloudinaryUploadOptions,
} from "./cloudinary-url.service";
import { validateFileMagicBytes } from "./cloudinary.utils";
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

  private get uploadTimeoutMs(): number {
    return this.configService.get<number>("CLOUDINARY_TIMEOUT_MS") ?? 30000;
  }

  private async withTimeout<T>(
    promise: Promise<T>,
    operation: string,
  ): Promise<T> {
    const timeoutMs = this.uploadTimeoutMs;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        promise,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            this.logger.error(
              `Timeout de comunicación con Cloudinary (${timeoutMs}ms) en ${operation}`,
            );
            reject(
              new ServiceUnavailableException(
                "Tiempo de espera agotado al comunicar con el servicio de almacenamiento multimedia (Cloudinary).",
              ),
            );
          }, timeoutMs);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  public isConfigured(): boolean {
    const cloudName =
      this.configService.get<string>("CLOUDINARY_CLOUD_NAME") ||
      this.cloudinary.config().cloud_name;
    return Boolean(cloudName);
  }

  private assertConfigured(): void {
    if (!this.isConfigured()) {
      this.logger.error("Cloudinary credentials are not configured.");
      throw new ServiceUnavailableException(
        "El servicio de almacenamiento multimedia (Cloudinary) no está configurado.",
      );
    }
  }

  async uploadBuffer(
    buffer: Buffer,
    options: UploadOptions = {},
  ): Promise<CloudinaryUploadResult> {
    this.assertConfigured();
    const uploadParams = buildCloudinaryUploadOptions(options);
    const timeoutMs = this.uploadTimeoutMs;

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
        uploadParams,
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
          resolve(mapCloudinaryUploadResponse(result));
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
    const buffer = file.buffer;
    const mimetype =
      typeof file.mimetype === "string" ? file.mimetype : undefined;
    validateFileMagicBytes(buffer, mimetype);
    return this.uploadBuffer(buffer, options);
  }

  async uploadBase64(
    base64Data: string,
    options: UploadOptions = {},
  ): Promise<CloudinaryUploadResult> {
    this.assertConfigured();
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

    try {
      const result = await this.withTimeout(
        this.cloudinary.uploader.upload(
          base64Data,
          buildCloudinaryUploadOptions(options),
        ),
        "uploadBase64",
      );
      return mapCloudinaryUploadResponse(result);
    } catch (err: unknown) {
      if (err instanceof ServiceUnavailableException) throw err;
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
    this.assertConfigured();
    try {
      return (await this.withTimeout(
        this.cloudinary.uploader.destroy(publicId, {
          resource_type: options.resourceType || "image",
        }),
        "deleteFile",
      )) as { result: string };
    } catch (err: unknown) {
      if (err instanceof ServiceUnavailableException) throw err;
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
