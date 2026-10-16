import { Logger } from "@nestjs/common";
import { Model } from "mongoose";
import QRCode from "qrcode";
import type { CourseEnrollmentDocument } from "./schemas/course-enrollment.schema";
import type { CourseDocument } from "./schemas/course.schema";
import type { UserDocument } from "../users/schemas/user.schema";
import type { BirdEmailService } from "../bird/bird-email.service";
import { generateTicketPdf } from "./tickets/ticket-pdf.generator";
import { buildQrTicketPayload } from "./events-checkin.helpers";
import { deriveRecipientName } from "./events-ticket-common.helper";

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
    if (!user?.email) {
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
