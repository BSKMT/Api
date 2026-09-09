import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Req,
  UseGuards,
  HttpCode,
  HttpStatus,
  ForbiddenException,
} from "@nestjs/common";
import type { Request } from "express";
import { SessionGuard } from "../../auth/session.guard";
import { GestionGuard } from "../../common/guards/gestion.guard";
import { RequireSubroles } from "../../common/decorators/subroles.decorator";
import { UserRole, UserSubrole } from "../../users/schemas/user.schema";
import {
  GestionArphaService,
  AssignArphaDto,
  UpdateGestorLocationDto,
  UpdateGestionStatusDto,
} from "../services/gestion-arpha.service";

interface AuthenticatedRequest extends Request {
  user: {
    userId: string;
    email?: string;
    role?: string;
    subrol?: string | null;
  };
}

@Controller("gestion/arpha")
@UseGuards(SessionGuard, GestionGuard)
@RequireSubroles(
  UserSubrole.LIDER_ARPHA,
  UserSubrole.GESTOR_CAMPO_ARPHA,
  UserSubrole.GESTOR_MESA_ARPHA,
)
export class GestionArphaController {
  constructor(private readonly gestionArphaService: GestionArphaService) {}

  @Get("requests")
  async listRequests(@Req() req: AuthenticatedRequest) {
    return this.gestionArphaService.listRequests(req.user);
  }

  @Get("gestores")
  async listGestores(@Req() req: AuthenticatedRequest) {
    const isLeaderOrAdmin =
      req.user.role === UserRole.ADMIN ||
      req.user.subrol === UserSubrole.LIDER_ARPHA;

    if (!isLeaderOrAdmin) {
      throw new ForbiddenException("Solo líderes o administradores pueden listar gestores");
    }
    return this.gestionArphaService.listAvailableGestores();
  }

  @Post("requests/:id/assign")
  @HttpCode(HttpStatus.OK)
  async assignRequest(
    @Param("id") id: string,
    @Body() dto: AssignArphaDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const isLeaderOrAdmin =
      req.user.role === UserRole.ADMIN ||
      req.user.subrol === UserSubrole.LIDER_ARPHA;

    if (!isLeaderOrAdmin) {
      throw new ForbiddenException("Solo líderes o administradores pueden asignar solicitudes");
    }
    return this.gestionArphaService.assignRequest(id, dto, req.user);
  }

  @Post("requests/:id/location")
  @HttpCode(HttpStatus.OK)
  async updateLocation(
    @Param("id") id: string,
    @Body() coords: UpdateGestorLocationDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.gestionArphaService.updateGestorLocation(id, coords, req.user);
  }

  @Post("requests/:id/status")
  @HttpCode(HttpStatus.OK)
  async updateStatus(
    @Param("id") id: string,
    @Body() dto: UpdateGestionStatusDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.gestionArphaService.updateStatus(id, dto, req.user);
  }
}
