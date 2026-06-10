import { Injectable, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy } from "passport-jwt";
import type { Request } from "express";
import type { EnvironmentConfig } from "../../config/config.interface";
import { UsersService } from "../../users/users.service";

interface JwtPayload {
  sub: string;
  email: string;
  iat: number;
  exp: number;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, "jwt") {
  constructor(
    private readonly configService: ConfigService<EnvironmentConfig>,
    private readonly usersService: UsersService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        (request: Request) => {
          return (
            (request?.cookies as Record<string, string>)?.access_token ?? null
          );
        },
      ]),
      ignoreExpiration: false,
      secretOrKey: configService.get("JWT_SECRET", { infer: true }) ?? "",
      issuer: "api.bskmt.com",
      audience: "bskmt.com",
    });
  }

  async validate(payload: JwtPayload) {
    if (!payload.sub || !payload.email) {
      throw new UnauthorizedException("Token invalido");
    }

    const user = await this.usersService.findById(payload.sub);
    const role = user?.role ?? "user";

    return { userId: payload.sub, email: payload.email, role };
  }
}
