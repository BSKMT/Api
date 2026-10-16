import {
  str,
  num,
  computeMembershipStatus,
} from "./public-profile.helpers";

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

interface UserProfileData {
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
    (targetUser.profile as Record<string, Record<string, unknown>> | undefined) ?? {};
  const personal = profile["datos-personales"] ?? {};
  const contacto = profile["contacto"] ?? {};
  const moto = profile["motocicleta"] ?? {};
  const salud = profile["salud-seguridad"] ?? {};
  const legal = profile["documentacion-legal"] ?? {};
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
        enfermedadesCronicas: str(u.salud, "enfermedadesCronicas") || "Ninguna reportada",
        medicamentosActuales: str(u.salud, "medicamentosActuales") || "Ninguno reportado",
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
    adminPermissions.length === 0 ||
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
  targetUser: Record<string, unknown>,
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

  const u = extractUserData(targetUser);

  if (reqRole === "superadmin" || reqRole === "gerente") {
    return buildSuperadminSection(u, targetUser);
  }

  if (reqRole === "admin") {
    return buildAdminSection(u, targetUser, adminPermissions);
  }

  const isGestor = reqRole === "gestor" || Boolean(reqSubrol);
  if (isGestor) {
    return buildGestorOperationalSection(u, targetUser, reqRole, reqSubrol);
  }

  return null;
}

function buildGestorOperationalSection(
  u: UserProfileData,
  targetUser: Record<string, unknown>,
  reqRole: string,
  reqSubrol: string,
): OperationalSection {
  if (
    reqSubrol.includes("evento") ||
    reqSubrol === "gestor_campo" ||
    reqRole === "event-manager" ||
    reqRole === "road-captain"
  ) {
    return {
      scope: "gestor_eventos",
      roleLabel: "Gestor de Eventos y Logística en Campo",
      data: {
        asistente: {
          nombreCompleto: u.fullName,
          tipoDocumento: str(u.personal, "tipoDocumento"),
          numeroDocumento: str(u.personal, "numeroDocumento"),
          telefono: u.phone,
        },
        vehiculoAcreditado: {
          placa: str(u.moto, "placaMoto"),
          marca: str(u.moto, "marcaMoto"),
          linea: str(u.moto, "lineaMoto"),
          cilindraje: num(u.moto, "cilindraje"),
          soatVigente: Boolean(u.moto?.["soatVigencia"]),
        },
        contingenciaRuta: {
          contactoEmergenciaNombre: str(u.contacto, "contactoEmergenciaNombre"),
          contactoEmergenciaParentesco: str(u.contacto, "contactoEmergenciaParentesco"),
          contactoEmergenciaTelefono: str(u.contacto, "contactoEmergenciaTelefono"),
        },
        licencia: {
          categoria: str(u.legal, "licenciaConduccionCategoria"),
        },
      },
    };
  }

  if (reqSubrol.includes("arpha")) {
    return {
      scope: "gestor_arpha",
      roleLabel: "Gestor Asistencial y Paramédico ARPHA",
      data: {
        paciente: {
          nombreCompleto: u.fullName,
          tipoDocumento: str(u.personal, "tipoDocumento"),
          numeroDocumento: str(u.personal, "numeroDocumento"),
          telefono: u.phone,
          fechaNacimiento: str(u.personal, "fechaNacimiento"),
          genero: str(u.personal, "genero"),
        },
        fichaMedicaSeguridad: {
          grupoSanguineo: str(u.salud, "grupoSanguineo"),
          eps: str(u.salud, "eps"),
          alergias: str(u.salud, "alergias") || "Ninguna reportada",
          enfermedadesCronicas: str(u.salud, "enfermedadesCronicas") || "Ninguna reportada",
          medicamentosActuales: str(u.salud, "medicamentosActuales") || "Ninguno reportado",
          cirugiasPrevias: str(u.salud, "cirugiasPrevias") || "Ninguna",
          discapacidad: str(u.salud, "discapacidad") || "Ninguna",
          donanteOrganos: str(u.salud, "donanteOrganos"),
          medicoTratanteNombre: str(u.salud, "medicoTratanteNombre"),
          medicoTratanteTelefono: str(u.salud, "medicoTratanteTelefono"),
        },
        contactosEmergencia: [
          {
            nombre: str(u.contacto, "contactoEmergenciaNombre"),
            parentesco: str(u.contacto, "contactoEmergenciaParentesco"),
            telefono: str(u.contacto, "contactoEmergenciaTelefono"),
          },
          ...(str(u.contacto, "contactoEmergencia2Nombre")
            ? [
                {
                  nombre: str(u.contacto, "contactoEmergencia2Nombre"),
                  parentesco: "Secundario",
                  telefono: str(u.contacto, "contactoEmergencia2Telefono"),
                },
              ]
            : []),
        ],
      },
    };
  }

  if (reqSubrol.includes("curso")) {
    return {
      scope: "gestor_cursos",
      roleLabel: "Gestor Académico de Cursos y Talleres",
      data: {
        estudiante: {
          nombreCompleto: u.fullName,
          tipoDocumento: str(u.personal, "tipoDocumento"),
          numeroDocumento: str(u.personal, "numeroDocumento"),
          telefono: u.phone,
          email: targetUser.email,
        },
        vehiculoPractica: {
          placa: str(u.moto, "placaMoto"),
          marca: str(u.moto, "marcaMoto"),
          linea: str(u.moto, "lineaMoto"),
        },
        licenciaConduccion: {
          categoria: str(u.legal, "licenciaConduccionCategoria"),
          numero: str(u.legal, "licenciaConduccionNumero"),
          vigencia: str(u.legal, "licenciaVigencia"),
        },
        contactoEmergencia: {
          nombre: str(u.contacto, "contactoEmergenciaNombre"),
          telefono: str(u.contacto, "contactoEmergenciaTelefono"),
        },
      },
    };
  }

  if (reqSubrol.includes("tienda")) {
    return {
      scope: "gestor_tienda",
      roleLabel: "Gestor de Tienda y Envíos",
      data: {
        destinatario: {
          nombreCompleto: u.fullName,
          telefono: u.phone,
          email: targetUser.email,
        },
        direccionDespacho: {
          direccionResidencia: str(u.contacto, "direccionResidencia"),
          barrio: str(u.contacto, "barrio"),
          ciudad: str(u.contacto, "ciudad"),
          departamento: str(u.contacto, "departamento"),
          codigoPostal: str(u.contacto, "codigoPostal"),
        },
      },
    };
  }

  if (reqSubrol.includes("membresia")) {
    return {
      scope: "gestor_membresias",
      roleLabel: "Gestor de Membresías y Afiliaciones",
      data: {
        afiliado: {
          nombreCompleto: u.fullName,
          tipoDocumento: str(u.personal, "tipoDocumento"),
          numeroDocumento: str(u.personal, "numeroDocumento"),
          email: targetUser.email,
          telefono: u.phone,
          identidadVerificada: targetUser.identityVerified ?? false,
        },
        membresiaOficial: {
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

  return {
    scope: "gestor_general",
    roleLabel: "Gestor Operativo General",
    data: {
      identidad: {
        nombreCompleto: u.fullName,
        tipoDocumento: str(u.personal, "tipoDocumento"),
        numeroDocumento: str(u.personal, "numeroDocumento"),
        telefono: u.phone,
        email: targetUser.email,
      },
      membresia: {
        numeroMiembro: str(u.membEco, "numeroMiembro"),
        estado: u.membershipStatus.status,
        esValida: u.membershipStatus.isValid,
      },
    },
  };
}
