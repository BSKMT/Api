import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { Request } from 'express';
import type { EnvironmentConfig } from '../../config/config.interface';

interface JwtPayload {
  sub: string;
  email: string;
  iat: number;
  exp: number;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(private configService: ConfigService<EnvironmentConfig>) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        (request: Request) => {
          return (
            (request?.cookies as Record<string, string> | undefined)?.[
              'access_token'
            ] ?? null
          );
        },
      ]),
      ignoreExpiration: false,
      secretOrKey: configService.get('jwtSecret', { infer: true })!,
      issuer: 'api.bskmt.com',
      audience: 'bskmt.com',
    });
  }

  validate(payload: JwtPayload) {
    if (!payload.sub || !payload.email) {
      throw new UnauthorizedException('Token invalido');
    }
    return { userId: payload.sub, email: payload.email };
  }
}
