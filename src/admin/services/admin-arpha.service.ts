import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";
import {
  ArphaRequest,
  ArphaRequestDocument,
  ArphaRequestStatus,
} from "../../arpha/schemas/arpha-request.schema";
import { AssignArphaRequestDto } from "../dto/assign-arpha-request.dto";
import { UpdateArphaStatusDto } from "../dto/update-arpha-status.dto";

@Injectable()
export class AdminArphaService {
  private readonly logger = new Logger(AdminArphaService.name);

  constructor(
    @InjectModel(ArphaRequest.name)
    private arphaRequestModel: Model<ArphaRequestDocument>,
  ) {}

  async listRequests(filters: {
    status?: string;
    requestType?: string;
    limit?: number;
    page?: number;
  }) {
    const filter: Record<string, unknown> = {};
    if (filters.status) filter.status = filters.status;
    if (filters.requestType) filter.requestType = filters.requestType;

    const limit = filters.limit ?? 50;
    const page = filters.page ?? 1;
    const skip = (page - 1) * limit;

    const [items, total] = await Promise.all([
      this.arphaRequestModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      this.arphaRequestModel.countDocuments(filter),
    ]);

    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    };
  }

  async getRequest(id: string): Promise<ArphaRequestDocument> {
    const request = await this.arphaRequestModel.findById(id).lean();
    if (!request) {
      throw new NotFoundException("Solicitud no encontrada");
    }
    return request;
  }

  async assignRequest(
    id: string,
    dto: AssignArphaRequestDto,
  ): Promise<ArphaRequestDocument> {
    const request = await this.arphaRequestModel.findById(id);
    if (!request) {
      throw new NotFoundException("Solicitud no encontrada");
    }
    if (
      request.status === ArphaRequestStatus.COMPLETED ||
      request.status === ArphaRequestStatus.CANCELLED
    ) {
      throw new BadRequestException(
        "No se puede asignar una solicitud completada o cancelada",
      );
    }

    if (dto.assignedTechnician !== undefined) {
      request.assignedTechnician = dto.assignedTechnician;
    }
    if (dto.eta !== undefined) {
      request.eta = dto.eta;
    }
    const saved = await request.save();
    this.logger.log(
      `ARPHA request assigned: id=${id} technician=${dto.assignedTechnician ?? "n/a"}`,
    );
    return saved;
  }

  async updateStatus(
    id: string,
    dto: UpdateArphaStatusDto,
  ): Promise<ArphaRequestDocument> {
    const request = await this.arphaRequestModel.findById(id);
    if (!request) {
      throw new NotFoundException("Solicitud no encontrada");
    }

    switch (dto.status) {
      case ArphaRequestStatus.PENDING:
        throw new BadRequestException(
          "No se puede revertir a PENDING desde administración",
        );
      case ArphaRequestStatus.EN_CAMINO:
        if (request.status === ArphaRequestStatus.COMPLETED) {
          throw new BadRequestException(
            "No se puede reactivar una solicitud completada",
          );
        }
        if (request.status === ArphaRequestStatus.CANCELLED) {
          throw new BadRequestException(
            "No se puede reactivar una solicitud cancelada",
          );
        }
        request.status = ArphaRequestStatus.EN_CAMINO;
        break;
      case ArphaRequestStatus.COMPLETED:
        if (request.status === ArphaRequestStatus.CANCELLED) {
          throw new BadRequestException(
            "No se puede completar una solicitud cancelada",
          );
        }
        request.status = ArphaRequestStatus.COMPLETED;
        request.resolvedAt = new Date();
        if (dto.resolution) request.resolution = dto.resolution;
        break;
      case ArphaRequestStatus.CANCELLED:
        if (request.status === ArphaRequestStatus.COMPLETED) {
          throw new BadRequestException(
            "No se puede cancelar una solicitud completada",
          );
        }
        request.status = ArphaRequestStatus.CANCELLED;
        request.cancelledAt = new Date();
        if (dto.resolution) request.resolution = dto.resolution;
        break;
      default:
        throw new BadRequestException("Estado inválido");
    }

    const saved = await request.save();
    this.logger.log(
      `ARPHA request status updated: id=${id} status=${dto.status}`,
    );
    return saved;
  }
}
