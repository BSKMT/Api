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
exports.ProfileController = void 0;
const common_1 = require("@nestjs/common");
const jwt_auth_guard_1 = require("../auth/guards/jwt-auth.guard");
const users_service_1 = require("../users/users.service");
const update_profile_section_dto_1 = require("./dto/update-profile-section.dto");
const delete_profile_section_dto_1 = require("./dto/delete-profile-section.dto");
let ProfileController = class ProfileController {
    usersService;
    constructor(usersService) {
        this.usersService = usersService;
    }
    async getProfile(req) {
        const user = req.user;
        const fullUser = await this.usersService.findById(user.userId);
        if (!fullUser)
            return { profile: {}, completedSections: [], profileCompleted: false };
        return {
            profile: fullUser.profile ?? {},
            completedSections: fullUser.completedSections ?? [],
            profileCompleted: fullUser.profileCompleted,
            membershipLevel: fullUser.membershipLevel,
            role: fullUser.role,
            email: fullUser.email,
        };
    }
    async updateSection(req, dto) {
        const user = req.user;
        const updated = await this.usersService.updateProfileSection(user.userId, dto.sectionId, dto.data);
        return {
            sectionId: dto.sectionId,
            completedSections: updated.completedSections,
            profileCompleted: updated.profileCompleted,
        };
    }
    async deleteSection(req, dto) {
        const user = req.user;
        const updated = await this.usersService.deleteProfileSection(user.userId, dto.sectionId);
        return {
            sectionId: dto.sectionId,
            completedSections: updated.completedSections,
            profileCompleted: updated.profileCompleted,
        };
    }
};
exports.ProfileController = ProfileController;
__decorate([
    (0, common_1.Get)(),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], ProfileController.prototype, "getProfile", null);
__decorate([
    (0, common_1.Put)(),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, update_profile_section_dto_1.UpdateProfileSectionDto]),
    __metadata("design:returntype", Promise)
], ProfileController.prototype, "updateSection", null);
__decorate([
    (0, common_1.Delete)(),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, delete_profile_section_dto_1.DeleteProfileSectionDto]),
    __metadata("design:returntype", Promise)
], ProfileController.prototype, "deleteSection", null);
exports.ProfileController = ProfileController = __decorate([
    (0, common_1.Controller)('profile'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    __metadata("design:paramtypes", [users_service_1.UsersService])
], ProfileController);
//# sourceMappingURL=profile.controller.js.map