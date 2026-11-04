import { Logger } from "@nestjs/common";
import {
  extractInboundMessageFromWebhook,
  handleWebhookInboundMessage,
} from "./bird-realtime-webhook.helpers";
import { TicketChannel } from "../tickets/schemas/ticket.schema";
import type { BirdWebhookEvent } from "./bird-realtime.interfaces";
import type { TicketsService } from "../tickets/tickets.service";

describe("BirdRealtimeWebhookHelpers", () => {
  const logger = new Logger("TestLogger");

  describe("extractInboundMessageFromWebhook", () => {
    it("should extract inbound WhatsApp message from standard Bird unwrapped event with BSUID", () => {
      const event: BirdWebhookEvent = {
        id: "whe_test123",
        type: "whatsapp.received",
        timestamp: "2026-10-24T00:14:38Z",
        data: {
          id: "wam_01m5nm4qgge00afxg5cw7dhv0p",
          direction: "inbound",
          status: "received",
          from: {
            bsuid: "CO.2041512499849757",
            display_name: "James Andres",
            username: "jacivy",
          },
          to: {
            phone_number: "+573169588444",
          },
          text: {
            body: "hola",
          },
        },
      };

      const result = extractInboundMessageFromWebhook(event);

      expect(result).not.toBeNull();
      expect(result?.channel).toBe(TicketChannel.WHATSAPP);
      expect(result?.from).toBe("CO.2041512499849757");
      expect(result?.to).toBe("+573169588444");
      expect(result?.text).toBe("hola");
      expect(result?.senderName).toBe("James Andres");
      expect(result?.messageId).toBe("wam_01m5nm4qgge00afxg5cw7dhv0p");
    });

    it("should extract inbound WhatsApp message with standard E.164 phone numbers", () => {
      const event: BirdWebhookEvent = {
        type: "whatsapp.received",
        data: {
          id: "wam_test_e164",
          status: "received",
          from: {
            phone_number: "+573001234567",
            display_name: "Motero BSK",
          },
          to: {
            phone_number: "+573169588444",
          },
          text: {
            body: "1",
          },
        },
      };

      const result = extractInboundMessageFromWebhook(event);

      expect(result).not.toBeNull();
      expect(result?.channel).toBe(TicketChannel.WHATSAPP);
      expect(result?.from).toBe("+573001234567");
      expect(result?.to).toBe("+573169588444");
      expect(result?.text).toBe("1");
      expect(result?.senderName).toBe("Motero BSK");
    });

    it("should extract interactive button reply text", () => {
      const event: BirdWebhookEvent = {
        type: "whatsapp.received",
        data: {
          id: "wam_interactive",
          direction: "inbound",
          from: {
            bsuid: "CO.2041512499849757",
          },
          to: {
            phone_number: "+573169588444",
          },
          interactive_reply: {
            title: "Membresías Legend",
          },
        },
      };

      const result = extractInboundMessageFromWebhook(event);

      expect(result).not.toBeNull();
      expect(result?.text).toBe("Membresías Legend");
    });

    it("should return null for outbound or non-message webhook events", () => {
      const outboundEvent: BirdWebhookEvent = {
        type: "whatsapp.delivered",
        data: {
          direction: "outbound",
          status: "delivered",
        },
      };

      expect(extractInboundMessageFromWebhook(outboundEvent)).toBeNull();
    });
  });

  describe("handleWebhookInboundMessage", () => {
    it("should call ticketsService.handleInboundMessage when event is valid", async () => {
      const handleInboundMock = jest.fn().mockResolvedValue({});
      const mockTicketsService = {
        handleInboundMessage: handleInboundMock,
      } as unknown as TicketsService;

      const event: BirdWebhookEvent = {
        type: "whatsapp.received",
        data: {
          id: "wam_test",
          direction: "inbound",
          from: { bsuid: "CO.2041512499849757", display_name: "James Andres" },
          to: { phone_number: "+573169588444" },
          text: { body: "hola bot" },
        },
      };

      await handleWebhookInboundMessage(event, mockTicketsService, logger);

      expect(handleInboundMock).toHaveBeenCalledTimes(1);
      expect(handleInboundMock).toHaveBeenCalledWith({
        channel: TicketChannel.WHATSAPP,
        from: "CO.2041512499849757",
        to: "+573169588444",
        text: "hola bot",
        senderName: "James Andres",
        messageId: "wam_test",
      });
    });

    it("should do nothing if ticketsService is undefined", async () => {
      const event: BirdWebhookEvent = {
        type: "whatsapp.received",
        data: {
          from: { bsuid: "CO.2041512499849757" },
          text: { body: "hola" },
        },
      };

      await expect(
        handleWebhookInboundMessage(event, undefined, logger),
      ).resolves.toBeUndefined();
    });
  });
});
