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
exports.PanelController = void 0;
const common_1 = require("@nestjs/common");
const jwt_auth_guard_1 = require("../auth/guards/jwt-auth.guard");
const users_service_1 = require("../users/users.service");
const MEMBERSHIP_DISCOUNT_MAP = {
    Friend: '5%',
    Rider: '10%',
    Expert: '25%',
    Master: '30%',
    Legend: '30%+',
};
const MEMBERSHIP_PRIORITY_MAP = {
    Friend: 'Estandar',
    Rider: 'Media',
    Expert: 'Alta',
    Master: 'Maxima',
    Legend: 'Honorifica',
};
let PanelController = class PanelController {
    usersService;
    constructor(usersService) {
        this.usersService = usersService;
    }
    async getPanel(req) {
        const user = req.user;
        const fullUser = await this.usersService.findById(user.userId);
        if (!fullUser) {
            return { user: null, metrics: [], session: {}, benefits: [] };
        }
        const profile = fullUser.profile ?? {};
        const completedSections = fullUser.completedSections ?? [];
        const level = fullUser.membershipLevel ?? 'Friend';
        const discount = MEMBERSHIP_DISCOUNT_MAP[level] ?? '5%';
        const priority = MEMBERSHIP_PRIORITY_MAP[level] ?? 'Estandar';
        const personalData = profile['datos-personales'] ?? {};
        const contactData = profile['contacto'] ?? {};
        const membershipData = profile['membresia-ecosistema'] ?? {};
        const displayName = personalData.primerNombre ||
            personalData.primerApellido ||
            fullUser.email.split('@')[0];
        const motorcycleCount = profile['motocicleta'] ? 1 : 0;
        const hasSecondMoto = profile['motocicleta']?.tieneMoto2 === 'Si';
        const totalMotos = motorcycleCount + (hasSecondMoto ? 1 : 0);
        const metrics = [
            {
                label: 'Rodadas completadas',
                value: String(membershipData.rodadasCompletadas ?? 0),
                icon: 'road',
            },
            {
                label: 'Beneficio en tienda',
                value: discount,
                icon: 'discount',
            },
            {
                label: 'Nivel actual',
                value: level,
                icon: 'crown',
            },
        ];
        const session = {
            accountStatus: fullUser.isActive ? 'Activa' : 'Inactiva',
            accountVerified: fullUser.emailVerified,
            supportPriority: priority,
            membershipLevel: level,
            profileCompleted: fullUser.profileCompleted,
            completedSectionsCount: completedSections.length,
            totalSections: 8,
        };
        const benefits = [
            {
                tier: 'Friend',
                value: '5%',
                detail: 'Acceso base y alertas tempranas de nuevos eventos.',
                accent: level === 'Friend' ? 'heat' : 'neutral',
                current: level === 'Friend',
            },
            {
                tier: 'Rider',
                value: '10%',
                detail: 'Preventa parcial de tienda y cupos priorizados.',
                accent: level === 'Rider' ? 'hud' : 'neutral',
                current: level === 'Rider',
            },
            {
                tier: 'Expert',
                value: '25%',
                detail: 'Ventana premium en drops y soporte de alta prioridad.',
                accent: level === 'Expert' ? 'heat' : 'neutral',
                current: level === 'Expert',
            },
            {
                tier: 'Master',
                value: '30%',
                detail: 'Maximo beneficio y acceso extendido a experiencias VIP.',
                accent: level === 'Master' ? 'heat' : 'neutral',
                current: level === 'Master',
            },
            {
                tier: 'Legend',
                value: '30%+',
                detail: 'Membresia honorifica: beneficios perpetuos y reconocimiento historico.',
                accent: level === 'Legend' ? 'hud' : 'neutral',
                current: level === 'Legend',
            },
        ];
        const shortcuts = [
            { label: 'Mi Perfil', href: '/mi-perfil', icon: 'dashboard' },
            { label: 'Ver Rodadas VIP', href: '/rodadas-vip', icon: 'calendar' },
            { label: 'Abrir Tienda BSK', href: '/tienda-bsk', icon: 'store' },
        ];
        const modules = [
            {
                title: 'Ruta y agenda',
                status: 'Activo',
                icon: 'road',
                summary: 'Consulta rodadas, confirma asistencia y visualiza requisitos por evento.',
                bullets: ['Calendario por semana', 'Confirmacion de cupos', 'Checklist previo por salida'],
            },
            {
                title: 'Beneficios y tienda',
                status: 'Activo',
                icon: 'store',
                summary: `Descuento actual: ${discount} en tienda BSK y acceso a drops con prioridad ${priority}.`,
                bullets: [`Beneficio ${discount}`, 'Historial de uso', 'Alertas de preventa'],
            },
            {
                title: 'Seguridad y soporte',
                status: Object.keys(profile['salud-seguridad'] ?? {}).length > 0 ? 'Activo' : 'Sincronizando',
                icon: 'shield',
                summary: 'Gestiona datos de emergencia y flujo rapido de soporte en ruta.',
                bullets: [
                    Object.keys(profile['salud-seguridad'] ?? {}).length > 0 ? 'Perfil medico completo' : 'Perfil medico pendiente',
                    Object.keys(contactData).length > 0 && contactData.contactoEmergenciaTelefono ? 'Contacto SOS configurado' : 'Contacto SOS pendiente',
                    `Soporte ${priority}`,
                ],
            },
            {
                title: 'Progreso del piloto',
                status: membershipData.rodadasCompletadas ? 'Activo' : 'Proximo',
                icon: 'bolt',
                summary: 'Seguimiento de objetivos tecnicos y avance por temporada.',
                bullets: [
                    `${membershipData.rodadasCompletadas ?? 0} rodadas`,
                    `${membershipData.cursosCompletados ?? 0} cursos`,
                    `${completedSections.length}/8 secciones de perfil`,
                ],
            },
        ];
        return {
            user: {
                userId: String(fullUser._id),
                email: fullUser.email,
                displayName,
                membershipLevel: level,
                role: fullUser.role,
                profileCompleted: fullUser.profileCompleted,
            },
            metrics,
            session,
            benefits,
            shortcuts,
            modules,
            profile: {
                personal: personalData,
                contact: contactData,
                motorcycle: profile['motocicleta'] ?? {},
                totalMotos,
            },
        };
    }
};
exports.PanelController = PanelController;
__decorate([
    (0, common_1.Get)(),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], PanelController.prototype, "getPanel", null);
exports.PanelController = PanelController = __decorate([
    (0, common_1.Controller)('panel'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    __metadata("design:paramtypes", [users_service_1.UsersService])
], PanelController);
//# sourceMappingURL=panel.controller.js.map