import { Injectable, Logger, ConflictException } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";
import { User, UserDocument, UserRole } from "../../users/schemas/user.schema";
import { UserSubrole } from "../../users/schemas/user-subdocuments.schema";
import {
  CreateCollaboratorDto,
  CreateAdministratorDto,
  CreateSuperAdminDto,
} from "../dto/contractor-management.dto";
import { normalizeStaffPayload } from "./contractor-payload.helpers";
import { provisionStaffUser } from "./contractor-provision.helpers";

@Injectable()
export class ContractorManagementService {
  private readonly logger = new Logger(ContractorManagementService.name);

  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
  ) {}

  private async ensureEmailNotRegistered(email: string) {
    const existingUser = await this.userModel.findOne({ email }).lean();
    if (existingUser) {
      throw new ConflictException(
        `El correo institucional o corporativo ${email} ya se encuentra registrado.`,
      );
    }
  }

  /**
   * Crea un Gestor / Colaborador de BSK Fascia con datos de contratista y credenciales.
   */
  async createCollaborator(dto: CreateCollaboratorDto, creatorUserId: string) {
    const norm = normalizeStaffPayload(
      dto,
      "Gestor de Operaciones en Campo",
      "Operaciones de Campo",
    );
    await this.ensureEmailNotRegistered(norm.email);

    const subrol = dto.subrol || UserSubrole.GESTOR_CAMPO;
    const collaborator = await provisionStaffUser({
      userModel: this.userModel,
      norm,
      role: UserRole.GESTOR,
      subrol,
      tipoContrato: dto.tipoContrato || "Contrato de Prestación de Servicios",
      creatorUserId,
      logger: this.logger,
    });

    return {
      message: "Gestor de operaciones (campo/oficina) registrado exitosamente.",
      collaborator,
    };
  }

  /**
   * Crea un Administrador de BSK Console con datos de contratista y permisos asignados.
   */
  async createAdministrator(
    dto: CreateAdministratorDto,
    creatorUserId: string,
  ) {
    const norm = normalizeStaffPayload(
      dto,
      "Administrador Ejecutivo",
      "Administración Central",
    );
    await this.ensureEmailNotRegistered(norm.email);

    const subrol = dto.subrol || dto.role || null;
    const adminPermissions = Array.isArray(dto.adminPermissions)
      ? dto.adminPermissions
      : [];

    const staff = await provisionStaffUser({
      userModel: this.userModel,
      norm,
      role: UserRole.ADMIN,
      subrol,
      adminPermissions,
      tipoContrato: "Contrato Laboral / Directivo BSKMT",
      creatorUserId,
      logger: this.logger,
    });

    return {
      message: "Administrador ejecutivo registrado exitosamente.",
      administrator: {
        ...staff,
        area: norm.area,
        adminPermissions,
      },
    };
  }

  /**
   * Crea un Superadministrador (Owner / New-BSKMT).
   */
  async createSuperAdmin(dto: CreateSuperAdminDto, creatorUserId: string) {
    const norm = normalizeStaffPayload(
      dto,
      "Superadministrador General / Propietario",
      "Dirección General / Presidencia",
    );
    await this.ensureEmailNotRegistered(norm.email);

    const superadmin = await provisionStaffUser({
      userModel: this.userModel,
      norm,
      role: UserRole.SUPERADMIN,
      tipoContrato: "Propietario / Socio Fundador",
      creatorUserId,
      logger: this.logger,
    });

    return {
      message: "Superadministrador registrado exitosamente.",
      superadmin,
    };
  }

  /**
   * Lista todos los colaboradores/contratistas de gestión (Fascia).
   */
  async listCollaborators() {
    return this.userModel
      .find({
        $or: [
          { role: UserRole.GESTOR },
          { contractorInfo: { $ne: null } },
          { subrol: { $ne: null } },
        ],
      })
      .select("email username role subrol contractorInfo isActive createdAt")
      .sort({ createdAt: -1 })
      .lean();
  }

  /**
   * Lista todos los administradores ejecutivos y superadministradores.
   */
  async listAdministrators() {
    return this.userModel
      .find({
        role: { $in: [UserRole.ADMIN, UserRole.SUPERADMIN] },
      })
      .select(
        "email username role subrol adminPermissions contractorInfo isActive createdAt",
      )
      .sort({ createdAt: -1 })
      .lean();
  }

  /**
   * Lista todos los superadministradores.
   */
  async listSuperAdmins() {
    return this.userModel
      .find({
        role: UserRole.SUPERADMIN,
      })
      .select(
        "email username role subrol adminPermissions contractorInfo isActive createdAt",
      )
      .sort({ createdAt: -1 })
      .lean();
  }
}
