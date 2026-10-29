import "multer";
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
  ForbiddenException,
  HttpCode,
  HttpStatus,
  Req,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { Throttle } from "@nestjs/throttler";
import { CloudinaryService } from "./cloudinary.service";
import { Public } from "../common/decorators/public.decorator";
import {
  UploadImageDto,
  UploadBase64Dto,
  GenerateSignatureDto,
} from "./dto/upload.dto";
import {
  sanitizeFolder,
  isStaffUser,
  isAdminOrSuperAdmin,
  assertFolderAccess,
  buildTagsAndMetadata,
  validateSignatureParams,
  fileUploadInterceptorOptions,
} from "./cloudinary.utils";
import type { AuthenticatedRequest } from "./cloudinary.utils";

@Controller("cloudinary")
@Throttle({ default: { ttl: 60000, limit: 15 } })
export class CloudinaryController {
  constructor(private readonly cloudinaryService: CloudinaryService) {}

  @Public()
  @Get("config")
  getConfig() {
    return {
      status: "ok",
      config: {
        cloudName: this.cloudinaryService.getPublicConfig().cloudName,
      },
    };
  }

  @Post("upload")
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FileInterceptor("file", fileUploadInterceptorOptions))
  async uploadFile(
    @UploadedFile() file: Express.Multer.File,
    @Body() body: UploadImageDto,
    @Req() req: AuthenticatedRequest,
  ) {
    if (!file) {
      throw new BadRequestException(
        'Archivo no proporcionado en el campo "file".',
      );
    }

    const folder = sanitizeFolder(body.folder);
    assertFolderAccess(folder, req.user);

    const { tags, metadata } = buildTagsAndMetadata(
      folder,
      body.tags,
      req.user?.userId,
    );

    const result = await this.cloudinaryService.uploadFile(file, {
      folder,
      tags,
      metadata,
    });

    return {
      success: true,
      ...result,
    };
  }

  @Post("upload-base64")
  @HttpCode(HttpStatus.OK)
  async uploadBase64(
    @Body() body: UploadBase64Dto,
    @Req() req: AuthenticatedRequest,
  ) {
    if (!body.image) {
      throw new BadRequestException('Campo "image" en base64 requerido.');
    }

    const folder = sanitizeFolder(body.folder);
    assertFolderAccess(folder, req.user);

    const { tags, metadata } = buildTagsAndMetadata(
      folder,
      body.tags,
      req.user?.userId,
    );

    const result = await this.cloudinaryService.uploadBase64(body.image, {
      folder,
      tags,
      metadata,
    });

    return {
      success: true,
      ...result,
    };
  }

  @Post("signature")
  @HttpCode(HttpStatus.OK)
  generateSignature(
    @Body() body: GenerateSignatureDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const rawParams = body.paramsToSign || {};
    const filteredParams = validateSignatureParams(rawParams, req.user);
    const signatureData =
      this.cloudinaryService.generateUploadSignature(filteredParams);

    return {
      success: true,
      ...signatureData,
      folder: filteredParams.folder,
      overwrite: signatureData.overwrite ?? "false",
    };
  }

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
      width: width ? Number.parseInt(width, 10) : undefined,
      height: height ? Number.parseInt(height, 10) : undefined,
      crop: crop || undefined,
      quality: quality || "auto",
      format: format || "auto",
    });

    return {
      success: true,
      url: optimizedUrl,
    };
  }

  @Delete(["*publicId", ""])
  @HttpCode(HttpStatus.OK)
  async deleteAsset(
    @Param("publicId") publicIdParam: string | string[] | undefined,
    @Query("publicId") publicIdQuery: string | undefined,
    @Body("publicId") publicIdBody: string | undefined,
    @Req() req: AuthenticatedRequest,
  ) {
    if (!isStaffUser(req.user?.role, req.user?.subrol)) {
      throw new ForbiddenException(
        "No tienes permisos suficientes para eliminar archivos de Cloudinary. Operación restringida a Administradores.",
      );
    }

    const rawId = Array.isArray(publicIdParam)
      ? publicIdParam.filter(Boolean).join("/")
      : publicIdParam || publicIdQuery || publicIdBody;

    const resolvedPublicId = (rawId || "").trim().replace(/^\/+/, "");

    if (!resolvedPublicId) {
      throw new BadRequestException(
        "El publicId del archivo a eliminar es requerido.",
      );
    }

    if (
      !resolvedPublicId.startsWith("bskmt/") ||
      resolvedPublicId.includes("..")
    ) {
      throw new ForbiddenException(
        "Solo se permite eliminar recursos ubicados dentro del prefijo 'bskmt/'.",
      );
    }

    const userRole = req.user?.role;
    if (
      (resolvedPublicId.startsWith("bskmt/documents/") ||
        resolvedPublicId.startsWith("bskmt/profiles/")) &&
      !isAdminOrSuperAdmin(typeof userRole === "string" ? userRole : undefined)
    ) {
      throw new ForbiddenException(
        "Solo Administradores o Superadministradores pueden eliminar documentos o perfiles en Cloudinary.",
      );
    }

    const res = await this.cloudinaryService.deleteFile(resolvedPublicId);
    return {
      success: true,
      ...res,
    };
  }
}
