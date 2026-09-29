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
  "image/svg+xml",
  "application/pdf",
];

export const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB
