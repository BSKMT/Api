import {
  Injectable,
  Logger,
  ConflictException,
  BadRequestException,
} from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";
import { User, UserDocument, UserRole } from "../../users/schemas/user.schema";
import { UserSubrole } from "../../users/schemas/user-subdocuments.schema";
import { getAuth, getMongoDb } from "../../auth/better-auth";
import { generateBskmtUsername } from "../../common/utils/username-generator.util";
import {
  CreateCollaboratorDto,
  CreateAdministratorDto,
  CreateSuperAdminDto,
} from "../dto/contractor-management.dto";

@Injectable()
export class ContractorManagementService {
  private readonly logger = new Logger(ContractorManagementService.name);

  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
  ) {}

  /**
   * Generates a unique username for a contractor or staff member.
   */
  private async generateUniqueUsername(
    cedula: string,
    primerNombre: string,
    primerApellido: string,
  ): Promise<{ username: string; internalCode: string }> {
    let attempts = 0;
    while (attempts < 10) {
      const generated = generateBskmtUsername(
        cedula,
        primerNombre,
        primerApellido,
      );
      const exists = await this.userModel
        .findOne({ username: generated.username })
        .lean();
      if (!exists) {
        return {
          username: generated.username,
          internalCode: generated.internalCode,
        };
      }
      attempts++;
    }
    throw new ConflictException(
      "No fue posible generar un nombre de usuario único tras 10 intentos.",
    );
  }

  /**
   * Internal helper to create the credential account in Better Auth and sync MongoDB.
   */
  private async createBetterAuthAccount(
    email: string,
    password: string,
    fullName: string,
    primerNombre: string,
    segundoNombre: string | undefined,
    primerApellido: string,
    segundoApellido: string | undefined,
  ): Promise<string> {
    const auth = await getAuth();
    let betterAuthId = "";

    try {
      const authRes = await auth.api.signUpEmail({
        body: {
          email: email.toLowerCase(),
          password,
          name: fullName,
          primerNombre,
          segundoNombre: segundoNombre || "",
          primerApellido,
          segundoApellido: segundoApellido || "",
        },
      });

      betterAuthId = authRes?.user?.id || "";
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `Error en auth.api.signUpEmail para ${email}: ${errMsg}`,
      );
      throw new BadRequestException(
        `Error al registrar credenciales de Better Auth: ${errMsg}`,
      );
    }

    if (!betterAuthId) {
      // Fallback: buscar el id recién insertado en MongoDB raw
      const rawUser = await getMongoDb()
        .collection("user")
        .findOne({ email: email.toLowerCase() });
      if (rawUser) {
        betterAuthId = String(rawUser._id);
      } else {
        throw new BadRequestException(
          "No se pudo obtener el identificador de usuario de Better Auth.",
        );
      }
    }

    // Asegurar que Better Auth marque el email como verificado para permitir inicio de sesión inmediato
    await getMongoDb()
      .collection("user")
      .updateOne(
        { email: email.toLowerCase() },
        { $set: { emailVerified: true } },
      );

    return betterAuthId;
  }

  /**
   * Helper que normaliza y valida campos comunes (nombres, documentos, emails, teléfonos, etc.)
   * aceptando tanto nombres en español como aliases en inglés.
   */
  private normalizeStaffPayload(
    dto: CreateCollaboratorDto | CreateAdministratorDto | CreateSuperAdminDto,
    defaultCargo: string,
    defaultArea: string,
  ) {
    const cedula = (dto.cedula || dto.docNumber || "").trim();
    if (!cedula) {
      throw new BadRequestException(
        "El número de documento o cédula es obligatorio.",
      );
    }

    let primerNombre = (dto.primerNombre || "").trim();
    let segundoNombre = (dto.segundoNombre || "").trim() || undefined;
    if (!primerNombre && dto.firstName) {
      const parts = dto.firstName.trim().split(/\s+/);
      primerNombre = parts[0] || "";
      segundoNombre = parts.slice(1).join(" ") || undefined;
    }
    if (!primerNombre) {
      throw new BadRequestException("El nombre es obligatorio.");
    }

    let primerApellido = (dto.primerApellido || "").trim();
    let segundoApellido = (dto.segundoApellido || "").trim() || undefined;
    if (!primerApellido && dto.lastName) {
      const parts = dto.lastName.trim().split(/\s+/);
      primerApellido = parts[0] || "";
      segundoApellido = parts.slice(1).join(" ") || undefined;
    }
    if (!primerApellido) {
      throw new BadRequestException("El apellido es obligatorio.");
    }

    const email = (dto.correoInstitucional || dto.institutionalEmail || "")
      .toLowerCase()
      .trim();
    if (!email) {
      throw new BadRequestException(
        "El correo corporativo o institucional es obligatorio.",
      );
    }

    const telefono = (dto.telefono || dto.phone || "").trim();
    if (!telefono) {
      throw new BadRequestException(
        "El número de teléfono o celular es obligatorio.",
      );
    }

    const cargo = (dto.cargo || dto.position || defaultCargo).trim();
    const area = (dto.area || dto.department || defaultArea).trim();
    const password = (dto.password || "").trim();
    if (!password || password.length < 8) {
      throw new BadRequestException(
        "La contraseña debe contener al menos 8 caracteres.",
      );
    }

    return {
      cedula,
      primerNombre,
      segundoNombre,
      primerApellido,
      segundoApellido,
      email,
      telefono,
      cargo,
      area,
      password,
      docType: dto.docType || "CC",
      personalEmail: dto.personalEmail?.trim()?.toLowerCase() || undefined,
      address: dto.address?.trim() || undefined,
      birthDate: dto.birthDate || undefined,
      bloodType: dto.bloodType || undefined,
      emergencyContactName: dto.emergencyContactName?.trim() || undefined,
      emergencyContactPhone: dto.emergencyContactPhone?.trim() || undefined,
    };
  }

  /**
   * Crea un Gestor / Colaborador de BSK Fascia con datos de contratista y credenciales.
   * Puede ser ejecutado por Administrador de Talento Humano o Superadmin.
   */
  async createCollaborator(dto: CreateCollaboratorDto, creatorUserId: string) {
    const norm = this.normalizeStaffPayload(
      dto,
      "Gestor de Operaciones en Campo",
      "Operaciones de Campo",
    );

    const existingUser = await this.userModel
      .findOne({ email: norm.email })
      .lean();
    if (existingUser) {
      throw new ConflictException(
        `El correo institucional ${norm.email} ya se encuentra registrado.`,
      );
    }

    const { username, internalCode } = await this.generateUniqueUsername(
      norm.cedula,
      norm.primerNombre,
      norm.primerApellido,
    );

    const fullName =
      `${norm.primerNombre} ${norm.segundoNombre ? norm.segundoNombre + " " : ""}${norm.primerApellido} ${norm.segundoApellido || ""}`.trim();

    const betterAuthId = await this.createBetterAuthAccount(
      norm.email,
      norm.password,
      fullName,
      norm.primerNombre,
      norm.segundoNombre,
      norm.primerApellido,
      norm.segundoApellido,
    );

    const subrol = dto.subrol || UserSubrole.GESTOR_CAMPO;

    const contractorInfo = {
      cedula: norm.cedula,
      docType: norm.docType,
      nombres: `${norm.primerNombre} ${norm.segundoNombre || ""}`.trim(),
      apellidos: `${norm.primerApellido} ${norm.segundoApellido || ""}`.trim(),
      correoInstitucional: norm.email,
      personalEmail: norm.personalEmail,
      telefono: norm.telefono,
      cargo: norm.cargo,
      area: norm.area,
      address: norm.address,
      bloodType: norm.bloodType,
      emergencyContactName: norm.emergencyContactName,
      emergencyContactPhone: norm.emergencyContactPhone,
      subrol,
      tipoContrato: dto.tipoContrato || "Contrato de Prestación de Servicios",
      createdBy: creatorUserId,
      createdAt: new Date(),
    };

    const updatedUser = await this.userModel.findOneAndUpdate(
      { $or: [{ email: norm.email }, { betterAuthId }] },
      {
        $set: {
          email: norm.email,
          betterAuthId,
          username,
          internalCode,
          role: UserRole.GESTOR,
          subrol,
          contractorInfo,
          emailVerified: true,
          isActive: true,
          profileCompleted: true,
          "profile.datos-personales": {
            primerNombre: norm.primerNombre,
            segundoNombre: norm.segundoNombre || "",
            primerApellido: norm.primerApellido,
            segundoApellido: norm.segundoApellido || "",
            tipoDocumento:
              norm.docType === "CE"
                ? "Cédula de Extranjería"
                : norm.docType === "PASSPORT"
                  ? "Pasaporte"
                  : "Cédula de Ciudadanía",
            numeroDocumento: norm.cedula,
            fechaNacimiento: norm.birthDate || "",
          },
          "profile.contacto": {
            celular: norm.telefono,
            correoInstitucional: norm.email,
            correoPersonal: norm.personalEmail || "",
            direccion: norm.address || "",
          },
          "profile.salud-seguridad": {
            rh: norm.bloodType || "O+",
            contactoEmergenciaNombre: norm.emergencyContactName || "",
            contactoEmergenciaTelefono: norm.emergencyContactPhone || "",
          },
        },
      },
      { new: true, upsert: true },
    );

    // Sincronizar username y rol en Better Auth
    await getMongoDb()
      .collection("user")
      .updateOne(
        { email: norm.email },
        { $set: { username, role: UserRole.GESTOR } },
      );

    this.logger.log(
      `Gestor Fascia creado exitosamente: usuario="${username}", email="${norm.email}", subrol="${subrol}" por admin=${creatorUserId}`,
    );

    return {
      message: "Gestor de operaciones (campo/oficina) registrado exitosamente.",
      collaborator: {
        _id: updatedUser._id,
        username,
        email: norm.email,
        role: UserRole.GESTOR,
        subrol,
        contractorInfo,
      },
    };
  }

  /**
   * Crea un Administrador de BSK Console con datos de contratista y permisos asignados.
   * EXCLUSIVO: Solo puede ser ejecutado por un Superadministrador.
   */
  async createAdministrator(
    dto: CreateAdministratorDto,
    creatorUserId: string,
  ) {
    const norm = this.normalizeStaffPayload(
      dto,
      "Administrador Ejecutivo",
      "Administración Central",
    );

    const existingUser = await this.userModel
      .findOne({ email: norm.email })
      .lean();
    if (existingUser) {
      throw new ConflictException(
        `El correo corporativo ${norm.email} ya se encuentra registrado.`,
      );
    }

    const { username, internalCode } = await this.generateUniqueUsername(
      norm.cedula,
      norm.primerNombre,
      norm.primerApellido,
    );

    const fullName =
      `${norm.primerNombre} ${norm.segundoNombre ? norm.segundoNombre + " " : ""}${norm.primerApellido} ${norm.segundoApellido || ""}`.trim();

    const betterAuthId = await this.createBetterAuthAccount(
      norm.email,
      norm.password,
      fullName,
      norm.primerNombre,
      norm.segundoNombre,
      norm.primerApellido,
      norm.segundoApellido,
    );

    const subrol = dto.subrol || dto.role || null;
    const adminPermissions = Array.isArray(dto.adminPermissions)
      ? dto.adminPermissions
      : [];

    const contractorInfo = {
      cedula: norm.cedula,
      docType: norm.docType,
      nombres: `${norm.primerNombre} ${norm.segundoNombre || ""}`.trim(),
      apellidos: `${norm.primerApellido} ${norm.segundoApellido || ""}`.trim(),
      correoInstitucional: norm.email,
      personalEmail: norm.personalEmail,
      telefono: norm.telefono,
      cargo: norm.cargo,
      area: norm.area,
      address: norm.address,
      bloodType: norm.bloodType,
      emergencyContactName: norm.emergencyContactName,
      emergencyContactPhone: norm.emergencyContactPhone,
      subrol,
      tipoContrato: "Contrato Laboral / Directivo BSKMT",
      createdBy: creatorUserId,
      createdAt: new Date(),
    };

    const updatedUser = await this.userModel.findOneAndUpdate(
      { $or: [{ email: norm.email }, { betterAuthId }] },
      {
        $set: {
          email: norm.email,
          betterAuthId,
          username,
          internalCode,
          role: UserRole.ADMIN,
          subrol,
          adminPermissions,
          contractorInfo,
          emailVerified: true,
          isActive: true,
          profileCompleted: true,
          "profile.datos-personales": {
            primerNombre: norm.primerNombre,
            segundoNombre: norm.segundoNombre || "",
            primerApellido: norm.primerApellido,
            segundoApellido: norm.segundoApellido || "",
            tipoDocumento:
              norm.docType === "CE"
                ? "Cédula de Extranjería"
                : norm.docType === "PASSPORT"
                  ? "Pasaporte"
                  : "Cédula de Ciudadanía",
            numeroDocumento: norm.cedula,
            fechaNacimiento: norm.birthDate || "",
          },
          "profile.contacto": {
            celular: norm.telefono,
            correoInstitucional: norm.email,
            correoPersonal: norm.personalEmail || "",
            direccion: norm.address || "",
          },
          "profile.salud-seguridad": {
            rh: norm.bloodType || "O+",
            contactoEmergenciaNombre: norm.emergencyContactName || "",
            contactoEmergenciaTelefono: norm.emergencyContactPhone || "",
          },
        },
      },
      { new: true, upsert: true },
    );

    // Sincronizar username y role en Better Auth
    await getMongoDb()
      .collection("user")
      .updateOne(
        { email: norm.email },
        { $set: { username, role: UserRole.ADMIN } },
      );

    this.logger.log(
      `Administrador Console creado exitosamente: usuario="${username}", email="${norm.email}", area="${norm.area}" por superadmin=${creatorUserId}`,
    );

    return {
      message: "Administrador ejecutivo registrado exitosamente.",
      administrator: {
        _id: updatedUser._id,
        username,
        email: norm.email,
        role: UserRole.ADMIN,
        area: norm.area,
        adminPermissions,
        contractorInfo,
      },
    };
  }

  /**
   * Crea un Superadministrador (Owner / New-BSKMT).
   * EXCLUSIVO: Solo puede ser ejecutado por otro Superadministrador.
   */
  async createSuperAdmin(dto: CreateSuperAdminDto, creatorUserId: string) {
    const norm = this.normalizeStaffPayload(
      dto,
      "Superadministrador General / Propietario",
      "Dirección General / Presidencia",
    );

    const existingUser = await this.userModel
      .findOne({ email: norm.email })
      .lean();
    if (existingUser) {
      throw new ConflictException(
        `El correo ${norm.email} ya se encuentra registrado.`,
      );
    }

    const { username, internalCode } = await this.generateUniqueUsername(
      norm.cedula,
      norm.primerNombre,
      norm.primerApellido,
    );

    const fullName =
      `${norm.primerNombre} ${norm.segundoNombre ? norm.segundoNombre + " " : ""}${norm.primerApellido} ${norm.segundoApellido || ""}`.trim();

    const betterAuthId = await this.createBetterAuthAccount(
      norm.email,
      norm.password,
      fullName,
      norm.primerNombre,
      norm.segundoNombre,
      norm.primerApellido,
      norm.segundoApellido,
    );

    const contractorInfo = {
      cedula: norm.cedula,
      docType: norm.docType,
      nombres: `${norm.primerNombre} ${norm.segundoNombre || ""}`.trim(),
      apellidos: `${norm.primerApellido} ${norm.segundoApellido || ""}`.trim(),
      correoInstitucional: norm.email,
      personalEmail: norm.personalEmail,
      telefono: norm.telefono,
      cargo: norm.cargo,
      area: norm.area,
      address: norm.address,
      bloodType: norm.bloodType,
      emergencyContactName: norm.emergencyContactName,
      emergencyContactPhone: norm.emergencyContactPhone,
      tipoContrato: "Propietario / Socio Fundador",
      createdBy: creatorUserId,
      createdAt: new Date(),
    };

    const updatedUser = await this.userModel.findOneAndUpdate(
      { $or: [{ email: norm.email }, { betterAuthId }] },
      {
        $set: {
          email: norm.email,
          betterAuthId,
          username,
          internalCode,
          role: UserRole.SUPERADMIN,
          contractorInfo,
          emailVerified: true,
          isActive: true,
          profileCompleted: true,
          "profile.datos-personales": {
            primerNombre: norm.primerNombre,
            segundoNombre: norm.segundoNombre || "",
            primerApellido: norm.primerApellido,
            segundoApellido: norm.segundoApellido || "",
            tipoDocumento:
              norm.docType === "CE"
                ? "Cédula de Extranjería"
                : norm.docType === "PASSPORT"
                  ? "Pasaporte"
                  : "Cédula de Ciudadanía",
            numeroDocumento: norm.cedula,
            fechaNacimiento: norm.birthDate || "",
          },
          "profile.contacto": {
            celular: norm.telefono,
            correoInstitucional: norm.email,
            correoPersonal: norm.personalEmail || "",
            direccion: norm.address || "",
          },
          "profile.salud-seguridad": {
            rh: norm.bloodType || "O+",
            contactoEmergenciaNombre: norm.emergencyContactName || "",
            contactoEmergenciaTelefono: norm.emergencyContactPhone || "",
          },
        },
      },
      { new: true, upsert: true },
    );

    await getMongoDb()
      .collection("user")
      .updateOne(
        { email: norm.email },
        { $set: { username, role: UserRole.SUPERADMIN } },
      );

    this.logger.log(
      `Superadministrador creado exitosamente: usuario="${username}", email="${norm.email}" por superadmin=${creatorUserId}`,
    );

    return {
      message: "Superadministrador registrado exitosamente.",
      superadmin: {
        _id: updatedUser._id,
        username,
        email: norm.email,
        role: UserRole.SUPERADMIN,
        contractorInfo,
      },
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
