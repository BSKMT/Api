import type { TransformationOptions } from "cloudinary";

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

export interface OptimizedUrlOptions {
  width?: number;
  height?: number;
  crop?: string;
  gravity?: string;
  quality?: string | number;
  format?: string;
}

export interface UploadSignatureResult {
  signature: string;
  timestamp: number;
  apiKey: string;
  cloudName: string;
}

export interface PublicConfigResult {
  cloudName: string;
  uploadPreset: string;
}
