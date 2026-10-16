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

export async function generateTicketPdf(data: TicketPdfData): Promise<Buffer> {
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
