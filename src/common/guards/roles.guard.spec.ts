import { describe, it, expect, beforeEach, jest } from "@jest/globals";
import { ExecutionContext, ForbiddenException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { RolesGuard, checkAdminModulePermissions } from "./roles.guard";
import { Role } from "../decorators/roles.decorator";

describe("RolesGuard (NIST CSF 2.0 PR.AA-05)", () => {
  let guard: RolesGuard;
  let reflector: Reflector;

  beforeEach(() => {
    reflector = new Reflector();
    guard = new RolesGuard(reflector);
  });

  function createMockContext(
    user?: { userId?: string; role?: string; adminPermissions?: string[] },
    url = "/api/admin/users",
    method = "GET",
  ): ExecutionContext {
    return {
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: () => ({
        getRequest: () => ({
          method,
          url,
          originalUrl: url,
          user,
        }),
      }),
    } as unknown as ExecutionContext;
  }

  it("permite el acceso si no hay roles requeridos", () => {
    jest.spyOn(reflector, "getAllAndOverride").mockReturnValue(undefined);
    const ctx = createMockContext({ userId: "u1", role: Role.USER });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it("permite peticiones con método OPTIONS", () => {
    jest.spyOn(reflector, "getAllAndOverride").mockReturnValue([Role.ADMIN]);
    const ctx = createMockContext(undefined, "/api/admin/users", "OPTIONS");
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it("lanza ForbiddenException si no hay usuario en el request", () => {
    jest.spyOn(reflector, "getAllAndOverride").mockReturnValue([Role.ADMIN]);
    const ctx = createMockContext(undefined);
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it("permite acceso incondicional al SUPERADMIN", () => {
    jest.spyOn(reflector, "getAllAndOverride").mockReturnValue([Role.ADMIN]);
    const ctx = createMockContext({ userId: "sa1", role: Role.SUPERADMIN });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it("deniega acceso si el usuario no tiene el rol requerido", () => {
    jest.spyOn(reflector, "getAllAndOverride").mockReturnValue([Role.ADMIN]);
    const ctx = createMockContext({ userId: "u1", role: Role.USER });
    expect(() => guard.canActivate(ctx)).toThrow(
      "No tienes permisos para realizar esta acción",
    );
  });

  it("permite a un ADMIN con permiso '*' acceder a cualquier ruta", () => {
    jest.spyOn(reflector, "getAllAndOverride").mockReturnValue([Role.ADMIN]);
    const ctx = createMockContext(
      { userId: "a1", role: Role.ADMIN, adminPermissions: ["*"] },
      "/api/admin/users",
    );
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it("permite a un ADMIN con permiso de módulo coincidente acceder a la ruta", () => {
    jest.spyOn(reflector, "getAllAndOverride").mockReturnValue([Role.ADMIN]);
    const ctx = createMockContext(
      { userId: "a1", role: Role.ADMIN, adminPermissions: ["users"] },
      "/api/admin/users/export?format=csv",
    );
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it("deniega a un ADMIN si carece del permiso de módulo requerido", () => {
    jest.spyOn(reflector, "getAllAndOverride").mockReturnValue([Role.ADMIN]);
    const ctx = createMockContext(
      { userId: "a1", role: Role.ADMIN, adminPermissions: ["events"] },
      "/api/admin/users",
    );
    expect(() => guard.canActivate(ctx)).toThrow(
      "No tienes permisos asignados para el módulo administrativo 'users'",
    );
  });

  it("aplica política FAIL-CLOSED ante rutas administrativas no mapeadas", () => {
    jest.spyOn(reflector, "getAllAndOverride").mockReturnValue([Role.ADMIN]);
    const ctx = createMockContext(
      { userId: "a1", role: Role.ADMIN, adminPermissions: ["users"] },
      "/api/admin/unmapped-sensitive-area",
    );
    expect(() => guard.canActivate(ctx)).toThrow(
      "Módulo administrativo no reconocido o sin política de acceso definida. Acceso denegado (Fail-Closed).",
    );
  });

  it("permite el alias de permiso 'events' para el módulo 'arpha'", () => {
    expect(() =>
      checkAdminModulePermissions(["events"], "/api/admin/arpha/cases"),
    ).not.toThrow();
  });
});
