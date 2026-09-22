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
import type { Request } from "express";
import { UsersService } from "../users/users.service";
import { SessionGuard } from "../auth/session.guard";
import { Public } from "../common/decorators";
import { SendFriendRequestDto } from "./public-profile.dto";
import {
  getUserIdFromSession,
  deriveDisplayName,
  privacyFlag,
  str,
  buildPrivacyFlags,
  buildOptionalSections,
} from "./public-profile.helpers";

export { SendFriendRequestDto };

@Controller("profile")
export class PublicProfileController {
  constructor(private readonly usersService: UsersService) {}

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

  @Public()
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

    const requesterUserId = await getUserIdFromSession(req);
    const isOwner =
      requesterUserId !== null && requesterUserId === user.betterAuthId;

    const privacy = buildPrivacyFlags(user);
    if (!isOwner && !privacy.profileVisible) {
      throw new NotFoundException("Perfil no disponible");
    }

    const profile = user.profile ?? {};
    const displayName = deriveDisplayName(profile, user.email);
    const membSection = profile["membresia-ecosistema"] ?? {};
    const memberNumber = str(membSection, "numeroMiembro");
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
      ...buildOptionalSections(profile, privacy, isOwner),
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

    const senderDisplayName = deriveDisplayName(
      sender.profile ?? {},
      sender.email,
    );
    const senderMemb = sender.profile?.["membresia-ecosistema"] ?? {};
    const senderMemberNumber = str(senderMemb, "numeroMiembro");

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
