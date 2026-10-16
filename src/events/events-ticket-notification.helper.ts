import { Logger } from "@nestjs/common";
import { Model } from "mongoose";
import QRCode from "qrcode";
import type { EventRegistrationDocument } from "./schemas/event-registration.schema";
import type { EventDocument } from "./schemas/event.schema";
import type { UserDocument } from "../users/schemas/user.schema";
import type { BirdEmailService } from "../bird/bird-email.service";
import { generateTicketPdf } from "./tickets/ticket-pdf.generator";
import { buildQrTicketPayload } from "./events-checkin.helpers";
import { deriveRecipientName } from "./events-ticket-common.helper";

export { dispatchConfirmedCourseTicketNotification } from "./courses-ticket-notification.helper";

function formatMeetingTime(
  meetingTime?: string | null,
  departureTime?: string | null,
): string | undefined {
  if (!meetingTime) {
    return undefined;
  }
  const departureSuffix = departureTime ? ` · Salida: ${departureTime}` : "";
  return `Encuentro: ${meetingTime}${departureSuffix}`;
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
    if (!user?.email) {
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

    const timeText = formatMeetingTime(event.meetingTime, event.departureTime);

    // 2. Generar el PDF oficial de alta resolución adjunto
    let pdfBuffer: Buffer | undefined;
    try {
      pdfBuffer = await generateTicketPdf({
        type: "EVENT",
        title: event.title,
        recipientName,
        recipientEmail: user.email,
        recipientPhone: phone,
        vehiclePlate: plate,
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
