"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuthController = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const auth_service_1 = require("./auth.service");
const local_auth_guard_1 = require("./guards/local-auth.guard");
const jwt_auth_guard_1 = require("./guards/jwt-auth.guard");
const register_dto_1 = require("./dto/register.dto");
const users_service_1 = require("../users/users.service");
let AuthController = class AuthController {
    authService;
    configService;
    usersService;
    constructor(authService, configService, usersService) {
        this.authService = authService;
        this.configService = configService;
        this.usersService = usersService;
    }
    async login(req, res) {
        const user = req.user;
        const tokens = await this.authService.login(user);
        this.setTokenCookies(res, tokens.accessToken, tokens.refreshToken);
        return { user: tokens.user };
    }
    async register(dto, res) {
        const tokens = await this.authService.register(dto);
        this.setTokenCookies(res, tokens.accessToken, tokens.refreshToken);
        return { user: tokens.user };
    }
    async refresh(req, res) {
        const user = req.user;
        if (!user)
            throw new Error('Not authenticated');
        const refreshToken = req.cookies?.['refresh_token'];
        if (!refreshToken) {
            throw new Error('No refresh token');
        }
        const tokens = await this.authService.refreshTokens(user.userId, refreshToken);
        this.setTokenCookies(res, tokens.accessToken, tokens.refreshToken);
        return { user: tokens.user };
    }
    async logout(req, res) {
        const user = req.user;
        await this.authService.logout(user.userId);
        this.clearTokenCookies(res);
    }
    async me(req) {
        const user = req.user;
        const fullUser = await this.usersService.findById(user.userId);
        return {
            userId: user.userId,
            email: user.email,
            profileCompleted: fullUser?.profileCompleted ?? false,
            membershipLevel: fullUser?.membershipLevel ?? 'Friend',
            role: fullUser?.role ?? 'user',
            completedSections: fullUser?.completedSections ?? [],
        };
    }
    setTokenCookies(res, accessToken, refreshToken) {
        const domain = this.configService.get('cookieDomain', { infer: true });
        const secure = this.configService.get('cookieSecure', { infer: true });
        res.cookie('access_token', accessToken, {
            httpOnly: true,
            secure,
            sameSite: 'lax',
            domain,
            path: '/',
            maxAge: 15 * 60 * 1000,
        });
        res.cookie('refresh_token', refreshToken, {
            httpOnly: true,
            secure,
            sameSite: 'lax',
            domain,
            path: '/api/auth/refresh',
            maxAge: 7 * 24 * 60 * 60 * 1000,
        });
    }
    clearTokenCookies(res) {
        const domain = this.configService.get('cookieDomain', { infer: true });
        const secure = this.configService.get('cookieSecure', { infer: true });
        res.cookie('access_token', '', {
            httpOnly: true,
            secure,
            sameSite: 'lax',
            domain,
            path: '/',
            maxAge: 0,
        });
        res.cookie('refresh_token', '', {
            httpOnly: true,
            secure,
            sameSite: 'lax',
            domain,
            path: '/api/auth/refresh',
            maxAge: 0,
        });
    }
};
exports.AuthController = AuthController;
__decorate([
    (0, common_1.UseGuards)(local_auth_guard_1.LocalAuthGuard),
    (0, common_1.Post)('login'),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)({ passthrough: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "login", null);
__decorate([
    (0, common_1.Post)('register'),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_1.Res)({ passthrough: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [register_dto_1.RegisterDto, Object]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "register", null);
__decorate([
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    (0, common_1.Post)('refresh'),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)({ passthrough: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "refresh", null);
__decorate([
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    (0, common_1.Post)('logout'),
    (0, common_1.HttpCode)(common_1.HttpStatus.NO_CONTENT),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)({ passthrough: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "logout", null);
__decorate([
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    (0, common_1.Get)('me'),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "me", null);
exports.AuthController = AuthController = __decorate([
    (0, common_1.Controller)('auth'),
    __metadata("design:paramtypes", [auth_service_1.AuthService,
        config_1.ConfigService,
        users_service_1.UsersService])
], AuthController);
//# sourceMappingURL=auth.controller.js.map