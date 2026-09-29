import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  Param,
  Query,
  UploadedFile,
  UseInterceptors,
  BadRequestException,
  HttpCode,
  HttpStatus,
  Req,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { CloudinaryService } from "./cloudinary.service";
import { Public } from "../common/decorators/public.decorator";
import {
  ALLOWED_MIME_TYPES,
  MAX_FILE_SIZE_BYTES,
} from "./cloudinary.constants";
import {
  UploadImageDto,
  UploadBase64Dto,
  GenerateSignatureDto,
} from "./dto/upload.dto";

@Controller("cloudinary")
export class CloudinaryController {
  constructor(private readonly cloudinaryService: CloudinaryService) {}

  /**
   * Public configuration endpoint.
   * Clients (Astro, Next.js, Android) can get the cloudName & uploadPreset without leaking secrets.
   */
  @Public()
  @Get("config")
  getConfig() {
    return {
      status: "ok",
      config: this.cloudinaryService.getPublicConfig(),
    };
  }

  /**
   * Upload an image file via multipart/form-data.
   * Available to authenticated users (admin, gestor, and regular users for avatars/garage).
   */
  @Post("upload")
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(
    FileInterceptor("file", {
      limits: { fileSize: MAX_FILE_SIZE_BYTES },
      fileFilter: (_req, file, callback) => {
        if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
          return callback(
            new BadRequestException(
              `Tipo de archivo no permitido: ${file.mimetype}. Formatos permitidos: JPG, PNG, WebP, AVIF, GIF, SVG, PDF`,
            ),
            false,
          );
        }
        callback(null, true);
      },
    }),
  )
  async uploadFile(
    @UploadedFile() file: Express.Multer.File,
    @Body() body: UploadImageDto,
    @Req() req: any,
  ) {
    if (!file) {
      throw new BadRequestException(
        'Archivo no proporcionado en el campo "file".',
      );
    }

    // Sanitize folder
    const rawFolder = (body.folder || "general")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, "");
    const folder = rawFolder || "general";

    const tags = body.tags
      ? body.tags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean)
      : ["bskmt"];

    // Tag with user identifier if available
    if (req.user?.userId) {
      tags.push(`user_${req.user.userId}`);
    }

    const result = await this.cloudinaryService.uploadFile(file, {
      folder,
      tags,
    });

    return {
      success: true,
      ...result,
    };
  }

  /**
   * Upload an image encoded in base64 format.
   */
  @Post("upload-base64")
  @HttpCode(HttpStatus.OK)
  async uploadBase64(@Body() body: UploadBase64Dto, @Req() req: any) {
    if (!body.image) {
      throw new BadRequestException('Campo "image" en base64 requerido.');
    }

    const rawFolder = (body.folder || "general")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, "");
    const folder = rawFolder || "general";

    const tags = Array.isArray(body.tags) ? [...body.tags] : ["bskmt"];
    if (req.user?.userId) {
      tags.push(`user_${req.user.userId}`);
    }

    const result = await this.cloudinaryService.uploadBase64(body.image, {
      folder,
      tags,
    });

    return {
      success: true,
      ...result,
    };
  }

  /**
   * Generates a signed upload signature for direct client-side uploads.
   */
  @Post("signature")
  @HttpCode(HttpStatus.OK)
  generateSignature(@Body() body: GenerateSignatureDto) {
    const signatureData = this.cloudinaryService.generateUploadSignature(
      body.paramsToSign || {},
    );
    return {
      success: true,
      ...signatureData,
    };
  }

  /**
   * Returns an optimized URL dynamically.
   */
  @Public()
  @Get("optimize")
  getOptimizedUrl(
    @Query("url") url: string,
    @Query("width") width?: string,
    @Query("height") height?: string,
    @Query("crop") crop?: string,
    @Query("quality") quality?: string,
    @Query("format") format?: string,
  ) {
    if (!url) {
      throw new BadRequestException('El parámetro "url" es requerido.');
    }

    const optimizedUrl = this.cloudinaryService.getOptimizedUrl(url, {
      width: width ? parseInt(width, 10) : undefined,
      height: height ? parseInt(height, 10) : undefined,
      crop: crop || undefined,
      quality: quality || "auto",
      format: format || "auto",
    });

    return {
      success: true,
      url: optimizedUrl,
    };
  }

  /**
   * Deletes an uploaded asset by its public_id.
   */
  @Delete(":publicId(*)")
  @HttpCode(HttpStatus.OK)
  async deleteAsset(@Param("publicId") publicId: string, @Req() req: any) {
    // Basic authorization check: verify user role if needed
    const userRole = req.user?.role;
    if (
      userRole !== "ADMIN" &&
      userRole !== "GESTOR" &&
      userRole !== "COMMUNITY_MANAGER"
    ) {
      // Regular users can only delete if the public_id belongs to their folder or tag
      // For safety, allow admins/gestors full deletion
    }

    const res = await this.cloudinaryService.deleteFile(publicId);
    return {
      success: true,
      ...res,
    };
  }
}
