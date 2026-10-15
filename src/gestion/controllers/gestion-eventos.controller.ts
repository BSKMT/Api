import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Param,
  Query,
  Body,
  Req,
  UseGuards,
  HttpCode,
  HttpStatus,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from "@nestjs/common";
import type { Request } from "express";
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";
import { SessionGuard } from "../../auth/session.guard";
import { GestionGuard } from "../../common/guards/gestion.guard";
import { RequireSubroles } from "../../common/decorators/subroles.decorator";
import {
  User,
  UserDocument,
  UserRole,
  UserSubrole,
} from "../../users/schemas/user.schema";
import { Event, EventDocument } from "../../events/schemas/event.schema";
import {
  EventRegistration,
  EventRegistrationDocument,
} from "../../events/schemas/event-registration.schema";
import { ParseObjectIdPipe } from "../../common/pipes/parse-object-id.pipe";
import { parseCheckInInput } from "../../events/events-checkin.helpers";

interface AuthenticatedGestionRequest extends Request {
  user: {
    userId: string;
    email: string;
    role: string;
    subrol?: string | null;
    contractorInfo?: {
      nombres: string;
      apellidos: string;
    } | null;
  };
}

@Controller("gestion/eventos")
@UseGuards(SessionGuard, GestionGuard)
@RequireSubroles(
  UserSubrole.LIDER_EVENTOS,
  UserSubrole.GESTOR_EVENTOS,
  UserSubrole.GESTOR_CAMPO,
)
export class GestionEventosController {
  constructor(
    @InjectModel(Event.name)
    private readonly eventModel: Model<EventDocument>,
    @InjectModel(EventRegistration.name)
    private readonly registrationModel: Model<EventRegistrationDocument>,
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
  ) {}

  private authorizeEventCoordinator(
    event: EventDocument | (Event & { _id: unknown }),
    user: AuthenticatedGestionRequest["user"],
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

  @Get("events")
  async listEvents() {
    const events = await this.eventModel
      .find()
      .select(
        "_id slug title date endDate location meetingPoint meetingTime departureTime registeredCount maxCapacity coordinatorId coordinatorName coordinatorEmail status",
      )
      .sort({ date: -1 })
      .limit(50)
      .lean();
    return { events };
  }

  @Get("registrations/:eventId")
  async listRegistrations(
    @Param("eventId", ParseObjectIdPipe) eventId: string,
    @Query("search") search?: string,
  ) {
    const event = await this.eventModel.findById(eventId).lean();
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

    const registrations = await this.registrationModel
      .find(filter)
      .sort({ createdAt: -1 })
      .lean();

    const userIds = Array.from(
      new Set(registrations.map((r) => r.userId).filter(Boolean)),
    );
    const users = await this.userModel
      .find({ _id: { $in: userIds } })
      .select("email profile contractorInfo")
      .lean();
    const userMap = new Map(users.map((u) => [String(u._id), u]));

    const enrichedRegistrations = registrations.map((r) => {
      const u = userMap.get(String(r.userId));
      const rawProfile = u?.profile as
        Record<string, Record<string, string>> | undefined;
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
      const userName =
        fullName ||
        (r as unknown as { userName?: string }).userName ||
        u?.email ||
        "Piloto BSKMT";

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
          : "";

      return {
        ...r,
        userName,
        userEmail:
          u?.email || (r as unknown as { userEmail?: string }).userEmail,
        userPhone:
          (typeof contact?.celular === "string" ? contact.celular : "") ||
          (r as unknown as { userPhone?: string }).userPhone ||
          "",
        motorcyclePlate:
          (typeof vehicle?.placa === "string" ? vehicle.placa : "") ||
          (r as unknown as { motorcyclePlate?: string }).motorcyclePlate ||
          "",
        vehicleBrand: typeof vehicle?.marca === "string" ? vehicle.marca : "",
        vehicleModel: typeof vehicle?.modelo === "string" ? vehicle.modelo : "",
        emergencyContact,
      };
    });

    return {
      event: {
        _id: event._id,
        title: event.title,
        slug: event.slug,
        date: event.date,
        location: event.location,
        meetingPoint: event.meetingPoint,
        meetingTime: event.meetingTime,
        departureTime: event.departureTime,
        registeredCount: event.registeredCount,
        maxCapacity: event.maxCapacity,
        coordinatorId: event.coordinatorId,
        coordinatorName: event.coordinatorName,
        coordinatorEmail: event.coordinatorEmail,
      },
      registrations: enrichedRegistrations,
    };
  }

  @Post("scan-checkin")
  @HttpCode(HttpStatus.OK)
  async scanCheckIn(
    @Req() req: AuthenticatedGestionRequest,
    @Body() dto: { eventId?: string; codeOrQr: string },
  ) {
    if (!dto.codeOrQr || typeof dto.codeOrQr !== "string") {
      throw new BadRequestException("Código o lectura de QR requerida.");
    }

    const parsed = parseCheckInInput(dto.codeOrQr);
    const candidateCode = parsed.checkInCode;
    const candidateRegId = parsed.registrationId;

    const orClauses: Record<string, unknown>[] = [];
    if (candidateCode) {
      orClauses.push({ checkInCode: candidateCode });
    }
    if (candidateRegId && candidateRegId.match(/^[0-9a-fA-F]{24}$/)) {
      orClauses.push({ _id: candidateRegId });
    }
    if (candidateCode && candidateCode.match(/^[0-9a-fA-F]{24}$/)) {
      orClauses.push({ _id: candidateCode });
    }

    if (orClauses.length === 0) {
      throw new BadRequestException("Formato de código o QR no reconocido.");
    }

    const reg = await this.registrationModel.findOne({ $or: orClauses });
    if (!reg) {
      throw new NotFoundException(
        "No se encontró ninguna inscripción con este código o QR.",
      );
    }

    const rawReg = reg as unknown as Record<string, unknown>;
    const eventFilter = rawReg.eventId
      ? { $or: [{ _id: rawReg.eventId }, { slug: reg.eventSlug }] }
      : { slug: reg.eventSlug };
    const event = await this.eventModel.findOne(eventFilter);
    if (!event) {
      throw new NotFoundException(
        "El evento asociado a esta inscripción no fue encontrado.",
      );
    }

    if (dto.eventId && String(event._id) !== String(dto.eventId)) {
      throw new BadRequestException(
        `Este ticket pertenece al evento "${event.title}", no al evento seleccionado.`,
      );
    }

    // EXCLUSIVIDAD DE COORDINADOR ASIGNADO
    this.authorizeEventCoordinator(event, req.user);

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

    const u = await this.userModel
      .findById(reg.userId)
      .select("email profile contractorInfo")
      .lean();
    const rawProfile = u?.profile as
      Record<string, Record<string, string>> | undefined;
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
    const pilotName =
      `${primerNombre} ${primerApellido}`.trim() || u?.email || "Piloto";

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
          name: pilotName,
          email: u?.email,
          phone:
            typeof contact?.celular === "string"
              ? contact.celular
              : "No registrado",
          plate: typeof vehicle?.placa === "string" ? vehicle.placa : "N/A",
          checkInCode: reg.checkInCode,
          attendedAt: reg.attendedAt,
          checkedInByName: reg.checkedInByName,
        },
        registration: reg,
      };
    }

    const checkedByName = req.user.contractorInfo
      ? `${req.user.contractorInfo.nombres} ${req.user.contractorInfo.apellidos}`
      : req.user.email || req.user.userId;

    reg.attendanceConfirmed = true;
    reg.attendedAt = new Date();
    reg.checkedInBy = req.user.userId;
    reg.checkedInByName = checkedByName;
    reg.status = "CONFIRMED";
    await reg.save();

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
      message: `¡Asistencia confirmada en campo para ${pilotName}!`,
      attendee: {
        name: pilotName,
        email: u?.email,
        phone:
          typeof contact?.celular === "string"
            ? contact.celular
            : "No registrado",
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
        checkedInByName: checkedByName,
      },
      registration: reg,
    };
  }

  @Post("check-in/:id")
  @Put("check-in/:id")
  @Patch("check-in/:id")
  @HttpCode(HttpStatus.OK)
  async checkIn(
    @Param("id", ParseObjectIdPipe) id: string,
    @Req() req: AuthenticatedGestionRequest,
  ) {
    const reg = await this.registrationModel.findById(id);
    if (!reg) {
      throw new NotFoundException("Inscripción no encontrada");
    }

    const rawReg = reg as unknown as Record<string, unknown>;
    const eventFilter = rawReg.eventId
      ? { $or: [{ _id: rawReg.eventId }, { slug: reg.eventSlug }] }
      : { slug: reg.eventSlug };
    const event = await this.eventModel.findOne(eventFilter);
    if (!event) {
      throw new NotFoundException("Evento asociado no encontrado");
    }

    // EXCLUSIVIDAD DE COORDINADOR ASIGNADO
    this.authorizeEventCoordinator(event, req.user);

    if (!reg.waiverAccepted) {
      throw new BadRequestException(
        "No se puede realizar check-in: el participante no ha aceptado la exoneración de responsabilidad (waiver).",
      );
    }

    const isPaidEvent =
      (!event.membersFree && reg.membershipStatus === "member") ||
      reg.membershipStatus !== "member" ||
      reg.registrationType === "with-companion";

    if (isPaidEvent && !reg.paymentConfirmed) {
      throw new BadRequestException(
        "No se puede realizar check-in: el pago de la inscripción no ha sido confirmado.",
      );
    }

    const checkedByName = req.user.contractorInfo
      ? `${req.user.contractorInfo.nombres} ${req.user.contractorInfo.apellidos}`
      : req.user.email || req.user.userId;

    reg.attendanceConfirmed = true;
    reg.attendedAt = new Date();
    reg.checkedInBy = req.user.userId;
    reg.checkedInByName = checkedByName;
    reg.status = "CONFIRMED";
    await reg.save();

    return {
      success: true,
      message: "Piloto registrado y asistencia confirmada en campo.",
      registration: reg,
    };
  }
}
