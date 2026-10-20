import { describe, it, expect, beforeEach, jest } from "@jest/globals";
import { Test, TestingModule } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import {
  BadRequestException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { Writable } from "node:stream";
import { CloudinaryService } from "./cloudinary.service";
import { CLOUDINARY } from "./cloudinary.constants";
import { CloudinaryUrlService } from "./cloudinary-url.service";

describe("CloudinaryService (NIST CSF 2.0 GV.SC-07, PR.IR-04)", () => {
  let service: CloudinaryService;
  let mockCloudinary: {
    config: jest.Mock;
    uploader: {
      upload_stream: jest.Mock;
    };
  };
  let mockConfigService: { get: jest.Mock };
  let mockUrlService: Partial<CloudinaryUrlService>;

  beforeEach(async () => {
    mockCloudinary = {
      config: jest.fn().mockReturnValue({ cloud_name: "test-cloud" }),
      uploader: {
        upload_stream: jest.fn(),
      },
    };

    mockConfigService = {
      get: jest.fn((key: string) => {
        if (key === "CLOUDINARY_CLOUD_NAME") return "test-cloud";
        if (key === "CLOUDINARY_TIMEOUT_MS") return 100; // Fast timeout for test
        return null;
      }),
    };

    mockUrlService = {
      getOptimizedUrl: jest.fn<CloudinaryUrlService["getOptimizedUrl"]>(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CloudinaryService,
        {
          provide: CLOUDINARY,
          useValue: mockCloudinary,
        },
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
        {
          provide: CloudinaryUrlService,
          useValue: mockUrlService,
        },
      ],
    }).compile();

    service = module.get<CloudinaryService>(CloudinaryService);
  });

  it("sube exitosamente un archivo en buffer a Cloudinary", async () => {
    mockCloudinary.uploader.upload_stream.mockImplementation(
      (_opts: unknown, callback: (err: unknown, result?: unknown) => void) => {
        const stream = new Writable({
          write(_chunk, _encoding, next) {
            next();
          },
        });
        process.nextTick(() => {
          callback(null, {
            public_id: "bskmt/test/img1",
            url: "http://res.cloudinary.com/test/image/upload/img1.jpg",
            secure_url: "https://res.cloudinary.com/test/image/upload/img1.jpg",
            format: "jpg",
            width: 800,
            height: 600,
            bytes: 12345,
            resource_type: "image",
          });
        });
        return stream;
      },
    );

    const result = await service.uploadBuffer(Buffer.from("fake-image-bytes"), {
      folder: "test",
    });

    expect(result).toBeDefined();
    expect(result.publicId).toBe("bskmt/test/img1");
    expect(result.secureUrl).toContain("https://");
  });

  it("rechaza la solicitud si Cloudinary no está configurado", async () => {
    mockConfigService.get.mockReturnValue(null);
    mockCloudinary.config.mockReturnValue({ cloud_name: undefined });

    await expect(
      service.uploadBuffer(Buffer.from("some-bytes")),
    ).rejects.toThrow(ServiceUnavailableException);
  });

  it("maneja errores de la API de Cloudinary adecuadamente", async () => {
    mockCloudinary.uploader.upload_stream.mockImplementation(
      (_opts: unknown, callback: (err: unknown, result?: unknown) => void) => {
        const stream = new Writable({
          write(_chunk, _encoding, next) {
            next();
          },
        });
        process.nextTick(() => {
          callback({ message: "Invalid image format" }, null);
        });
        return stream;
      },
    );

    await expect(
      service.uploadBuffer(Buffer.from("invalid-bytes")),
    ).rejects.toThrow(BadRequestException);
  });

  it("aplica timeout de resiliencia si la conexión con Cloudinary se estanca (PR.IR-04)", async () => {
    // Simulated hanging stream that never invokes the callback
    mockCloudinary.uploader.upload_stream.mockImplementation(() => {
      return new Writable({
        write(_chunk, _encoding, next) {
          next();
        },
      });
    });

    await expect(
      service.uploadBuffer(Buffer.from("hanging-bytes")),
    ).rejects.toThrow(ServiceUnavailableException);
  });

  it("uploadFile rechaza llamadas si no se proporciona un buffer", async () => {
    await expect(service.uploadFile({} as Express.Multer.File)).rejects.toThrow(
      BadRequestException,
    );
  });
});
