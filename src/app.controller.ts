import { Controller, Get, Header, Res } from "@nestjs/common";
import { InjectConnection } from "@nestjs/mongoose";
import { Connection } from "mongoose";
import { ConfigService } from "@nestjs/config";
import { SkipThrottle } from "@nestjs/throttler";
import type { Response } from "express";
import { Public } from "./common/decorators";
import { issueCsrfCookie } from "./common/csrf/csrf-cookie.helper";
import type { EnvironmentConfig } from "./config/config.interface";

@Controller()
export class AppController {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    private readonly configService: ConfigService<EnvironmentConfig>,
  ) {}

  @Public()
  @Get("robots.txt")
  @Header("Content-Type", "text/plain")
  getRobots() {
    return "User-agent: *\nDisallow: /\n";
  }

  @Public()
  @Get()
  getRoot() {
    return {
      status: "ok",
      name: "BSKMT API",
      timestamp: new Date().toISOString(),
    };
  }

  @Public()
  @Get("api")
  getApiRoot() {
    return this.getRoot();
  }

  /**
   * Genera un token CSRF criptográfico y establece la cookie Double-Submit (NIST CSF 2.0 PR.PS-06).
   */
  @Public()
  @Get(["csrf-token", "api/csrf-token"])
  getCsrfToken(@Res({ passthrough: true }) res: Response) {
    const token = issueCsrfCookie(
      res,
      this.configService.get<string>("CSRF_SECRET", { infer: true }),
      this.configService.get<string>("BETTER_AUTH_SECRET", { infer: true }),
    );

    return { csrfToken: token };
  }

  @Public()
  @SkipThrottle()
  @Get("health")
  getHealth() {
    // Mongoose readyState: 0 = disconnected, 1 = connected, 2 = connecting, 3 = disconnecting
    const isDbConnected = Number(this.connection?.readyState) === 1;
    return {
      status: isDbConnected ? "ok" : "degraded",
      name: "BSKMT API",
      timestamp: new Date().toISOString(),
      database: isDbConnected ? "connected" : "disconnected",
    };
  }

  @Public()
  @Get(".well-known/assetlinks.json")
  getAssetLinks() {
    return [
      {
        relation: [
          "delegate_permission/common.handle_all_urls",
          "delegate_permission/common.get_login_creds",
        ],
        target: {
          namespace: "android_app",
          package_name: "com.bskmt.app",
          sha256_cert_fingerprints: [
            "5D:88:48:70:09:20:85:33:3F:28:1A:1A:0E:F2:27:47:E1:AA:73:D2:EA:B5:60:4C:2F:5D:7D:0C:B0:51:05:4B",
          ],
        },
      },
    ];
  }
}
