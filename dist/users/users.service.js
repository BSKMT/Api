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
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.UsersService = void 0;
const common_1 = require("@nestjs/common");
const mongoose_1 = require("@nestjs/mongoose");
const mongoose_2 = require("mongoose");
const bcrypt = __importStar(require("bcrypt"));
const config_1 = require("@nestjs/config");
const user_schema_1 = require("./schemas/user.schema");
let UsersService = class UsersService {
    userModel;
    configService;
    constructor(userModel, configService) {
        this.userModel = userModel;
        this.configService = configService;
    }
    async findByEmail(email) {
        return this.userModel.findOne({ email: email.toLowerCase() }).lean();
    }
    async findById(id) {
        return this.userModel.findById(id).lean();
    }
    async create(dto) {
        const existing = await this.findByEmail(dto.email);
        if (existing) {
            throw new common_1.ConflictException('El correo electronico ya esta registrado');
        }
        const saltRounds = this.configService.get('bcryptSaltRounds', {
            infer: true,
        });
        const passwordHash = await bcrypt.hash(dto.password, saltRounds);
        const created = new this.userModel({
            email: dto.email.toLowerCase(),
            password: passwordHash,
            membershipLevel: 'Friend',
            role: 'user',
            profileCompleted: false,
            completedSections: [],
            profile: {},
        });
        return created.save();
    }
    async updateRefreshTokenHash(userId, refreshTokenHash) {
        await this.userModel.updateOne({ _id: userId }, { refreshTokenHash });
    }
    async updateProfileSection(userId, sectionId, sectionData) {
        const user = await this.userModel.findById(userId);
        if (!user) {
            throw new common_1.NotFoundException('Usuario no encontrado');
        }
        const profile = user.profile ?? {};
        profile[sectionId] = sectionData;
        const completedSections = [...(user.completedSections ?? [])];
        if (!completedSections.includes(sectionId)) {
            completedSections.push(sectionId);
        }
        const profileCompleted = user_schema_1.REQUIRED_PROFILE_SECTIONS.every((s) => completedSections.includes(s));
        user.profile = profile;
        user.completedSections = completedSections;
        user.profileCompleted = profileCompleted;
        return user.save();
    }
    async deleteProfileSection(userId, sectionId) {
        const user = await this.userModel.findById(userId);
        if (!user) {
            throw new common_1.NotFoundException('Usuario no encontrado');
        }
        const profile = user.profile ?? {};
        profile[sectionId] = {};
        const completedSections = (user.completedSections ?? []).filter((s) => s !== sectionId);
        const profileCompleted = user_schema_1.REQUIRED_PROFILE_SECTIONS.every((s) => completedSections.includes(s));
        user.profile = profile;
        user.completedSections = completedSections;
        user.profileCompleted = profileCompleted;
        return user.save();
    }
};
exports.UsersService = UsersService;
exports.UsersService = UsersService = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, mongoose_1.InjectModel)(user_schema_1.User.name)),
    __metadata("design:paramtypes", [mongoose_2.Model,
        config_1.ConfigService])
], UsersService);
//# sourceMappingURL=users.service.js.map