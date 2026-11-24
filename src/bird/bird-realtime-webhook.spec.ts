import { Logger } from "@nestjs/common";
import {
  extractInboundMessageFromWebhook,
  handleWebhookInboundMessage,
} from "./bird-realtime-webhook.helpers";
import {
  signMemberAuth,
  signChannelAuth,
  resolveSafeRealtimeDisplayName,
} from "./bird-realtime-auth.helpers";
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

    it("should return null for outbound or non-message webhook events (prevents echo loops)", () => {
      const outboundEvents: BirdWebhookEvent[] = [
        {
          type: "whatsapp.delivered",
          data: { direction: "outbound", status: "delivered" },
        },
        {
          type: "whatsapp.message.sent",
          data: {
            whatsapp_id: "wam_echo",
            direction: "outbound",
            from: { phone_number: "+573169588444" },
            to: { phone_number: "+573001234567" },
            text: { body: "auto-reply" },
          },
        },
        {
          type: "sms.sent",
          data: {
            sms_id: "sms_echo",
            from: "901444",
            to: "+573001234567",
            body: "BSKMT",
          },
        },
        {
          type: "email.bounced",
          data: {
            email_id: "em_bounce",
            from: "no_responder@bskmt.com",
            to: ["user@example.com"],
            subject: "Bounce",
          },
        },
      ];

      for (const evt of outboundEvents) {
        expect(extractInboundMessageFromWebhook(evt)).toBeNull();
      }
    });

    it("should extract SDK 0.147 whatsapp_id, sms_id, and email.received with array recipients", () => {
      const waEvt: BirdWebhookEvent = {
        type: "whatsapp.received",
        data: {
          whatsapp_id: "wam_sdk0147",
          from: { phone_number: "+573001234567" },
          to: { phone_number: "+573169588444" },
          text: { body: "Hola SDK 0.147" },
        },
      };
      expect(extractInboundMessageFromWebhook(waEvt)?.messageId).toBe(
        "wam_sdk0147",
      );

      const smsEvt: BirdWebhookEvent = {
        type: "sms.received",
        data: {
          sms_id: "sms_sdk0147",
          from: "+573001234567",
          to: "901444",
          body: "Consulta SMS",
        },
      };
      const parsedSms = extractInboundMessageFromWebhook(smsEvt);
      expect(parsedSms?.channel).toBe(TicketChannel.SMS);
      expect(parsedSms?.messageId).toBe("sms_sdk0147");

      const emailEvt: BirdWebhookEvent = {
        type: "email.received",
        data: {
          inbound_message_id: "inb_01m999",
          from: "piloto@gmail.com",
          to: ["soporte@bskmt.com"],
          subject: "Consulta rodada",
        },
      };
      const parsedEmail = extractInboundMessageFromWebhook(emailEvt);
      expect(parsedEmail?.channel).toBe(TicketChannel.EMAIL);
      expect(parsedEmail?.to).toBe("soporte@bskmt.com");
      expect(parsedEmail?.inboundEmailId).toBe("inb_01m999");
      expect(parsedEmail?.messageId).toBe("inb_01m999");
    });
  });

  describe("handleWebhookInboundMessage", () => {
    it("should fetch full inbound email body via fetchEmailBody callback", async () => {
      const handleInboundMock = jest.fn().mockResolvedValue({});
      const fetchBodyMock = jest
        .fn()
        .mockResolvedValue("Cuerpo completo del correo entrante.");
      const mockTicketsService = {
        handleInboundMessage: handleInboundMock,
      } as unknown as TicketsService;

      const emailEvt: BirdWebhookEvent = {
        type: "email.received",
        data: {
          inbound_message_id: "inb_01m999",
          from: "piloto@gmail.com",
          to: ["soporte@bskmt.com"],
          subject: "Consulta rodada",
        },
      };

      await handleWebhookInboundMessage(
        emailEvt,
        mockTicketsService,
        logger,
        fetchBodyMock,
      );

      expect(fetchBodyMock).toHaveBeenCalledWith("inb_01m999");
      expect(handleInboundMock).toHaveBeenCalledWith(
        expect.objectContaining({
          channel: TicketChannel.EMAIL,
          from: "piloto@gmail.com",
          to: "soporte@bskmt.com",
          text: "Consulta rodada\n\nCuerpo completo del correo entrante.",
          messageId: "inb_01m999",
        }),
      );
    });

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

  describe("BirdRealtimeAuthHelpers security hardening (CWE-347 & PII)", () => {
    it("rejects connection_id containing ':' delimiter to prevent HMAC signature forgery", () => {
      expect(() =>
        signMemberAuth("key", "secret", "conn:private-admin", "member1"),
      ).toThrow();
      expect(() =>
        signChannelAuth(
          "key",
          "secret",
          "conn:private-admin",
          "private-user-member1",
        ),
      ).toThrow();
    });

    it("never leaks raw email addresses in presence displayName", () => {
      expect(resolveSafeRealtimeDisplayName("piloto@gmail.com", "member")).toBe(
        "Miembro BSK",
      );
      expect(resolveSafeRealtimeDisplayName("admin@bskmt.com", "admin")).toBe(
        "Staff BSK",
      );
      expect(resolveSafeRealtimeDisplayName("Carlos Moto", "member")).toBe(
        "Carlos Moto",
      );
    });
  });
});
