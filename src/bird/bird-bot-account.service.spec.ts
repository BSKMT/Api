import type { Model } from "mongoose";
import { BirdBotAccountService } from "./bird-bot-account.service";
import type { BirdWhatsappService } from "./bird-whatsapp.service";
import type { UserDocument } from "../users/schemas/user.schema";
import type { GarageMotorcycleDocument } from "../garage/schemas/garage-motorcycle.schema";

interface OutboundWhatsappMessage {
  to: string;
  text: string;
}

describe("BirdBotAccountService", () => {
  let service: BirdBotAccountService;
  let mockUserModel: {
    findOne: jest.Mock;
  };
  let mockMotorcycleModel: {
    find: jest.Mock;
  };
  let mockWhatsappService: {
    sendDirectWhatsapp: jest.Mock;
  };

  beforeEach(() => {
    mockUserModel = {
      findOne: jest.fn(),
    };

    mockMotorcycleModel = {
      find: jest.fn(),
    };

    mockWhatsappService = {
      sendDirectWhatsapp: jest.fn().mockResolvedValue({ id: "wam_sent_123" }),
    };

    service = new BirdBotAccountService(
      mockUserModel as unknown as Model<UserDocument>,
      mockMotorcycleModel as unknown as Model<GarageMotorcycleDocument>,
      mockWhatsappService as unknown as BirdWhatsappService,
    );
  });

  describe("isAccountInquiry", () => {
    it("should recognize valid email addresses", () => {
      expect(service.isAccountInquiry("usuario@bskmt.com")).toBe(true);
      expect(service.isAccountInquiry("rider.test@gmail.com")).toBe(true);
    });

    it("should recognize document numbers with or without prefix", () => {
      expect(service.isAccountInquiry("1020304050")).toBe(true);
      expect(service.isAccountInquiry("CC 1020304050")).toBe(true);
      expect(service.isAccountInquiry("c.c. 1.020.304.050")).toBe(true);
      expect(service.isAccountInquiry("doc 12345678")).toBe(true);
    });

    it("should recognize account management commands", () => {
      expect(service.isAccountInquiry("mi cuenta")).toBe(true);
      expect(service.isAccountInquiry("Gestionar mi cuenta")).toBe(true);
      expect(service.isAccountInquiry("consultar mi cuenta")).toBe(true);
      expect(service.isAccountInquiry("mi membresia")).toBe(true);
      expect(service.isAccountInquiry("estado de cuenta")).toBe(true);
    });

    it("should return false for unrelated text", () => {
      expect(service.isAccountInquiry("Hola buenas tardes")).toBe(false);
      expect(service.isAccountInquiry("Quiero información sobre rutas")).toBe(
        false,
      );
      expect(service.isAccountInquiry("Gracias")).toBe(false);
      expect(service.isAccountInquiry("")).toBe(false);
    });
  });

  describe("handleAccountInquiry", () => {
    it("should send account report when user is found by document", async () => {
      const mockUser = {
        _id: "usr_mock_123",
        username: "jacivy",
        membershipLevel: "Legend",
        membershipExpired: false,
        identityVerified: true,
        profile: {
          "datos-personales": {
            primerNombre: "James",
            primerApellido: "Andres",
            numeroDocumento: "1020304050",
          },
          "membresia-ecosistema": {
            numeroMiembro: "007",
          },
        },
      };

      mockUserModel.findOne.mockReturnValue({
        lean: jest.fn().mockResolvedValue(mockUser),
      });

      mockMotorcycleModel.find.mockReturnValue({
        lean: jest.fn().mockResolvedValue([
          {
            brand: "Yamaha",
            modelLine: "MT-09",
            plate: "ABC12D",
            soatExpiryDate: new Date(Date.now() + 86400000 * 30),
          },
        ]),
      });

      const result = await service.handleAccountInquiry({
        from: "CO.2041512499849757",
        text: "1020304050",
      });

      expect(result).toBe(true);
      expect(mockWhatsappService.sendDirectWhatsapp).toHaveBeenCalledTimes(1);
      const calls = mockWhatsappService.sendDirectWhatsapp.mock
        .calls as unknown as [[OutboundWhatsappMessage]];
      const payload = calls[0][0];

      expect(payload.to).toBe("CO.2041512499849757");
      expect(payload.text).toContain("ESTADO DE TU CUENTA BSKMT");
      expect(payload.text).toContain("James Andres");
      expect(payload.text).toContain("102****50"); // Enmascaramiento PII
      expect(payload.text).toContain("Legend");
      expect(payload.text).toContain("#007");
      expect(payload.text).toContain("Yamaha MT-09 [ABC12D]");
      expect(payload.text).toContain("SOAT: Vigente ✅");
      expect(payload.text).toContain("https://bskmt.com/login");
    });

    it("should send not-found message when document is provided but user does not exist", async () => {
      mockUserModel.findOne.mockReturnValue({
        lean: jest.fn().mockResolvedValue(null),
      });

      const result = await service.handleAccountInquiry({
        from: "+573001234567",
        text: "999999999",
      });

      expect(result).toBe(true);
      expect(mockWhatsappService.sendDirectWhatsapp).toHaveBeenCalledTimes(1);
      const calls = mockWhatsappService.sendDirectWhatsapp.mock
        .calls as unknown as [[OutboundWhatsappMessage]];
      const payload = calls[0][0];

      expect(payload.text).toContain("Cuenta no encontrada en BSKMT");
      expect(payload.text).toContain("https://bskmt.com/registro");
    });

    it("should send prompt message when general command is received without document/email", async () => {
      mockUserModel.findOne.mockReturnValue({
        lean: jest.fn().mockResolvedValue(null),
      });

      const result = await service.handleAccountInquiry({
        from: "+573001234567",
        text: "Gestionar mi cuenta",
      });

      expect(result).toBe(true);
      expect(mockWhatsappService.sendDirectWhatsapp).toHaveBeenCalledTimes(1);
      const calls = mockWhatsappService.sendDirectWhatsapp.mock
        .calls as unknown as [[OutboundWhatsappMessage]];
      const payload = calls[0][0];

      expect(payload.text).toContain("Gestión y Consulta de Cuenta BSKMT");
      expect(payload.text).toContain("Número de Cédula");
    });
  });
});
