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
import { ensureString } from "../../common/utils/sanitize-query.util";

function validateNotFinalized(
  request: ArphaRequestDocument,
  message: string,
): void {
  if (
    request.status === ArphaRequestStatus.COMPLETED ||
    request.status === ArphaRequestStatus.CANCELLED
  ) {
    throw new BadRequestException(message);
  }
}

@Injectable()
export class AdminArphaService {
  private readonly logger = new Logger(AdminArphaService.name);

  constructor(
    @InjectModel(ArphaRequest.name)
    private readonly arphaRequestModel: Model<ArphaRequestDocument>,
  ) {}

  async listRequests(filters: {
    status?: string;
    requestType?: string;
    limit?: number;
    page?: number;
  }) {
    // M2: Sanitize filter
    const filter: Record<string, unknown> = {};
    const status = ensureString(filters.status);
    if (status) filter.status = status;
    const requestType = ensureString(filters.requestType);
    if (requestType) filter.requestType = requestType;

    const page = Math.max(1, filters.page ?? 1);
    const limit = Math.min(100, Math.max(1, filters.limit ?? 25));
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
    const request = await this.arphaRequestModel.findById(id);
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

    validateNotFinalized(
      request,
      "No se puede asignar una solicitud completada o cancelada",
    );

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
        validateNotFinalized(
          request,
          "No se puede reactivar una solicitud finalizada",
        );
        request.status = ArphaRequestStatus.EN_CAMINO;
        break;
      case ArphaRequestStatus.EN_SITIO:
        validateNotFinalized(
          request,
          "No se puede cambiar el estado de una solicitud finalizada",
        );
        request.status = ArphaRequestStatus.EN_SITIO;
        request.arrivedAt ??= new Date();
        break;
      case ArphaRequestStatus.COMPLETED:
        if (request.status === ArphaRequestStatus.CANCELLED) {
          throw new BadRequestException(
            "No se puede completar una solicitud cancelada",
          );
        }
        request.status = ArphaRequestStatus.COMPLETED;
        request.resolvedAt = new Date();
        request.activeRequestKey = null; // M16: Release active slot
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
        request.activeRequestKey = null; // M16: Release active slot
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
