import { Controller, Get, Res } from "@nestjs/common";
import type { Response } from "express";
import { ConfigService } from "@nestjs/config";
import { CsrfService } from "./csrf.service";
import { Public } from "../common/decorators";
import type { EnvironmentConfig } from "../config/config.interface";

@Controller("csrf")
export class CsrfController {
  constructor(
    private readonly csrfService: CsrfService,
    private readonly configService: ConfigService<EnvironmentConfig>,
  ) {}

  @Public()
  @Get("token")
  getToken(@Res({ passthrough: true }) res: Response) {
    const token = this.csrfService.generateToken();
    const domain =
      this.configService.get<string>("COOKIE_DOMAIN", { infer: true }) ?? "";
    const secure = Boolean(
      this.configService.get<boolean>("COOKIE_SECURE") ?? true,
    );

    res.cookie("csrf_token", token, {
      httpOnly: false,
      secure,
      sameSite: "lax",
      domain,
      path: "/",
      maxAge: 24 * 60 * 60 * 1000,
    });

    return { csrfToken: token };
  }
}
