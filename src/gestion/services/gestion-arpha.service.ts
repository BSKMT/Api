import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";
import {
  ArphaRequest,
  ArphaRequestDocument,
  ArphaRequestStatus,
} from "../../arpha/schemas/arpha-request.schema";
import {
  IsString,
  MinLength,
  IsIn,
  IsOptional,
  IsNumber,
  IsEnum,
} from "class-validator";
import { UsersService } from "../../users/users.service";
import { UserRole, UserSubrole } from "../../users/schemas/user.schema";

export class AssignArphaDto {
  @IsString()
  @MinLength(1)
  gestorId!: string;

  @IsString()
  @MinLength(1)
  gestorName!: string;

  @IsIn(["campo", "mesa"])
  assignedType!: "campo" | "mesa";

  @IsOptional()
  @IsString()
  eta?: string;
}

export class UpdateGestorLocationDto {
  @IsNumber()
  lat!: number;

  @IsNumber()
  lng!: number;
}

export class UpdateGestionStatusDto {
  @IsEnum(ArphaRequestStatus)
  status!: ArphaRequestStatus;

  @IsOptional()
  @IsString()
  resolution?: string;
}

@Injectable()
export class GestionArphaService {
  private readonly logger = new Logger(GestionArphaService.name);

  constructor(
    @InjectModel(ArphaRequest.name)
    private readonly arphaRequestModel: Model<ArphaRequestDocument>,
    private readonly usersService: UsersService,
  ) {}

  async listRequests(user: {
    userId: string;
    role?: string;
    subrol?: string | null;
  }) {
    const isLeaderOrAdmin =
      user.role === UserRole.ADMIN || user.subrol === UserSubrole.LIDER_ARPHA;

    let filter: Record<string, unknown> = {};

    if (!isLeaderOrAdmin) {
      if (user.subrol === UserSubrole.GESTOR_CAMPO_ARPHA) {
        filter = {
          $or: [
            { assignedGestorId: user.userId },
            {
              status: ArphaRequestStatus.PENDING,
              assignedGestorId: null,
            },
          ],
        };
      } else if (user.subrol === UserSubrole.GESTOR_MESA_ARPHA) {
        filter = {
          $or: [
            { assignedGestorId: user.userId },
            {
              assignedType: "mesa",
              status: ArphaRequestStatus.PENDING,
            },
          ],
        };
      } else {
        throw new ForbiddenException(
          "No tienes permisos para consultar solicitudes ARPHA",
        );
      }
    }

    const items = await this.arphaRequestModel
      .find(filter)
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();

    return {
      requests: items,
      total: items.length,
      userRole: user.role,
      userSubrol: user.subrol,
    };
  }

  async assignRequest(
    requestId: string,
    dto: AssignArphaDto,
    assignedBy: { userId: string; role?: string; subrol?: string | null },
  ) {
    const request = await this.arphaRequestModel.findById(requestId);
    if (!request) {
      throw new NotFoundException("Solicitud ARPHA no encontrada");
    }

    if (
      request.status === ArphaRequestStatus.COMPLETED ||
      request.status === ArphaRequestStatus.CANCELLED
    ) {
      throw new BadRequestException(
        "No se puede asignar una solicitud completada o cancelada",
      );
    }

    request.assignedGestorId = dto.gestorId;
    request.assignedGestorName = dto.gestorName;
    request.assignedTechnician = dto.gestorName;
    request.assignedType = dto.assignedType;
    if (dto.eta) request.eta = dto.eta;
    request.status = ArphaRequestStatus.EN_CAMINO;

    const saved = await request.save();
    this.logger.log(
      `ARPHA assigned: req=${requestId} gestor=${dto.gestorName} (${dto.assignedType}) by=${assignedBy.userId}`,
    );

    return saved;
  }

  async updateGestorLocation(
    requestId: string,
    coords: UpdateGestorLocationDto,
    user: { userId: string; role?: string; subrol?: string | null },
  ) {
    const request = await this.arphaRequestModel.findById(requestId);
    if (!request) {
      throw new NotFoundException("Solicitud ARPHA no encontrada");
    }

    const isLeaderOrAdmin =
      user.role === UserRole.ADMIN || user.subrol === UserSubrole.LIDER_ARPHA;

    if (!isLeaderOrAdmin && request.assignedGestorId !== user.userId) {
      throw new ForbiddenException(
        "No estás asignado como gestor de esta solicitud",
      );
    }

    request.gestorLocation = {
      lat: coords.lat,
      lng: coords.lng,
      updatedAt: new Date(),
    };

    const saved = await request.save();
    return {
      success: true,
      requestId,
      gestorLocation: saved.gestorLocation,
    };
  }

  async updateStatus(
    requestId: string,
    dto: UpdateGestionStatusDto,
    user: { userId: string; role?: string; subrol?: string | null },
  ) {
    const request = await this.arphaRequestModel.findById(requestId);
    if (!request) {
      throw new NotFoundException("Solicitud ARPHA no encontrada");
    }

    const isLeaderOrAdmin =
      user.role === UserRole.ADMIN || user.subrol === UserSubrole.LIDER_ARPHA;

    if (!isLeaderOrAdmin && request.assignedGestorId !== user.userId) {
      throw new ForbiddenException(
        "No tienes autorización para modificar esta solicitud",
      );
    }

    request.status = dto.status;
    if (dto.resolution) {
      request.resolution = dto.resolution;
    }

    if (dto.status === ArphaRequestStatus.COMPLETED) {
      request.resolvedAt = new Date();
      request.activeRequestKey = null; // Release slot
    } else if (dto.status === ArphaRequestStatus.CANCELLED) {
      request.cancelledAt = new Date();
      request.activeRequestKey = null; // Release slot
    }

    return request.save();
  }

  async listAvailableGestores() {
    return this.usersService.findStaffBySubroles([
      UserSubrole.LIDER_ARPHA,
      UserSubrole.GESTOR_CAMPO_ARPHA,
      UserSubrole.GESTOR_MESA_ARPHA,
    ]);
  }
}
