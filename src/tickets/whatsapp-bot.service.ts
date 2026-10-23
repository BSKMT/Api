import { Injectable, Logger } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import {
  TicketDocument,
  TicketInteractionMode,
  TicketStatus,
} from "./schemas/ticket.schema";
import { BirdWhatsappService } from "../bird/bird-whatsapp.service";
import { BirdRealtimeService } from "../bird/bird-realtime.service";
import { BotProcessResult } from "./bot/bot.types";
import { getMainMenuText, getEscalationReplyText } from "./bot/bot-texts-main";
import { evaluateBotResponse } from "./bot/bot-evaluators";

export type { BotProcessResult };

@Injectable()
export class WhatsappBotService {
  private readonly logger = new Logger(WhatsappBotService.name);

  constructor(
    private readonly birdWhatsappService: BirdWhatsappService,
    private readonly birdRealtimeService: BirdRealtimeService,
  ) {}

  /**
   * Procesa un mensaje entrante de WhatsApp cuando el ticket esta en modo BOT.
   * Ejecuta el arbol de decisiones, detecta intenciones o escala a asesor humano.
   */
  async processInboundWhatsappMessage(params: {
    ticket: TicketDocument;
    text: string;
    customerName: string;
    customerPhone: string;
  }): Promise<BotProcessResult> {
    const { ticket, text, customerName, customerPhone } = params;
    const cleanText = text.trim();
    const normalized = cleanText
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");

    const currentState = ticket.botState || "MAIN";
    this.logger.log(
      `Bot evaluando mensaje="${cleanText}" para ticket #${ticket.ticketNumber} [estado=${currentState}]`,
    );

    // 1. Deteccion de solicitud de escalamiento a asesor en vivo
    if (this.isEscalationRequested(normalized, currentState)) {
      return this.handleEscalationToLiveAgent(
        ticket,
        cleanText,
        customerName,
        customerPhone,
      );
    }

    // 2. Comandos de navegacion global (volver al menu principal)
    if (this.isNavigationToMainMenu(normalized)) {
      const replyText = getMainMenuText(customerName);
      await this.sendBotReply(ticket, customerPhone, replyText, "MAIN");
      return { replyText, nextState: "MAIN", escalatedToLiveAgent: false };
    }

    // 3. Evaluacion por estado o por intencion
    const result = evaluateBotResponse(currentState, normalized, cleanText);

    // Si el resultado solicita escalamiento (por ejemplo desde subopcion de emergencia)
    if (result.escalate) {
      return this.handleEscalationToLiveAgent(
        ticket,
        cleanText,
        customerName,
        customerPhone,
      );
    }

    await this.sendBotReply(
      ticket,
      customerPhone,
      result.text,
      result.nextState,
    );

    return {
      replyText: result.text,
      nextState: result.nextState,
      escalatedToLiveAgent: false,
    };
  }

  /**
   * Detecta si el usuario esta pidiendo un asesor humano
   */
  private isEscalationRequested(normalized: string, state: string): boolean {
    if (normalized === "0" && (state === "MAIN" || state === "" || !state)) {
      return true;
    }
    if (normalized === "*" || normalized === "asesor en vivo") {
      return true;
    }

    const keywords = [
      "asesor",
      "humano",
      "agente",
      "operador",
      "en vivo",
      "persona",
      "alguien",
      "hablar con asesor",
      "hablar con persona",
      "quiero un asesor",
      "comunicarme con asesor",
      "soporte humano",
      "atencion en vivo",
    ];

    return keywords.some((kw) => normalized.includes(kw));
  }

  /**
   * Detecta si el usuario desea regresar al menu inicial
   */
  private isNavigationToMainMenu(normalized: string): boolean {
    const mainKeywords = [
      "menu",
      "inicio",
      "volver",
      "regresar",
      "empezar",
      "hola",
      "buenos dias",
      "buenas tardes",
      "buenas noches",
      "hey",
      "saludos",
    ];
    return (
      normalized === "0" ||
      normalized === "menu principal" ||
      mainKeywords.some(
        (kw) =>
          normalized === kw ||
          normalized.startsWith(kw) ||
          normalized.includes("menu") ||
          normalized.includes("inicio") ||
          normalized.includes("volver") ||
          normalized.includes("hola") ||
          normalized.includes("buenos") ||
          normalized.includes("buenas"),
      )
    );
  }

  /**
   * Transfiere el ticket a modo LIVE_AGENT y notifica al cliente y a los gestores en Fascia
   */
  private async handleEscalationToLiveAgent(
    ticket: TicketDocument,
    userPrompt: string,
    customerName: string,
    customerPhone: string,
  ): Promise<BotProcessResult> {
    ticket.interactionMode = TicketInteractionMode.LIVE_AGENT;
    ticket.status = TicketStatus.ABIERTO;
    ticket.auditLog.push({
      action: "escalated_to_live_agent",
      performedBy: customerName,
      details: { prompt: userPrompt, phone: customerPhone },
      timestamp: new Date(),
    });

    const replyText = getEscalationReplyText(customerName);

    const systemMsg = {
      messageId: randomUUID(),
      sender: "system" as const,
      senderName: "Asistente Virtual BSKMT",
      content:
        "Conversación transferida a Asesor en Vivo. Modo live_agent activado.",
      isInternalNote: false,
      createdAt: new Date(),
    };
    ticket.messages.push(systemMsg);
    await ticket.save();

    await this.birdWhatsappService.sendDirectWhatsapp({
      to: customerPhone,
      text: replyText,
    });

    if (this.birdRealtimeService.isRealtimeConfigured()) {
      void this.birdRealtimeService.publishToChannel(
        "private-admin",
        "support.live_chat_requested",
        {
          ticketId: String(ticket._id),
          ticketNumber: ticket.ticketNumber,
          customer: ticket.customer,
          userPrompt,
          timestamp: new Date(),
        },
      );
      void this.birdRealtimeService.publishToChannel(
        "private-admin",
        "support.ticket_message_received",
        {
          ticketId: String(ticket._id),
          ticketNumber: ticket.ticketNumber,
          channel: "whatsapp",
          from: customerPhone,
          text: userPrompt,
          customer: ticket.customer,
          isLiveChat: true,
        },
      );
    }

    this.logger.log(
      `Ticket #${ticket.ticketNumber} transferido exitosamente a ASESOR EN VIVO para ${customerPhone}`,
    );

    return {
      replyText,
      nextState: "LIVE_AGENT",
      escalatedToLiveAgent: true,
    };
  }

  /**
   * Guarda el mensaje del bot en el historial del ticket y envia por WhatsApp
   */
  private async sendBotReply(
    ticket: TicketDocument,
    customerPhone: string,
    replyText: string,
    nextState: string,
  ): Promise<void> {
    ticket.botState = nextState;
    ticket.messages.push({
      messageId: randomUUID(),
      sender: "system",
      senderName: "Asistente Virtual BSKMT",
      content: replyText,
      isInternalNote: false,
      createdAt: new Date(),
    });
    await ticket.save();

    await this.birdWhatsappService.sendDirectWhatsapp({
      to: customerPhone,
      text: replyText,
    });
  }
}
