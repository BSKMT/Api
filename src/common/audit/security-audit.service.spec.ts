import { describe, it, expect, beforeEach, jest } from "@jest/globals";
import { Test, TestingModule } from "@nestjs/testing";
import { getModelToken } from "@nestjs/mongoose";
import { ConfigService } from "@nestjs/config";
import type { Model } from "mongoose";
import { SecurityAuditService, AuditSeverity } from "./security-audit.service";
import {
  SecurityAuditLog,
  type SecurityAuditLogDocument,
} from "./schemas/security-audit-log.schema";
import type { BirdSmsService } from "../../bird/bird-sms.service";

interface SavedAuditDoc {
  requestId: string;
  eventType: string;
  signature: string;
  timestamp: Date;
}

describe("SecurityAuditService (NIST CSF 2.0 RS.AN-06, RS.AN-07)", () => {
  let service: SecurityAuditService;
  let mockAuditModel: {
    create: jest.Mock<(doc: Record<string, unknown>) => Promise<unknown>>;
  };

  beforeEach(async () => {
    mockAuditModel = {
      create: jest
        .fn<(doc: Record<string, unknown>) => Promise<unknown>>()
        .mockImplementation((doc) =>
          Promise.resolve({ ...doc, _id: "audit-doc-1" }),
        ),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SecurityAuditService,
        {
          provide: getModelToken(SecurityAuditLog.name),
          useValue: mockAuditModel,
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest
              .fn()
              .mockReturnValue("super-secure-audit-secret-minimum32chars"),
          },
        },
      ],
    }).compile();

    service = module.get<SecurityAuditService>(SecurityAuditService);
  });

  it("persiste un evento de auditoría calculando la firma HMAC de no repudio", async () => {
    const params = {
      requestId: "req-trace-test-1",
      eventType: "UNAUTHORIZED_ADMIN_ACCESS",
      severity: AuditSeverity.WARN,
      clientIp: "192.168.1.100",
      method: "POST",
      path: "/api/admin/users",
      statusCode: 403,
      userId: "user-attacker-123",
      details: { reason: "Missing users permission" },
    };

    const result = await service.recordEvent(params);

    expect(result).toBeDefined();
    expect(mockAuditModel.create).toHaveBeenCalledTimes(1);
    const savedDoc = mockAuditModel.create.mock
      .calls[0][0] as unknown as SavedAuditDoc;
    expect(savedDoc.requestId).toBe("req-trace-test-1");
    expect(savedDoc.eventType).toBe("UNAUTHORIZED_ADMIN_ACCESS");
    expect(typeof savedDoc.signature).toBe("string");
    expect(savedDoc.signature).toHaveLength(64);
    expect(savedDoc.timestamp).toBeInstanceOf(Date);
  });

  it("registra evento crítico sin lanzar excepción ante fallos de persistencia", async () => {
    mockAuditModel.create.mockRejectedValue(new Error("Mongo connection drop"));

    const params = {
      requestId: "req-crit-1",
      eventType: "BRUTE_FORCE_THRESHOLD_EXCEEDED",
      severity: AuditSeverity.CRITICAL,
      clientIp: "203.0.113.5",
      method: "POST",
      path: "/api/auth/sign-in",
      statusCode: 429,
    };

    const result = await service.recordEvent(params);
    expect(result).toBeNull();
  });

  it("despacha alerta SMS automatizada al número SecDevOps en incidentes CRITICAL (NIST RS.CO-02)", async () => {
    interface SmsPayload {
      to: string;
      title: string;
      message: string;
    }

    const mockBirdSmsService = {
      sendNotificationSms: jest
        .fn<(payload: SmsPayload) => Promise<boolean>>()
        .mockResolvedValue(true),
    };

    const moduleWithBird: TestingModule = await Test.createTestingModule({
      providers: [
        SecurityAuditService,
        {
          provide: getModelToken(SecurityAuditLog.name),
          useValue: mockAuditModel,
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              if (key === "BETTER_AUTH_SECRET")
                return "super-secure-audit-secret-minimum32chars";
              if (key === "SECDEVOPS_ALERT_PHONE") return "+573009998877";
              return null;
            }),
          },
        },
        {
          provide: "BirdSmsService",
          useValue: mockBirdSmsService,
        },
      ],
    }).compile();

    const alertService = new SecurityAuditService(
      mockAuditModel as unknown as Model<SecurityAuditLogDocument>,
      moduleWithBird.get(ConfigService),
      mockBirdSmsService as unknown as BirdSmsService,
    );

    const criticalParams = {
      requestId: "req-crit-alert-1",
      eventType: "RANSOMWARE_OR_INJECTION_DETECTED",
      severity: AuditSeverity.CRITICAL,
      clientIp: "198.51.100.1",
      method: "POST",
      path: "/api/admin/system",
      statusCode: 500,
    };

    await alertService.recordEvent(criticalParams);

    expect(mockBirdSmsService.sendNotificationSms).toHaveBeenCalledTimes(1);
    const sentPayload =
      mockBirdSmsService.sendNotificationSms.mock.calls[0]?.[0];
    expect(sentPayload?.to).toBe("+573009998877");
    expect(sentPayload?.title).toBe("ALERTA CRITICA BSKMT");
    expect(sentPayload?.message).toContain("RANSOMWARE_OR_INJECTION_DETECTED");
  });
});
