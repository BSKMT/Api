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
  ARPHA_PRICING,
} from "./schemas/arpha-request.schema";
import { CreateArphaRequestDto } from "./dto/create-arpha-request.dto";
import { RateArphaRequestDto } from "./dto/rate-arpha-request.dto";

const LEGEND_LEVELS = new Set([
  "Legend",
  "Friend",
  "Rider",
  "Expert",
  "Master",
]);

export interface ArphaPricingResult {
  request: ArphaRequestDocument;
  pricing: {
    amount: number;
    isMember: boolean;
    requiresPayment: boolean;
  };
}

@Injectable()
export class ArphaService {
  private readonly logger = new Logger(ArphaService.name);

  constructor(
    @InjectModel(ArphaRequest.name)
    private arphaRequestModel: Model<ArphaRequestDocument>,
  ) {}

  async createRequest(
    userId: string,
    dto: CreateArphaRequestDto,
    membershipLevel: string | null = null,
  ): Promise<ArphaPricingResult> {
    const activeRequest = await this.arphaRequestModel.findOne({
      userId,
      status: {
        $in: [ArphaRequestStatus.PENDING, ArphaRequestStatus.EN_CAMINO],
      },
    });

    if (activeRequest) {
      throw new BadRequestException(
        "Ya tienes una solicitud de asistencia activa",
      );
    }

    const isMember =
      membershipLevel !== null && LEGEND_LEVELS.has(membershipLevel);
    const amount = isMember ? 0 : (ARPHA_PRICING[dto.requestType] ?? 15000);

    const request = new this.arphaRequestModel({
      userId,
      requestType: dto.requestType,
      status: ArphaRequestStatus.PENDING,
      location: dto.location,
      description: dto.description ?? null,
      isMember,
      amount,
      paymentConfirmed: isMember,
    });

    const saved = await request.save();
    this.logger.log(
      `ARPHA request created: id=${String(saved._id)} user=${userId} type=${dto.requestType} amount=${amount} member=${isMember}`,
    );

    return {
      request: saved,
      pricing: {
        amount,
        isMember,
        requiresPayment: !isMember && amount > 0,
      },
    };
  }

  async cancelRequest(
    userId: string,
    requestId: string,
  ): Promise<{ message: string }> {
    const request = await this.arphaRequestModel.findOne({
      _id: requestId,
      userId,
    });

    if (!request) {
      throw new NotFoundException("Solicitud no encontrada");
    }

    if (
      request.status === ArphaRequestStatus.COMPLETED ||
      request.status === ArphaRequestStatus.CANCELLED
    ) {
      throw new BadRequestException(
        "No se puede cancelar una solicitud completada o ya cancelada",
      );
    }

    request.status = ArphaRequestStatus.CANCELLED;
    request.cancelledAt = new Date();
    await request.save();

    this.logger.log(`ARPHA request cancelled: id=${requestId} user=${userId}`);

    return { message: "Solicitud cancelada exitosamente" };
  }

  async rateRequest(
    userId: string,
    requestId: string,
    dto: RateArphaRequestDto,
  ): Promise<ArphaRequestDocument> {
    const request = await this.arphaRequestModel.findOne({
      _id: requestId,
      userId,
    });

    if (!request) {
      throw new NotFoundException("Solicitud no encontrada");
    }

    if (request.status !== ArphaRequestStatus.COMPLETED) {
      throw new BadRequestException(
        "Solo se pueden calificar solicitudes completadas",
      );
    }

    if (request.rating !== null) {
      throw new BadRequestException("Ya has calificado esta solicitud");
    }

    request.rating = dto.rating;
    request.comment = dto.comment ?? null;
    return request.save();
  }

  async getMyRequests(userId: string): Promise<{
    active: ArphaRequestDocument[];
    history: ArphaRequestDocument[];
  }> {
    const requests = await this.arphaRequestModel
      .find({ userId })
      .sort({ createdAt: -1 })
      .lean();

    const active = requests.filter(
      (r) =>
        r.status === ArphaRequestStatus.PENDING ||
        r.status === ArphaRequestStatus.EN_CAMINO,
    );
    const history = requests.filter(
      (r) =>
        r.status === ArphaRequestStatus.COMPLETED ||
        r.status === ArphaRequestStatus.CANCELLED,
    );

    return { active, history };
  }

  async getActiveCount(userId: string): Promise<number> {
    return this.arphaRequestModel.countDocuments({
      userId,
      status: {
        $in: [ArphaRequestStatus.PENDING, ArphaRequestStatus.EN_CAMINO],
      },
    });
  }

  async linkArphaPayment(
    userId: string,
    requestId: string,
    transactionReference: string,
  ): Promise<ArphaRequestDocument> {
    const request = await this.arphaRequestModel.findOneAndUpdate(
      { _id: requestId, userId },
      {
        transactionReference,
        paymentConfirmed: true,
      },
      { new: true },
    );

    if (!request) {
      throw new NotFoundException("Solicitud no encontrada");
    }

    this.logger.log(
      `ARPHA payment linked: id=${requestId} ref=${transactionReference}`,
    );

    return request;
  }

  getPricingInfo(requestType: string, membershipLevel: string | null) {
    const isMember =
      membershipLevel !== null && LEGEND_LEVELS.has(membershipLevel);
    const amount = isMember ? 0 : (ARPHA_PRICING[requestType] ?? 15000);
    return {
      amount,
      isMember,
      requiresPayment: !isMember && amount > 0,
      servicePrices: ARPHA_PRICING,
    };
  }
}
