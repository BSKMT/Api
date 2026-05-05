import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import type { StringValue } from 'ms';
import { UsersService } from '../users/users.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import type { EnvironmentConfig } from '../config/config.interface';

@Injectable()
export class AuthService {
  constructor(
    private usersService: UsersService,
    private jwtService: JwtService,
    private configService: ConfigService<EnvironmentConfig>,
  ) {}

  async validateUser(
    email: string,
    password: string,
  ): Promise<{ userId: string; email: string } | null> {
    const user = await this.usersService.findByEmail(email);
    if (!user || !user.password || !password) return null;

    let isValid: boolean;
    try {
      isValid = await bcrypt.compare(password, user.password);
    } catch {
      return null;
    }
    if (!isValid) return null;

    if (!user.isActive) return null;

    return { userId: String(user._id), email: user.email };
  }

  async generateTokensAndSave(userId: string, email: string) {
    const { accessToken, refreshToken } = await this.generateTokens(
      userId,
      email,
    );

    const saltRounds = this.configService.get<number>('BCRYPT_SALT_ROUNDS', 12)!;
    const refreshTokenHash = await bcrypt.hash(refreshToken, saltRounds);
    await this.usersService.updateRefreshTokenHash(userId, refreshTokenHash);

    const fullUser = await this.usersService.findById(userId);

    return {
      accessToken,
      refreshToken,
      user: {
        email,
        userId,
        profileCompleted: fullUser?.profileCompleted ?? false,
        membershipLevel: fullUser?.membershipLevel ?? 'Friend',
        role: fullUser?.role ?? 'user',
      },
    };
  }

  async register(dto: RegisterDto) {
    if (dto.password !== dto.confirmPassword) {
      throw new BadRequestException(
        'La contrasena y la confirmacion no coinciden',
      );
    }

    const user = await this.usersService.create(dto);

    const { accessToken, refreshToken } = await this.generateTokens(
      String(user._id),
      user.email,
    );

    const saltRounds = this.configService.get<number>('BCRYPT_SALT_ROUNDS', 12)!;
    const refreshTokenHash = await bcrypt.hash(refreshToken, saltRounds);
    await this.usersService.updateRefreshTokenHash(
      String(user._id),
      refreshTokenHash,
    );

    return {
      accessToken,
      refreshToken,
      user: {
        email: user.email,
        userId: String(user._id),
        profileCompleted: false,
        membershipLevel: 'Friend',
        role: 'user',
      },
    };
  }

  async refreshTokens(userId: string, incomingRefreshToken: string) {
    const user = await this.usersService.findById(userId);
    if (!user || !user.refreshTokenHash) {
      throw new UnauthorizedException('Sesion invalida');
    }

    const matches = await bcrypt.compare(
      incomingRefreshToken,
      user.refreshTokenHash,
    );
    if (!matches) {
      await this.usersService.updateRefreshTokenHash(userId, null);
      throw new UnauthorizedException('Token de refresco invalido');
    }

    const { accessToken, refreshToken } = await this.generateTokens(
      userId,
      user.email,
    );

    const saltRounds = this.configService.get<number>('BCRYPT_SALT_ROUNDS', 12)!;
    const newHash = await bcrypt.hash(refreshToken, saltRounds);
    await this.usersService.updateRefreshTokenHash(userId, newHash);

    const fullUser = await this.usersService.findById(userId);

    return {
      accessToken,
      refreshToken,
      user: {
        email: user.email,
        userId,
        profileCompleted: fullUser?.profileCompleted ?? false,
        membershipLevel: fullUser?.membershipLevel ?? 'Friend',
        role: fullUser?.role ?? 'user',
      },
    };
  }

  async logout(userId: string) {
    await this.usersService.updateRefreshTokenHash(userId, null);
  }

  private async generateTokens(userId: string, email: string) {
    const jwtSecret = this.configService.get('JWT_SECRET', { infer: true })!;
    const jwtExpiration = this.configService.get('JWT_EXPIRATION', {
      infer: true,
    })!;
    const jwtRefreshSecret = this.configService.get('JWT_REFRESH_SECRET', {
      infer: true,
    })!;
    const jwtRefreshExpiration = this.configService.get(
      'JWT_REFRESH_EXPIRATION',
      { infer: true },
    )!;

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(
        { sub: userId, email },
        {
          secret: jwtSecret,
          expiresIn: jwtExpiration as StringValue,
          issuer: 'api.bskmt.com',
          audience: 'bskmt.com',
        },
      ),
      this.jwtService.signAsync(
        { sub: userId, email },
        {
          secret: jwtRefreshSecret,
          expiresIn: jwtRefreshExpiration as StringValue,
          issuer: 'api.bskmt.com',
          audience: 'bskmt.com',
        },
      ),
    ]);

    return { accessToken, refreshToken };
  }
}
