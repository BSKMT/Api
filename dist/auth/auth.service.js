"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuthService = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const jwt_1 = require("@nestjs/jwt");
const bcrypt = __importStar(require("bcrypt"));
const users_service_1 = require("../users/users.service");
let AuthService = class AuthService {
    usersService;
    jwtService;
    configService;
    constructor(usersService, jwtService, configService) {
        this.usersService = usersService;
        this.jwtService = jwtService;
        this.configService = configService;
    }
    async validateUser(email, password) {
        const user = await this.usersService.findByEmail(email);
        if (!user)
            return null;
        const isValid = await bcrypt.compare(password, user.password);
        if (!isValid)
            return null;
        if (!user.isActive)
            return null;
        return { userId: String(user._id), email: user.email };
    }
    async login(dto) {
        const validated = await this.validateUser(dto.email, dto.password);
        if (!validated) {
            throw new common_1.UnauthorizedException('Credenciales invalidas');
        }
        const { accessToken, refreshToken } = await this.generateTokens(validated.userId, validated.email);
        const saltRounds = this.configService.get('bcryptSaltRounds', {
            infer: true,
        });
        const refreshTokenHash = await bcrypt.hash(refreshToken, saltRounds);
        await this.usersService.updateRefreshTokenHash(validated.userId, refreshTokenHash);
        const fullUser = await this.usersService.findById(validated.userId);
        return {
            accessToken,
            refreshToken,
            user: {
                email: validated.email,
                userId: validated.userId,
                profileCompleted: fullUser?.profileCompleted ?? false,
                membershipLevel: fullUser?.membershipLevel ?? 'Friend',
                role: fullUser?.role ?? 'user',
            },
        };
    }
    async register(dto) {
        if (dto.password !== dto.confirmPassword) {
            throw new common_1.BadRequestException('La contrasena y la confirmacion no coinciden');
        }
        const user = await this.usersService.create(dto);
        const { accessToken, refreshToken } = await this.generateTokens(String(user._id), user.email);
        const saltRounds = this.configService.get('bcryptSaltRounds', {
            infer: true,
        });
        const refreshTokenHash = await bcrypt.hash(refreshToken, saltRounds);
        await this.usersService.updateRefreshTokenHash(String(user._id), refreshTokenHash);
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
    async refreshTokens(userId, incomingRefreshToken) {
        const user = await this.usersService.findById(userId);
        if (!user || !user.refreshTokenHash) {
            throw new common_1.UnauthorizedException('Sesion invalida');
        }
        const matches = await bcrypt.compare(incomingRefreshToken, user.refreshTokenHash);
        if (!matches) {
            await this.usersService.updateRefreshTokenHash(userId, null);
            throw new common_1.UnauthorizedException('Token de refresco invalido');
        }
        const { accessToken, refreshToken } = await this.generateTokens(userId, user.email);
        const saltRounds = this.configService.get('bcryptSaltRounds', {
            infer: true,
        });
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
    async logout(userId) {
        await this.usersService.updateRefreshTokenHash(userId, null);
    }
    async generateTokens(userId, email) {
        const jwtSecret = this.configService.get('jwtSecret', { infer: true });
        const jwtExpiration = this.configService.get('jwtExpiration', {
            infer: true,
        });
        const jwtRefreshSecret = this.configService.get('jwtRefreshSecret', {
            infer: true,
        });
        const jwtRefreshExpiration = this.configService.get('jwtRefreshExpiration', { infer: true });
        const [accessToken, refreshToken] = await Promise.all([
            this.jwtService.signAsync({ sub: userId, email }, {
                secret: jwtSecret,
                expiresIn: jwtExpiration,
                issuer: 'api.bskmt.com',
                audience: 'bskmt.com',
            }),
            this.jwtService.signAsync({ sub: userId, email }, {
                secret: jwtRefreshSecret,
                expiresIn: jwtRefreshExpiration,
                issuer: 'api.bskmt.com',
                audience: 'bskmt.com',
            }),
        ]);
        return { accessToken, refreshToken };
    }
};
exports.AuthService = AuthService;
exports.AuthService = AuthService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [users_service_1.UsersService,
        jwt_1.JwtService,
        config_1.ConfigService])
], AuthService);
//# sourceMappingURL=auth.service.js.map