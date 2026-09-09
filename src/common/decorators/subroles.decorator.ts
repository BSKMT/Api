import { SetMetadata } from "@nestjs/common";
import { UserSubrole } from "../../users/schemas/user.schema";

export const SUBROLES_KEY = "subroles";
export const RequireSubroles = (...subroles: (UserSubrole | string)[]) =>
  SetMetadata(SUBROLES_KEY, subroles);
