import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  Req,
  UseGuards,
  HttpCode,
  HttpStatus,
  NotFoundException,
  BadRequestException,
  Logger,
} from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model, isValidObjectId } from "mongoose";
import type { Request } from "express";
import { SessionGuard } from "../../auth/session.guard";
import { GestionGuard } from "../../common/guards/gestion.guard";
import { RequireSubroles } from "../../common/decorators/subroles.decorator";
import {
  User,
  UserDocument,
  UserSubrole,
} from "../../users/schemas/user.schema";

interface AuthenticatedRequest extends Request {
  user: {
    userId: string;
    email?: string;
    role?: string;
    subrol?: string | null;
  };
}

@Controller("gestion/membresias")
@UseGuards(SessionGuard, GestionGuard)
@RequireSubroles(UserSubrole.LIDER_MEMBRESIAS, UserSubrole.GESTOR_MEMBRESIAS)
export class GestionMembresiasController {
  private readonly logger = new Logger(GestionMembresiasController.name);

  constructor(
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
  ) {}

  @Get("members")
  async listMembers(
    @Query("search") search?: string,
    @Query("limit") limit?: string,
    @Query("page") page?: string,
  ) {
    const filter: Record<string, unknown> = {
      role: { $in: ["member", "admin"] },
    };

    if (search && typeof search === "string") {
      const cleanSearch = search.trim().slice(0, 100);
      const searchRegex = new RegExp(
        cleanSearch.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`),
        "i",
      );
      filter.$or = [
        { email: searchRegex },
        { "profile.datos-personales.primerNombre": searchRegex },
        { "profile.datos-personales.primerApellido": searchRegex },
        { "profile.membresia-ecosistema.numeroMiembro": searchRegex },
      ];
    }

    const lim = Math.min(
      Math.max(limit ? Number.parseInt(limit, 10) : 25, 1),
      100,
    );
    const pg = Math.max(page ? Number.parseInt(page, 10) : 1, 1);
    const skip = (pg - 1) * lim;

    // F-09: Proyección estricta de solo los campos necesarios para gestión de membresías
    const [members, total] = await Promise.all([
      this.userModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(lim)
        .select(
          "_id email role subrol membershipLevel membershipStartDate membershipExpiryDate profile.datos-personales profile.membresia-ecosistema identityVerified phone createdAt",
        )
        .lean(),
      this.userModel.countDocuments(filter),
    ]);

    return {
      members,
      total,
      page: pg,
      limit: lim,
      totalPages: Math.ceil(total / lim),
    };
  }

  @Get("verifications")
  async listPendingVerifications() {
    const pending = await this.userModel
      .find({
        identityVerified: false,
        profileCompleted: true,
      })
      .sort({ updatedAt: -1 })
      .limit(50)
      .select(
        "_id email role subrol profile.datos-personales phone identityVerified createdAt",
      )
      .lean();

    return { pending };
  }

  @Post("verify/:id")
  @HttpCode(HttpStatus.OK)
  async verifyIdentity(
    @Param("id") id: string,
    @Req() req: AuthenticatedRequest,
  ) {
    if (!isValidObjectId(id)) {
      throw new BadRequestException("Identificador de usuario inválido");
    }

    // F-09: Bloquear que un gestor se auto-verifique
    if (id === req.user.userId) {
      throw new BadRequestException(
        "Conflicto de interés: no puedes verificar tu propia identidad.",
      );
    }

    const user = await this.userModel.findById(id);
    if (!user) {
      throw new NotFoundException("Usuario no encontrado");
    }

    const existingKyc = user.identityVerification;
    const personal = user.profile?.["datos-personales"] as
      Record<string, unknown> | undefined;
    const primerNombre = (personal?.primerNombre as string) || "";
    const primerApellido = (personal?.primerApellido as string) || "";
    const fullName =
      existingKyc?.fullName ||
      `${primerNombre} ${primerApellido}`.trim() ||
      "Verificado Manual";
    const docNumber =
      existingKyc?.documentNumber ||
      (personal?.numeroDocumento as string) ||
      "MANUAL";
    const docType =
      existingKyc?.documentType || (personal?.tipoDocumento as string) || "CC";

    user.identityVerified = true;
    user.identityVerifiedAt = new Date();
    user.identityVerification = {
      documentType: docType,
      documentNumber: docNumber,
      fullName: fullName,
      firstName: existingKyc?.firstName ?? primerNombre ?? null,
      lastName: existingKyc?.lastName ?? primerApellido ?? null,
      dateOfBirth: existingKyc?.dateOfBirth ?? null,
      gender: existingKyc?.gender ?? null,
      documentStatus: existingKyc?.documentStatus ?? "VIGENTE",
      expirationDate: existingKyc?.expirationDate ?? null,
      verifikId: existingKyc?.verifikId ?? null,
      verifiedAt: new Date(),
      verifiedBy: req.user.userId,
      verificationMethod: "manual_gestion",
    };
    await user.save();

    this.logger.log(
      `Identity manually verified for user ${id} by gestor ${req.user.userId}`,
    );

    return {
      success: true,
      message: "Identidad verificada exitosamente por el gestor de membresías",
      userId: user._id,
    };
  }
}
