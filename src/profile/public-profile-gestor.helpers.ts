import { str, num } from "./public-profile.helpers";
import type {
  OperationalSection,
  UserProfileData,
} from "./public-profile-privileged.helpers";

export function buildGestorOperationalSection(
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
          contactoEmergenciaParentesco: str(
            u.contacto,
            "contactoEmergenciaParentesco",
          ),
          contactoEmergenciaTelefono: str(
            u.contacto,
            "contactoEmergenciaTelefono",
          ),
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
