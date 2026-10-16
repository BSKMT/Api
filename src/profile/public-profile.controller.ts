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
import { SendFriendRequestDto } from "./public-profile.dto";
import { deriveDisplayName, privacyFlag, str } from "./public-profile.helpers";
import { isSerializedProfileToken } from "./profile-token.helper";
import {
  AuthenticatedRequestUser,
  validateRequesterAccess,
  validateAntiIdorAccess,
  findUserByIdentifierHelper,
  buildPublicProfileResponse,
} from "./public-profile-access.helpers";

export { SendFriendRequestDto };

@Controller("profile")
export class PublicProfileController {
  constructor(private readonly usersService: UsersService) {}

  @Get("public/:identifier")
  @UseGuards(SessionGuard)
  @Throttle({ default: { ttl: 10000, limit: 20 } })
  async getPublicProfile(
    @Param("identifier") identifier: string,
    @Req() req: Request & { user?: AuthenticatedRequestUser },
  ) {
    const requester = req.user;
    const { isStaff } = await validateRequesterAccess(
      requester,
      this.usersService,
    );

    const isSerialized = isSerializedProfileToken(identifier);
    const user = await findUserByIdentifierHelper(
      identifier,
      this.usersService,
    );
    if (!user) {
      throw new NotFoundException("Perfil no encontrado o token inválido");
    }

    const isOwner =
      String(user._id) === requester!.userId ||
      user.betterAuthId === requester!.betterAuthId;

    validateAntiIdorAccess(
      isSerialized,
      isStaff,
      isOwner,
      user.profileCompleted ?? false,
    );

    return buildPublicProfileResponse(user, requester!, isOwner);
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
