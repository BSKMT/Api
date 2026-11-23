import { BadRequestException, HttpException } from "@nestjs/common";
import type { Model } from "mongoose";
import type { UserDocument } from "../users/schemas/user.schema";
import type { VerifikService } from "../verifik/verifik.service";
import type { KvCacheService } from "../kv/kv-cache.service";
import type { SecurityAuditService } from "../common/audit/security-audit.service";
import { IdentityVerificationService } from "./identity-verification.service";
import { extractAndValidateDocument } from "./identity-verification.helpers";
import { resetIdentityIfDocumentChanged } from "../users/users-official-number.helper";

interface MockUserDoc {
  _id: string;
  betterAuthId?: string;
  identityVerified: boolean;
  identityVerifiedAt: Date | null;
  identityVerification: Record<string, unknown> | null;
  profile: Record<string, Record<string, unknown>>;
  completedSections: string[];
  profileCompleted: boolean;
  markModified: (field: string) => void;
  save: () => Promise<void>;
}

function makeMockUser(overrides: Partial<MockUserDoc> = {}): MockUserDoc {
  return {
    _id: "507f1f77bcf86cd799439011",
    betterAuthId: "ba-user-1",
    identityVerified: false,
    identityVerifiedAt: null,
    identityVerification: null,
    profile: {
      "datos-personales": {
        tipoDocumento: "Cédula de Ciudadanía",
        numeroDocumento: "1020304050",
        primerNombre: "JUAN",
        primerApellido: "PEREZ",
      },
    },
    completedSections: [],
    profileCompleted: false,
    markModified: () => {},
    save: () => Promise.resolve(),
    ...overrides,
  };
}

function makeKvCacheMock(deletedKeys: string[]): KvCacheService {
  return {
    isAvailable: () => true,
    get: () => Promise.resolve(null),
    set: () => Promise.resolve(),
    delete: (key: string) => {
      deletedKeys.push(key);
      return Promise.resolve();
    },
  } as unknown as KvCacheService;
}

describe("IdentityVerificationService & KYC Security Controls", () => {
  describe("extractAndValidateDocument (Verifik Colombia Document Rules)", () => {
    it("accepts 15-digit PEP, 7/15-digit PPT, and strips non-digits for CE/PPT/PEP", () => {
      const pep = extractAndValidateDocument(
        {},
        {
          documentType: "PEP",
          documentNumber: "12345-67890-12345",
          expeditionDate: "2021-06-15",
        },
      );
      expect(pep).toEqual({
        verifikType: "PEP",
        documentNumber: "123456789012345",
        verifikExpeditionDate: "15/06/2021",
      });

      const ppt = extractAndValidateDocument(
        {},
        {
          documentType: "PPT",
          documentNumber: "000000001234567",
          expeditionDate: "5/4/2023",
        },
      );
      expect(ppt).toEqual({
        verifikType: "PPT",
        documentNumber: "000000001234567",
        verifikExpeditionDate: "05/04/2023",
      });

      const cc = extractAndValidateDocument(
        {},
        { documentType: "CC", documentNumber: "1.020.304.050" },
      );
      expect(cc).toEqual({
        verifikType: "CC",
        documentNumber: "1020304050",
        verifikExpeditionDate: null,
      });
    });

    it("rejects invalid PEP length and missing expeditionDate on foreigner docs", () => {
      expect(() =>
        extractAndValidateDocument(
          {},
          {
            documentType: "PEP",
            documentNumber: "12345678",
            expeditionDate: "2022-01-01",
          },
        ),
      ).toThrow(BadRequestException);

      expect(() =>
        extractAndValidateDocument(
          {},
          { documentType: "CE", documentNumber: "456789" },
        ),
      ).toThrow(BadRequestException);
    });
  });

  describe("resetIdentityIfDocumentChanged", () => {
    it("revokes identityVerified when alphanumeric prefix changes or number is cleared", () => {
      const user = makeMockUser({
        identityVerified: true,
        identityVerifiedAt: new Date(),
        identityVerification: { documentNumber: "AB12345" },
        profile: {
          "datos-personales": {
            tipoDocumento: "Pasaporte",
            numeroDocumento: "AB12345",
          },
        },
      }) as unknown as UserDocument;

      resetIdentityIfDocumentChanged(user, { numeroDocumento: "CD12345" });
      expect(user.identityVerified).toBe(false);
      expect(user.identityVerification).toBeNull();

      user.identityVerified = true;
      user.identityVerification = {
        documentNumber: "1020304050",
      } as unknown as UserDocument["identityVerification"];
      user.profile = {
        "datos-personales": {
          tipoDocumento: "CC",
          numeroDocumento: "1020304050",
        },
      };
      resetIdentityIfDocumentChanged(user, { numeroDocumento: "" });
      expect(user.identityVerified).toBe(false);
    });
  });

  describe("verifyIdentity (Concurrency Lock, Duplicate Protection, Basic v3 License & Audit)", () => {
    it("blocks parallel in-flight requests for the same user with 429", async () => {
      const user = makeMockUser();
      let releaseVerifik!: () => void;
      const verifikGate = new Promise<void>((resolve) => {
        releaseVerifik = resolve;
      });
      let verifikCalls = 0;

      const userModel = {
        findById: () => Promise.resolve(user),
        findOne: () => ({ lean: () => Promise.resolve(null) }),
      } as unknown as Model<UserDocument>;

      const verifikService = {
        isConfigured: () => true,
        verifyCedulaPremium: async () => {
          verifikCalls++;
          await verifikGate;
          return {
            ok: true as const,
            record: {
              documentType: "CC",
              documentNumber: "1020304050",
              fullName: "JUAN PEREZ",
              firstName: "JUAN",
              lastName: "PEREZ",
              arrayName: ["JUAN", "PEREZ"],
              dateOfBirth: "1990-01-01",
              gender: "M",
              status: "VIGENTE",
              expirationDate: null,
              verifikId: "vfk-lock-1",
            },
          };
        },
        getDriverLicense: () =>
          Promise.resolve({
            documentNumber: "1020304050",
            documentType: "CC",
            status: "NO_REGISTRA" as const,
            categories: [],
            expeditionDate: null,
            expiryDate: null,
          }),
      } as unknown as VerifikService;

      const service = new IdentityVerificationService(
        userModel,
        verifikService,
        makeKvCacheMock([]),
      );

      const first = service.verifyIdentity(user._id);
      await new Promise((r) => setTimeout(r, 10));
      await expect(service.verifyIdentity(user._id)).rejects.toThrow(
        HttpException,
      );

      releaseVerifik();
      const firstResult = await first;
      expect(firstResult.verified).toBe(true);
      expect(verifikCalls).toBe(1);
    });

    it("handles MongoDB code 11000 duplicate race condition and records masked audit event", async () => {
      const auditEvents: Array<Record<string, unknown>> = [];
      const user = makeMockUser({
        save: () => {
          const dupErr = Object.assign(new Error("E11000 duplicate key"), {
            code: 11000,
          });
          return Promise.reject(dupErr);
        },
      });

      const userModel = {
        findById: () => Promise.resolve(user),
        findOne: () => ({ lean: () => Promise.resolve(null) }),
      } as unknown as Model<UserDocument>;

      const verifikService = {
        isConfigured: () => true,
        verifyCedulaPremium: () =>
          Promise.resolve({
            ok: true as const,
            record: {
              documentType: "CC",
              documentNumber: "1020304050",
              fullName: "JUAN PEREZ",
              firstName: "JUAN",
              lastName: "PEREZ",
              arrayName: ["JUAN", "PEREZ"],
              dateOfBirth: null,
              gender: null,
              status: "VIGENTE",
              expirationDate: null,
              verifikId: "vfk-dup-1",
            },
          }),
        getDriverLicense: () =>
          Promise.resolve({
            documentNumber: "1020304050",
            documentType: "CC",
            status: "DESCONOCIDO" as const,
            categories: [],
            expeditionDate: null,
            expiryDate: null,
          }),
      } as unknown as VerifikService;

      const auditService = {
        recordEvent: (evt: Record<string, unknown>) => {
          auditEvents.push(evt);
          return Promise.resolve();
        },
      } as unknown as SecurityAuditService;

      const service = new IdentityVerificationService(
        userModel,
        verifikService,
        makeKvCacheMock([]),
        undefined,
        auditService,
      );

      await expect(service.verifyIdentity(user._id)).rejects.toThrow(
        BadRequestException,
      );
      expect(auditEvents).toHaveLength(1);
      expect(auditEvents[0]?.eventType).toBe(
        "IDENTITY_VERIFICATION_DUPLICATE_BLOCKED",
      );
      expect(JSON.stringify(auditEvents[0])).not.toContain("1020304050");
    });

    it("forwards primerApellido to getDriverLicense, invalidates user:ba cache, and audits success", async () => {
      const deletedKeys: string[] = [];
      const licenseCalls: Array<unknown[]> = [];
      const auditEvents: Array<Record<string, unknown>> = [];
      const user = makeMockUser();

      const userModel = {
        findById: () => Promise.resolve(user),
        findOne: () => ({ lean: () => Promise.resolve(null) }),
      } as unknown as Model<UserDocument>;

      const verifikService = {
        isConfigured: () => true,
        verifyCedulaPremium: () =>
          Promise.resolve({
            ok: true as const,
            record: {
              documentType: "CC",
              documentNumber: "1020304050",
              fullName: "JUAN CARLOS PEREZ GOMEZ",
              firstName: "JUAN CARLOS",
              lastName: "PEREZ GOMEZ",
              arrayName: ["JUAN", "CARLOS", "PEREZ", "GOMEZ"],
              dateOfBirth: "1990-05-10",
              gender: "HOMBRE",
              status: "VIGENTE",
              expirationDate: null,
              verifikId: "vfk-ok-1",
            },
          }),
        getDriverLicense: (...args: unknown[]) => {
          licenseCalls.push(args);
          return Promise.resolve({
            documentNumber: "1020304050",
            documentType: "CC",
            status: "ACTIVA" as const,
            categories: [
              { category: "A2", validUntil: "2030-05-10", status: "ACTIVA" },
            ],
            expeditionDate: "2020-05-10",
            expiryDate: "2030-05-10",
          });
        },
      } as unknown as VerifikService;

      const auditService = {
        recordEvent: (evt: Record<string, unknown>) => {
          auditEvents.push(evt);
          return Promise.resolve();
        },
      } as unknown as SecurityAuditService;

      const service = new IdentityVerificationService(
        userModel,
        verifikService,
        makeKvCacheMock(deletedKeys),
        undefined,
        auditService,
      );

      const res = await service.verifyIdentity(user._id);
      expect(res.verified).toBe(true);
      expect(licenseCalls).toEqual([["CC", "1020304050", "PEREZ"]]);
      expect(deletedKeys).toContain("user:ba:ba-user-1");
      expect(auditEvents[0]?.eventType).toBe("IDENTITY_VERIFICATION_SUCCESS");
      expect(
        user.profile["documentacion-legal"]?.licenciaConduccionCategoria,
      ).toBe("A2");
    });
  });
});
