import PDFDocument from "pdfkit";
import QRCode from "qrcode";

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
  // Generar buffer de imagen PNG para el código QR
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

      // ── Fondo principal Dark Slate ───────────────────────────────────────────
      doc.rect(0, 0, pageWidth, pageHeight).fill("#090d16");

      // ── Barra decorativa superior (Rojo BSK) ──────────────────────────────────
      doc.rect(0, 0, pageWidth, 5).fill("#dc2626");

      // ── Cabecera de Marca ──────────────────────────────────────────────────
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

      // ── Tarjeta de Información del Evento / Curso ──────────────────────────
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

      // Detalle 1: Fecha y Horario
      doc
        .fillColor("#94a3b8")
        .fontSize(7.5)
        .font("Helvetica")
        .text("FECHA Y HORARIO:", 36, 104);
      doc
        .fillColor("#f1f5f9")
        .fontSize(8)
        .font("Helvetica-Bold")
        .text(
          `${data.dateText}${data.timeText ? ` · ${data.timeText}` : ""}`,
          36,
          114,
        );

      // Detalle 2: Punto de Encuentro / Locación
      const loc =
        data.meetingPointText || data.locationText || "Punto oficial BSK";
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

      // Coordinador asignado (si existe)
      if (data.coordinatorName) {
        doc
          .fillColor("#38bdf8")
          .fontSize(7.5)
          .font("Helvetica")
          .text(`Coordinador en campo: ${data.coordinatorName}`, 36, 149);
      }

      // ── Tarjeta de Datos del Piloto / Participante ──────────────────────────
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
      if (data.companionName)
        contactItems.push(`Acompañante: ${data.companionName}`);

      doc
        .fillColor("#94a3b8")
        .fontSize(8)
        .font("Helvetica")
        .text(contactItems.join("  |  "), 36, 203, {
          width: pageWidth - 72,
          ellipsis: true,
        });

      // ── Contenedor Central del Ticket (Blanco para contraste QR impecable) ───
      const ticketCardY = 238;
      const ticketCardHeight = 270;
      doc
        .roundedRect(24, ticketCardY, pageWidth - 48, ticketCardHeight, 10)
        .fill("#ffffff");

      // Borde decorativo
      doc
        .roundedRect(24, ticketCardY, pageWidth - 48, ticketCardHeight, 10)
        .strokeColor("#cbd5e1")
        .lineWidth(1)
        .stroke();

      // Franja superior de ticket
      doc.roundedRect(24, ticketCardY, pageWidth - 48, 28, 10).fill("#020617");
      doc
        .fillColor("#38bdf8")
        .fontSize(8)
        .font("Helvetica-Bold")
        .text("PASE DIGITAL DE ASISTENCIA", 24, ticketCardY + 9, {
          width: pageWidth - 48,
          align: "center",
        });

      // Imagen del Código QR (Centrada)
      const qrSize = 145;
      const qrX = (pageWidth - qrSize) / 2;
      doc.image(qrPngBuffer, qrX, ticketCardY + 36, {
        width: qrSize,
        height: qrSize,
      });

      // Código alfanumérico grande y legible
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
        .text(
          "CÓDIGO ALFANUMÉRICO DE ASISTENCIA EN CAMPO",
          24,
          ticketCardY + 208,
          {
            width: pageWidth - 48,
            align: "center",
          },
        );

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

      // ── Pie de Página Oficial ──────────────────────────────────────────────
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

      doc.end();
    } catch (err: unknown) {
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
}
