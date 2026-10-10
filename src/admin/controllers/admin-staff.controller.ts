import {
  Controller,
  Post,
  Get,
  Body,
  Req,
  UseGuards,
  HttpCode,
  HttpStatus,
} from "@nestjs/common";
import type { Request } from "express";
import { SessionGuard } from "../../auth/session.guard";
import { RolesGuard, SuperAdminGuard } from "../../common/guards";
import { Roles, Role } from "../../common/decorators";
import { ContractorManagementService } from "../services/contractor-management.service";
import {
  CreateCollaboratorDto,
  CreateAdministratorDto,
  CreateSuperAdminDto,
} from "../dto/contractor-management.dto";

interface AuthenticatedUserRequest extends Request {
  user: {
    userId: string;
    email: string;
    role: string;
    subrol?: string | null;
  };
}

@Controller("admin/staff")
export class AdminStaffController {
  constructor(
    private readonly contractorService: ContractorManagementService,
  ) {}

  /**
   * Registro de Colaborador de BSK Fascia (Operaciones / Contratistas).
   * Permitido para Administradores y Superadministradores.
   */
  @Post("collaborators")
  @UseGuards(SessionGuard, RolesGuard)
  @Roles(Role.ADMIN, Role.SUPERADMIN)
  @HttpCode(HttpStatus.CREATED)
  async createCollaborator(
    @Body() dto: CreateCollaboratorDto,
    @Req() req: AuthenticatedUserRequest,
  ) {
    return this.contractorService.createCollaborator(dto, req.user.userId);
  }

  /**
   * Lista todos los colaboradores/gestores de operaciones.
   */
  @Get("collaborators")
  @UseGuards(SessionGuard, RolesGuard)
  @Roles(Role.ADMIN, Role.SUPERADMIN)
  async listCollaborators() {
    return this.contractorService.listCollaborators();
  }

  /**
   * Registro de Administrador Ejecutivo para BSK Console.
   * EXCLUSIVO: Solo un Superadministrador puede crear administradores.
   */
  @Post("administrators")
  @UseGuards(SessionGuard, SuperAdminGuard)
  @HttpCode(HttpStatus.CREATED)
  async createAdministrator(
    @Body() dto: CreateAdministratorDto,
    @Req() req: AuthenticatedUserRequest,
  ) {
    return this.contractorService.createAdministrator(dto, req.user.userId);
  }

  /**
   * Lista todos los administradores ejecutivos.
   */
  @Get("administrators")
  @UseGuards(SessionGuard, RolesGuard)
  @Roles(Role.ADMIN, Role.SUPERADMIN)
  async listAdministrators() {
    return this.contractorService.listAdministrators();
  }

  /**
   * Registro de nuevo Superadministrador para BSK Superadmin (New-BSKMT).
   * EXCLUSIVO: Solo un Superadministrador puede registrar a otro Superadministrador.
   */
  @Post("superadmins")
  @UseGuards(SessionGuard, SuperAdminGuard)
  @HttpCode(HttpStatus.CREATED)
  async createSuperAdmin(
    @Body() dto: CreateSuperAdminDto,
    @Req() req: AuthenticatedUserRequest,
  ) {
    return this.contractorService.createSuperAdmin(dto, req.user.userId);
  }
}
