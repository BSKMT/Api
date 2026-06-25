import {
  Controller,
  Post,
  Get,
  Body,
  Req,
  Res,
  UseGuards,
  HttpCode,
  HttpStatus,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Request, Response } from "express";
import { AuthService } from "./auth.service";
import { LocalAuthGuard } from "./guards/local-auth.guard";
import { JwtAuthGuard } from "./guards/jwt-auth.guard";
import { RegisterDto } from "./dto/register.dto";
import { UsersService } from "../users/users.service";
import { CsrfService } from "../csrf/csrf.service";
import { Public } from "../common/decorators";
import type { EnvironmentConfig } from "../config/config.interface";

@Controller("auth")
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService<EnvironmentConfig>,
    private readonly usersService: UsersService,
    private readonly csrfService: CsrfService,
  ) {}

  @Public()
  @UseGuards(LocalAuthGuard)
  @Post("login")
  @HttpCode(HttpStatus.OK)
  async login(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const { userId, email } = req.user as { userId: string; email: string };
    const tokens = await this.authService.generateTokensAndSave(userId, email);
    this.setTokenCookies(res, tokens.accessToken, tokens.refreshToken);
    this.setCsrfCookie(res);
    return { user: tokens.user };
  }

  @Public()
  @Post("register")
  async register(
    @Body() dto: RegisterDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const tokens = await this.authService.register(dto);
    this.setTokenCookies(res, tokens.accessToken, tokens.refreshToken);
    this.setCsrfCookie(res);
    return { user: tokens.user };
  }

  @UseGuards(JwtAuthGuard)
  @Post("refresh")
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const user = req.user as { userId: string; email: string } | undefined;
    if (!user) throw new TypeError("Not authenticated");
    const refreshToken = (req.cookies as Record<string, unknown>)
      ?.refresh_token;
    if (typeof refreshToken !== "string") {
      throw new TypeError("No refresh token");
    }
    const tokens = await this.authService.refreshTokens(
      user.userId,
      refreshToken,
    );
    this.setTokenCookies(res, tokens.accessToken, tokens.refreshToken);
    this.setCsrfCookie(res);
    return { user: tokens.user };
  }

  @UseGuards(JwtAuthGuard)
  @Post("logout")
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const user = req.user as { userId: string };
    await this.authService.logout(user.userId);
    this.clearTokenCookies(res);
  }

  @UseGuards(JwtAuthGuard)
  @Get("me")
  async me(@Req() req: Request) {
    const user = req.user as { userId: string; email: string };
    const fullUser = await this.usersService.findById(user.userId);
    return {
      userId: user.userId,
      email: user.email,
      profileCompleted: fullUser?.profileCompleted ?? false,
      membershipLevel: fullUser?.membershipLevel ?? null,
      membershipExpired: fullUser?.membershipExpired ?? true,
      membershipExpiryDate: fullUser?.membershipExpiryDate ?? null,
      membershipStartDate: fullUser?.membershipStartDate ?? null,
      membershipPaymentPlan: fullUser?.membershipPaymentPlan ?? null,
      role: fullUser?.role ?? "user",
      completedSections: fullUser?.completedSections ?? [],
    };
  }

  private setCsrfCookie(res: Response) {
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
  }

  private setTokenCookies(
    res: Response,
    accessToken: string,
    refreshToken: string,
  ) {
    const domain =
      this.configService.get<string>("COOKIE_DOMAIN", { infer: true }) ?? "";
    const secure = Boolean(
      this.configService.get<boolean>("COOKIE_SECURE") ?? true,
    );

    res.cookie("access_token", accessToken, {
      httpOnly: true,
      secure,
      sameSite: "lax",
      domain,
      path: "/",
      maxAge: 15 * 60 * 1000,
    });

    res.cookie("refresh_token", refreshToken, {
      httpOnly: true,
      secure,
      sameSite: "lax",
      domain,
      path: "/api/auth/refresh",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });
  }

  private clearTokenCookies(res: Response) {
    const domain =
      this.configService.get<string>("COOKIE_DOMAIN", { infer: true }) ?? "";
    const secure = Boolean(
      this.configService.get<boolean>("COOKIE_SECURE") ?? true,
    );

    res.cookie("access_token", "", {
      httpOnly: true,
      secure,
      sameSite: "lax",
      domain,
      path: "/",
      maxAge: 0,
    });

    res.cookie("refresh_token", "", {
      httpOnly: true,
      secure,
      sameSite: "lax",
      domain,
      path: "/api/auth/refresh",
      maxAge: 0,
    });

    res.cookie("csrf_token", "", {
      httpOnly: false,
      secure,
      sameSite: "lax",
      domain,
      path: "/",
      maxAge: 0,
    });
  }
}
