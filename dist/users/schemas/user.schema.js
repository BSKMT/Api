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
Object.defineProperty(exports, "__esModule", { value: true });
exports.REQUIRED_PROFILE_SECTIONS = exports.UserSchema = exports.User = void 0;
const mongoose_1 = require("@nestjs/mongoose");
const REQUIRED_PROFILE_SECTIONS = [
    'datos-personales',
    'contacto',
    'motocicleta',
    'salud-seguridad',
    'documentacion-legal',
    'membresia-ecosistema',
    'equipamiento',
    'experiencia-motera',
];
exports.REQUIRED_PROFILE_SECTIONS = REQUIRED_PROFILE_SECTIONS;
let User = class User {
    email;
    password;
    membershipLevel;
    role;
    profileCompleted;
    emailVerified;
    isActive;
    refreshTokenHash;
    profile;
    completedSections;
};
exports.User = User;
__decorate([
    (0, mongoose_1.Prop)({ required: true, unique: true, lowercase: true, trim: true }),
    __metadata("design:type", String)
], User.prototype, "email", void 0);
__decorate([
    (0, mongoose_1.Prop)({ required: true }),
    __metadata("design:type", String)
], User.prototype, "password", void 0);
__decorate([
    (0, mongoose_1.Prop)({ default: 'Friend' }),
    __metadata("design:type", String)
], User.prototype, "membershipLevel", void 0);
__decorate([
    (0, mongoose_1.Prop)({ default: 'user' }),
    __metadata("design:type", String)
], User.prototype, "role", void 0);
__decorate([
    (0, mongoose_1.Prop)({ default: false }),
    __metadata("design:type", Boolean)
], User.prototype, "profileCompleted", void 0);
__decorate([
    (0, mongoose_1.Prop)({ default: false }),
    __metadata("design:type", Boolean)
], User.prototype, "emailVerified", void 0);
__decorate([
    (0, mongoose_1.Prop)({ default: true }),
    __metadata("design:type", Boolean)
], User.prototype, "isActive", void 0);
__decorate([
    (0, mongoose_1.Prop)(),
    __metadata("design:type", String)
], User.prototype, "refreshTokenHash", void 0);
__decorate([
    (0, mongoose_1.Prop)({ type: Object, default: {} }),
    __metadata("design:type", Object)
], User.prototype, "profile", void 0);
__decorate([
    (0, mongoose_1.Prop)({ default: [] }),
    __metadata("design:type", Array)
], User.prototype, "completedSections", void 0);
exports.User = User = __decorate([
    (0, mongoose_1.Schema)({
        timestamps: true,
        collection: 'users',
    })
], User);
exports.UserSchema = mongoose_1.SchemaFactory.createForClass(User);
exports.UserSchema.index({ email: 1 }, { unique: true });
//# sourceMappingURL=user.schema.js.map