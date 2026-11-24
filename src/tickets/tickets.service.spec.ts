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
  findOne: jest.Mock;
  findById: jest.Mock;
  aggregate: jest.Mock;
}

describe("TicketsService", () => {
  let service: TicketsService;
  let mockTicketModel: MockTicketModel;
  let mockEmailService: { sendNotificationEmail: jest.Mock };
  let mockContactService: { syncContact: jest.Mock; syncUser: jest.Mock };
  let mockUsersService: {
    findById: jest.Mock;
    findByEmail: jest.Mock;
    findByPhone: jest.Mock;
  };
  let mockSmsService: { sendNotificationSms: jest.Mock };
  let mockWhatsappService: {
    sendNotificationWhatsapp: jest.Mock;
    sendDirectWhatsapp: jest.Mock;
  };
  let mockRealtimeService: {
    isRealtimeConfigured: jest.Mock;
    publishToChannel: jest.Mock;
    publishToMember: jest.Mock;
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
      findOne: jest.fn().mockResolvedValue(null),
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
      syncUser: jest
        .fn()
        .mockResolvedValue({ success: true, contactId: "bird-member-456" }),
    };

    mockUsersService = {
      findById: jest.fn().mockResolvedValue({
        _id: "usr1",
        betterAuthId: "ba_usr1",
        name: "Agente 1",
        email: "agente1@bskmt.com",
      }),
      findByEmail: jest.fn().mockResolvedValue(null),
      findByPhone: jest.fn().mockResolvedValue(null),
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
      publishToMember: jest.fn().mockResolvedValue(undefined),
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
    const sentEmailCall = (
      mockEmailService.sendNotificationEmail.mock.calls[0] as [
        { message: string },
      ]
    )[0];
    expect(sentEmailCall.message).toContain("https://dash.bskmt.com/soporte");
  });

  it("debe respetar sendEmail: false y omitir correos sintéticos @inbound.bskmt.com", async () => {
    const mockTicket = {
      _id: "60f1b2b3c4d5e6f7a8b9c0d2",
      ticketNumber: "TK-2026-01007",
      subject: "Consulta WhatsApp",
      status: TicketStatus.ABIERTO,
      customer: {
        name: "Piloto",
        email: "piloto@gmail.com",
        userId: "usr1",
      },
      sla: { firstRespondedAt: null },
      messages: [] as unknown[],
      auditLog: [] as unknown[],
      save: jest.fn().mockImplementation(function (this: unknown) {
        return Promise.resolve(this);
      }),
    };
    mockTicketModel.findById.mockResolvedValue(mockTicket);

    await service.replyTicket(
      "60f1b2b3c4d5e6f7a8b9c0d2",
      { content: "Respuesta sin correo", sendEmail: false },
      {
        userId: "agent1",
        name: "Agente BSK",
        email: "soporte@bskmt.com",
        isAgent: true,
      },
    );

    await new Promise((resolve) => setImmediate(resolve));

    expect(mockEmailService.sendNotificationEmail).not.toHaveBeenCalled();
    expect(mockRealtimeService.publishToMember).toHaveBeenCalledWith(
      "ba_usr1",
      "support.ticket_replied",
      expect.any(Object),
    );
  });

  it("debe usar syncUser para miembros registrados en lugar de degradar rol con syncContact", async () => {
    mockUsersService.findByEmail.mockResolvedValueOnce({
      _id: "usr_member_1",
      email: "legend@gmail.com",
      role: "member",
    });

    await service.createTicket({
      subject: "Soporte membresía",
      description: "Necesito ayuda con mi membresía Legend",
      customerName: "Rider Legend",
      customerEmail: "legend@gmail.com",
      channel: TicketChannel.WEB_CONTACT,
    });

    expect(mockContactService.syncUser).toHaveBeenCalledTimes(1);
    expect(mockContactService.syncContact).not.toHaveBeenCalled();
  });

  it("debe deduplicar mensajes entrantes por messageId en handleInboundMessage", async () => {
    const existing = { _id: "tk_dup", ticketNumber: "TK-2026-01008" };
    mockTicketModel.findOne.mockResolvedValueOnce(existing);

    const res = await service.handleInboundMessage({
      channel: TicketChannel.WHATSAPP,
      from: "+573001234567",
      to: "+573169588444",
      text: "Mensaje repetido",
      messageId: "wam_duplicate_1",
    });

    expect(res).toBe(existing);
    expect(mockTicketModel.findOne).toHaveBeenCalledWith({
      "messages.messageId": "wam_duplicate_1",
    });
  });
});
