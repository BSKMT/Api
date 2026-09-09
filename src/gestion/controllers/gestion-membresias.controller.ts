import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
  NotFoundException,
} from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";
import { SessionGuard } from "../../auth/session.guard";
import { GestionGuard } from "../../common/guards/gestion.guard";
import { RequireSubroles } from "../../common/decorators/subroles.decorator";
import { User, UserDocument, UserSubrole } from "../../users/schemas/user.schema";

@Controller("gestion/membresias")
@UseGuards(SessionGuard, GestionGuard)
@RequireSubroles(UserSubrole.LIDER_MEMBRESIAS, UserSubrole.GESTOR_MEMBRESIAS)
export class GestionMembresiasController {
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

    if (search) {
      const searchRegex = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      filter.$or = [
        { email: searchRegex },
        { "profile.datos-personales.primerNombre": searchRegex },
        { "profile.datos-personales.primerApellido": searchRegex },
        { "profile.membresia-ecosistema.numeroMiembro": searchRegex },
      ];
    }

    const lim = Math.min(Math.max(limit ? Number.parseInt(limit, 10) : 25, 1), 100);
    const pg = Math.max(page ? Number.parseInt(page, 10) : 1, 1);
    const skip = (pg - 1) * lim;

    const [members, total] = await Promise.all([
      this.userModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(lim)
        .select("-settings")
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
      .select("_id email role subrol profile.datos-personales phone identityVerified")
      .lean();

    return { pending };
  }

  @Post("verify/:id")
  @HttpCode(HttpStatus.OK)
  async verifyIdentity(@Param("id") id: string) {
    const user = await this.userModel.findById(id);
    if (!user) {
      throw new NotFoundException("Usuario no encontrado");
    }

    user.identityVerified = true;
    user.identityVerifiedAt = new Date();
    await user.save();

    return {
      success: true,
      message: "Identidad verificada exitosamente por el gestor de membresías",
      userId: user._id,
    };
  }
}
