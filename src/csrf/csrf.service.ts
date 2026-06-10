import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { randomBytes, createHmac, timingSafeEqual } from "crypto";
import type { EnvironmentConfig } from "../config/config.interface";

@Injectable()
export class CsrfService {
  private readonly secret: string;

  constructor(
    private readonly configService: ConfigService<EnvironmentConfig>,
  ) {
    this.secret =
      this.configService.get<string>("CSRF_SECRET", { infer: true }) ?? "";
  }

  generateToken(): string {
    const random = randomBytes(32).toString("hex");
    const timestamp = Date.now().toString(36);
    const payload = `${timestamp}.${random}`;
    const signature = createHmac("sha256", this.secret)
      .update(payload)
      .digest("hex");
    return `${payload}.${signature}`;
  }

  verifyToken(token: string): boolean {
    if (!token || typeof token !== "string") return false;

    const parts = token.split(".");
    if (parts.length !== 3) return false;

    const [timestamp, random, signature] = parts;
    const payload = `${timestamp}.${random}`;
    const expectedSignature = createHmac("sha256", this.secret)
      .update(payload)
      .digest("hex");

    const sigBuffer = Buffer.from(signature, "hex");
    const expectedBuffer = Buffer.from(expectedSignature, "hex");

    if (sigBuffer.length !== expectedBuffer.length) return false;

    return timingSafeEqual(sigBuffer, expectedBuffer);
  }
}
