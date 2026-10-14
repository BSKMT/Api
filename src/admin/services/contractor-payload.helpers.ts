import { BadRequestException } from "@nestjs/common";
import {
  CreateCollaboratorDto,
  CreateAdministratorDto,
  CreateSuperAdminDto,
} from "../dto/contractor-management.dto";

export interface NormalizedStaffPayload {
  cedula: string;
  primerNombre: string;
  segundoNombre?: string;
  primerApellido: string;
  segundoApellido?: string;
  email: string;
  telefono: string;
  cargo: string;
  area: string;
  password: string;
  docType: string;
  personalEmail?: string;
  address?: string;
  birthDate?: string;
  bloodType?: string;
  emergencyContactName?: string;
  emergencyContactPhone?: string;
}

export function normalizeStaffPayload(
  dto: CreateCollaboratorDto | CreateAdministratorDto | CreateSuperAdminDto,
  defaultCargo: string,
  defaultArea: string,
): NormalizedStaffPayload {
  const cedula = (dto.cedula || dto.docNumber || "").trim();
  if (!cedula) {
    throw new BadRequestException(
      "El número de documento o cédula es obligatorio.",
    );
  }

  let primerNombre = (dto.primerNombre || "").trim();
  let segundoNombre = (dto.segundoNombre || "").trim() || undefined;
  if (!primerNombre && dto.firstName) {
    const parts = dto.firstName.trim().split(/\s+/);
    primerNombre = parts[0] || "";
    segundoNombre = parts.slice(1).join(" ") || undefined;
  }
  if (!primerNombre) {
    throw new BadRequestException("El nombre es obligatorio.");
  }

  let primerApellido = (dto.primerApellido || "").trim();
  let segundoApellido = (dto.segundoApellido || "").trim() || undefined;
  if (!primerApellido && dto.lastName) {
    const parts = dto.lastName.trim().split(/\s+/);
    primerApellido = parts[0] || "";
    segundoApellido = parts.slice(1).join(" ") || undefined;
  }
  if (!primerApellido) {
    throw new BadRequestException("El apellido es obligatorio.");
  }

  const email = (dto.correoInstitucional || dto.institutionalEmail || "")
    .toLowerCase()
    .trim();
  if (!email) {
    throw new BadRequestException(
      "El correo corporativo o institucional es obligatorio.",
    );
  }

  const telefono = (dto.telefono || dto.phone || "").trim();
  if (!telefono) {
    throw new BadRequestException(
      "El número de teléfono o celular es obligatorio.",
    );
  }

  const cargo = (dto.cargo || dto.position || defaultCargo).trim();
  const area = (dto.area || dto.department || defaultArea).trim();
  const password = (dto.password || "").trim();
  if (!password || password.length < 8) {
    throw new BadRequestException(
      "La contraseña debe contener al menos 8 caracteres.",
    );
  }

  return {
    cedula,
    primerNombre,
    segundoNombre,
    primerApellido,
    segundoApellido,
    email,
    telefono,
    cargo,
    area,
    password,
    docType: dto.docType || "CC",
    personalEmail: dto.personalEmail?.trim()?.toLowerCase() || undefined,
    address: dto.address?.trim() || undefined,
    birthDate: dto.birthDate || undefined,
    bloodType: dto.bloodType || undefined,
    emergencyContactName: dto.emergencyContactName?.trim() || undefined,
    emergencyContactPhone: dto.emergencyContactPhone?.trim() || undefined,
  };
}

export function buildStaffProfileUpdate(norm: NormalizedStaffPayload) {
  const docTypeDesc =
    norm.docType === "CE"
      ? "Cédula de Extranjería"
      : norm.docType === "PASSPORT"
        ? "Pasaporte"
        : "Cédula de Ciudadanía";

  return {
    "profile.datos-personales": {
      primerNombre: norm.primerNombre,
      segundoNombre: norm.segundoNombre || "",
      primerApellido: norm.primerApellido,
      segundoApellido: norm.segundoApellido || "",
      tipoDocumento: docTypeDesc,
      numeroDocumento: norm.cedula,
      fechaNacimiento: norm.birthDate || "",
    },
    "profile.contacto": {
      celular: norm.telefono,
      correoInstitucional: norm.email,
      correoPersonal: norm.personalEmail || "",
      direccion: norm.address || "",
    },
    "profile.salud-seguridad": {
      rh: norm.bloodType || "O+",
      contactoEmergenciaNombre: norm.emergencyContactName || "",
      contactoEmergenciaTelefono: norm.emergencyContactPhone || "",
    },
  };
}

export function buildStaffContractorInfo(
  norm: NormalizedStaffPayload,
  subrol: string | null | undefined,
  tipoContrato: string,
  createdBy: string,
) {
  return {
    cedula: norm.cedula,
    docType: norm.docType,
    nombres: `${norm.primerNombre} ${norm.segundoNombre || ""}`.trim(),
    apellidos: `${norm.primerApellido} ${norm.segundoApellido || ""}`.trim(),
    correoInstitucional: norm.email,
    personalEmail: norm.personalEmail,
    telefono: norm.telefono,
    cargo: norm.cargo,
    area: norm.area,
    address: norm.address,
    bloodType: norm.bloodType,
    emergencyContactName: norm.emergencyContactName,
    emergencyContactPhone: norm.emergencyContactPhone,
    subrol,
    tipoContrato,
    createdBy,
    createdAt: new Date(),
  };
}
