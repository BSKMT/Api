import * as React from "react";
import { Heading, Text, Button, Section, Img } from "@react-email/components";
import { EmailLayout } from "./email-layout";
import {
  sectionStyle,
  badgeStyle,
  headingStyle,
  introTextStyle,
  detailsCardStyle,
  cardTitleStyle,
  detailRowStyle,
  ticketContainerStyle,
  ticketHeaderStyle,
  qrWrapperStyle,
  qrImageStyle,
  codeTextStyle,
  codeSubtextStyle,
  ticketInstructionStyle,
  pdfNoticeStyle,
  pdfNoticeTextStyle,
  buttonContainerStyle,
  buttonStyle,
  footerMutedStyle,
} from "./ticket-notification.styles";

export interface TicketNotificationEmailProps {
  recipientName: string;
  type: "EVENT" | "COURSE";
  title: string;
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
  const typeLabel = type === "EVENT" ? "Evento BSK" : "Curso / Academia BSK";

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
          Hola <strong>{recipientName}</strong>, tu lugar en el{" "}
          {typeLabel.toLowerCase()} <strong>&ldquo;{title}&rdquo;</strong> ha
          sido validado exitosamente. A continuación encontrarás tu ticket
          oficial de acceso y asistencia.
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
