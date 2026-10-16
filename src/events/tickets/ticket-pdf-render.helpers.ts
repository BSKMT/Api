import type PDFDocument from "pdfkit";
import type { TicketPdfData } from "./ticket-pdf.generator";

export { drawTicketQrSection } from "./ticket-pdf-qr.helpers";

type PDFDoc = InstanceType<typeof PDFDocument>;

export function drawTicketHeader(
  doc: PDFDoc,
  data: TicketPdfData,
  pageWidth: number,
  pageHeight: number,
): void {
  // Fondo principal Dark Slate
  doc.rect(0, 0, pageWidth, pageHeight).fill("#090d16");

  // Barra decorativa superior (Rojo BSK)
  doc.rect(0, 0, pageWidth, 5).fill("#dc2626");

  // Cabecera de Marca
  doc
    .fillColor("#dc2626")
    .fontSize(13)
    .font("Helvetica-Bold")
    .text("BSK MOTORCYCLE TEAM", 24, 22, { align: "left" });

  const typeLabel =
    data.type === "EVENT"
      ? "PASE OFICIAL DE ASISTENCIA A EVENTO"
      : "TICKET OFICIAL DE MATRÍCULA Y CURSO";

  doc
    .fillColor("#94a3b8")
    .fontSize(7.5)
    .font("Helvetica")
    .text(typeLabel, 24, 38, { align: "left" });

  // Badge de estado "PAGO Y REGISTRO CONFIRMADO"
  const badgeX = pageWidth - 164;
  doc.roundedRect(badgeX, 20, 140, 24, 6).fill("#1e293b");
  doc
    .fillColor("#22c55e")
    .fontSize(8)
    .font("Helvetica-Bold")
    .text("REGISTRO CONFIRMADO ✓", badgeX, 27, {
      width: 140,
      align: "center",
    });

  // Línea divisoria elegante
  doc
    .moveTo(24, 52)
    .lineTo(pageWidth - 24, 52)
    .strokeColor("#1e293b")
    .lineWidth(1)
    .stroke();
}

export function drawTicketEventDetails(
  doc: PDFDoc,
  data: TicketPdfData,
  pageWidth: number,
): void {
  doc.roundedRect(24, 60, pageWidth - 48, 100, 8).fill("#0f172a");
  doc
    .roundedRect(24, 60, pageWidth - 48, 100, 8)
    .strokeColor("#1e293b")
    .lineWidth(1)
    .stroke();

  doc
    .fillColor("#f8fafc")
    .fontSize(12)
    .font("Helvetica-Bold")
    .text(data.title, 36, 70, { width: pageWidth - 72, ellipsis: true });

  if (data.categoryOrLevel || data.format) {
    const sub = [data.categoryOrLevel, data.format]
      .filter(Boolean)
      .join(" · ")
      .toUpperCase();
    doc
      .fillColor("#e2e8f0")
      .fontSize(7.5)
      .font("Helvetica-Bold")
      .text(sub, 36, 88);
  }

  // Detalle 1: Fecha y Horario (no nested template literal)
  const timeSuffix = data.timeText ? ` · ${data.timeText}` : "";
  const dateTimeText = `${data.dateText}${timeSuffix}`;

  doc
    .fillColor("#94a3b8")
    .fontSize(7.5)
    .font("Helvetica")
    .text("FECHA Y HORARIO:", 36, 104);
  doc
    .fillColor("#f1f5f9")
    .fontSize(8)
    .font("Helvetica-Bold")
    .text(dateTimeText, 36, 114);

  // Detalle 2: Punto de Encuentro / Locación
  const loc = data.meetingPointText || data.locationText || "Punto oficial BSK";
  doc
    .fillColor("#94a3b8")
    .fontSize(7.5)
    .font("Helvetica")
    .text("PUNTO DE ENCUENTRO / LUGAR:", 36, 128);
  doc
    .fillColor("#f1f5f9")
    .fontSize(8)
    .font("Helvetica-Bold")
    .text(loc, 36, 138, { width: pageWidth - 72, ellipsis: true });

  if (data.coordinatorName) {
    doc
      .fillColor("#38bdf8")
      .fontSize(7.5)
      .font("Helvetica")
      .text(`Coordinador en campo: ${data.coordinatorName}`, 36, 149);
  }
}

export function drawTicketParticipant(
  doc: PDFDoc,
  data: TicketPdfData,
  pageWidth: number,
): void {
  doc.roundedRect(24, 168, pageWidth - 48, 62, 8).fill("#0f172a");
  doc
    .roundedRect(24, 168, pageWidth - 48, 62, 8)
    .strokeColor("#1e293b")
    .lineWidth(1)
    .stroke();

  doc
    .fillColor("#94a3b8")
    .fontSize(7.5)
    .font("Helvetica")
    .text("PARTICIPANTE REGISTRADO:", 36, 176);

  doc
    .fillColor("#f8fafc")
    .fontSize(10)
    .font("Helvetica-Bold")
    .text(data.recipientName, 36, 187);

  const contactItems: string[] = [];
  if (data.recipientEmail) contactItems.push(data.recipientEmail);
  if (data.recipientPhone) contactItems.push(`Tel: ${data.recipientPhone}`);
  if (data.vehiclePlate) contactItems.push(`Placa: ${data.vehiclePlate}`);
  if (data.companionName) {
    contactItems.push(`Acompañante: ${data.companionName}`);
  }

  doc
    .fillColor("#94a3b8")
    .fontSize(8)
    .font("Helvetica")
    .text(contactItems.join("  |  "), 36, 203, {
      width: pageWidth - 72,
      ellipsis: true,
    });
}
