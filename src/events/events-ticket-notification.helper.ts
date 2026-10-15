import { Logger } from "@nestjs/common";
import { Model } from "mongoose";
import QRCode from "qrcode";
import type { EventRegistrationDocument } from "./schemas/event-registration.schema";
import type { EventDocument } from "./schemas/event.schema";
import type { CourseEnrollmentDocument } from "./schemas/course-enrollment.schema";
import type { CourseDocument } from "./schemas/course.schema";
import type { UserDocument } from "../users/schemas/user.schema";
import type { BirdEmailService } from "../bird/bird-email.service";
import { generateTicketPdf } from "./tickets/ticket-pdf.generator";
import { buildQrTicketPayload } from "./events-checkin.helpers";

function deriveRecipientName(
  user: UserDocument | null,
  fallback: string,
): { name: string; phone?: string; plate?: string } {
  if (!user) return { name: fallback };

  const rawProfile = user.profile as
    Record<string, Record<string, string>> | undefined;
  const personal = rawProfile?.["datos-personales"];
  const contact = rawProfile?.["contacto"];
  const vehicle = rawProfile?.["vehiculo"];

  const primerNombre =
    typeof personal?.primerNombre === "string" ? personal.primerNombre : "";
  const primerApellido =
    typeof personal?.primerApellido === "string" ? personal.primerApellido : "";
  const fullName = `${primerNombre} ${primerApellido}`.trim();

  return {
    name: fullName || user.email || fallback,
    phone: typeof contact?.celular === "string" ? contact.celular : undefined,
    plate: typeof vehicle?.placa === "string" ? vehicle.placa : undefined,
  };
}

export async function dispatchConfirmedEventTicketNotification(
  registration: EventRegistrationDocument,
  event: EventDocument,
  userModel: Model<UserDocument>,
  birdEmailService: BirdEmailService,
  panelBaseUrl: string,
  logger: Logger,
): Promise<void> {
  // Idempotencia: evitar envíos duplicados
  if (registration.confirmationEmailSent) {
    return;
  }

  try {
    const user = await userModel.findById(registration.userId).lean();
    if (!user || !user.email) {
      logger.warn(
        `No se pudo enviar notificación de ticket de evento: usuario ${registration.userId} sin correo registrado.`,
      );
      return;
    }

    const {
      name: recipientName,
      phone,
      plate,
    } = deriveRecipientName(user, "Piloto BSK");

    const checkInCode =
      registration.checkInCode ||
      `EVT-${String(registration._id).slice(-8).toUpperCase()}`;

    const qrPayload =
      registration.qrCodeData ||
      buildQrTicketPayload("EVENT", {
        registrationId: String(registration._id),
        slug: event.slug,
        checkInCode,
        userId: registration.userId,
      });

    // 1. Generar DataURL de QR para el cuerpo HTML del correo
    const qrDataUrl = await QRCode.toDataURL(qrPayload, {
      width: 240,
      margin: 1,
      color: {
        dark: "#090d16",
        light: "#ffffff",
      },
    });

    const dateFormatted = new Date(event.date).toLocaleDateString("es-CO", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });

    const timeText = event.meetingTime
      ? `Encuentro: ${event.meetingTime}${event.departureTime ? ` · Salida: ${event.departureTime}` : ""}`
      : undefined;

    // 2. Generar el PDF oficial de alta resolución adjunto
    let pdfBuffer: Buffer | undefined;
    try {
      pdfBuffer = await generateTicketPdf({
        type: "EVENT",
        title: event.title,
        categoryOrLevel: event.category,
        recipientName,
        recipientEmail: user.email,
        recipientPhone: phone,
        vehiclePlate: plate,
        companionName: registration.companionData?.fullName,
        checkInCode,
        qrPayload,
        dateText: dateFormatted,
        timeText,
        locationText: event.location,
        meetingPointText: event.meetingPoint ?? undefined,
        coordinatorName: event.coordinatorName ?? undefined,
      });
    } catch (pdfErr) {
      logger.error(
        `Error generando PDF adjunto para ticket ${checkInCode}: ${
          pdfErr instanceof Error ? pdfErr.message : String(pdfErr)
        }`,
      );
    }

    const panelUrl = `${panelBaseUrl.replace(/\/$/, "")}/eventos/${event.slug}`;

    // 3. Enviar correo vía Bird Email
    const sent = await birdEmailService.sendTicketNotificationEmail({
      to: user.email,
      recipientName,
      type: "EVENT",
      title: event.title,
      slug: event.slug,
      checkInCode,
      qrDataUrl,
      dateText: dateFormatted,
      timeText,
      locationText: event.location,
      meetingPointText: event.meetingPoint ?? undefined,
      coordinatorName: event.coordinatorName ?? undefined,
      panelUrl,
      pdfBuffer,
    });

    if (sent) {
      registration.confirmationEmailSent = true;
      registration.confirmationEmailSentAt = new Date();
      await registration.save();
      logger.log(
        `Notificación y ticket de evento ${event.slug} enviados exitosamente a ${user.email} (código ${checkInCode})`,
      );
    }
  } catch (err) {
    logger.error(
      `Fallo inesperado despachando notificación de ticket de evento ${event.slug}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
}

export async function dispatchConfirmedCourseTicketNotification(
  enrollment: CourseEnrollmentDocument,
  course: CourseDocument,
  userModel: Model<UserDocument>,
  birdEmailService: BirdEmailService,
  panelBaseUrl: string,
  logger: Logger,
): Promise<void> {
  // Idempotencia: evitar envíos duplicados
  if (enrollment.confirmationEmailSent) {
    return;
  }

  try {
    const user = await userModel.findById(enrollment.userId).lean();
    if (!user || !user.email) {
      logger.warn(
        `No se pudo enviar notificación de ticket de curso: usuario ${enrollment.userId} sin correo registrado.`,
      );
      return;
    }

    const { name: recipientName, phone } = deriveRecipientName(
      user,
      "Estudiante BSK",
    );

    const checkInCode =
      enrollment.checkInCode ||
      `CRS-${String(enrollment._id).slice(-8).toUpperCase()}`;

    const qrPayload =
      enrollment.qrCodeData ||
      buildQrTicketPayload("COURSE", {
        registrationId: String(enrollment._id),
        slug: course.slug,
        checkInCode,
        userId: enrollment.userId,
      });

    // 1. Generar DataURL de QR
    const qrDataUrl = await QRCode.toDataURL(qrPayload, {
      width: 240,
      margin: 1,
      color: {
        dark: "#090d16",
        light: "#ffffff",
      },
    });

    const meta = course.metadata || {};
    const locationText =
      (meta.locationOrLink as string) ||
      (course.format === "virtual"
        ? "Aula Virtual BSK Academy"
        : "Autódromo de Tocancipá / Pista BSK");

    const dateFormatted = course.date
      ? new Date(course.date).toLocaleDateString("es-CO", {
          weekday: "long",
          year: "numeric",
          month: "long",
          day: "numeric",
        })
      : "Fecha programada en aula/pista";

    // 2. Generar el PDF oficial
    let pdfBuffer: Buffer | undefined;
    try {
      pdfBuffer = await generateTicketPdf({
        type: "COURSE",
        title: course.title,
        categoryOrLevel: course.level,
        format: course.format,
        recipientName,
        recipientEmail: user.email,
        recipientPhone: phone,
        checkInCode,
        qrPayload,
        dateText: dateFormatted,
        timeText: course.durationHours
          ? `Duración: ${course.durationHours} horas`
          : undefined,
        locationText,
        coordinatorName: course.coordinatorName ?? undefined,
      });
    } catch (pdfErr) {
      logger.error(
        `Error generando PDF adjunto para ticket de curso ${checkInCode}: ${
          pdfErr instanceof Error ? pdfErr.message : String(pdfErr)
        }`,
      );
    }

    const panelUrl = `${panelBaseUrl.replace(/\/$/, "")}/cursos/${course.slug}`;

    // 3. Enviar correo vía Bird Email
    const sent = await birdEmailService.sendTicketNotificationEmail({
      to: user.email,
      recipientName,
      type: "COURSE",
      title: course.title,
      slug: course.slug,
      checkInCode,
      qrDataUrl,
      dateText: dateFormatted,
      timeText: course.durationHours
        ? `Duración: ${course.durationHours} horas`
        : undefined,
      locationText,
      coordinatorName: course.coordinatorName ?? undefined,
      panelUrl,
      pdfBuffer,
    });

    if (sent) {
      enrollment.confirmationEmailSent = true;
      enrollment.confirmationEmailSentAt = new Date();
      await enrollment.save();
      logger.log(
        `Notificación y ticket de curso ${course.slug} enviados exitosamente a ${user.email} (código ${checkInCode})`,
      );
    }
  } catch (err) {
    logger.error(
      `Fallo inesperado despachando notificación de ticket de curso ${course.slug}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
}
