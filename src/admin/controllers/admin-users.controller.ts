import {
  Controller,
  Get,
  Patch,
  Put,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
  BadRequestException,
  NotFoundException,
} from "@nestjs/common";
import { IsOptional, IsString, ValidateIf } from "class-validator";
import { SessionGuard } from "../../auth/session.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { Roles, Role } from "../../common/decorators";
import { UsersService } from "../../users/users.service";
import { UserSubrole } from "../../users/schemas/user.schema";
import { ParseObjectIdPipe } from "../../common/pipes/parse-object-id.pipe";
import { BirdContactService } from "../../bird/bird-contact.service";

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
    @Query("search") search?: string,
    @Query("role") role?: string,
    @Query("subrol") subrol?: string,
    @Query("limit") limit?: string,
    @Query("page") page?: string,
  ) {
    return this.usersService.listUsers({
      search,
      role,
      subrol,
      limit: limit ? Number.parseInt(limit, 10) : 20,
      page: page ? Number.parseInt(page, 10) : 1,
    });
  }

  @Post("sync-crm")
  @HttpCode(HttpStatus.OK)
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
