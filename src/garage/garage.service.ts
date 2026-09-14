import { Injectable, NotFoundException, Logger } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";
import {
  GarageMotorcycle,
  GarageMotorcycleDocument,
} from "./schemas/garage-motorcycle.schema";
import {
  MaintenanceLog,
  MaintenanceLogDocument,
} from "./schemas/maintenance-log.schema";
import {
  OdometerLog,
  OdometerLogDocument,
} from "./schemas/odometer-log.schema";
import {
  EventRegistration,
  EventRegistrationDocument,
} from "../events/schemas/event-registration.schema";
import { Order, OrderDocument } from "../shop/schemas/order.schema";
import { UsersService } from "../users/users.service";
import { CreateMotorcycleDto } from "./dto/create-motorcycle.dto";
import { UpdateMotorcycleDto } from "./dto/update-motorcycle.dto";
import { UpdateOdometerDto } from "./dto/update-odometer.dto";
import { CreateMaintenanceDto } from "./dto/create-maintenance.dto";
import { AlliedServiceOrderDto } from "./dto/allied-service-order.dto";
import { VerifyRuntDto } from "./dto/verify-runt.dto";
import { VerifikService } from "../verifik/verifik.service";
import { ALLIED_WORKSHOPS } from "./garage.constants";
import { executeGetDashboard } from "./garage-dashboard.helpers";
import {
  executeCreateMotorcycle,
  executeUpdateMotorcycle,
  executeUpdateOdometer,
} from "./garage-crud.helpers";
import {
  executeCreateMaintenance,
  executeRecordAlliedServiceOrder,
} from "./garage-maintenance.helpers";
import { executeVerifyMotorcycleWithRunt } from "./garage-runt.helpers";

@Injectable()
export class GarageService {
  private readonly logger = new Logger(GarageService.name);

  constructor(
    @InjectModel(GarageMotorcycle.name)
    private readonly motorcycleModel: Model<GarageMotorcycleDocument>,
    @InjectModel(MaintenanceLog.name)
    private readonly maintenanceModel: Model<MaintenanceLogDocument>,
    @InjectModel(OdometerLog.name)
    private readonly odometerModel: Model<OdometerLogDocument>,
    @InjectModel(EventRegistration.name)
    private readonly eventRegistrationModel: Model<EventRegistrationDocument>,
    @InjectModel(Order.name)
    private readonly orderModel: Model<OrderDocument>,
    private readonly usersService: UsersService,
    private readonly verifikService: VerifikService,
  ) {}

  async getDashboard(userId: string, targetMotorcycleId?: string) {
    return executeGetDashboard(
      this.motorcycleModel,
      this.maintenanceModel,
      this.odometerModel,
      this.eventRegistrationModel,
      this.orderModel,
      this.usersService,
      userId,
      targetMotorcycleId,
    );
  }

  async createMotorcycle(userId: string, dto: CreateMotorcycleDto) {
    const user = await this.usersService.findById(userId);
    if (!user) {
      throw new NotFoundException("Usuario no encontrado");
    }
    const isLegend = user.membershipLevel === "Legend";
    return executeCreateMotorcycle(
      this.motorcycleModel,
      this.odometerModel,
      userId,
      dto,
      isLegend,
      this.logger,
    );
  }

  async updateMotorcycle(
    userId: string,
    motorcycleId: string,
    dto: UpdateMotorcycleDto,
  ) {
    return executeUpdateMotorcycle(
      this.motorcycleModel,
      this.odometerModel,
      userId,
      motorcycleId,
      dto,
    );
  }

  async deleteMotorcycle(userId: string, motorcycleId: string) {
    const moto = await this.motorcycleModel.findOne({
      _id: motorcycleId,
      userId,
    });
    if (!moto) {
      throw new NotFoundException("Motocicleta no encontrada");
    }

    await this.motorcycleModel.deleteOne({ _id: motorcycleId });
    await this.maintenanceModel.deleteMany({ motorcycleId });
    await this.odometerModel.deleteMany({ motorcycleId });

    return { success: true, message: "Motocicleta eliminada del garaje" };
  }

  async updateOdometer(
    userId: string,
    motorcycleId: string,
    dto: UpdateOdometerDto,
  ) {
    return executeUpdateOdometer(
      this.motorcycleModel,
      this.odometerModel,
      userId,
      motorcycleId,
      dto,
    );
  }

  async createMaintenance(
    userId: string,
    motorcycleId: string,
    dto: CreateMaintenanceDto,
  ) {
    return executeCreateMaintenance(
      this.motorcycleModel,
      this.maintenanceModel,
      userId,
      motorcycleId,
      dto,
    );
  }

  async recordAlliedServiceOrder(dto: AlliedServiceOrderDto) {
    return executeRecordAlliedServiceOrder(
      this.motorcycleModel,
      this.maintenanceModel,
      this.odometerModel,
      dto,
      this.logger,
    );
  }

  getAlliedWorkshops() {
    return ALLIED_WORKSHOPS;
  }

  async verifyMotorcycleWithRunt(
    userId: string,
    motorcycleId: string,
    dto?: VerifyRuntDto,
  ) {
    const user = await this.usersService.findById(userId);
    if (!user) {
      throw new NotFoundException("Usuario no encontrado");
    }

    const moto = await this.motorcycleModel.findOne({
      _id: motorcycleId,
      userId,
    });
    if (!moto) {
      throw new NotFoundException("Motocicleta no encontrada");
    }

    return executeVerifyMotorcycleWithRunt(
      this.verifikService,
      user,
      moto,
      dto,
      userId,
      this.logger,
    );
  }
}
