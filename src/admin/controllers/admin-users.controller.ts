import {
  Controller,
  Get,
  Patch,
  Put,
  Post,
  Body,
  Param,
  Query,
  Req,
  UseGuards,
  HttpCode,
  HttpStatus,
  BadRequestException,
  NotFoundException,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import type { Request } from "express";
import { IsOptional, IsString, ValidateIf } from "class-validator";
import { SessionGuard } from "../../auth/session.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { Roles, Role } from "../../common/decorators";
import { UsersService } from "../../users/users.service";
import { UserRole, UserSubrole } from "../../users/schemas/user.schema";
import { ParseObjectIdPipe } from "../../common/pipes/parse-object-id.pipe";
import { BirdContactService } from "../../bird/bird-contact.service";
import { ensureString } from "../../common/utils/sanitize-query.util";
import { parsePositiveInt } from "../../common/utils/pagination.util";

interface AuthenticatedAdminRequest extends Request {
  user: { userId: string; role: string };
}

export class UpdateSubrolDto {
  @IsOptional()
  @ValidateIf((_obj, val) => val !== null && val !== undefined)
  @IsString()
  subrol?: string | null;
}

@Controller("admin/users")
@UseGuards(SessionGuard, RolesGuard)
@Roles(Role.ADMIN)
export class AdminUsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly birdContactService?: BirdContactService,
  ) {}

  @Get()
  async listUsers(
    @Req() req: AuthenticatedAdminRequest,
    @Query("search") search?: unknown,
    @Query("role") role?: unknown,
    @Query("subrol") subrol?: unknown,
    @Query("limit") limit?: unknown,
    @Query("page") page?: unknown,
  ) {
    const isSuperAdmin =
      (req.user?.role || "").toLowerCase() === String(UserRole.SUPERADMIN);
    return this.usersService.listUsers({
      search: ensureString(search),
      role: ensureString(role),
      subrol: ensureString(subrol),
      limit: parsePositiveInt(limit, 20, 100),
      page: parsePositiveInt(page, 1, 10000),
      excludeSuperAdmin: !isSuperAdmin,
    });
  }

  @Post("sync-crm")
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60000, limit: 1 } })
  async syncAllToCrm() {
    if (!this.birdContactService) {
      throw new BadRequestException("Servicio de Bird CRM no disponible");
    }
    const result = await this.birdContactService.syncAllUsers();
    return {
      message: "Sincronización masiva con Bird CRM completada",
      ...result,
    };
  }

  @Post(":id/sync-crm")
  @HttpCode(HttpStatus.OK)
  async syncUserToCrm(@Param("id", ParseObjectIdPipe) id: string) {
    if (!this.birdContactService) {
      throw new BadRequestException("Servicio de Bird CRM no disponible");
    }
    const user = await this.usersService.findById(id);
    if (!user) {
      throw new NotFoundException("Usuario no encontrado");
    }
    const result = await this.birdContactService.syncUser(user);
    return {
      message: "Usuario sincronizado con Bird CRM exitosamente",
      ...result,
    };
  }

  @Patch(":id/subrol")
  @Put(":id/subrol")
  @Post(":id/subrol")
  @HttpCode(HttpStatus.OK)
  async updateSubrol(
    @Param("id", ParseObjectIdPipe) id: string,
    @Body() dto: UpdateSubrolDto,
  ) {
    const subrol = dto.subrol ?? null;
    if (
      subrol !== null &&
      !Object.values(UserSubrole).includes(subrol as UserSubrole)
    ) {
      throw new BadRequestException(
        `Subrol inválido. Opciones válidas: ${Object.values(UserSubrole).join(", ")} o null`,
      );
    }
    const updated = await this.usersService.updateSubrol(id, subrol);
    return {
      message: "Subrol actualizado exitosamente",
      user: {
        _id: updated._id,
        email: updated.email,
        role: updated.role,
        subrol: updated.subrol,
      },
    };
  }
}
