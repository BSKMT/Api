import * as React from "react";
import { Heading, Text, Button, Section, Img } from "@react-email/components";
import { EmailLayout } from "./email-layout";

export interface TicketNotificationEmailProps {
  recipientName: string;
  type: "EVENT" | "COURSE";
  title: string;
  slug: string;
  checkInCode: string;
  qrDataUrl: string;
  dateText: string;
  timeText?: string;
  locationText?: string;
  meetingPointText?: string;
  coordinatorName?: string;
  panelUrl: string;
}

export const TicketNotificationEmail: React.FC<
  TicketNotificationEmailProps
> = ({
  recipientName,
  type,
  title,
  checkInCode,
  qrDataUrl,
  dateText,
  timeText,
  locationText,
  meetingPointText,
  coordinatorName,
  panelUrl,
}) => {
  const typeLabel =
    type === "EVENT" ? "Evento BSK" : "Curso / Academia BSK";

  return (
    <EmailLayout
      previewText={`¡Tu registro en ${title} está 100% confirmado! Pase oficial: ${checkInCode}`}
    >
      <Section style={sectionStyle}>
        <div style={badgeStyle} className="bsk-badge-notify">
          CONFIRMACIÓN DE REGISTRO Y TICKET OFICIAL
        </div>

        <Heading style={headingStyle} className="bsk-heading">
          ¡Tu registro está 100% confirmado!
        </Heading>

        <Text style={introTextStyle} className="bsk-paragraph">
          Hola <strong>{recipientName}</strong>, tu lugar en el {typeLabel.toLowerCase()}{" "}
          <strong>&ldquo;{title}&rdquo;</strong> ha sido validado exitosamente. A
          continuación encontrarás tu ticket oficial de acceso y asistencia.
        </Text>

        {/* Tarjeta de detalles del evento */}
        <Section style={detailsCardStyle} className="bsk-box">
          <Text style={cardTitleStyle}>DETALLES DE LA CONVOCATORIA</Text>
          <Text style={detailRowStyle} className="bsk-paragraph">
            <strong>{typeLabel}:</strong> {title}
          </Text>
          <Text style={detailRowStyle} className="bsk-paragraph">
            <strong>Fecha y horario:</strong> {dateText}
            {timeText ? ` · ${timeText}` : ""}
          </Text>
          <Text style={detailRowStyle} className="bsk-paragraph">
            <strong>Lugar / Punto de encuentro:</strong>{" "}
            {meetingPointText || locationText || "Punto oficial BSK"}
          </Text>
          {coordinatorName && (
            <Text style={detailRowStyle} className="bsk-paragraph">
              <strong>Coordinador en campo:</strong> {coordinatorName}
            </Text>
          )}
        </Section>

        {/* Tarjeta del Ticket con QR y Código alfanumérico */}
        <Section style={ticketContainerStyle}>
          <div style={ticketHeaderStyle}>PASE DIGITAL DE ASISTENCIA</div>

          <div style={qrWrapperStyle}>
            <Img
              src={qrDataUrl}
              width={180}
              height={180}
              alt={`QR Asistencia ${checkInCode}`}
              style={qrImageStyle}
            />
          </div>

          <Text style={codeTextStyle}>{checkInCode}</Text>
          <Text style={codeSubtextStyle}>
            CÓDIGO ALFANUMÉRICO DE ASISTENCIA EN CAMPO
          </Text>

          <Text style={ticketInstructionStyle}>
            Presenta este código QR o código alfanumérico al coordinador
            responsable al momento de tu llegada al punto de encuentro o pista.
          </Text>
        </Section>

        {/* Aviso de PDF adjunto */}
        <Section style={pdfNoticeStyle}>
          <Text style={pdfNoticeTextStyle}>
            📎 <strong>Ticket oficial en PDF adjunto:</strong> Para mayor
            comodidad, hemos adjuntado a este correo tu ticket en formato PDF de
            alta resolución para que puedas guardarlo en tu teléfono o
            imprimirlo.
          </Text>
        </Section>

        {/* Botón CTA al panel */}
        {panelUrl && (
          <Section style={buttonContainerStyle}>
            <Button href={panelUrl} style={buttonStyle}>
              VER MI TICKET EN EL PANEL BSK
            </Button>
          </Section>
        )}

        <Text style={footerMutedStyle} className="bsk-muted">
          Este pase es personal e intransferible. Si necesitas asistencia previa
          al evento, puedes contactar a nuestro equipo a través de la línea de
          soporte ARPHA 24/7 disponible en el panel.
        </Text>
      </Section>
    </EmailLayout>
  );
};

// ── Estilos de soporte ────────────────────────────────────────────────────────
const sectionStyle: React.CSSProperties = {
  textAlign: "left",
};

const badgeStyle: React.CSSProperties = {
  display: "inline-block",
  backgroundColor: "#052e16",
  color: "#4ade80",
  border: "1px solid #166534",
  fontSize: "10.5px",
  fontWeight: 700,
  letterSpacing: "0.08em",
  padding: "4px 10px",
  borderRadius: "9999px",
  marginBottom: "16px",
  textTransform: "uppercase",
};

const headingStyle: React.CSSProperties = {
  color: "#0f172a",
  fontSize: "22px",
  fontWeight: 800,
  lineHeight: "28px",
  margin: "0 0 14px 0",
};

const introTextStyle: React.CSSProperties = {
  color: "#334155",
  fontSize: "14px",
  lineHeight: "22px",
  margin: "0 0 20px 0",
};

const detailsCardStyle: React.CSSProperties = {
  backgroundColor: "#f8fafc",
  border: "1px solid #e2e8f0",
  borderRadius: "12px",
  padding: "16px 20px",
  margin: "0 0 24px 0",
};

const cardTitleStyle: React.CSSProperties = {
  color: "#64748b",
  fontSize: "10px",
  fontWeight: 700,
  letterSpacing: "0.08em",
  margin: "0 0 10px 0",
  textTransform: "uppercase",
};

const detailRowStyle: React.CSSProperties = {
  color: "#1e293b",
  fontSize: "13px",
  lineHeight: "20px",
  margin: "0 0 6px 0",
};

const ticketContainerStyle: React.CSSProperties = {
  backgroundColor: "#ffffff",
  border: "2px dashed #cbd5e1",
  borderRadius: "16px",
  padding: "24px 20px",
  textAlign: "center",
  margin: "0 0 24px 0",
};

const ticketHeaderStyle: React.CSSProperties = {
  color: "#dc2626",
  fontSize: "11px",
  fontWeight: 800,
  letterSpacing: "0.1em",
  textTransform: "uppercase",
  marginBottom: "14px",
};

const qrWrapperStyle: React.CSSProperties = {
  display: "inline-block",
  padding: "10px",
  backgroundColor: "#ffffff",
  border: "1px solid #e2e8f0",
  borderRadius: "12px",
  marginBottom: "14px",
};

const qrImageStyle: React.CSSProperties = {
  display: "block",
  margin: "0 auto",
};

const codeTextStyle: React.CSSProperties = {
  color: "#0f172a",
  fontFamily: "Courier, monospace",
  fontSize: "22px",
  fontWeight: 800,
  letterSpacing: "0.05em",
  margin: "0 0 4px 0",
};

const codeSubtextStyle: React.CSSProperties = {
  color: "#64748b",
  fontSize: "9.5px",
  fontWeight: 700,
  letterSpacing: "0.05em",
  textTransform: "uppercase",
  margin: "0 0 14px 0",
};

const ticketInstructionStyle: React.CSSProperties = {
  color: "#475569",
  fontSize: "12px",
  lineHeight: "18px",
  maxWidth: "380px",
  margin: "0 auto",
};

const pdfNoticeStyle: React.CSSProperties = {
  backgroundColor: "#f1f5f9",
  borderLeft: "4px solid #38bdf8",
  borderRadius: "6px",
  padding: "12px 16px",
  margin: "0 0 24px 0",
};

const pdfNoticeTextStyle: React.CSSProperties = {
  color: "#334155",
  fontSize: "12px",
  lineHeight: "18px",
  margin: 0,
};

const buttonContainerStyle: React.CSSProperties = {
  textAlign: "center",
  margin: "0 0 24px 0",
};

const buttonStyle: React.CSSProperties = {
  backgroundColor: "#dc2626",
  color: "#ffffff",
  fontSize: "13px",
  fontWeight: 700,
  letterSpacing: "0.05em",
  padding: "14px 28px",
  borderRadius: "10px",
  textDecoration: "none",
  display: "inline-block",
};

const footerMutedStyle: React.CSSProperties = {
  color: "#94a3b8",
  fontSize: "11px",
  lineHeight: "16px",
  margin: "0",
};
