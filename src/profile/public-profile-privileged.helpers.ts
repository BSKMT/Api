import { str, num, computeMembershipStatus } from "./public-profile.helpers";
import { buildGestorOperationalSection } from "./public-profile-gestor.helpers";
import { decryptSensitiveField } from "../common/crypto/field-encryption.helper";

export interface OperationalSection {
  scope:
    | "gestor_eventos"
    | "gestor_arpha"
    | "gestor_cursos"
    | "gestor_tienda"
    | "gestor_membresias"
    | "admin"
    | "superadmin"
    | "gestor_general";
  roleLabel: string;
  data: Record<string, unknown>;
}

export interface UserProfileData {
  fullName: string;
  phone: string;
  personal: Record<string, unknown>;
  contacto: Record<string, unknown>;
  moto: Record<string, unknown>;
  salud: Record<string, unknown>;
  legal: Record<string, unknown>;
  membEco: Record<string, unknown>;
  membershipStatus: ReturnType<typeof computeMembershipStatus>;
  cuotasProgress: string;
}

function extractUserData(targetUser: Record<string, unknown>): UserProfileData {
  const profile =
    (targetUser.profile as
      Record<string, Record<string, unknown>> | undefined) ?? {};
  const personal = profile["datos-personales"] ?? {};
  const contacto = profile["contacto"] ?? {};
  const moto = profile["motocicleta"] ?? {};
  const salud =
    decryptSensitiveField<Record<string, unknown>>(
      profile["salud-seguridad"],
    ) ?? {};
  const legal =
    decryptSensitiveField<Record<string, unknown>>(
      profile["documentacion-legal"],
    ) ?? {};
  const membEco = profile["membresia-ecosistema"] ?? {};

  const fullName = [
    str(personal, "primerNombre"),
    str(personal, "segundoNombre"),
    str(personal, "primerApellido"),
    str(personal, "segundoApellido"),
  ]
    .filter(Boolean)
    .join(" ");

  const phone = str(targetUser, "phone") || str(contacto, "celular");
  const membershipStatus = computeMembershipStatus(targetUser);
  const installmentsPaid = num(targetUser, "installmentsPaid") ?? 0;
  const installmentsTotal = num(targetUser, "installmentsTotal") ?? 12;
  const cuotasProgress = `${installmentsPaid} / ${installmentsTotal}`;

  return {
    fullName,
    phone,
    personal,
    contacto,
    moto,
    salud,
    legal,
    membEco,
    membershipStatus,
    cuotasProgress,
  };
}

function buildSuperadminSection(
  u: UserProfileData,
  targetUser: Record<string, unknown>,
): OperationalSection {
  return {
    scope: "superadmin",
    roleLabel: "Gerencia General (Acceso Integral 360°)",
    data: {
      identidad: {
        nombreCompleto: u.fullName,
        tipoDocumento: str(u.personal, "tipoDocumento"),
        numeroDocumento: str(u.personal, "numeroDocumento"),
        fechaNacimiento: str(u.personal, "fechaNacimiento"),
        genero: str(u.personal, "genero"),
        nacionalidad: str(u.personal, "nacionalidad"),
        email: targetUser.email,
        telefono: u.phone,
        identidadVerificada: targetUser.identityVerified ?? false,
        cuentaActiva: targetUser.isActive ?? true,
        perfilCompleto: targetUser.profileCompleted ?? false,
        consentimientoLegal: targetUser.legalConsentAccepted ?? false,
        fechaRegistro: (targetUser as { createdAt?: Date }).createdAt ?? null,
      },
      contactoYResidencia: {
        direccion: str(u.contacto, "direccionResidencia"),
        barrio: str(u.contacto, "barrio"),
        ciudad: str(u.contacto, "ciudad"),
        departamento: str(u.contacto, "departamento"),
        codigoPostal: str(u.contacto, "codigoPostal"),
      },
      emergencia: {
        contactoPrincipal: {
          nombre: str(u.contacto, "contactoEmergenciaNombre"),
          parentesco: str(u.contacto, "contactoEmergenciaParentesco"),
          telefono: str(u.contacto, "contactoEmergenciaTelefono"),
        },
        contactoSecundario: {
          nombre: str(u.contacto, "contactoEmergencia2Nombre"),
          telefono: str(u.contacto, "contactoEmergencia2Telefono"),
        },
      },
      vehiculoPrincipal: {
        placa: str(u.moto, "placaMoto"),
        marca: str(u.moto, "marcaMoto"),
        linea: str(u.moto, "lineaMoto"),
        cilindraje: num(u.moto, "cilindraje"),
        modelo: num(u.moto, "anioMoto"),
        color: str(u.moto, "colorMoto"),
        tipo: str(u.moto, "tipoMoto"),
        soatVigencia: str(u.moto, "soatVigencia"),
        tecnomecanicaVigencia: str(u.moto, "tecnomecanicaVigencia"),
      },
      saludArpha: {
        grupoSanguineo: str(u.salud, "grupoSanguineo"),
        eps: str(u.salud, "eps"),
        alergias: str(u.salud, "alergias") || "Ninguna reportada",
        enfermedadesCronicas:
          str(u.salud, "enfermedadesCronicas") || "Ninguna reportada",
        medicamentosActuales:
          str(u.salud, "medicamentosActuales") || "Ninguno reportado",
        cirugiasPrevias: str(u.salud, "cirugiasPrevias") || "Ninguna",
        discapacidad: str(u.salud, "discapacidad") || "Ninguna",
        donanteOrganos: str(u.salud, "donanteOrganos"),
        medicoTratanteNombre: str(u.salud, "medicoTratanteNombre"),
        medicoTratanteTelefono: str(u.salud, "medicoTratanteTelefono"),
      },
      documentacionLegal: {
        licenciaCategoria: str(u.legal, "licenciaConduccionCategoria"),
        licenciaNumero: str(u.legal, "licenciaConduccionNumero"),
        licenciaVigencia: str(u.legal, "licenciaVigencia"),
        licenciaRestricciones: str(u.legal, "licenciaRestricciones"),
        poseeSeguroMoto: str(u.legal, "poseeSeguroMoto"),
      },
      membresiaAudit: {
        numeroMiembro: str(u.membEco, "numeroMiembro"),
        nivel: targetUser.membershipLevel ?? null,
        estado: u.membershipStatus.status,
        esValida: u.membershipStatus.isValid,
        fechaInicio: targetUser.membershipStartDate ?? null,
        fechaVencimiento: targetUser.membershipExpiryDate ?? null,
        planPago: targetUser.membershipPaymentPlan ?? null,
        cuotas: u.cuotasProgress,
      },
    },
  };
}

function buildAdminSection(
  u: UserProfileData,
  targetUser: Record<string, unknown>,
  adminPermissions: string[],
): OperationalSection {
  const hasArphaPerm =
    adminPermissions.includes("*") ||
    adminPermissions.includes("arpha") ||
    adminPermissions.includes("events");

  return {
    scope: "admin",
    roleLabel: "Administrador de Consola BSK",
    data: {
      identidad: {
        nombreCompleto: u.fullName,
        tipoDocumento: str(u.personal, "tipoDocumento"),
        numeroDocumento: str(u.personal, "numeroDocumento"),
        email: targetUser.email,
        telefono: u.phone,
        identidadVerificada: targetUser.identityVerified ?? false,
        cuentaActiva: targetUser.isActive ?? true,
        perfilCompleto: targetUser.profileCompleted ?? false,
      },
      contactoEmergencia: {
        nombre: str(u.contacto, "contactoEmergenciaNombre"),
        parentesco: str(u.contacto, "contactoEmergenciaParentesco"),
        telefono: str(u.contacto, "contactoEmergenciaTelefono"),
      },
      vehiculo: {
        placa: str(u.moto, "placaMoto"),
        marca: str(u.moto, "marcaMoto"),
        linea: str(u.moto, "lineaMoto"),
        cilindraje: num(u.moto, "cilindraje"),
      },
      membresia: {
        numeroMiembro: str(u.membEco, "numeroMiembro"),
        nivel: targetUser.membershipLevel ?? null,
        estado: u.membershipStatus.status,
        fechaVencimiento: targetUser.membershipExpiryDate ?? null,
        cuotas: u.cuotasProgress,
      },
      ...(hasArphaPerm
        ? {
            saludArphaBasica: {
              grupoSanguineo: str(u.salud, "grupoSanguineo"),
              eps: str(u.salud, "eps"),
              alergias: str(u.salud, "alergias") || "Ninguna reportada",
            },
          }
        : {}),
    },
  };
}

export function buildPrivilegedSection(
  targetUser: unknown,
  requester: {
    userId: string;
    role: string;
    subrol?: string | null;
    adminPermissions?: string[];
  },
): OperationalSection | null {
  const reqRole = (requester.role || "").toLowerCase();
  const reqSubrol = (requester.subrol || "").toLowerCase();
  const adminPermissions = requester.adminPermissions ?? [];

  const rawTarget = (targetUser ?? {}) as Record<string, unknown>;
  const u = extractUserData(rawTarget);

  if (reqRole === "superadmin" || reqRole === "gerente") {
    return buildSuperadminSection(u, rawTarget);
  }

  if (reqRole === "admin") {
    return buildAdminSection(u, rawTarget, adminPermissions);
  }

  const isGestor = reqRole === "gestor" || Boolean(reqSubrol);
  if (isGestor) {
    return buildGestorOperationalSection(u, rawTarget, reqRole, reqSubrol);
  }

  return null;
}
