export const CLOUDINARY = "CLOUDINARY";

export const ALLOWED_CLOUDINARY_FOLDERS = [
  "products",
  "events",
  "courses",
  "garage",
  "avatars",
  "documents",
  "arpha",
  "general",
] as const;

export type CloudinaryFolder = (typeof ALLOWED_CLOUDINARY_FOLDERS)[number];

export const ALLOWED_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/avif",
  "image/gif",
  "application/pdf",
];

export const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

export const ALLOWED_SIGNATURE_PARAMS = [
  "folder",
  "timestamp",
  "upload_preset",
  "tags",
  "context",
  "public_id",
  "source",
] as const;
