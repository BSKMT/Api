import type { Request } from "express";
import { BadRequestException, ForbiddenException } from "@nestjs/common";
import {
  ALLOWED_CLOUDINARY_FOLDERS,
  ALLOWED_MIME_TYPES,
  ALLOWED_SIGNATURE_PARAMS,
  MAX_FILE_SIZE_BYTES,
  CloudinaryFolder,
} from "./cloudinary.constants";
import { UserSubrole } from "../users/schemas/user.schema";

export interface AuthenticatedRequest extends Request {
  user?: {
    userId?: string;
    role?: string;
    subrol?: string | null;
  };
}

export const RESTRICTED_CATALOG_FOLDERS: readonly CloudinaryFolder[] = [
  "products",
  "events",
  "courses",
  "documents",
  "arpha",
];

export function sanitizeFolder(folder?: string): CloudinaryFolder {
  if (!folder) return "general";
  let cleaned = folder.trim().toLowerCase();
  if (cleaned.startsWith("bskmt/")) {
    cleaned = cleaned.slice(6);
  }
  cleaned = cleaned.replace(/[^a-z0-9_-]/g, "");
  return (ALLOWED_CLOUDINARY_FOLDERS as readonly string[]).includes(cleaned)
    ? (cleaned as CloudinaryFolder)
    : "general";
}

export const STAFF_ROLES: readonly string[] = [
  "admin",
  "superadmin",
  "event-manager",
  "moderator",
  "road-captain",
  "gestor",
  "community_manager",
];

export const STAFF_SUBROLES: readonly string[] = Object.values(UserSubrole);

export function isAdminOrSuperAdmin(role?: string): boolean {
  if (!role) return false;
  const normalized = role.toLowerCase().trim();
  return normalized === "admin" || normalized === "superadmin";
}

export function isStaffUser(role?: string, subrol?: string | null): boolean {
  if (role) {
    const normalized = role.toLowerCase().trim();
    if (STAFF_ROLES.includes(normalized)) return true;
  }
  if (subrol) {
    const normalizedSub = subrol.toLowerCase().trim();
    if (STAFF_SUBROLES.includes(normalizedSub)) return true;
  }
  return false;
}

const MAGIC_BYTES_MATCHERS: Record<string, (buf: Buffer) => boolean> = {
  "image/jpeg": (buf) =>
    buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff,
  "image/png": (buf) =>
    buf.length >= 8 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a,
  "image/gif": (buf) => {
    if (buf.length < 6) return false;
    const header = buf.subarray(0, 6).toString("ascii");
    return header === "GIF87a" || header === "GIF89a";
  },
  "image/webp": (buf) =>
    buf.length >= 12 &&
    buf.subarray(0, 4).toString("ascii") === "RIFF" &&
    buf.subarray(8, 12).toString("ascii") === "WEBP",
  "image/avif": (buf) => {
    if (buf.length < 12) return false;
    const boxType = buf.subarray(4, 8).toString("ascii");
    const brand = buf.subarray(8, 12).toString("ascii");
    return (
      boxType === "ftyp" && ["avif", "avis", "mif1", "msf1"].includes(brand)
    );
  },
  "application/pdf": (buf) =>
    buf.length >= 5 && buf.subarray(0, 5).toString("ascii") === "%PDF-",
};

export function validateFileMagicBytes(
  buffer: Buffer,
  mimetype?: string,
): void {
  if (!Buffer.isBuffer(buffer) || buffer.length < 3) {
    throw new BadRequestException(
      "El contenido binario del archivo es inválido o está vacío.",
    );
  }

  if (mimetype) {
    const normalizedMime = mimetype.toLowerCase().trim();
    const matcher = MAGIC_BYTES_MATCHERS[normalizedMime];
    if (!matcher?.(buffer)) {
      throw new BadRequestException(
        "El contenido binario del archivo (magic bytes) no coincide con el tipo MIME declarado.",
      );
    }
    return;
  }

  const matchesAny = Object.values(MAGIC_BYTES_MATCHERS).some((fn) =>
    fn(buffer),
  );
  if (!matchesAny) {
    throw new BadRequestException(
      "El contenido binario del archivo (magic bytes) no corresponde a un formato permitido.",
    );
  }
}

export function assertFolderAccess(
  folder: CloudinaryFolder,
  user?: { role?: string; subrol?: string | null },
): void {
  if (
    RESTRICTED_CATALOG_FOLDERS.includes(folder) &&
    !isStaffUser(user?.role, user?.subrol)
  ) {
    throw new ForbiddenException(
      `No tienes permisos para subir archivos a la carpeta '${folder}'. Las subidas de usuarios estándar se restringen a 'avatars' y 'garage'.`,
    );
  }
}

export function buildTagsAndMetadata(
  folder: string,
  rawTags?: string | string[],
  userId?: string,
): { tags: string[]; metadata: Record<string, string> } {
  let tags: string[];
  if (Array.isArray(rawTags)) {
    tags = [...rawTags];
  } else if (typeof rawTags === "string" && rawTags.trim()) {
    tags = rawTags
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
  } else {
    tags = ["bskmt"];
  }

  if (userId) {
    tags.push(`user_${userId}`);
  }

  const metadata: Record<string, string> = {
    bsk_module: folder,
    ...(userId ? { bsk_user_id: String(userId) } : {}),
  };

  return { tags, metadata };
}

export function validateSignatureParams(
  rawParams: Record<string, unknown>,
  user?: { role?: string; subrol?: string | null },
): Record<string, unknown> {
  const filtered: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(rawParams)) {
    if ((ALLOWED_SIGNATURE_PARAMS as readonly string[]).includes(key)) {
      filtered[key] = value;
    }
  }

  if (rawParams.overwrite === true || rawParams.overwrite === "true") {
    throw new BadRequestException(
      "El parámetro 'overwrite' no está permitido en firmas delegadas.",
    );
  }
  if (rawParams.notification_url) {
    throw new BadRequestException(
      "El parámetro 'notification_url' no está permitido en firmas delegadas.",
    );
  }

  const rawFolder =
    typeof filtered.folder === "string" ? filtered.folder : undefined;
  const folderCategory = sanitizeFolder(rawFolder);

  assertFolderAccess(folderCategory, user);
  filtered.folder = `bskmt/${folderCategory}`;

  if (filtered.public_id && typeof filtered.public_id === "string") {
    filtered.public_id = filtered.public_id
      .replace(/[^a-zA-Z0-9_-]/g, "")
      .slice(0, 100);
  }

  return filtered;
}

export const fileUploadInterceptorOptions = {
  limits: { fileSize: MAX_FILE_SIZE_BYTES },
  fileFilter: (
    _req: unknown,
    file: Express.Multer.File,
    callback: (error: Error | null, acceptFile: boolean) => void,
  ) => {
    if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      callback(
        new BadRequestException(
          `Tipo de archivo no permitido: ${file.mimetype}. Formatos permitidos: JPG, PNG, WebP, AVIF, GIF, SVG, PDF`,
        ),
        false,
      );
      return;
    }
    callback(null, true);
  },
};
