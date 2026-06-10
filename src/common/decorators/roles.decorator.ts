import { SetMetadata } from "@nestjs/common";

export enum Role {
  USER = "user",
  ADMIN = "admin",
  ROAD_CAPTAIN = "road-captain",
  EVENT_MANAGER = "event-manager",
  MODERATOR = "moderator",
}

export const ROLES_KEY = "roles";
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
