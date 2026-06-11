import { Controller, Get, Req, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { UsersService } from "../users/users.service";

const DEFAULT_MEMBERSHIP = "Membresia BSK Legacy";
const MEMBERSHIP_DISCOUNT = "20%";
const SUPPORT_PRIORITY = "Alta";
const LEGACY_MEMBERSHIPS = new Set([
  "Friend",
  "Rider",
  "Expert",
  "Master",
  "Legend",
]);

@Controller("panel")
@UseGuards(JwtAuthGuard)
export class PanelController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  async getPanel(@Req() req: Request) {
    const user = req.user as { userId: string; email: string };
    const fullUser = await this.usersService.findById(user.userId);

    if (!fullUser) {
      return { user: null, metrics: [], session: {}, benefits: [] };
    }

    const profile = fullUser.profile ?? {};
    const completedSections = fullUser.completedSections ?? [];
    const rawLevel = fullUser.membershipLevel ?? DEFAULT_MEMBERSHIP;
    const level = LEGACY_MEMBERSHIPS.has(rawLevel)
      ? DEFAULT_MEMBERSHIP
      : rawLevel;
    const discount = MEMBERSHIP_DISCOUNT;
    const priority = SUPPORT_PRIORITY;

    const personalData = profile["datos-personales"] ?? {};
    const contactData = profile["contacto"] ?? {};
    const membershipData = profile["membresia-ecosistema"] ?? {};

    const displayName =
      (personalData.primerNombre as string) ||
      (personalData.primerApellido as string) ||
      fullUser.email.split("@")[0];

    const motorcycleCount = profile["motocicleta"] ? 1 : 0;
    const hasSecondMoto =
      (profile["motocicleta"]?.tieneMoto2 as string) === "Si";
    const totalMotos = motorcycleCount + (hasSecondMoto ? 1 : 0);
    const completedRides = Number(membershipData.rodadasCompletadas ?? 0);
    const completedCourses = Number(membershipData.cursosCompletados ?? 0);

    const metrics = [
      {
        label: "Rodadas completadas",
        value: String(completedRides),
        icon: "road",
      },
      {
        label: "Beneficio en tienda",
        value: discount,
        icon: "discount",
      },
      {
        label: "Nivel actual",
        value: level,
        icon: "crown",
      },
    ];

    const session = {
      accountStatus: fullUser.isActive ? "Activa" : "Inactiva",
      accountVerified: fullUser.emailVerified,
      supportPriority: priority,
      membershipLevel: level,
      profileCompleted: fullUser.profileCompleted,
      completedSectionsCount: completedSections.length,
      totalSections: 7,
    };

    const benefits = [
      {
        tier: DEFAULT_MEMBERSHIP,
        value: MEMBERSHIP_DISCOUNT,
        detail: "Acceso total al ecosistema, preventa y soporte prioritario.",
        accent: "heat",
        current: true,
      },
    ];

    const shortcuts = [
      { label: "Mi Perfil", href: "/mi-perfil", icon: "dashboard" },
      { label: "Ver Rodadas VIP", href: "/rodadas-vip", icon: "calendar" },
      { label: "Abrir Tienda BSK", href: "/tienda-bsk", icon: "store" },
    ];

    const modules = [
      {
        title: "Ruta y agenda",
        status: "Activo",
        icon: "road",
        summary:
          "Consulta rodadas, confirma asistencia y visualiza requisitos por evento.",
        bullets: [
          "Calendario por semana",
          "Confirmacion de cupos",
          "Checklist previo por salida",
        ],
      },
      {
        title: "Beneficios y tienda",
        status: "Activo",
        icon: "store",
        summary: `Descuento actual: ${discount} en tienda BSK y acceso a drops con prioridad ${priority}.`,
        bullets: [
          `Beneficio ${discount}`,
          "Historial de uso",
          "Alertas de preventa",
        ],
      },
      {
        title: "Seguridad y soporte",
        status:
          Object.keys(profile["salud-seguridad"] ?? {}).length > 0
            ? "Activo"
            : "Sincronizando",
        icon: "shield",
        summary:
          "Gestiona datos de emergencia y flujo rapido de soporte en ruta.",
        bullets: [
          Object.keys(profile["salud-seguridad"] ?? {}).length > 0
            ? "Perfil medico completo"
            : "Perfil medico pendiente",
          Object.keys(contactData).length > 0 &&
          contactData.contactoEmergenciaTelefono
            ? "Contacto SOS configurado"
            : "Contacto SOS pendiente",
          `Soporte ${priority}`,
        ],
      },
      {
        title: "Progreso del piloto",
        status: completedRides > 0 ? "Activo" : "Proximo",
        icon: "bolt",
        summary: "Seguimiento de objetivos tecnicos y avance por temporada.",
        bullets: [
          `${completedRides} rodadas`,
          `${completedCourses} cursos`,
          `${completedSections.length}/7 secciones de perfil`,
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
        motorcycle: profile["motocicleta"] ?? {},
        totalMotos,
      },
    };
  }
}
