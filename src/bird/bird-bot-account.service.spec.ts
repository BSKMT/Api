import type { Model } from "mongoose";
import { BirdBotAccountService } from "./bird-bot-account.service";
import type { BirdWhatsappService } from "./bird-whatsapp.service";
import type { UserDocument } from "../users/schemas/user.schema";
import type { GarageMotorcycleDocument } from "../garage/schemas/garage-motorcycle.schema";
import type { EventDocument } from "../events/schemas/event.schema";
import type { CourseDocument } from "../events/schemas/course.schema";
import type { ProductDocument } from "../shop/schemas/product.schema";
import type { ArphaRequestDocument } from "../arpha/schemas/arpha-request.schema";

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
  let mockEventModel: {
    find: jest.Mock;
  };
  let mockCourseModel: {
    find: jest.Mock;
  };
  let mockProductModel: {
    find: jest.Mock;
  };
  let mockArphaModel: {
    findOne: jest.Mock;
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

    mockEventModel = {
      find: jest.fn().mockReturnValue({
        sort: jest.fn().mockReturnValue({
          limit: jest.fn().mockReturnValue({
            lean: jest.fn().mockResolvedValue([
              {
                title: "Rodada Alto de Letras",
                date: new Date(Date.now() + 86400000 * 5),
                meetingPoint: "Bomba Mobil Calle 80",
                meetingTime: "6:00 AM",
                departureTime: "6:30 AM",
                difficulty: "Alta",
                slug: "rodada-alto-de-letras",
              },
            ]),
          }),
        }),
      }),
    };

    mockCourseModel = {
      find: jest.fn().mockReturnValue({
        sort: jest.fn().mockReturnValue({
          limit: jest.fn().mockReturnValue({
            lean: jest.fn().mockResolvedValue([
              {
                title: "Conducción Defensiva Urbana",
                level: "principiante",
                format: "presencial",
                subtitle: "Técnicas de frenado y evasión",
              },
            ]),
          }),
        }),
      }),
    };

    mockProductModel = {
      find: jest.fn().mockReturnValue({
        sort: jest.fn().mockReturnValue({
          limit: jest.fn().mockReturnValue({
            lean: jest.fn().mockResolvedValue([
              {
                name: "Chaqueta Oficial BSKMT",
                publicPrice: 350000,
                memberDiscountPercent: 20,
              },
            ]),
          }),
        }),
      }),
    };

    mockArphaModel = {
      findOne: jest.fn().mockReturnValue({
        sort: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue(null),
        }),
      }),
    };

    mockWhatsappService = {
      sendDirectWhatsapp: jest.fn().mockResolvedValue({ id: "wam_sent_123" }),
    };

    service = new BirdBotAccountService(
      mockUserModel as unknown as Model<UserDocument>,
      mockMotorcycleModel as unknown as Model<GarageMotorcycleDocument>,
      mockEventModel as unknown as Model<EventDocument>,
      mockCourseModel as unknown as Model<CourseDocument>,
      mockProductModel as unknown as Model<ProductDocument>,
      mockArphaModel as unknown as Model<ArphaRequestDocument>,
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

    it("should recognize numeric options and keywords", () => {
      expect(service.isAccountInquiry("0")).toBe(true);
      expect(service.isAccountInquiry("1")).toBe(true);
      expect(service.isAccountInquiry("2")).toBe(true);
      expect(service.isAccountInquiry("3")).toBe(true);
      expect(service.isAccountInquiry("4")).toBe(true);
      expect(service.isAccountInquiry("5")).toBe(true);
      expect(service.isAccountInquiry("6")).toBe(true);
      expect(service.isAccountInquiry("7")).toBe(true);
      expect(service.isAccountInquiry("8")).toBe(true);
      expect(service.isAccountInquiry("garage")).toBe(true);
      expect(service.isAccountInquiry("arpha")).toBe(true);
      expect(service.isAccountInquiry("rutas")).toBe(true);
      expect(service.isAccountInquiry("tienda")).toBe(true);
    });

    it("should return false for unrelated text", () => {
      expect(service.isAccountInquiry("Hola como te va")).toBe(false);
      expect(service.isAccountInquiry("Quiero pizza")).toBe(false);
      expect(service.isAccountInquiry("")).toBe(false);
    });
  });

  describe("handleAccountInquiry", () => {
    it("should send account report when user is found by document and cache session", async () => {
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
            year: 2024,
            plate: "ABC12D",
            color: "Negro",
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
      expect(payload.text).toContain("RESUMEN DE TU CUENTA BSKMT");
      expect(payload.text).toContain("James Andres");
      expect(payload.text).toContain("102****50");
      expect(payload.text).toContain("Legend");
      expect(payload.text).toContain("#007");

      // Now test that subsequent numeric query '1' uses cached session for detailed garage view
      const garageResult = await service.handleAccountInquiry({
        from: "CO.2041512499849757",
        text: "1",
      });
      expect(garageResult).toBe(true);
      const secondCall = mockWhatsappService.sendDirectWhatsapp.mock
        .calls as unknown as [unknown, [OutboundWhatsappMessage]];
      const garagePayload = secondCall[1][0];
      expect(garagePayload.text).toContain("ESTADO DE TU GARAGE BSKMT");
      expect(garagePayload.text).toContain("Yamaha MT-09 (2024)");
      expect(garagePayload.text).toContain("Pico y Placa");
    });

    it("should return upcoming events when user queries 'rutas'", async () => {
      const result = await service.handleAccountInquiry({
        from: "+573001234567",
        text: "rutas",
      });

      expect(result).toBe(true);
      const calls = mockWhatsappService.sendDirectWhatsapp.mock
        .calls as unknown as [[OutboundWhatsappMessage]];
      const payload = calls[0][0];
      expect(payload.text).toContain("PRÓXIMAS RODADAS OFICIALES BSKMT");
      expect(payload.text).toContain("Rodada Alto de Letras");
      expect(payload.text).toContain("Bomba Mobil Calle 80");
    });

    it("should return courses when user queries 'academia'", async () => {
      const result = await service.handleAccountInquiry({
        from: "+573001234567",
        text: "academia",
      });

      expect(result).toBe(true);
      const calls = mockWhatsappService.sendDirectWhatsapp.mock
        .calls as unknown as [[OutboundWhatsappMessage]];
      const payload = calls[0][0];
      expect(payload.text).toContain("CURSOS ACADEMIA BSKMT");
      expect(payload.text).toContain("Conducción Defensiva Urbana");
    });

    it("should return main menu when user queries '0' or 'menu'", async () => {
      const result = await service.handleAccountInquiry({
        from: "+573001234567",
        text: "0",
      });

      expect(result).toBe(true);
      const calls = mockWhatsappService.sendDirectWhatsapp.mock
        .calls as unknown as [[OutboundWhatsappMessage]];
      const payload = calls[0][0];
      expect(payload.text).toContain(
        "Centro de Autogestión BSK Motorcycle Team",
      );
      expect(payload.text).toContain("1️⃣ 👤 *Mi Cuenta y Garage*");
      expect(payload.text).toContain("3️⃣ 🚨 *Asistencia Vial ARPHA*");
    });

    it("should return ARPHA emergency triage when user queries 'arpha'", async () => {
      const result = await service.handleAccountInquiry({
        from: "+573001234567",
        text: "arpha",
      });

      expect(result).toBe(true);
      const calls = mockWhatsappService.sendDirectWhatsapp.mock
        .calls as unknown as [[OutboundWhatsappMessage]];
      const payload = calls[0][0];
      expect(payload.text).toContain(
        "ÁREA 3: CENTRO DE ASISTENCIA VIAL ARPHA 24/7",
      );
      expect(payload.text).toContain("1️⃣ 🚜 *Solicitar Grúa en Ruta*");
      expect(payload.text).toContain(
        "5️⃣ 📞 *Línea Telefónica de Emergencia Directa*",
      );
    });
  });
});
