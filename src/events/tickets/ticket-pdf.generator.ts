import PDFDocument from "pdfkit";
import QRCode from "qrcode";
import {
  drawTicketHeader,
  drawTicketEventDetails,
  drawTicketParticipant,
  drawTicketQrSection,
} from "./ticket-pdf-render.helpers";

export interface TicketPdfData {
  type: "EVENT" | "COURSE";
  title: string;
  categoryOrLevel?: string;
  format?: string;
  recipientName: string;
  recipientEmail?: string;
  recipientPhone?: string;
  vehiclePlate?: string;
  companionName?: string;
  checkInCode: string;
  qrPayload: string;
  dateText: string;
  timeText?: string;
  locationText?: string;
  meetingPointText?: string;
  coordinatorName?: string;
  issuedAt?: Date;
}

function sanitizePdfText(value: string | undefined, maxLen = 140): string {
  if (!value || typeof value !== "string") return "";
  return value
    .replace(/\p{Cc}+/gu, " ")
    .replace(/\s{2,}/g, " ")
    .trim()
    .slice(0, maxLen);
}

function sanitizeTicketData(raw: TicketPdfData): TicketPdfData {
  return {
    ...raw,
    title: sanitizePdfText(raw.title, 120),
    categoryOrLevel: raw.categoryOrLevel
      ? sanitizePdfText(raw.categoryOrLevel, 60)
      : undefined,
    format: raw.format ? sanitizePdfText(raw.format, 60) : undefined,
    recipientName: sanitizePdfText(raw.recipientName, 100),
    recipientEmail: raw.recipientEmail
      ? sanitizePdfText(raw.recipientEmail, 100)
      : undefined,
    recipientPhone: raw.recipientPhone
      ? sanitizePdfText(raw.recipientPhone, 30)
      : undefined,
    vehiclePlate: raw.vehiclePlate
      ? sanitizePdfText(raw.vehiclePlate, 20)
      : undefined,
    companionName: raw.companionName
      ? sanitizePdfText(raw.companionName, 100)
      : undefined,
    checkInCode: sanitizePdfText(raw.checkInCode, 40),
    qrPayload: sanitizePdfText(raw.qrPayload, 512),
    dateText: sanitizePdfText(raw.dateText, 80),
    timeText: raw.timeText ? sanitizePdfText(raw.timeText, 60) : undefined,
    locationText: raw.locationText
      ? sanitizePdfText(raw.locationText, 140)
      : undefined,
    meetingPointText: raw.meetingPointText
      ? sanitizePdfText(raw.meetingPointText, 140)
      : undefined,
    coordinatorName: raw.coordinatorName
      ? sanitizePdfText(raw.coordinatorName, 100)
      : undefined,
  };
}

export async function generateTicketPdf(raw: TicketPdfData): Promise<Buffer> {
  const data = sanitizeTicketData(raw);
  const qrPngBuffer = await QRCode.toBuffer(data.qrPayload, {
    width: 280,
    margin: 1,
    color: {
      dark: "#090d16",
      light: "#ffffff",
    },
  });

  return new Promise<Buffer>((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: "A5",
        margin: 24,
        info: {
          Title: `Ticket BSK - ${data.checkInCode}`,
          Author: "BSK Motorcycle Team",
          Subject: `Pase de Asistencia - ${data.title}`,
        },
      });

      const chunks: Buffer[] = [];
      doc.on("data", (chunk: Buffer) => chunks.push(chunk));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", (err: Error) => reject(err));

      const pageWidth = doc.page.width;
      const pageHeight = doc.page.height;

      drawTicketHeader(doc, data, pageWidth, pageHeight);
      drawTicketEventDetails(doc, data, pageWidth);
      drawTicketParticipant(doc, data, pageWidth);
      drawTicketQrSection(doc, data, qrPngBuffer, pageWidth, pageHeight);

      doc.end();
    } catch (err: unknown) {
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
}
