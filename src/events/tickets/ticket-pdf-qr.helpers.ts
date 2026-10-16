import type PDFDocument from "pdfkit";
import type { TicketPdfData } from "./ticket-pdf.generator";

type PDFDoc = InstanceType<typeof PDFDocument>;

export function drawTicketQrSection(
  doc: PDFDoc,
  data: TicketPdfData,
  qrPngBuffer: Buffer,
  pageWidth: number,
  pageHeight: number,
): void {
  const ticketCardY = 238;
  const ticketCardHeight = 270;
  doc
    .roundedRect(24, ticketCardY, pageWidth - 48, ticketCardHeight, 10)
    .fill("#ffffff");

  doc
    .roundedRect(24, ticketCardY, pageWidth - 48, ticketCardHeight, 10)
    .strokeColor("#cbd5e1")
    .lineWidth(1)
    .stroke();

  doc.roundedRect(24, ticketCardY, pageWidth - 48, 28, 10).fill("#020617");
  doc
    .fillColor("#38bdf8")
    .fontSize(8)
    .font("Helvetica-Bold")
    .text("PASE DIGITAL DE ASISTENCIA", 24, ticketCardY + 9, {
      width: pageWidth - 48,
      align: "center",
    });

  const qrSize = 145;
  const qrX = (pageWidth - qrSize) / 2;
  doc.image(qrPngBuffer, qrX, ticketCardY + 36, {
    width: qrSize,
    height: qrSize,
  });

  doc
    .fillColor("#020617")
    .fontSize(16)
    .font("Courier-Bold")
    .text(data.checkInCode, 24, ticketCardY + 188, {
      width: pageWidth - 48,
      align: "center",
    });

  doc
    .fillColor("#64748b")
    .fontSize(7.5)
    .font("Helvetica")
    .text("CÓDIGO ALFANUMÉRICO DE ASISTENCIA EN CAMPO", 24, ticketCardY + 208, {
      width: pageWidth - 48,
      align: "center",
    });

  doc
    .fillColor("#334155")
    .fontSize(7.5)
    .font("Helvetica")
    .text(
      "Presenta este QR o código al coordinador de campo BSK Fascia al momento de tu llegada.",
      36,
      ticketCardY + 226,
      { width: pageWidth - 72, align: "center" },
    );

  doc
    .fillColor("#dc2626")
    .fontSize(7)
    .font("Helvetica-Bold")
    .text(
      "Ticket personal e intransferible. Válido únicamente para el evento/curso indicado.",
      36,
      ticketCardY + 246,
      { width: pageWidth - 72, align: "center" },
    );

  const now = data.issuedAt || new Date();
  const issueDateStr = now.toLocaleDateString("es-CO", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  doc
    .fillColor("#64748b")
    .fontSize(6.5)
    .font("Helvetica")
    .text(
      `Emitido por BSK Motorcycle Team · ${issueDateStr} · Soporte ARPHA 24/7 disponible en panel`,
      24,
      pageHeight - 24,
      { width: pageWidth - 48, align: "center" },
    );
}
