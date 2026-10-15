import type { Request } from "express";
import { getAuth } from "../auth/better-auth";

/**
 * Extracts the userId from the Better Auth session cookie if present.
 */
export async function getUserIdFromSession(
  req: Request,
): Promise<string | null> {
  const cookieHeader = req.headers.cookie ?? "";
  if (!cookieHeader) return null;
  if (!cookieHeader.includes("better-auth.session_token")) return null;
  try {
    const auth = await getAuth();
    const headers = new Headers();
    headers.set("cookie", cookieHeader);
    const session = await auth.api.getSession({ headers });
    return session?.user?.id ?? null;
  } catch {
    return null;
  }
}

/**
 * Derives a display name from the profile's datos-personales section.
 */
export function deriveDisplayName(
  profile: Record<string, Record<string, unknown>>,
  _email: string,
): string {
  const personal = profile["datos-personales"] ?? {};
  const primerNombre = personal.primerNombre as string | undefined;
  const primerApellido = personal.primerApellido as string | undefined;
  if (primerNombre && primerApellido)
    return `${primerNombre} ${primerApellido}`;
  if (primerNombre) return primerNombre;
  if (primerApellido) return primerApellido;
  return "Piloto BSKMT";
}

/**
 * Reads a boolean privacy flag from user's settings.
 */
export function privacyFlag(
  user: Record<string, unknown>,
  key: string,
  fallback: boolean,
): boolean {
  const settings = user.settings as Record<string, unknown> | undefined;
  const privacy = settings?.privacy as Record<string, boolean> | undefined;
  if (privacy && typeof privacy[key] === "boolean") return privacy[key];
  return fallback;
}

export function str(
  section: Record<string, unknown> | undefined,
  field: string,
): string {
  const v = section?.[field];
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  return "";
}

export function num(
  section: Record<string, unknown> | undefined,
  field: string,
): number | null {
  const v = section?.[field];
  return typeof v === "number" ? v : null;
}

export function buildPrivacyFlags(user: unknown) {
  const record = user as Record<string, unknown>;
  return {
    // F-06: Visibilidad pública por defecto desactivada (opt-in por privacidad)
    profileVisible: privacyFlag(record, "profileVisible", false),
    showLocation: privacyFlag(record, "showLocation", false),
    allowFriendRequests: privacyFlag(record, "allowFriendRequests", false),
    shareStats: privacyFlag(record, "shareStats", false),
    showMotorcycle: privacyFlag(record, "showMotorcycle", false),
  };
}

export function computeMembershipStatus(user: unknown): {
  status: "ACTIVO" | "VENCIDO" | "INACTIVO";
  isValid: boolean;
  expiryFormatted: string | null;
} {
  const record = (user ?? {}) as Record<string, unknown>;
  const expiryRaw = record["membershipExpiryDate"];
  if (!expiryRaw) {
    return { status: "INACTIVO", isValid: false, expiryFormatted: null };
  }
  const expiry = new Date(expiryRaw as string | number | Date);
  if (Number.isNaN(expiry.getTime())) {
    return { status: "INACTIVO", isValid: false, expiryFormatted: null };
  }
  const now = new Date();
  const isValid = expiry > now && !record["membershipExpired"];
  return {
    status: isValid ? "ACTIVO" : "VENCIDO",
    isValid,
    expiryFormatted: expiry.toISOString(),
  };
}

export function buildOptionalSections(
  profile: Record<string, Record<string, unknown>>,
  privacy: ReturnType<typeof buildPrivacyFlags>,
  isOwner: boolean,
): Record<string, unknown> {
  const sections: Record<string, unknown> = {};

  // Si no es el propietario y el perfil está configurado como no visible, no se exponen secciones opcionales
  if (!isOwner && !privacy.profileVisible) {
    return sections;
  }

  if (isOwner || privacy.showMotorcycle) {
    const moto = profile["motocicleta"];
    sections["motorcycle"] = moto
      ? {
          marcaMoto: str(moto, "marcaMoto"),
          lineaMoto: str(moto, "lineaMoto"),
          anioMoto: num(moto, "anioMoto"),
          cilindraje: num(moto, "cilindraje"),
          colorMoto: str(moto, "colorMoto"),
          tipoMoto: str(moto, "tipoMoto"),
        }
      : null;

    const equip = profile["equipamiento"];
    sections["equipment"] = equip
      ? {
          cascoMarca: str(equip, "cascoMarca"),
          cascoCertificacion: str(equip, "cascoCertificacion"),
          chaquetaTipo: str(equip, "chaquetaTipo"),
          pantalonTipo: str(equip, "pantalonTipo"),
          guantes: str(equip, "guantes"),
          botasTipo: str(equip, "botasTipo"),
          proteccionEspalda: str(equip, "proteccionEspalda"),
          airbagVest: str(equip, "airbagVest"),
          intercomunicador: str(equip, "intercomunicador"),
          camaraAccion: str(equip, "camaraAccion"),
        }
      : null;
  }

  if (isOwner || privacy.showLocation) {
    const contacto = profile["contacto"];
    sections["location"] = contacto
      ? {
          ciudad: str(contacto, "ciudad"),
          departamento: str(contacto, "departamento"),
        }
      : null;
  }

  if (isOwner || privacy.shareStats) {
    const exp = profile["experiencia-motera"];
    sections["stats"] = exp
      ? {
          anosExperiencia: num(exp, "anosExperiencia"),
          kilometrosMensuales: num(exp, "kilometrosMensuales"),
          tipoConduccionPreferido: str(exp, "tipoConduccionPreferido"),
          disponibilidadRodadas: str(exp, "disponibilidadRodadas"),
        }
      : null;
  }

  return sections;
}

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

  const profile =
    (targetUser.profile as
      Record<string, Record<string, unknown>> | undefined) ?? {};
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

  // 1. SUPERADMIN / GERENTE GENERAL (Acceso 360° a toda la información del usuario)
  if (reqRole === "superadmin" || reqRole === "gerente") {
    return {
      scope: "superadmin",
      roleLabel: "Gerencia General (Acceso Integral 360°)",
      data: {
        identidad: {
          nombreCompleto: fullName,
          tipoDocumento: str(personal, "tipoDocumento"),
          numeroDocumento: str(personal, "numeroDocumento"),
          fechaNacimiento: str(personal, "fechaNacimiento"),
          genero: str(personal, "genero"),
          nacionalidad: str(personal, "nacionalidad"),
          email: targetUser.email,
          telefono: phone,
          identidadVerificada: targetUser.identityVerified ?? false,
          cuentaActiva: targetUser.isActive ?? true,
          perfilCompleto: targetUser.profileCompleted ?? false,
          consentimientoLegal: targetUser.legalConsentAccepted ?? false,
          fechaRegistro: (targetUser as { createdAt?: Date }).createdAt ?? null,
        },
        contactoYResidencia: {
          direccion: str(contacto, "direccionResidencia"),
          barrio: str(contacto, "barrio"),
          ciudad: str(contacto, "ciudad"),
          departamento: str(contacto, "departamento"),
          codigoPostal: str(contacto, "codigoPostal"),
        },
        emergencia: {
          contactoPrincipal: {
            nombre: str(contacto, "contactoEmergenciaNombre"),
            parentesco: str(contacto, "contactoEmergenciaParentesco"),
            telefono: str(contacto, "contactoEmergenciaTelefono"),
          },
          contactoSecundario: {
            nombre: str(contacto, "contactoEmergencia2Nombre"),
            telefono: str(contacto, "contactoEmergencia2Telefono"),
          },
        },
        vehiculoPrincipal: {
          placa: str(moto, "placaMoto"),
          marca: str(moto, "marcaMoto"),
          linea: str(moto, "lineaMoto"),
          cilindraje: num(moto, "cilindraje"),
          modelo: num(moto, "anioMoto"),
          color: str(moto, "colorMoto"),
          tipo: str(moto, "tipoMoto"),
          soatVigencia: str(moto, "soatVigencia"),
          tecnomecanicaVigencia: str(moto, "tecnomecanicaVigencia"),
        },
        saludArpha: {
          grupoSanguineo: str(salud, "grupoSanguineo"),
          eps: str(salud, "eps"),
          alergias: str(salud, "alergias") || "Ninguna reportada",
          enfermedadesCronicas:
            str(salud, "enfermedadesCronicas") || "Ninguna reportada",
          medicamentosActuales:
            str(salud, "medicamentosActuales") || "Ninguno reportado",
          cirugiasPrevias: str(salud, "cirugiasPrevias") || "Ninguna",
          discapacidad: str(salud, "discapacidad") || "Ninguna",
          donanteOrganos: str(salud, "donanteOrganos"),
          medicoTratanteNombre: str(salud, "medicoTratanteNombre"),
          medicoTratanteTelefono: str(salud, "medicoTratanteTelefono"),
        },
        documentacionLegal: {
          licenciaCategoria: str(legal, "licenciaConduccionCategoria"),
          licenciaNumero: str(legal, "licenciaConduccionNumero"),
          licenciaVigencia: str(legal, "licenciaVigencia"),
          licenciaRestricciones: str(legal, "licenciaRestricciones"),
          poseeSeguroMoto: str(legal, "poseeSeguroMoto"),
        },
        membresiaAudit: {
          numeroMiembro: str(membEco, "numeroMiembro"),
          nivel: targetUser.membershipLevel ?? null,
          estado: membershipStatus.status,
          esValida: membershipStatus.isValid,
          fechaInicio: targetUser.membershipStartDate ?? null,
          fechaVencimiento: targetUser.membershipExpiryDate ?? null,
          planPago: targetUser.membershipPaymentPlan ?? null,
          cuotas: cuotasProgress,
        },
      },
    };
  }

  // 2. ADMINISTRADOR EN CONSOLA (Console)
  if (reqRole === "admin") {
    const hasArphaPerm =
      adminPermissions.length === 0 ||
      adminPermissions.includes("arpha") ||
      adminPermissions.includes("events");

    return {
      scope: "admin",
      roleLabel: "Administrador de Consola BSK",
      data: {
        identidad: {
          nombreCompleto: fullName,
          tipoDocumento: str(personal, "tipoDocumento"),
          numeroDocumento: str(personal, "numeroDocumento"),
          email: targetUser.email,
          telefono: phone,
          identidadVerificada: targetUser.identityVerified ?? false,
          cuentaActiva: targetUser.isActive ?? true,
          perfilCompleto: targetUser.profileCompleted ?? false,
        },
        contactoEmergencia: {
          nombre: str(contacto, "contactoEmergenciaNombre"),
          parentesco: str(contacto, "contactoEmergenciaParentesco"),
          telefono: str(contacto, "contactoEmergenciaTelefono"),
        },
        vehiculo: {
          placa: str(moto, "placaMoto"),
          marca: str(moto, "marcaMoto"),
          linea: str(moto, "lineaMoto"),
          cilindraje: num(moto, "cilindraje"),
        },
        membresia: {
          numeroMiembro: str(membEco, "numeroMiembro"),
          nivel: targetUser.membershipLevel ?? null,
          estado: membershipStatus.status,
          fechaVencimiento: targetUser.membershipExpiryDate ?? null,
          cuotas: cuotasProgress,
        },
        ...(hasArphaPerm
          ? {
              saludArphaBasica: {
                grupoSanguineo: str(salud, "grupoSanguineo"),
                eps: str(salud, "eps"),
                alergias: str(salud, "alergias") || "Ninguna reportada",
              },
            }
          : {}),
      },
    };
  }

  // 3. GESTORES EN FASCIA (Filtrado estricto según subrol operativo)
  const isGestor = reqRole === "gestor" || Boolean(reqSubrol);

  if (isGestor) {
    // 3A. Gestor de Eventos / Campo
    if (
      reqSubrol === "gestor_eventos" ||
      reqSubrol === "lider_eventos" ||
      reqSubrol === "gestor_campo" ||
      reqSubrol.includes("evento") ||
      reqRole === "event-manager" ||
      reqRole === "road-captain"
    ) {
      return {
        scope: "gestor_eventos",
        roleLabel: "Gestor de Eventos y Logística en Campo",
        data: {
          asistente: {
            nombreCompleto: fullName,
            tipoDocumento: str(personal, "tipoDocumento"),
            numeroDocumento: str(personal, "numeroDocumento"),
            telefono: phone,
          },
          vehiculoAcreditado: {
            placa: str(moto, "placaMoto"),
            marca: str(moto, "marcaMoto"),
            linea: str(moto, "lineaMoto"),
            cilindraje: num(moto, "cilindraje"),
            soatVigente: Boolean(moto?.["soatVigencia"]),
          },
          contingenciaRuta: {
            contactoEmergenciaNombre: str(contacto, "contactoEmergenciaNombre"),
            contactoEmergenciaParentesco: str(
              contacto,
              "contactoEmergenciaParentesco",
            ),
            contactoEmergenciaTelefono: str(
              contacto,
              "contactoEmergenciaTelefono",
            ),
          },
          licencia: {
            categoria: str(legal, "licenciaConduccionCategoria"),
          },
        },
      };
    }

    // 3B. Gestor ARPHA (Atención en vía y mesa médica)
    if (
      reqSubrol === "gestor_campo_arpha" ||
      reqSubrol === "gestor_mesa_arpha" ||
      reqSubrol === "lider_arpha" ||
      reqSubrol.includes("arpha")
    ) {
      return {
        scope: "gestor_arpha",
        roleLabel: "Gestor Asistencial y Paramédico ARPHA",
        data: {
          paciente: {
            nombreCompleto: fullName,
            tipoDocumento: str(personal, "tipoDocumento"),
            numeroDocumento: str(personal, "numeroDocumento"),
            telefono: phone,
            fechaNacimiento: str(personal, "fechaNacimiento"),
            genero: str(personal, "genero"),
          },
          fichaMedicaSeguridad: {
            grupoSanguineo: str(salud, "grupoSanguineo"),
            eps: str(salud, "eps"),
            alergias: str(salud, "alergias") || "Ninguna reportada",
            enfermedadesCronicas:
              str(salud, "enfermedadesCronicas") || "Ninguna reportada",
            medicamentosActuales:
              str(salud, "medicamentosActuales") || "Ninguno reportado",
            cirugiasPrevias: str(salud, "cirugiasPrevias") || "Ninguna",
            discapacidad: str(salud, "discapacidad") || "Ninguna",
            donanteOrganos: str(salud, "donanteOrganos"),
            medicoTratanteNombre: str(salud, "medicoTratanteNombre"),
            medicoTratanteTelefono: str(salud, "medicoTratanteTelefono"),
          },
          contactosEmergencia: [
            {
              nombre: str(contacto, "contactoEmergenciaNombre"),
              parentesco: str(contacto, "contactoEmergenciaParentesco"),
              telefono: str(contacto, "contactoEmergenciaTelefono"),
            },
            ...(str(contacto, "contactoEmergencia2Nombre")
              ? [
                  {
                    nombre: str(contacto, "contactoEmergencia2Nombre"),
                    parentesco: "Secundario",
                    telefono: str(contacto, "contactoEmergencia2Telefono"),
                  },
                ]
              : []),
          ],
        },
      };
    }

    // 3C. Gestor Cursos / Academia
    if (
      reqSubrol === "gestor_cursos" ||
      reqSubrol === "lider_cursos" ||
      reqSubrol.includes("curso")
    ) {
      return {
        scope: "gestor_cursos",
        roleLabel: "Gestor Académico de Cursos y Talleres",
        data: {
          estudiante: {
            nombreCompleto: fullName,
            tipoDocumento: str(personal, "tipoDocumento"),
            numeroDocumento: str(personal, "numeroDocumento"),
            telefono: phone,
            email: targetUser.email,
          },
          vehiculoPractica: {
            placa: str(moto, "placaMoto"),
            marca: str(moto, "marcaMoto"),
            linea: str(moto, "lineaMoto"),
          },
          licenciaConduccion: {
            categoria: str(legal, "licenciaConduccionCategoria"),
            numero: str(legal, "licenciaConduccionNumero"),
            vigencia: str(legal, "licenciaVigencia"),
          },
          contactoEmergencia: {
            nombre: str(contacto, "contactoEmergenciaNombre"),
            telefono: str(contacto, "contactoEmergenciaTelefono"),
          },
        },
      };
    }

    // 3D. Gestor Tienda / Despachos
    if (
      reqSubrol === "gestor_tienda" ||
      reqSubrol === "lider_tienda" ||
      reqSubrol.includes("tienda")
    ) {
      return {
        scope: "gestor_tienda",
        roleLabel: "Gestor de Tienda y Envíos",
        data: {
          destinatario: {
            nombreCompleto: fullName,
            telefono: phone,
            email: targetUser.email,
          },
          direccionDespacho: {
            direccionResidencia: str(contacto, "direccionResidencia"),
            barrio: str(contacto, "barrio"),
            ciudad: str(contacto, "ciudad"),
            departamento: str(contacto, "departamento"),
            codigoPostal: str(contacto, "codigoPostal"),
          },
        },
      };
    }

    // 3E. Gestor Membresías
    if (
      reqSubrol === "gestor_membresias" ||
      reqSubrol === "lider_membresias" ||
      reqSubrol.includes("membresia")
    ) {
      return {
        scope: "gestor_membresias",
        roleLabel: "Gestor de Membresías y Afiliaciones",
        data: {
          afiliado: {
            nombreCompleto: fullName,
            tipoDocumento: str(personal, "tipoDocumento"),
            numeroDocumento: str(personal, "numeroDocumento"),
            email: targetUser.email,
            telefono: phone,
            identidadVerificada: targetUser.identityVerified ?? false,
          },
          membresiaOficial: {
            numeroMiembro: str(membEco, "numeroMiembro"),
            nivel: targetUser.membershipLevel ?? null,
            estado: membershipStatus.status,
            esValida: membershipStatus.isValid,
            fechaInicio: targetUser.membershipStartDate ?? null,
            fechaVencimiento: targetUser.membershipExpiryDate ?? null,
            planPago: targetUser.membershipPaymentPlan ?? null,
            cuotas: cuotasProgress,
          },
        },
      };
    }

    // 3F. Otros Gestores operativos generales
    return {
      scope: "gestor_general",
      roleLabel: "Gestor Operativo General",
      data: {
        identidad: {
          nombreCompleto: fullName,
          tipoDocumento: str(personal, "tipoDocumento"),
          numeroDocumento: str(personal, "numeroDocumento"),
          telefono: phone,
          email: targetUser.email,
        },
        membresia: {
          numeroMiembro: str(membEco, "numeroMiembro"),
          estado: membershipStatus.status,
          esValida: membershipStatus.isValid,
        },
      },
    };
  }

  // 4. Usuario común (miembro / regular): Cero información privilegiada
  return null;
}
