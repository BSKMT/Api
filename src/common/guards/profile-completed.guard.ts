import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from "@nestjs/common";
import type { Request } from "express";
import { UsersService } from "../../users/users.service";

interface AuthenticatedRequest extends Request {
  user: { userId: string; email: string; role: string };
}

/**
 * ProfileCompletedGuard — blocks access to the dashboard panel
 * and any core member actions until all 6 required profile sections
 * are completed and legal consent has been accepted in the database.
 */
@Injectable()
export class ProfileCompletedGuard implements CanActivate {
  constructor(private readonly usersService: UsersService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();

    if (request.method === "OPTIONS") {
      return true;
    }

    const user = await this.usersService.findById(request.user?.userId);

    if (
      user?.profileCompleted === true &&
      user?.legalConsentAccepted === true
    ) {
      return true;
    }

    throw new ForbiddenException({
      statusCode: 403,
      error: "profile_incomplete",
      message:
        "Debes completar todos tus datos de perfil y aceptar las políticas antes de acceder al panel de control.",
    });
  }
}
