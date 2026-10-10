import {
  Injectable,
  Logger,
  ConflictException,
  BadRequestException,
} from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";
import { User, UserDocument, UserRole } from "../../users/schemas/user.schema";
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
      const generated = generateBskmtUsername(cedula, primerNombre, primerApellido);
      const exists = await this.userModel.findOne({ username: generated.username }).lean();
      if (!exists) {
        return {
          username: generated.username,
          internalCode: generated.internalCode,
        };
      }
      attempts++;
    }
    throw new ConflictException("No fue posible generar un nombre de usuario único tras 10 intentos.");
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
      this.logger.error(`Error en auth.api.signUpEmail para ${email}: ${errMsg}`);
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
        throw new BadRequestException("No se pudo obtener el identificador de usuario de Better Auth.");
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
   * Crea un Gestor / Colaborador de BSK Fascia con datos de contratista y credenciales.
   * Puede ser ejecutado por Administrador de Talento Humano o Superadmin.
   */
  async createCollaborator(dto: CreateCollaboratorDto, creatorUserId: string) {
    const email = dto.correoInstitucional.toLowerCase().trim();

    const existingUser = await this.userModel.findOne({ email }).lean();
    if (existingUser) {
      throw new ConflictException(`El correo institucional ${email} ya se encuentra registrado.`);
    }

    const { username, internalCode } = await this.generateUniqueUsername(
      dto.cedula,
      dto.primerNombre,
      dto.primerApellido,
    );

    const fullName = `${dto.primerNombre} ${dto.segundoNombre ? dto.segundoNombre + " " : ""}${dto.primerApellido} ${dto.segundoApellido || ""}`.trim();

    const betterAuthId = await this.createBetterAuthAccount(
      email,
      dto.password,
      fullName,
      dto.primerNombre,
      dto.segundoNombre,
      dto.primerApellido,
      dto.segundoApellido,
    );

    const contractorInfo = {
      cedula: dto.cedula.trim(),
      nombres: `${dto.primerNombre} ${dto.segundoNombre || ""}`.trim(),
      apellidos: `${dto.primerApellido} ${dto.segundoApellido || ""}`.trim(),
      correoInstitucional: email,
      telefono: dto.telefono.trim(),
      cargo: dto.cargo.trim(),
      area: dto.area?.trim() || "Operaciones",
      subrol: dto.subrol,
      tipoContrato: dto.tipoContrato || "Contrato de Prestación de Servicios",
      createdBy: creatorUserId,
      createdAt: new Date(),
    };

    const updatedUser = await this.userModel.findOneAndUpdate(
      { $or: [{ email }, { betterAuthId }] },
      {
        $set: {
          email,
          betterAuthId,
          username,
          internalCode,
          role: UserRole.MEMBER,
          subrol: dto.subrol,
          contractorInfo,
          emailVerified: true,
          isActive: true,
          profileCompleted: true,
          "profile.datos-personales": {
            primerNombre: dto.primerNombre,
            segundoNombre: dto.segundoNombre || "",
            primerApellido: dto.primerApellido,
            segundoApellido: dto.segundoApellido || "",
            tipoDocumento: "Cédula de Ciudadanía",
            numeroDocumento: dto.cedula.trim(),
          },
          "profile.contacto": {
            celular: dto.telefono.trim(),
            correoInstitucional: email,
          },
        },
      },
      { new: true, upsert: true },
    );

    // Sincronizar username en Better Auth
    await getMongoDb()
      .collection("user")
      .updateOne(
        { email },
        { $set: { username, role: UserRole.MEMBER } },
      );

    this.logger.log(
      `Colaborador Fascia creado exitosamente: usuario="${username}", email="${email}", subrol="${dto.subrol}" por admin=${creatorUserId}`,
    );

    return {
      message: "Colaborador de operaciones registrado exitosamente.",
      collaborator: {
        _id: updatedUser._id,
        username,
        email,
        subrol: dto.subrol,
        contractorInfo,
      },
    };
  }

  /**
   * Crea un Administrador de BSK Console con datos de contratista y permisos asignados.
   * EXCLUSIVO: Solo puede ser ejecutado por un Superadministrador.
   */
  async createAdministrator(dto: CreateAdministratorDto, creatorUserId: string) {
    const email = dto.correoInstitucional.toLowerCase().trim();

    const existingUser = await this.userModel.findOne({ email }).lean();
    if (existingUser) {
      throw new ConflictException(`El correo corporativo ${email} ya se encuentra registrado.`);
    }

    const { username, internalCode } = await this.generateUniqueUsername(
      dto.cedula,
      dto.primerNombre,
      dto.primerApellido,
    );

    const fullName = `${dto.primerNombre} ${dto.segundoNombre ? dto.segundoNombre + " " : ""}${dto.primerApellido} ${dto.segundoApellido || ""}`.trim();

    const betterAuthId = await this.createBetterAuthAccount(
      email,
      dto.password,
      fullName,
      dto.primerNombre,
      dto.segundoNombre,
      dto.primerApellido,
      dto.segundoApellido,
    );

    const contractorInfo = {
      cedula: dto.cedula.trim(),
      nombres: `${dto.primerNombre} ${dto.segundoNombre || ""}`.trim(),
      apellidos: `${dto.primerApellido} ${dto.segundoApellido || ""}`.trim(),
      correoInstitucional: email,
      telefono: dto.telefono.trim(),
      cargo: dto.cargo.trim(),
      area: dto.area.trim(),
      subrol: dto.subrol || null,
      tipoContrato: "Contrato Laboral / Directivo BSKMT",
      createdBy: creatorUserId,
      createdAt: new Date(),
    };

    const updatedUser = await this.userModel.findOneAndUpdate(
      { $or: [{ email }, { betterAuthId }] },
      {
        $set: {
          email,
          betterAuthId,
          username,
          internalCode,
          role: UserRole.ADMIN,
          subrol: dto.subrol || null,
          adminPermissions: dto.adminPermissions || [],
          contractorInfo,
          emailVerified: true,
          isActive: true,
          profileCompleted: true,
          "profile.datos-personales": {
            primerNombre: dto.primerNombre,
            segundoNombre: dto.segundoNombre || "",
            primerApellido: dto.primerApellido,
            segundoApellido: dto.segundoApellido || "",
            tipoDocumento: "Cédula de Ciudadanía",
            numeroDocumento: dto.cedula.trim(),
          },
          "profile.contacto": {
            celular: dto.telefono.trim(),
            correoInstitucional: email,
          },
        },
      },
      { new: true, upsert: true },
    );

    // Sincronizar username y role en Better Auth
    await getMongoDb()
      .collection("user")
      .updateOne(
        { email },
        { $set: { username, role: UserRole.ADMIN } },
      );

    this.logger.log(
      `Administrador Console creado exitosamente: usuario="${username}", email="${email}", area="${dto.area}" por superadmin=${creatorUserId}`,
    );

    return {
      message: "Administrador ejecutivo registrado exitosamente.",
      administrator: {
        _id: updatedUser._id,
        username,
        email,
        role: UserRole.ADMIN,
        area: dto.area,
        adminPermissions: dto.adminPermissions || [],
        contractorInfo,
      },
    };
  }

  /**
   * Crea un Superadministrador (Owner / New-BSKMT).
   * EXCLUSIVO: Solo puede ser ejecutado por otro Superadministrador.
   */
  async createSuperAdmin(dto: CreateSuperAdminDto, creatorUserId: string) {
    const email = dto.correoInstitucional.toLowerCase().trim();

    const existingUser = await this.userModel.findOne({ email }).lean();
    if (existingUser) {
      throw new ConflictException(`El correo ${email} ya se encuentra registrado.`);
    }

    const { username, internalCode } = await this.generateUniqueUsername(
      dto.cedula,
      dto.primerNombre,
      dto.primerApellido,
    );

    const fullName = `${dto.primerNombre} ${dto.segundoNombre ? dto.segundoNombre + " " : ""}${dto.primerApellido} ${dto.segundoApellido || ""}`.trim();

    const betterAuthId = await this.createBetterAuthAccount(
      email,
      dto.password,
      fullName,
      dto.primerNombre,
      dto.segundoNombre,
      dto.primerApellido,
      dto.segundoApellido,
    );

    const contractorInfo = {
      cedula: dto.cedula.trim(),
      nombres: `${dto.primerNombre} ${dto.segundoNombre || ""}`.trim(),
      apellidos: `${dto.primerApellido} ${dto.segundoApellido || ""}`.trim(),
      correoInstitucional: email,
      telefono: dto.telefono.trim(),
      cargo: dto.cargo.trim(),
      area: "Dirección General / Presidencia",
      tipoContrato: "Propietario / Socio Fundador",
      createdBy: creatorUserId,
      createdAt: new Date(),
    };

    const updatedUser = await this.userModel.findOneAndUpdate(
      { $or: [{ email }, { betterAuthId }] },
      {
        $set: {
          email,
          betterAuthId,
          username,
          internalCode,
          role: UserRole.SUPERADMIN,
          contractorInfo,
          emailVerified: true,
          isActive: true,
          profileCompleted: true,
          "profile.datos-personales": {
            primerNombre: dto.primerNombre,
            segundoNombre: dto.segundoNombre || "",
            primerApellido: dto.primerApellido,
            segundoApellido: dto.segundoApellido || "",
            tipoDocumento: "Cédula de Ciudadanía",
            numeroDocumento: dto.cedula.trim(),
          },
        },
      },
      { new: true, upsert: true },
    );

    await getMongoDb()
      .collection("user")
      .updateOne(
        { email },
        { $set: { username, role: UserRole.SUPERADMIN } },
      );

    this.logger.log(
      `Superadministrador creado exitosamente: usuario="${username}", email="${email}" por superadmin=${creatorUserId}`,
    );

    return {
      message: "Superadministrador registrado exitosamente.",
      superadmin: {
        _id: updatedUser._id,
        username,
        email,
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
      .select("email username role subrol adminPermissions contractorInfo isActive createdAt")
      .sort({ createdAt: -1 })
      .lean();
  }
}
