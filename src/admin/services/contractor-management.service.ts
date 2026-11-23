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
import { BirdContactService } from "../../bird/bird-contact.service";

@Injectable()
export class ContractorManagementService {
  private readonly logger = new Logger(ContractorManagementService.name);

  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    private readonly birdContactService?: BirdContactService,
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
      birdContactService: this.birdContactService,
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
      birdContactService: this.birdContactService,
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
      birdContactService: this.birdContactService,
    });

    return {
      message: "Superadministrador registrado exitosamente.",
      superadmin,
    };
  }

  private formatStaffRecord(user: Record<string, unknown>) {
    const info =
      (user.contractorInfo as Record<string, unknown> | null | undefined) ??
      undefined;
    const profile = user.profile as
      Record<string, Record<string, unknown>> | undefined;
    const personal = profile?.["datos-personales"];
    const membershipEco = profile?.["membresia-ecosistema"];

    const contractorName = [info?.nombres, info?.apellidos]
      .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
      .join(" ")
      .trim();
    const profileName = [personal?.primerNombre, personal?.primerApellido]
      .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
      .join(" ")
      .trim();
    const email = typeof user.email === "string" ? user.email : "";
    const resolvedName =
      contractorName || profileName || email.split("@")[0] || "Staff BSKMT";

    const normalizedInfo = info
      ? {
          ...info,
          position: info.position ?? info.cargo ?? undefined,
          department: info.department ?? info.area ?? undefined,
        }
      : null;

    const internalCode =
      typeof user.internalCode === "string" && user.internalCode.trim()
        ? user.internalCode
        : typeof membershipEco?.numeroMiembro === "string"
          ? membershipEco.numeroMiembro
          : undefined;

    return {
      _id: user._id,
      name: resolvedName,
      email: user.email,
      username: user.username,
      role: user.role,
      subrol: user.subrol ?? null,
      internalCode,
      adminPermissions: user.adminPermissions,
      contractorInfo: normalizedInfo,
      isActive: user.isActive,
      createdAt: user.createdAt,
    };
  }

  /**
   * Lista todos los colaboradores/contratistas de gestión (Fascia).
   * H-07: Nunca expone cuentas SUPERADMIN a llamadores no-superadmin.
   */
  async listCollaborators(callerRole?: string) {
    const isSuperAdmin =
      (callerRole || "").toLowerCase() === String(UserRole.SUPERADMIN);
    const filter: Record<string, unknown> = {
      $or: [
        { role: UserRole.GESTOR },
        { subrol: { $regex: /^(gestor_|lider_)/i } },
      ],
    };
    if (!isSuperAdmin) {
      filter.role = { $ne: UserRole.SUPERADMIN };
    }
    const users = await this.userModel
      .find(filter)
      .select(
        "email username role subrol contractorInfo profile.datos-personales profile.membresia-ecosistema isActive createdAt",
      )
      .sort({ createdAt: -1 })
      .limit(500)
      .lean();
    return users.map((u) =>
      this.formatStaffRecord(u as unknown as Record<string, unknown>),
    );
  }

  /**
   * Lista todos los administradores ejecutivos (y superadministradores solo si el llamador es SUPERADMIN).
   */
  async listAdministrators(callerRole?: string) {
    const isSuperAdmin =
      (callerRole || "").toLowerCase() === String(UserRole.SUPERADMIN);
    const users = await this.userModel
      .find({
        role: isSuperAdmin
          ? { $in: [UserRole.ADMIN, UserRole.SUPERADMIN] }
          : UserRole.ADMIN,
      })
      .select(
        "email username role subrol adminPermissions contractorInfo profile.datos-personales profile.membresia-ecosistema isActive createdAt",
      )
      .sort({ createdAt: -1 })
      .limit(500)
      .lean();
    return users.map((u) =>
      this.formatStaffRecord(u as unknown as Record<string, unknown>),
    );
  }

  /**
   * Lista todos los superadministradores.
   */
  async listSuperAdmins() {
    const users = await this.userModel
      .find({
        role: UserRole.SUPERADMIN,
      })
      .select(
        "email username role subrol adminPermissions contractorInfo profile.datos-personales profile.membresia-ecosistema isActive createdAt",
      )
      .sort({ createdAt: -1 })
      .limit(500)
      .lean();
    return users.map((u) =>
      this.formatStaffRecord(u as unknown as Record<string, unknown>),
    );
  }
}
