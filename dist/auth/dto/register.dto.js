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
exports.RegisterDto = void 0;
const class_validator_1 = require("class-validator");
class RegisterDto {
    email;
    password;
    confirmPassword;
    acceptTerms;
    acceptPrivacy;
}
exports.RegisterDto = RegisterDto;
__decorate([
    (0, class_validator_1.IsEmail)({}, { message: 'Correo electronico invalido' }),
    __metadata("design:type", String)
], RegisterDto.prototype, "email", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MinLength)(8, { message: 'La contrasena debe tener al menos 8 caracteres' }),
    __metadata("design:type", String)
], RegisterDto.prototype, "password", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MinLength)(8, {
        message: 'La confirmacion de contrasena debe tener al menos 8 caracteres',
    }),
    __metadata("design:type", String)
], RegisterDto.prototype, "confirmPassword", void 0);
__decorate([
    (0, class_validator_1.IsBoolean)(),
    (0, class_validator_1.Equals)(true, { message: 'Debes aceptar los Terminos y Condiciones' }),
    __metadata("design:type", Boolean)
], RegisterDto.prototype, "acceptTerms", void 0);
__decorate([
    (0, class_validator_1.IsBoolean)(),
    (0, class_validator_1.Equals)(true, {
        message: 'Debes aceptar la Politica de Privacidad',
    }),
    __metadata("design:type", Boolean)
], RegisterDto.prototype, "acceptPrivacy", void 0);
//# sourceMappingURL=register.dto.js.map