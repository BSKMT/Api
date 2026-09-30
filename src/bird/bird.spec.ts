import { Test, TestingModule } from "@nestjs/testing";
import { ForbiddenException, BadRequestException } from "@nestjs/common";
import { BirdRealtimeController } from "./bird-realtime.controller";
import { BirdRealtimeService } from "./bird-realtime.service";
import { BirdService } from "./bird.service";
import { BirdWhatsappService } from "./bird-whatsapp.service";
import { signMemberAuth, signChannelAuth } from "./bird-realtime.helpers";
import { createHmac } from "node:crypto";

describe("Bird Integration Suite", () => {
  describe("Bird HMAC-SHA256 Helpers", () => {
    const key = "test_key";
    const secret = "test_secret_32_bytes_long_value_123";
    const connectionId = "conn_abc123";
    const memberId = "cuid_user_999";

    it("should generate a valid member auth signature", () => {
      const res = signMemberAuth(
        key,
        secret,
        connectionId,
        memberId,
        "user",
        "Test User",
      );
      expect(res.auth).toBeDefined();
      expect(res.auth.startsWith(`${key}:`)).toBe(true);

      const memberData = JSON.stringify({
        member_id: memberId,
        member_info: { name: "Test User", role: "user" },
      });
      const expectedSig = createHmac("sha256", secret)
        .update(`${connectionId}::member::${memberData}`)
        .digest("hex");

      expect(res.auth).toBe(`${key}:${expectedSig}`);
      expect(res.member_data).toBe(memberData);
    });

    it("should generate private channel auth signatures", () => {
      const channelName = "private-user-123";
      const res = signChannelAuth(key, secret, connectionId, channelName);
      const expectedSig = createHmac("sha256", secret)
        .update(`${connectionId}:${channelName}`)
        .digest("hex");

      expect(res.auth).toBe(`${key}:${expectedSig}`);
    });
  });

  describe("BirdRealtimeController", () => {
    let controller: BirdRealtimeController;
    let mockRealtimeService: Partial<BirdRealtimeService>;
    let mockBirdService: Partial<BirdService>;

    beforeEach(async () => {
      mockRealtimeService = {
        getKey: jest.fn().mockReturnValue("rt_key_live"),
        getSecret: jest.fn().mockReturnValue("rt_secret_live"),
        getRegion: jest.fn().mockReturnValue("us1"),
        isRealtimeConfigured: jest.fn().mockReturnValue(true),
      };
      mockBirdService = {
        isConfigured: jest.fn().mockReturnValue(true),
      };

      const module: TestingModule = await Test.createTestingModule({
        controllers: [BirdRealtimeController],
        providers: [
          { provide: BirdRealtimeService, useValue: mockRealtimeService },
          { provide: BirdService, useValue: mockBirdService },
        ],
      }).compile();

      controller = module.get<BirdRealtimeController>(BirdRealtimeController);
    });

    it("getConfig should return key and region without requiring authentication", () => {
      const config = controller.getConfig();
      expect(config).toEqual({ key: "rt_key_live", region: "us1" });
    });

    it("authMember should throw ForbiddenException if user is not authenticated", () => {
      const req = { user: undefined } as any;
      expect(() => controller.authMember(req, { connection_id: "c1" })).toThrow(
        ForbiddenException,
      );
    });

    it("authMember should throw BadRequestException if connection_id is missing", () => {
      const req = { user: { betterAuthId: "user_1" } } as any;
      expect(() => controller.authMember(req, {} as any)).toThrow(
        BadRequestException,
      );
    });

    it("authMember should return valid signature when authenticated", () => {
      const req = {
        user: {
          betterAuthId: "user_1",
          role: "member",
          email: "rider@bskmt.com",
        },
      } as any;
      const res = controller.authMember(req, { connection_id: "conn_1" });
      expect(res.auth).toContain("rt_key_live:");
      expect(JSON.parse(res.member_data).member_id).toBe("user_1");
    });

    it("authChannel should enforce private-user ownership", () => {
      const req = {
        user: { betterAuthId: "user_attacker", role: "user" },
      } as any;

      expect(() =>
        controller.authChannel(req, {
          connection_id: "c1",
          channel_name: "private-user-victim",
        }),
      ).toThrow(ForbiddenException);
    });

    it("authChannel should allow user to subscribe to their own private channel", () => {
      const req = {
        user: { betterAuthId: "user_legit", role: "user" },
      } as any;

      const res = controller.authChannel(req, {
        connection_id: "c1",
        channel_name: "private-user-user_legit",
      });
      expect(res.auth).toBeDefined();
    });
  });

  describe("BirdWhatsappService", () => {
    let whatsappService: BirdWhatsappService;
    let mockBirdService: Partial<BirdService>;
    let mockClient: any;

    beforeEach(() => {
      mockClient = {
        whatsapp: {
          send: jest.fn().mockResolvedValue({ id: "msg_wa_123" }),
        },
      };
      mockBirdService = {
        isConfigured: jest.fn().mockReturnValue(true),
        getClient: jest.fn().mockResolvedValue(mockClient),
      };
      whatsappService = new BirdWhatsappService(mockBirdService as BirdService);
    });

    it("should validate E.164 phone numbers correctly", () => {
      expect(whatsappService.isValidE164("+573001234567")).toBe(true);
      expect(whatsappService.isValidE164("+13124495648")).toBe(true);
      expect(whatsappService.isValidE164("3001234567")).toBe(false);
      expect(whatsappService.isValidE164("invalid")).toBe(false);
    });

    it("should reject invalid destination numbers gracefully without crashing", async () => {
      const result = await whatsappService.sendNotificationWhatsapp({
        to: "not-a-number",
        title: "Test",
        message: "Hello",
      });
      expect(result).toBe(false);
    });

    it("should support template-based delivery for proactive messaging", async () => {
      const result = await whatsappService.sendNotificationWhatsapp({
        to: "+573001234567",
        title: "Evento BSKMT",
        message: "Tu asistencia está confirmada",
        templateSlug: "bird_event_notification",
      });

      expect(result).toBe(true);
      expect(mockClient.whatsapp.send).toHaveBeenCalledWith(
        expect.objectContaining({
          to: "+573001234567",
          template: expect.objectContaining({
            slug: "bird_event_notification",
          }),
        }),
      );
    });
  });
});
