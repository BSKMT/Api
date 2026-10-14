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
  "event-manager",
  "moderator",
  "road-captain",
  "gestor",
  "community_manager",
];

export const STAFF_SUBROLES: readonly string[] = Object.values(UserSubrole);

export function isStaffUser(role?: string, subrol?: string | null): boolean {
  if (role) {
    const normalized = role.toLowerCase().trim();
    if (STAFF_ROLES.includes(normalized) || normalized === "admin") return true;
  }
  if (subrol) {
    const normalizedSub = subrol.toLowerCase().trim();
    if (STAFF_SUBROLES.includes(normalizedSub)) return true;
  }
  return false;
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
