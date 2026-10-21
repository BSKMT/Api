import type { Model } from "mongoose";
import type { BirdService } from "./bird.service";
import {
  BirdContactService,
  DEFAULT_BIRD_AUDIENCES,
} from "./bird-contact.service";
import { UserRole, UserSubrole } from "../users/schemas/user.schema";
import type { UserDocument } from "../users/schemas/user.schema";

describe("BirdContactService", () => {
  let service: BirdContactService;
  let mockBirdService: {
    isConfigured: jest.Mock;
    getClient: jest.Mock;
  };
  let mockUserModel: {
    findById: jest.Mock;
    findOne: jest.Mock;
    find: jest.Mock;
    updateOne: jest.Mock;
  };

  beforeEach(() => {
    mockBirdService = {
      isConfigured: jest.fn().mockReturnValue(true),
      getClient: jest.fn().mockResolvedValue({
        contacts: {
          batch: jest.fn().mockResolvedValue({
            data: [
              {
                contact_id: "con_test123",
                status: "created",
                entry: { email: "test@bskmt.com" },
              },
            ],
          }),
          delete: jest
            .fn()
            .mockResolvedValue({ deleted: true, id: "con_test123" }),
        },
        audiences: {
          removeContact: jest.fn().mockResolvedValue({}),
        },
      }),
    };

    mockUserModel = {
      findById: jest.fn(),
      findOne: jest.fn(),
      find: jest.fn(),
      updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
    };

    service = new BirdContactService(
      mockBirdService as unknown as BirdService,
      mockUserModel as unknown as Model<UserDocument>,
    );
  });

  describe("normalizePhoneNumber", () => {
    it("debe normalizar números móviles colombianos de 10 dígitos a E.164", () => {
      expect(service.normalizePhoneNumber("3245413293")).toBe("+573245413293");
      expect(service.normalizePhoneNumber("300 123 4567")).toBe(
        "+573001234567",
      );
      expect(service.normalizePhoneNumber("310-987-6543")).toBe(
        "+573109876543",
      );
    });

    it("debe normalizar números que ya tienen prefijo 57 sin signo +", () => {
      expect(service.normalizePhoneNumber("573245413293")).toBe(
        "+573245413293",
      );
    });

    it("debe conservar números ya en formato E.164 válido", () => {
      expect(service.normalizePhoneNumber("+573245413293")).toBe(
        "+573245413293",
      );
      expect(service.normalizePhoneNumber("+13124495648")).toBe("+13124495648");
    });

    it("debe retornar null para valores vacíos, nulos o inválidos", () => {
      expect(service.normalizePhoneNumber(null)).toBeNull();
      expect(service.normalizePhoneNumber(undefined)).toBeNull();
      expect(service.normalizePhoneNumber("")).toBeNull();
      expect(service.normalizePhoneNumber("123")).toBeNull();
    });
  });

  describe("classifyUserAudiences", () => {
    it("debe clasificar a un usuario registrado regular en la audiencia de usuarios", () => {
      const classification = service.classifyUserAudiences({
        role: UserRole.USER,
        email: "rider@bskmt.com",
      });

      expect(classification.targetAudienceId).toBe(
        DEFAULT_BIRD_AUDIENCES.USERS,
      );
      expect(classification.isMember).toBe(false);
      expect(classification.customData.membership).toBe(false);
      expect(classification.customData.role).toBe("user");
    });

    it("debe clasificar a un miembro activo en la audiencia de miembros y removerlo de usuarios", () => {
      const classification = service.classifyUserAudiences({
        role: UserRole.MEMBER,
        membershipLevel: "Legend",
        membershipExpired: false,
        profile: {
          "membresia-ecosistema": {
            numeroMiembro: "9014126051",
          },
        },
      });

      expect(classification.targetAudienceId).toBe(
        DEFAULT_BIRD_AUDIENCES.MEMBERS,
      );
      expect(classification.removeAudienceIds).toContain(
        DEFAULT_BIRD_AUDIENCES.USERS,
      );
      expect(classification.isMember).toBe(true);
      expect(classification.customData.membership).toBe(true);
      expect(classification.customData.membership_level).toBe("Legend");
      expect(classification.customData.member_number).toBe("9014126051");
    });

    it("debe clasificar a colaboradores y gestores en la audiencia de empleados", () => {
      const classification = service.classifyUserAudiences({
        role: UserRole.GESTOR,
        subrol: UserSubrole.GESTOR_CAMPO,
        contractorInfo: {
          cedula: "1031165404",
          cargo: "Gestor de Campo",
        },
      });

      expect(classification.targetAudienceId).toBe(
        DEFAULT_BIRD_AUDIENCES.EMPLOYEES,
      );
      expect(classification.removeAudienceIds).toContain(
        DEFAULT_BIRD_AUDIENCES.USERS,
      );
      expect(classification.customData.role).toBe("gestor");
      expect(classification.customData.subrol).toBe(UserSubrole.GESTOR_CAMPO);
    });

    it("debe clasificar a administradores en la audiencia de administradores", () => {
      const classification = service.classifyUserAudiences({
        role: UserRole.ADMIN,
      });

      expect(classification.targetAudienceId).toBe(
        DEFAULT_BIRD_AUDIENCES.ADMINS,
      );
      expect(classification.removeAudienceIds).toContain(
        DEFAULT_BIRD_AUDIENCES.USERS,
      );
      expect(classification.customData.role).toBe("admin");
    });
  });

  describe("syncContact", () => {
    it("debe llamar a client.contacts.batch con los parámetros de CRM correctos", async () => {
      const result = await service.syncContact({
        email: "juan@bskmt.com",
        primerNombre: "Juan",
        primerApellido: "Perez",
        phone: "3001234567",
        role: UserRole.USER,
      });

      expect(result.success).toBe(true);
      expect(result.contactId).toBe("con_test123");
      expect(result.status).toBe("created");
    });

    it("debe manejar fallos de Bird sin arrojar excepciones", async () => {
      mockBirdService.getClient.mockRejectedValueOnce(
        new Error("Network timeout"),
      );

      const result = await service.syncContact({
        email: "juan@bskmt.com",
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("Network timeout");
    });
  });
});
