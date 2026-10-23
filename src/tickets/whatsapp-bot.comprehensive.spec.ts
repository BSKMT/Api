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

describe("WhatsappBotService - Pruebas Exhaustivas de Cobertura Total", () => {
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
      _id: "6a7d2afbdfc9ac9b97c65f5f",
      ticketNumber: "TK-2026-99999",
      subject: "Atención WhatsApp SuperAdmin",
      description: "Chat entrante",
      category: TicketCategory.GENERAL,
      priority: TicketPriority.ALTA,
      status: TicketStatus.NUEVO,
      channel: TicketChannel.WHATSAPP,
      interactionMode: mode,
      botState,
      customer: {
        name: "James Andres Cespedes Ibarra",
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

  describe("Navegación de submenús específicos", () => {
    it.each([
      { state: "MEMBERSHIP", input: "1.2", keyword: "PLANES Y PRECIOS" },
      { state: "EVENTS", input: "2.1", keyword: "CALENDARIO" },
      { state: "EVENTS", input: "2.2", keyword: "PUNTOS DE ENCUENTRO" },
      { state: "ACADEMY", input: "3.1", keyword: "CONDUCCIÓN PREVENTIVA" },
      { state: "ACADEMY", input: "3.2", keyword: "TRAZADO DE CURVAS" },
      { state: "ARPHA", input: "4.1", keyword: "GRÚA" },
      { state: "ARPHA", input: "4.4", keyword: "COBERTURA" },
      { state: "SHOP", input: "5.1", keyword: "CHAQUETAS" },
      { state: "SHOP", input: "5.2", keyword: "IMPERMEABLES" },
      { state: "ACCOUNT", input: "6.1", keyword: "CARNET DIGITAL" },
      { state: "ACCOUNT", input: "6.2", keyword: "RENOVACIÓN" },
      { state: "FAQ", input: "7.1", keyword: "SEDE" },
    ])(
      "En estado $state con opción '$input' responde con '$keyword'",
      async ({ state, input, keyword }) => {
        const ticket = createMockTicket(TicketInteractionMode.BOT, state);
        const res = await service.processInboundWhatsappMessage({
          ticket,
          text: input,
          customerName: "James Andres Cespedes Ibarra",
          customerPhone: "+573245413293",
        });
        expect(res.replyText).toContain(keyword);
      },
    );
  });

  describe("Reconocimiento de Intenciones en Lenguaje Natural (NLP)", () => {
    it.each([
      {
        prompt: "¿Cómo me afilio al club?",
        state: "MEMBERSHIP",
        keyword: "MEMBRESÍAS",
      },
      {
        prompt: "Cuándo es la siguiente rodada motera",
        state: "EVENTS",
        keyword: "RODADAS",
      },
      {
        prompt: "Quiero un curso para aprender a manejar moto",
        state: "ACADEMY",
        keyword: "ACADEMIA",
      },
      {
        prompt: "Necesito una grua me quede varado",
        state: "ARPHA",
        keyword: "ARPHA",
      },
      {
        prompt: "Quiero comprar una chaqueta motera",
        state: "SHOP",
        keyword: "TIENDA",
      },
      {
        prompt: "Dónde descargo mi carnet digital",
        state: "ACCOUNT",
        keyword: "CARNET DIGITAL",
      },
      {
        prompt: "Dónde queda la sede principal",
        state: "FAQ",
        keyword: "SEDE",
      },
    ])(
      "Interpreta '$prompt' -> estado $state",
      async ({ prompt, state, keyword }) => {
        const ticket = createMockTicket(TicketInteractionMode.BOT, "MAIN");
        const res = await service.processInboundWhatsappMessage({
          ticket,
          text: prompt,
          customerName: "James Andres Cespedes Ibarra",
          customerPhone: "+573245413293",
        });
        expect(res.nextState).toBe(state);
        expect(res.replyText).toContain(keyword);
      },
    );
  });

  describe("Escalamiento a Asesor en Vivo y Emergencias", () => {
    it.each([
      { input: "0", state: "MAIN" },
      { input: "asesor", state: "MAIN" },
      { input: "quiero hablar con un humano", state: "MEMBERSHIP" },
      { input: "operador en vivo por favor", state: "ARPHA" },
      { input: "4.3", state: "ARPHA" },
    ])(
      "Escala a live_agent con input '$input' en estado $state",
      async ({ input, state }) => {
        const ticket = createMockTicket(TicketInteractionMode.BOT, state);
        const res = await service.processInboundWhatsappMessage({
          ticket,
          text: input,
          customerName: "James Andres Cespedes Ibarra",
          customerPhone: "+573245413293",
        });

        expect(res.escalatedToLiveAgent).toBe(true);
        expect(ticket.interactionMode).toBe(TicketInteractionMode.LIVE_AGENT);
        expect(mockRealtimeService.publishToChannel).toHaveBeenCalledWith(
          "private-admin",
          "support.live_chat_requested",
          expect.objectContaining({
            ticketNumber: "TK-2026-99999",
          }),
        );
      },
    );
  });

  describe("Navegación Global y Manejo de Respuestas no Reconocidas", () => {
    it("debe regresar al menú principal al escribir 'volver' desde cualquier submenú", async () => {
      const ticket = createMockTicket(TicketInteractionMode.BOT, "SHOP");
      const res = await service.processInboundWhatsappMessage({
        ticket,
        text: "volver al menu",
        customerName: "James Andres Cespedes Ibarra",
        customerPhone: "+573245413293",
      });
      expect(res.nextState).toBe("MAIN");
      expect(res.replyText).toContain(
        "BSK MOTORCYCLE TEAM — ATENCIÓN AL CLIENTE",
      );
    });

    it("debe ofrecer opciones de ayuda claras si el mensaje no coincide", async () => {
      const ticket = createMockTicket(TicketInteractionMode.BOT, "MAIN");
      const res = await service.processInboundWhatsappMessage({
        ticket,
        text: "xyz987palabraDesconocida",
        customerName: "James Andres Cespedes Ibarra",
        customerPhone: "+573245413293",
      });
      expect(res.replyText).toContain("No logré identificar esa opción");
    });
  });
});
