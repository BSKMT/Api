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
  UseGuards,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { IsString, IsOptional, MaxLength } from "class-validator";
import type { Request } from "express";
import { UsersService } from "../users/users.service";
import { SessionGuard } from "../auth/session.guard";
import { getAuth } from "../auth/better-auth";

export class SendFriendRequestDto {
  @IsString()
  targetMemberNumber!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  message?: string;
}

/**
 * Public profile controller — endpoints NOT behind SessionGuard.
 *
 * GET /api/profile/public/:identifier
 *   Returns a privacy-filtered profile for any registered user.
 *   `identifier` can be a member number (e.g. "BSK-0001") or a
 *   MongoDB _id. If the profile owner has `privacy.profileVisible`
 *   set to false, a 404 is returned (unless the requester is the
 *   owner, detected via optional session cookies).
 *
 * POST /api/profile/friend-request  (SessionGuard-protected)
 *   Sends a friend request to another user. The target must have
 *   `privacy.allowFriendRequests` enabled.
 */
@Controller("profile")
export class PublicProfileController {
  constructor(private readonly usersService: UsersService) {}

  /**
   * Extracts the userId from the Better Auth session cookie if present.
   * Returns null for unauthenticated requests — the endpoint is public.
   */
  private async getUserIdFromSession(req: Request): Promise<string | null> {
    const cookieHeader = req.headers.cookie ?? "";
    if (!cookieHeader) return null;
    if (!cookieHeader.includes("better-auth.session_token")) return null;
    try {
      const auth = await getAuth();
      const headers = new Headers();
      headers.set("cookie", cookieHeader);
      const session = await auth.api.getSession({ headers });
      return session?.user?.id ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Derives a display name from the profile's datos-personales section,
   * falling back to the email username or "Piloto".
   */
  private deriveDisplayName(
    profile: Record<string, Record<string, unknown>>,
    email: string,
  ): string {
    const personal = profile["datos-personales"] ?? {};
    const primerNombre = personal.primerNombre as string | undefined;
    const primerApellido = personal.primerApellido as string | undefined;
    if (primerNombre && primerApellido)
      return `${primerNombre} ${primerApellido}`;
    if (primerNombre) return primerNombre;
    if (primerApellido) return primerApellido;
    return email ? email.split("@")[0] : "Piloto";
  }

  /**
   * Reads a boolean privacy flag from the user's settings, defaulting
   * to the DEFAULT_SETTINGS values when not explicitly set.
   */
  private privacyFlag(
    user: Record<string, unknown>,
    key: string,
    fallback: boolean,
  ): boolean {
    const settings = user.settings as Record<string, unknown> | undefined;
    const privacy = settings?.privacy as Record<string, boolean> | undefined;
    if (privacy && typeof privacy[key] === "boolean") return privacy[key];
    return fallback;
  }

  /**
   * Safely extracts a string field from a profile section.
   */
  private str(
    section: Record<string, unknown> | undefined,
    field: string,
  ): string {
    const v = section?.[field];
    if (typeof v === "string") return v;
    if (typeof v === "number") return String(v);
    return "";
  }

  /**
   * Safely extracts a number field from a profile section.
   */
  private num(
    section: Record<string, unknown> | undefined,
    field: string,
  ): number | null {
    const v = section?.[field];
    return typeof v === "number" ? v : null;
  }

  private async findUserByIdentifier(
    identifier: string,
  ): Promise<Awaited<ReturnType<UsersService["findById"]>>> {
    if (!identifier || identifier.length > 64) {
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

  private buildPrivacyFlags(user: unknown) {
    const record = user as Record<string, unknown>;
    return {
      profileVisible: this.privacyFlag(record, "profileVisible", true),
      showLocation: this.privacyFlag(record, "showLocation", true),
      allowFriendRequests: this.privacyFlag(
        record,
        "allowFriendRequests",
        false,
      ),
      shareStats: this.privacyFlag(record, "shareStats", true),
      showMotorcycle: this.privacyFlag(record, "showMotorcycle", true),
    };
  }

  private buildOptionalSections(
    profile: Record<string, Record<string, unknown>>,
    privacy: ReturnType<PublicProfileController["buildPrivacyFlags"]>,
    isOwner: boolean,
  ): Record<string, unknown> {
    const sections: Record<string, unknown> = {};

    if (isOwner || privacy.showMotorcycle) {
      const moto = profile["motocicleta"];
      sections["motorcycle"] = moto
        ? {
            marcaMoto: this.str(moto, "marcaMoto"),
            lineaMoto: this.str(moto, "lineaMoto"),
            anioMoto: this.num(moto, "anioMoto"),
            cilindraje: this.num(moto, "cilindraje"),
            colorMoto: this.str(moto, "colorMoto"),
            tipoMoto: this.str(moto, "tipoMoto"),
          }
        : null;

      const equip = profile["equipamiento"];
      sections["equipment"] = equip
        ? {
            cascoMarca: this.str(equip, "cascoMarca"),
            cascoCertificacion: this.str(equip, "cascoCertificacion"),
            chaquetaTipo: this.str(equip, "chaquetaTipo"),
            pantalonTipo: this.str(equip, "pantalonTipo"),
            guantes: this.str(equip, "guantes"),
            botasTipo: this.str(equip, "botasTipo"),
            proteccionEspalda: this.str(equip, "proteccionEspalda"),
            airbagVest: this.str(equip, "airbagVest"),
            intercomunicador: this.str(equip, "intercomunicador"),
            camaraAccion: this.str(equip, "camaraAccion"),
          }
        : null;
    }

    if (isOwner || privacy.showLocation) {
      const contacto = profile["contacto"];
      sections["location"] = contacto
        ? {
            ciudad: this.str(contacto, "ciudad"),
            departamento: this.str(contacto, "departamento"),
          }
        : null;
    }

    if (isOwner || privacy.shareStats) {
      const exp = profile["experiencia-motera"];
      sections["stats"] = exp
        ? {
            anosExperiencia: this.num(exp, "anosExperiencia"),
            kilometrosMensuales: this.num(exp, "kilometrosMensuales"),
            tipoConduccionPreferido: this.str(exp, "tipoConduccionPreferido"),
            disponibilidadRodadas: this.str(exp, "disponibilidadRodadas"),
          }
        : null;
    }

    return sections;
  }

  @Get("public/:identifier")
  @Throttle({ default: { ttl: 10000, limit: 20 } })
  async getPublicProfile(
    @Param("identifier") identifier: string,
    @Req() req: Request,
  ) {
    const user = await this.findUserByIdentifier(identifier);
    if (!user) {
      throw new NotFoundException("Perfil no encontrado");
    }
    if (!user.profileCompleted) {
      throw new NotFoundException("Perfil no disponible");
    }

    const requesterUserId = await this.getUserIdFromSession(req);
    const isOwner =
      requesterUserId !== null && requesterUserId === user.betterAuthId;

    const privacy = this.buildPrivacyFlags(user);
    if (!isOwner && !privacy.profileVisible) {
      throw new NotFoundException("Perfil no disponible");
    }

    const profile = user.profile ?? {};
    const displayName = this.deriveDisplayName(profile, user.email);
    const membSection = profile["membresia-ecosistema"] ?? {};
    const memberNumber = this.str(membSection, "numeroMiembro");
    const personalSection = profile["datos-personales"];

    const response: Record<string, unknown> = {
      displayName,
      firstName: personalSection?.primerNombre ?? displayName,
      memberNumber,
      membershipLevel: user.membershipLevel ?? null,
      role: user.role,
      memberSince: (user as unknown as { createdAt?: Date }).createdAt
        ? new Date(
            (user as unknown as { createdAt?: Date }).createdAt!,
          ).toISOString()
        : null,
      profileCompleted: user.profileCompleted,
      isOwner,
      privacy,
      ...this.buildOptionalSections(profile, privacy, isOwner),
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

    const allowFriendRequests = this.privacyFlag(
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
    const alreadyRequested = existingRequests.some(
      (r) => r.fromUserId === req.user.userId && r.status === "pending",
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

    const senderDisplayName = this.deriveDisplayName(
      sender.profile ?? {},
      sender.email,
    );
    const senderMemb = sender.profile?.["membresia-ecosistema"] ?? {};
    const senderMemberNumber = this.str(senderMemb, "numeroMiembro");

    const newRequest = {
      fromUserId: req.user.userId,
      fromMemberNumber: senderMemberNumber,
      fromDisplayName: senderDisplayName,
      message: message ?? null,
      status: "pending" as const,
      createdAt: new Date(),
    };

    await this.usersService.addFriendRequest(String(target._id), newRequest);

    return { message: "Solicitud de amistad enviada" };
  }
}
