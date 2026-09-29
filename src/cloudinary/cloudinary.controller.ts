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
import { CloudinaryService } from "./cloudinary.service";
import { Public } from "../common/decorators/public.decorator";
import {
  ALLOWED_CLOUDINARY_FOLDERS,
  ALLOWED_MIME_TYPES,
  CloudinaryFolder,
  MAX_FILE_SIZE_BYTES,
} from "./cloudinary.constants";
import {
  UploadImageDto,
  UploadBase64Dto,
  GenerateSignatureDto,
} from "./dto/upload.dto";

const RESTRICTED_CATALOG_FOLDERS: readonly CloudinaryFolder[] = [
  "products",
  "events",
  "courses",
  "documents",
  "arpha",
];

function sanitizeFolder(folder?: string): CloudinaryFolder {
  if (!folder) return "general";
  const cleaned = folder
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "");
  return (ALLOWED_CLOUDINARY_FOLDERS as readonly string[]).includes(cleaned)
    ? (cleaned as CloudinaryFolder)
    : "general";
}

const STAFF_ROLES: readonly string[] = [
  "admin",
  "event-manager",
  "moderator",
  "road-captain",
  "gestor",
  "community_manager",
];

function isStaffUser(role?: string, subrol?: string | null): boolean {
  if (role) {
    const normalized = role.toLowerCase().trim();
    if (STAFF_ROLES.includes(normalized) || normalized === "admin") return true;
  }
  if (subrol) {
    return true; // Any collaborative staff member
  }
  return false;
}

@Controller("cloudinary")
export class CloudinaryController {
  constructor(private readonly cloudinaryService: CloudinaryService) {}

  /**
   * Public configuration endpoint.
   * Returns cloudName for client use without exposing internal upload presets.
   */
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

  /**
   * Upload an image file via multipart/form-data.
   * Authenticated endpoint. Restricted catalog folders require staff role.
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

    const folder = sanitizeFolder(body.folder);

    if (
      RESTRICTED_CATALOG_FOLDERS.includes(folder) &&
      !isStaffUser(req.user?.role, req.user?.subrol)
    ) {
      throw new ForbiddenException(
        `No tienes permisos para subir archivos a la carpeta '${folder}'. Las subidas de usuarios estándar se restringen a 'avatars' y 'garage'.`,
      );
    }

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
   * Authenticated endpoint. Restricted catalog folders require staff role.
   */
  @Post("upload-base64")
  @HttpCode(HttpStatus.OK)
  async uploadBase64(@Body() body: UploadBase64Dto, @Req() req: any) {
    if (!body.image) {
      throw new BadRequestException('Campo "image" en base64 requerido.');
    }

    const folder = sanitizeFolder(body.folder);

    if (
      RESTRICTED_CATALOG_FOLDERS.includes(folder) &&
      !isStaffUser(req.user?.role, req.user?.subrol)
    ) {
      throw new ForbiddenException(
        `No tienes permisos para subir archivos a la carpeta '${folder}'. Las subidas de usuarios estándar se restringen a 'avatars' y 'garage'.`,
      );
    }

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
   * Strictly restricted to administrators and managers with parameter allowlisting.
   */
  @Post("signature")
  @HttpCode(HttpStatus.OK)
  generateSignature(@Body() body: GenerateSignatureDto, @Req() req: any) {
    if (!isStaffUser(req.user?.role, req.user?.subrol)) {
      throw new ForbiddenException(
        "Solo administradores y gestores pueden generar firmas de subida delegadas.",
      );
    }

    const params = { ...(body.paramsToSign || {}) };

    if (params.overwrite === true || params.overwrite === "true") {
      throw new BadRequestException(
        "El parámetro 'overwrite' no está permitido en firmas delegadas.",
      );
    }
    if (params.notification_url) {
      throw new BadRequestException(
        "El parámetro 'notification_url' no está permitido en firmas delegadas.",
      );
    }
    if (params.folder) {
      params.folder = sanitizeFolder(String(params.folder));
    }

    const signatureData =
      this.cloudinaryService.generateUploadSignature(params);
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
   * Strictly restricted to administrators and managers.
   */
  @Delete(["*publicId", ""])
  @HttpCode(HttpStatus.OK)
  async deleteAsset(
    @Param("publicId") publicIdParam: string | string[] | undefined,
    @Query("publicId") publicIdQuery: string | undefined,
    @Body("publicId") publicIdBody: string | undefined,
    @Req() req: any,
  ) {
    if (!isStaffUser(req.user?.role, req.user?.subrol)) {
      throw new ForbiddenException(
        "No tienes permisos suficientes para eliminar archivos de Cloudinary. Operación restringida a Administradores.",
      );
    }

    const resolvedPublicId = Array.isArray(publicIdParam)
      ? publicIdParam.join("/")
      : publicIdParam || publicIdQuery || publicIdBody;

    if (!resolvedPublicId) {
      throw new BadRequestException(
        "El publicId del archivo a eliminar es requerido.",
      );
    }

    const res = await this.cloudinaryService.deleteFile(resolvedPublicId);
    return {
      success: true,
      ...res,
    };
  }
}
