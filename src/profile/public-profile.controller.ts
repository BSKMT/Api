import {
  Controller,
  Get,
  Param,
  NotFoundException,
  Req,
  Post,
  Body,
  BadRequestException,
  ForbiddenException,
  UnauthorizedException,
  UseGuards,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import type { Request } from "express";
import { UsersService } from "../users/users.service";
import { SessionGuard } from "../auth/session.guard";
import { SendFriendRequestDto } from "./public-profile.dto";
import {
  deriveDisplayName,
  privacyFlag,
  str,
  buildPrivacyFlags,
  buildOptionalSections,
  computeMembershipStatus,
  buildPrivilegedSection,
} from "./public-profile.helpers";
import {
  serializeProfileIdentifier,
  deserializeProfileIdentifier,
  buildSecureQrPayload,
  isSerializedProfileToken,
} from "./profile-token.helper";

export { SendFriendRequestDto };

interface AuthenticatedRequestUser {
  userId: string;
  email: string;
  role: string;
  subrol?: string | null;
  adminPermissions?: string[];
  betterAuthId: string;
}

@Controller("profile")
export class PublicProfileController {
  constructor(private readonly usersService: UsersService) {}

  private async findUserByIdentifier(
    identifier: string,
  ): Promise<Awaited<ReturnType<UsersService["findById"]>>> {
    if (!identifier || identifier.length > 512) {
      return null;
    }

    if (isSerializedProfileToken(identifier)) {
      const parsed = deserializeProfileIdentifier(identifier);
      if (!parsed) {
        return null;
      }
      if (parsed.memberNumber) {
        return this.usersService.findByMemberNumber(parsed.memberNumber);
      }
      if (parsed.userId) {
        return this.usersService.findById(parsed.userId);
      }
      return null;
    }

    const upper = identifier.toUpperCase();
    if (upper.startsWith("BSK-")) {
      return this.usersService.findByMemberNumber(upper);
    }
    if (/^[0-9a-fA-F]{24}$/.test(identifier)) {
      return this.usersService.findById(identifier);
    }
    return null;
  }

  /**
   * Consulta de perfil y credencial oficial de membresía BSK.
   *
   * POLÍTICA DE SEGURIDAD Y PROTECCIÓN DE DATOS:
   * - Acceso restringido exclusivamente a personas registradas y logueadas (SessionGuard obligatorio).
   * - Si un usuario común (miembro) consulta el perfil, ÚNICAMENTE recibe información pública:
   *   nombre de display, número de miembro, nivel y estado oficial de membresía (ACTIVO/VENCIDO),
   *   y secciones opcionales (moto/rutas) según los ajustes de privacidad del titular.
   * - CERO divulgación de datos privados (cédula, celular, dirección, contactos de emergencia, ARPHA).
   * - Si el consultante tiene rol de staff operativo (Gestor en Fascia, Administrador en Console,
   *   o Gerente Superadmin), se incluye un bloque `operationalData` estrictamente acotado a las
   *   funciones de su rol/subrol asignado (ej. Gestor de Eventos solo ve logística/asistencia;
   *   Gestor ARPHA solo ve atención de salud; Administrador ve gestión administrativa; Gerente ve 360°).
   */
  @Get("public/:identifier")
  @UseGuards(SessionGuard)
  @Throttle({ default: { ttl: 10000, limit: 20 } })
  async getPublicProfile(
    @Param("identifier") identifier: string,
    @Req() req: Request & { user?: AuthenticatedRequestUser },
  ) {
    const requester = req.user;
    if (!requester || !requester.userId) {
      throw new UnauthorizedException(
        "Acceso restringido: Debes estar registrado e iniciar sesión en BSK para consultar perfiles de la comunidad.",
      );
    }

    // Verificar si el consultante es staff o usuario común
    const requesterRole = (requester.role || "").toLowerCase();
    const isStaff =
      requesterRole === "superadmin" ||
      requesterRole === "admin" ||
      requesterRole === "gestor" ||
      requesterRole === "road-captain" ||
      requesterRole === "event-manager" ||
      Boolean(requester.subrol);

    // Un usuario común debe tener su propio perfil completo antes de poder consultar a otros miembros
    if (!isStaff) {
      const requesterDoc = await this.usersService.findById(requester.userId);
      if (requesterDoc && !requesterDoc.profileCompleted) {
        throw new ForbiddenException(
          "Debes completar tu propio perfil y aceptar las políticas de tratamiento de datos antes de consultar perfiles de la comunidad.",
        );
      }
    }

    const isSerialized = isSerializedProfileToken(identifier);
    const user = await this.findUserByIdentifier(identifier);
    if (!user) {
      throw new NotFoundException("Perfil no encontrado o token inválido");
    }

    const isOwner =
      String(user._id) === requester.userId ||
      user.betterAuthId === requester.betterAuthId;

    // Prevención de ataques de enumeración secuencial (Anti-IDOR):
    // Si la consulta NO usó un token serializado seguro, y el consultante NO es staff operativo ni el dueño del perfil,
    // se deniega el acceso para evitar scraping de perfiles mediante números correlativos (ej. BSK-10023 -> BSK-10024).
    if (!isSerialized && !isStaff && !isOwner) {
      throw new ForbiddenException(
        "Acceso restringido: Para proteger la privacidad y prevenir ataques de enumeración de miembros, debes usar el enlace seguro serializado o escanear el carnet oficial con la cámara.",
      );
    }

    if (!user.profileCompleted && !isStaff && !isOwner) {
      throw new NotFoundException(
        "Perfil no disponible: El miembro aún no ha completado su registro oficial.",
      );
    }

    const membershipInfo = computeMembershipStatus(user);
    const privacy = buildPrivacyFlags(user);
    const profile = user.profile ?? {};
    const displayName = deriveDisplayName(profile, user.email);
    const membSection = profile["membresia-ecosistema"] ?? {};
    const memberNumber = str(membSection, "numeroMiembro");
    const personalSection = profile["datos-personales"];

    const serializedProfileToken = memberNumber
      ? serializeProfileIdentifier(memberNumber, String(user._id))
      : null;
    const secureQrPayload = serializedProfileToken
      ? buildSecureQrPayload(serializedProfileToken)
      : null;

    // Proyectar información privilegiada según el rol asignado
    const operationalData = isOwner
      ? null
      : buildPrivilegedSection(
          user as unknown as Record<string, unknown>,
          requester,
        );

    const response: Record<string, unknown> = {
      displayName,
      firstName: personalSection?.primerNombre ?? displayName,
      memberNumber,
      serializedProfileToken,
      secureQrPayload,
      membershipLevel: user.membershipLevel ?? null,
      membershipStatus: membershipInfo.status,
      isMembershipValid: membershipInfo.isValid,
      membershipExpiryFormatted: membershipInfo.expiryFormatted,
      role: isOwner ? user.role : null,
      memberSince: (user as unknown as { createdAt?: Date }).createdAt
        ? new Date(
            (user as unknown as { createdAt?: Date }).createdAt!,
          ).toISOString()
        : null,
      profileCompleted: user.profileCompleted,
      isOwner,
      privacy,
      isProfilePrivate: !privacy.profileVisible,
      ...buildOptionalSections(profile, privacy, isOwner),
      ...(operationalData ? { operationalData } : {}),
    };

    return response;
  }

  @Post("friend-request")
  @UseGuards(SessionGuard)
  @Throttle({ default: { ttl: 60000, limit: 5 } })
  async sendFriendRequest(
    @Req() req: Request & { user: { userId: string } },
    @Body() body: SendFriendRequestDto,
  ) {
    const { targetMemberNumber, message } = body;

    if (!targetMemberNumber || typeof targetMemberNumber !== "string") {
      throw new BadRequestException("targetMemberNumber es requerido");
    }

    if (message && message.length > 500) {
      throw new BadRequestException(
        "El mensaje no puede exceder 500 caracteres",
      );
    }

    const target = await this.usersService.findByMemberNumber(
      targetMemberNumber.toUpperCase(),
    );
    if (!target) {
      throw new NotFoundException("Usuario no encontrado");
    }

    if (String(target._id) === req.user.userId) {
      throw new BadRequestException(
        "No puedes enviarte una solicitud a ti mismo",
      );
    }

    const allowFriendRequests = privacyFlag(
      target as unknown as Record<string, unknown>,
      "allowFriendRequests",
      false,
    );

    if (!allowFriendRequests) {
      throw new ForbiddenException(
        "Este miembro no acepta solicitudes de amistad",
      );
    }

    const existingRequests = target.friendRequests ?? [];
    const pendingRequests = existingRequests.filter(
      (r) => r.status === "pending",
    );
    if (pendingRequests.length >= 30) {
      throw new BadRequestException(
        "Este miembro ha alcanzado el límite de solicitudes pendientes.",
      );
    }

    const alreadyRequested = pendingRequests.some(
      (r) => r.fromUserId === req.user.userId,
    );
    if (alreadyRequested) {
      throw new BadRequestException(
        "Ya tienes una solicitud pendiente con este miembro",
      );
    }

    const sender = await this.usersService.findById(req.user.userId);
    if (!sender) {
      throw new NotFoundException("Remitente no encontrado");
    }

    const senderDisplayName = deriveDisplayName(
      sender.profile ?? {},
      sender.email,
    );
    const senderMemb = sender.profile?.["membresia-ecosistema"] ?? {};
    const senderMemberNumber = str(senderMemb, "numeroMiembro");

    const cleanMessage = message ? message.trim().slice(0, 500) : null;

    const newRequest = {
      fromUserId: req.user.userId,
      fromMemberNumber: senderMemberNumber,
      fromDisplayName: senderDisplayName,
      message: cleanMessage,
      status: "pending" as const,
      createdAt: new Date(),
    };

    await this.usersService.addFriendRequest(String(target._id), newRequest);

    return { message: "Solicitud de amistad enviada" };
  }
}
