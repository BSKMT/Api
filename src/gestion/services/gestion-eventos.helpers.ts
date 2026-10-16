import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import { Model } from "mongoose";
import type {
  Event,
  EventDocument,
} from "../../events/schemas/event.schema";
import type { EventRegistrationDocument } from "../../events/schemas/event-registration.schema";
import {
  UserRole,
  UserSubrole,
  type UserDocument,
} from "../../users/schemas/user.schema";
import {
  deriveGestionAttendee,
  getGestionActorName,
} from "./gestion-checkin.helpers";
import type { GestionActor } from "./gestion-cursos.helpers";

export async function fetchEnrichedEventRegistrations(
  eventId: string,
  search: string | undefined,
  eventModel: Model<EventDocument>,
  registrationModel: Model<EventRegistrationDocument>,
  userModel: Model<UserDocument>,
) {
  const event = await eventModel.findById(eventId).lean();
  if (!event) {
    throw new NotFoundException("Evento no encontrado");
  }

  const filter: Record<string, unknown> = {
    $or: [{ eventId }, { eventSlug: event.slug }],
  };

  if (search) {
    const searchRegex = new RegExp(
      search.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`),
      "i",
    );
    filter.$and = [
      {
        $or: [
          { userEmail: searchRegex },
          { userName: searchRegex },
          { checkInCode: searchRegex },
          { "companionData.fullName": searchRegex },
        ],
      },
    ];
  }

  const registrations = await registrationModel
    .find(filter)
    .sort({ createdAt: -1 })
    .lean();

  const userIds = Array.from(
    new Set(registrations.map((r) => r.userId).filter(Boolean)),
  );
  const users = await userModel
    .find({ _id: { $in: userIds } })
    .select("email profile contractorInfo")
    .lean();
  const userMap = new Map(users.map((u) => [String(u._id), u]));

  const enrichedRegistrations = registrations.map((r) => {
    const u = userMap.get(String(r.userId));
    const rawProfile = u?.profile as
      | Record<string, Record<string, string>>
      | undefined;
    const personal = rawProfile?.["datos-personales"];
    const contact = rawProfile?.["contacto"];
    const vehicle = rawProfile?.["vehiculo"];
    const emergency = rawProfile?.["emergencia"];

    const primerNombre =
      typeof personal?.primerNombre === "string" ? personal.primerNombre : "";
    const primerApellido =
      typeof personal?.primerApellido === "string"
        ? personal.primerApellido
        : "";
    const fullName = `${primerNombre} ${primerApellido}`.trim();
    const pilotName = fullName || u?.email || "Piloto BSKMT";

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
      ...r,
      userName: pilotName,
      userEmail: u?.email,
      userPhone: typeof contact?.celular === "string" ? contact.celular : "",
      userPlate: typeof vehicle?.placa === "string" ? vehicle.placa : "",
      vehicleBrand: typeof vehicle?.marca === "string" ? vehicle.marca : "",
      vehicleModel: typeof vehicle?.modelo === "string" ? vehicle.modelo : "",
      emergencyContact,
    };
  });

  return {
    event: {
      _id: event._id,
      slug: event.slug,
      title: event.title,
      date: event.date,
      endDate: event.endDate,
      location: event.location,
      meetingPoint: event.meetingPoint,
      meetingTime: event.meetingTime,
      departureTime: event.departureTime,
      registeredCount: event.registeredCount,
      maxCapacity: event.maxCapacity,
      coordinatorId: event.coordinatorId,
      coordinatorName: event.coordinatorName,
      coordinatorEmail: event.coordinatorEmail,
      status: event.status,
    },
    registrations: enrichedRegistrations,
  };
}

export function validateEventCheckInPrerequisites(
  event: EventDocument | { membersFree?: boolean },
  reg: EventRegistrationDocument,
): void {
  if (!reg.waiverAccepted) {
    throw new BadRequestException(
      "No se puede confirmar asistencia: el participante no ha aceptado la exoneración de responsabilidad (waiver).",
    );
  }

  const isPaidEvent =
    (!event.membersFree && reg.membershipStatus === "member") ||
    reg.membershipStatus !== "member" ||
    reg.registrationType === "with-companion";

  if (isPaidEvent && !reg.paymentConfirmed) {
    throw new BadRequestException(
      "No se puede confirmar asistencia: el pago de la inscripción aún no ha sido confirmado.",
    );
  }
}

export async function applyEventCheckIn(
  reg: EventRegistrationDocument,
  user: GestionActor,
): Promise<string> {
  const checkedByName = getGestionActorName(user);

  reg.attendanceConfirmed = true;
  reg.attendedAt = new Date();
  reg.checkedInBy = user.userId;
  reg.checkedInByName = checkedByName;
  reg.status = "CONFIRMED";
  await reg.save();

  return checkedByName;
}

export function authorizeEventCoordinator(
  event: EventDocument | (Event & { _id: unknown }),
  user: GestionActor,
): void {
  const isSuper =
    user.role === (UserRole.ADMIN as string) ||
    user.role === (UserRole.SUPERADMIN as string) ||
    (user.subrol as string | null) === (UserSubrole.LIDER_EVENTOS as string);
  if (isSuper) return;

  if (!event.coordinatorId) {
    throw new BadRequestException(
      "Este evento aún no tiene un coordinador asignado por la Dirección de Eventos en Console. Contacte a la Dirección.",
    );
  }

  if (String(event.coordinatorId) !== String(user.userId)) {
    const assignedName =
      event.coordinatorName || "el gestor designado por la Dirección";
    throw new ForbiddenException(
      `Operación no autorizada: La validación de asistencia en campo para este evento está asignada exclusivamente a ${assignedName}.`,
    );
  }
}

