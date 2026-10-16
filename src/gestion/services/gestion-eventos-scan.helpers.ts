import type { EventRegistrationDocument } from "../../events/schemas/event-registration.schema";
import { deriveGestionAttendee } from "./gestion-checkin.helpers";
import type { GestionActor } from "./gestion-cursos.helpers";
import { applyEventCheckIn } from "./gestion-eventos.helpers";

export async function processEventScanCheckIn(
  reg: EventRegistrationDocument,
  userDoc: unknown,
  actor: GestionActor,
) {
  const attendee = deriveGestionAttendee(
    userDoc as Record<string, unknown>,
    "Piloto",
  );
  const rawProfile = (
    userDoc as { profile?: Record<string, Record<string, string>> }
  )?.profile;
  const vehicle = rawProfile?.["vehiculo"];
  const emergency = rawProfile?.["emergencia"];

  if (reg.attendanceConfirmed) {
    return {
      success: false,
      alreadyCheckedIn: true,
      message: `Asistencia ya confirmada previamente (${
        reg.attendedAt
          ? new Date(reg.attendedAt).toLocaleTimeString("es-CO", {
              hour: "2-digit",
              minute: "2-digit",
            })
          : "en campo"
      }).`,
      attendee: {
        name: attendee.name,
        email: attendee.email,
        phone: attendee.phone,
        plate: typeof vehicle?.placa === "string" ? vehicle.placa : "N/A",
        checkInCode: reg.checkInCode,
        attendedAt: reg.attendedAt,
        checkedInByName: reg.checkedInByName,
      },
      registration: reg,
    };
  }

  const checkedByName = await applyEventCheckIn(reg, actor);
  const contactoNombre =
    typeof emergency?.contactoNombre === "string"
      ? emergency.contactoNombre
      : "";
  const contactoTelefono =
    typeof emergency?.contactoTelefono === "string"
      ? emergency.contactoTelefono
      : "";
  const emergencyContact =
    contactoNombre || contactoTelefono
      ? `${contactoNombre} (${contactoTelefono})`.trim()
      : "No registrado";

  return {
    success: true,
    alreadyCheckedIn: false,
    message: `¡Asistencia confirmada en campo para ${attendee.name}!`,
    attendee: {
      name: attendee.name,
      email: attendee.email,
      phone: attendee.phone,
      plate:
        typeof vehicle?.placa === "string" ? vehicle.placa : "No registrada",
      vehicleBrand: typeof vehicle?.marca === "string" ? vehicle.marca : "",
      vehicleModel: typeof vehicle?.modelo === "string" ? vehicle.modelo : "",
      emergencyContact,
      registrationType: reg.registrationType,
      attendanceMode: reg.attendanceMode,
      companion: reg.companionData,
      attendedAt: reg.attendedAt,
      checkInCode: reg.checkInCode,
      checkedInByName,
    },
    registration: reg,
  };
}
