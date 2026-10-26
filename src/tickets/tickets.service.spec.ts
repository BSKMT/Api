import { Test, TestingModule } from "@nestjs/testing";
import { getModelToken } from "@nestjs/mongoose";
import { TicketsService } from "./tickets.service";
import { Ticket, TicketStatus, TicketChannel } from "./schemas/ticket.schema";
import { BirdEmailService } from "../bird/bird-email.service";
import { BirdContactService } from "../bird/bird-contact.service";
import { BirdSmsService } from "../bird/bird-sms.service";
import { BirdWhatsappService } from "../bird/bird-whatsapp.service";
import { BirdRealtimeService } from "../bird/bird-realtime.service";
import { UsersService } from "../users/users.service";

interface MockTicketModel {
  (...args: unknown[]): { save: jest.Mock };
  countDocuments: jest.Mock;
  find: jest.Mock;
  findById: jest.Mock;
  aggregate: jest.Mock;
}

describe("TicketsService", () => {
  let service: TicketsService;
  let mockTicketModel: MockTicketModel;
  let mockEmailService: { sendNotificationEmail: jest.Mock };
  let mockContactService: { syncContact: jest.Mock };
  let mockUsersService: { findById: jest.Mock };
  let mockSmsService: { sendNotificationSms: jest.Mock };
  let mockWhatsappService: {
    sendNotificationWhatsapp: jest.Mock;
    sendDirectWhatsapp: jest.Mock;
  };
  let mockRealtimeService: {
    isRealtimeConfigured: jest.Mock;
    publishToChannel: jest.Mock;
  };

  beforeEach(async () => {
    const modelFn = jest
      .fn()
      .mockImplementation((data: Record<string, unknown>) => ({
        ...data,
        save: jest
          .fn()
          .mockResolvedValue({ _id: "60f1b2b3c4d5e6f7a8b9c0d1", ...data }),
      }));
    mockTicketModel = Object.assign(modelFn, {
      countDocuments: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue(5),
      }),
      find: jest.fn().mockReturnValue({
        sort: jest.fn().mockReturnValue({
          skip: jest.fn().mockReturnValue({
            limit: jest.fn().mockReturnValue({
              exec: jest.fn().mockResolvedValue([]),
            }),
          }),
          exec: jest.fn().mockResolvedValue([]),
        }),
      }),
      findById: jest.fn(),
      aggregate: jest.fn().mockResolvedValue([]),
    });

    mockEmailService = {
      sendNotificationEmail: jest.fn().mockResolvedValue(true),
    };

    mockContactService = {
      syncContact: jest
        .fn()
        .mockResolvedValue({ success: true, contactId: "bird-123" }),
    };

    mockUsersService = {
      findById: jest.fn().mockResolvedValue({
        _id: "usr1",
        name: "Agente 1",
        email: "agente1@bskmt.com",
      }),
    };

    mockSmsService = {
      sendNotificationSms: jest.fn().mockResolvedValue(true),
    };

    mockWhatsappService = {
      sendNotificationWhatsapp: jest.fn().mockResolvedValue(true),
      sendDirectWhatsapp: jest.fn().mockResolvedValue(true),
    };

    mockRealtimeService = {
      isRealtimeConfigured: jest.fn().mockReturnValue(true),
      publishToChannel: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TicketsService,
        { provide: getModelToken(Ticket.name), useValue: mockTicketModel },
        { provide: BirdEmailService, useValue: mockEmailService },
        { provide: BirdContactService, useValue: mockContactService },
        { provide: UsersService, useValue: mockUsersService },
        { provide: BirdSmsService, useValue: mockSmsService },
        { provide: BirdWhatsappService, useValue: mockWhatsappService },
        { provide: BirdRealtimeService, useValue: mockRealtimeService },
      ],
    }).compile();

    service = module.get<TicketsService>(TicketsService);
  });

  it("debe estar definido", () => {
    expect(service).toBeDefined();
  });

  it("debe crear un ticket y sincronizar con Bird CRM", async () => {
    const result = await service.createTicket({
      subject: "Consulta sobre rodada",
      description:
        "Quisiera información sobre los requisitos para la rodada de este fin de semana",
      customerName: "Carlos Piloto",
      customerEmail: "carlos@example.com",
      channel: TicketChannel.WEB_CONTACT,
    });

    expect(result).toBeDefined();
    expect(result.ticketNumber).toBe("TK-2026-01006");
    expect(mockContactService.syncContact).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "carlos@example.com",
        primerNombre: "Carlos",
      }),
    );
    expect(mockEmailService.sendNotificationEmail).toHaveBeenCalled();
  });

  it("debe registrar respuesta pública de agente y enviar correo", async () => {
    const mockTicket = {
      _id: "60f1b2b3c4d5e6f7a8b9c0d1",
      ticketNumber: "TK-2026-01006",
      subject: "Consulta",
      status: TicketStatus.NUEVO,
      customer: { name: "Carlos", email: "carlos@example.com" },
      sla: { firstRespondedAt: null },
      messages: [] as unknown[],
      auditLog: [] as unknown[],
      save: jest.fn().mockImplementation(function (this: unknown) {
        return Promise.resolve(this);
      }),
    };
    mockTicketModel.findById.mockResolvedValue(mockTicket);

    await service.replyTicket(
      "60f1b2b3c4d5e6f7a8b9c0d1",
      {
        content:
          "Hola Carlos, te confirmamos que tu moto cumple los requisitos.",
      },
      {
        userId: "agent1",
        name: "Agente BSK",
        email: "soporte@bskmt.com",
        isAgent: true,
      },
    );

    expect(mockTicket.status).toBe(TicketStatus.PENDIENTE);
    expect(mockTicket.sla.firstRespondedAt).toBeInstanceOf(Date);
    expect(mockTicket.messages).toHaveLength(1);
    expect(mockEmailService.sendNotificationEmail).toHaveBeenCalled();
  });
});
