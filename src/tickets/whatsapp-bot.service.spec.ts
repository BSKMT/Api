import { Test, TestingModule } from "@nestjs/testing";
import { WhatsappBotService } from "./whatsapp-bot.service";
import { BirdWhatsappService } from "../bird/bird-whatsapp.service";
import { BirdRealtimeService } from "../bird/bird-realtime.service";
import {
  TicketDocument,
  TicketInteractionMode,
  TicketStatus,
  TicketChannel,
  TicketCategory,
  TicketPriority,
} from "./schemas/ticket.schema";

describe("WhatsappBotService", () => {
  let service: WhatsappBotService;
  let mockWhatsappService: {
    sendDirectWhatsapp: jest.Mock<
      Promise<boolean>,
      [{ to: string; text: string }]
    >;
  };
  let mockRealtimeService: {
    isRealtimeConfigured: jest.Mock<boolean, []>;
    publishToChannel: jest.Mock<
      Promise<boolean>,
      [string, string, Record<string, unknown>]
    >;
  };

  const createMockTicket = (
    mode = TicketInteractionMode.BOT,
    botState = "MAIN",
  ): TicketDocument => {
    return {
      _id: "60f1b2b3c4d5e6f7a8b9c0d1",
      ticketNumber: "TK-2026-01001",
      subject: "Consulta WhatsApp",
      description: "Hola",
      category: TicketCategory.GENERAL,
      priority: TicketPriority.MEDIA,
      status: TicketStatus.NUEVO,
      channel: TicketChannel.WHATSAPP,
      interactionMode: mode,
      botState,
      customer: {
        name: "Andrés Céspedes",
        email: "cespedesandres1996@hotmail.com",
        phone: "+573245413293",
      },
      messages: [],
      auditLog: [],
      save: jest.fn().mockResolvedValue(this),
    } as unknown as TicketDocument;
  };

  beforeEach(async () => {
    mockWhatsappService = {
      sendDirectWhatsapp: jest.fn<
        Promise<boolean>,
        [{ to: string; text: string }]
      >(() => Promise.resolve(true)),
    };
    mockRealtimeService = {
      isRealtimeConfigured: jest.fn<boolean, []>(() => true),
      publishToChannel: jest.fn<
        Promise<boolean>,
        [string, string, Record<string, unknown>]
      >(() => Promise.resolve(true)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WhatsappBotService,
        { provide: BirdWhatsappService, useValue: mockWhatsappService },
        { provide: BirdRealtimeService, useValue: mockRealtimeService },
      ],
    }).compile();

    service = module.get<WhatsappBotService>(WhatsappBotService);
  });

  it("debe responder con el menú principal si el usuario saluda o escribe 'menu'", async () => {
    const ticket = createMockTicket(TicketInteractionMode.BOT, "MAIN");

    const result = await service.processInboundWhatsappMessage({
      ticket,
      text: "Hola buenas tardes",
      customerName: "Andrés Céspedes",
      customerPhone: "+573245413293",
    });

    expect(result.escalatedToLiveAgent).toBe(false);
    expect(result.nextState).toBe("MAIN");
    expect(result.replyText).toContain(
      "BSK MOTORCYCLE TEAM — ATENCIÓN AL CLIENTE",
    );
    expect(result.replyText).toContain("1️⃣ *Membresías Legend BSKMT*");
    expect(mockWhatsappService.sendDirectWhatsapp).toHaveBeenCalledTimes(1);
    const firstCall = mockWhatsappService.sendDirectWhatsapp.mock.calls[0];
    expect(firstCall).toBeDefined();
    if (firstCall) {
      expect(firstCall[0].to).toBe("+573245413293");
      expect(firstCall[0].text).toContain("Membresías Legend BSKMT");
    }
  });

  it.each([
    {
      option: "1",
      expectedState: "MEMBERSHIP",
      expectedText: "MEMBRESÍAS LEGEND BSK MOTORCYCLE TEAM",
    },
    {
      option: "2",
      expectedState: "EVENTS",
      expectedText: "RODADAS Y CALENDARIO OFICIAL BSKMT",
    },
    {
      option: "3",
      expectedState: "ACADEMY",
      expectedText: "ACADEMIA READY TO RIDE BSKMT",
    },
    {
      option: "4",
      expectedState: "ARPHA",
      expectedText: "RED DE AUXILIO VIAL ARPHA 24/7",
    },
  ])(
    "debe navegar y responder adecuadamente a la opción '$option' del menú principal",
    async ({ option, expectedState, expectedText }) => {
      const ticket = createMockTicket(TicketInteractionMode.BOT, "MAIN");

      const result = await service.processInboundWhatsappMessage({
        ticket,
        text: option,
        customerName: "Andrés Céspedes",
        customerPhone: "+573245413293",
      });

      expect(result.nextState).toBe(expectedState);
      expect(result.replyText).toContain(expectedText);
    },
  );

  it("debe entregar los detalles de beneficios si el usuario responde '1.1' en Membresías", async () => {
    const ticket = createMockTicket(TicketInteractionMode.BOT, "MEMBERSHIP");

    const result = await service.processInboundWhatsappMessage({
      ticket,
      text: "1.1",
      customerName: "Andrés Céspedes",
      customerPhone: "+573245413293",
    });

    expect(result.replyText).toContain(
      "BENEFICIOS EXCLUSIVOS MEMBRESÍA LEGEND BSKMT",
    );
    expect(result.replyText).toContain("Auxilio Vial ARPHA 24/7");
    expect(result.replyText).toContain("Carnet Digital Oficial con QR");
  });

  it("debe escalar inmediatamente a Asesor en Vivo si el usuario escribe 'asesor'", async () => {
    const ticket = createMockTicket(TicketInteractionMode.BOT, "MAIN");

    const result = await service.processInboundWhatsappMessage({
      ticket,
      text: "Quiero hablar con un asesor por favor",
      customerName: "Andrés Céspedes",
      customerPhone: "+573245413293",
    });

    expect(result.escalatedToLiveAgent).toBe(true);
    expect(result.nextState).toBe("LIVE_AGENT");
    expect(ticket.interactionMode).toBe(TicketInteractionMode.LIVE_AGENT);
    expect(ticket.status).toBe(TicketStatus.ABIERTO);
    expect(result.replyText).toContain("SOLICITUD DE ASESOR EN VIVO CONECTADA");
    expect(mockRealtimeService.publishToChannel).toHaveBeenCalledWith(
      "private-admin",
      "support.live_chat_requested",
      expect.objectContaining({
        ticketNumber: "TK-2026-01001",
      }),
    );
  });

  it("debe reconocer intenciones naturales de lenguaje como 'cuanto cuesta la membresia'", async () => {
    const ticket = createMockTicket(TicketInteractionMode.BOT, "MAIN");

    const result = await service.processInboundWhatsappMessage({
      ticket,
      text: "quisiera saber cuanto cuesta la membresia",
      customerName: "Andrés Céspedes",
      customerPhone: "+573245413293",
    });

    expect(result.nextState).toBe("MEMBERSHIP");
    expect(result.replyText).toContain("MEMBRESÍAS LEGEND BSK MOTORCYCLE TEAM");
  });
});
