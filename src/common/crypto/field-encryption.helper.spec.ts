import { describe, it, expect } from "@jest/globals";
import {
  deriveFieldEncryptionKey,
  encryptSensitiveField,
  decryptSensitiveField,
  encryptUserProfileSensitiveFields,
  decryptUserProfileSensitiveFields,
  isEncryptedField,
} from "./field-encryption.helper";
import { decryptSensitiveProfileFields } from "../../users/schemas/user.schema";

describe("FieldEncryptionHelper (NIST PR.DS-01, Ley 1581 de 2012)", () => {
  const testSecret = "test-secret-key-32-characters-minimum-length!";
  const key = deriveFieldEncryptionKey(testSecret);

  it("should derive a 32-byte (256-bit) buffer key using scrypt", () => {
    expect(key).toBeInstanceOf(Buffer);
    expect(key).toHaveLength(32);
  });

  it("should encrypt and decrypt an object containing sensitive health data", () => {
    const healthData = {
      grupoSanguineo: "O+",
      eps: "Sura EPS",
      alergias: "Penicilina",
      enfermedades: "Ninguna",
      contactoEmergencia: "+573001234567",
    };

    const encrypted = encryptSensitiveField(healthData, key);
    expect(typeof encrypted).toBe("string");
    expect((encrypted as string).startsWith("enc:v1:")).toBe(true);

    const decrypted = decryptSensitiveField<typeof healthData>(encrypted, key);
    expect(decrypted).toEqual(healthData);
  });

  it("should generate different ciphertexts (random IV) for the same input", () => {
    const data = { grupoSanguineo: "A+" };
    const enc1 = encryptSensitiveField(data, key);
    const enc2 = encryptSensitiveField(data, key);

    expect(enc1).not.toEqual(enc2);
    expect(decryptSensitiveField(enc1, key)).toEqual(data);
    expect(decryptSensitiveField(enc2, key)).toEqual(data);
  });

  it("should be idempotent and not double-encrypt already encrypted payloads", () => {
    const data = { eps: "Sanitas" };
    const enc1 = encryptSensitiveField(data, key);
    const enc2 = encryptSensitiveField(enc1, key);

    expect(enc1).toEqual(enc2);
  });

  it("should return legacy plaintext as-is without error for backward compatibility", () => {
    const legacyPlainObject = {
      grupoSanguineo: "B+",
      eps: "Compensar",
    };

    const result = decryptSensitiveField(legacyPlainObject, key);
    expect(result).toEqual(legacyPlainObject);
  });

  it("should handle null and undefined safely", () => {
    expect(encryptSensitiveField(null, key)).toBeNull();
    expect(encryptSensitiveField(undefined, key)).toBeUndefined();
    expect(decryptSensitiveField(null, key)).toBeNull();
    expect(decryptSensitiveField(undefined, key)).toBeUndefined();
  });

  it("should return an empty object if ciphertext is tampered with (AEAD auth tag mismatch)", () => {
    const encrypted = encryptSensitiveField({ test: "data" }, key) as string;
    // Tamper with the ciphertext segment
    const tampered = encrypted.slice(0, -4) + "ffff";

    const decrypted = decryptSensitiveField(tampered, key);
    expect(decrypted).toEqual({});
  });

  it("should correctly encrypt and decrypt multiple sections of a user profile", () => {
    const profile = {
      "datos-personales": {
        primerNombre: "Carlos",
        primerApellido: "Perez",
      },
      "salud-seguridad": {
        grupoSanguineo: "O-",
        eps: "Salud Total",
      },
      "documentacion-legal": {
        licenciaConduccionNumero: "1020304050",
        licenciaConduccionCategoria: "A2",
      },
      motocicleta: {
        placaMoto: "ABC12D",
      },
    };

    // Encrypt sensitive sections
    encryptUserProfileSensitiveFields(profile, key);

    // Non-sensitive sections should remain plain objects
    expect(profile["datos-personales"]).toEqual({
      primerNombre: "Carlos",
      primerApellido: "Perez",
    });
    expect(profile["motocicleta"]).toEqual({
      placaMoto: "ABC12D",
    });

    // Sensitive sections must now be encrypted envelope strings
    expect(isEncryptedField(profile["salud-seguridad"])).toBe(true);
    expect(isEncryptedField(profile["documentacion-legal"])).toBe(true);

    // Decrypt sensitive sections back
    decryptUserProfileSensitiveFields(profile, key);

    expect(profile["salud-seguridad"]).toEqual({
      grupoSanguineo: "O-",
      eps: "Salud Total",
    });
    expect(profile["documentacion-legal"]).toEqual({
      licenciaConduccionNumero: "1020304050",
      licenciaConduccionCategoria: "A2",
    });
  });

  it("should decrypt sensitive profile fields on lean documents via decryptSensitiveProfileFields (ID-01)", () => {
    const leanDoc = {
      profile: {
        "salud-seguridad": encryptSensitiveField({ eps: "Sura" }),
      },
    };
    expect(isEncryptedField(leanDoc.profile["salud-seguridad"])).toBe(true);
    decryptSensitiveProfileFields(leanDoc);
    expect(leanDoc.profile["salud-seguridad"]).toEqual({ eps: "Sura" });
  });
});
