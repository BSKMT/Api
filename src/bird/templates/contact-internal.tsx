import * as React from "react";
import { Heading, Text, Section, Row, Column } from "@react-email/components";
import { EmailLayout } from "./email-layout";

export interface ContactInternalEmailProps {
  name: string;
  email: string;
  subject: string;
  message: string;
  source?: string;
}

export const ContactInternalEmail: React.FC<ContactInternalEmailProps> = ({
  name,
  email,
  subject,
  message,
  source,
}) => {
  return (
    <EmailLayout previewText={`[Contacto Web] ${subject} — de ${name}`}>
      <Section style={sectionStyle}>
        <div style={badgeStyle}>NUEVO MENSAJE DE CONTACTO</div>
        <Heading style={headingStyle}>Formulario de Contacto Web</Heading>

        <Section style={metaTableStyle}>
          <Row style={metaRowStyle}>
            <Column style={metaLabelColStyle}>Remitente:</Column>
            <Column style={metaValueColStyle}>
              <strong>{name}</strong>
            </Column>
          </Row>
          <Row style={metaRowStyle}>
            <Column style={metaLabelColStyle}>Correo:</Column>
            <Column style={metaValueColStyle}>{email}</Column>
          </Row>
          <Row style={metaRowStyle}>
            <Column style={metaLabelColStyle}>Asunto:</Column>
            <Column style={metaValueColStyle}>{subject}</Column>
          </Row>
          {source && (
            <Row style={metaRowStyle}>
              <Column style={metaLabelColStyle}>Origen:</Column>
              <Column style={metaValueColStyle}>{source}</Column>
            </Row>
          )}
        </Section>

        <Text style={messageHeaderStyle}>Mensaje del usuario:</Text>
        <Section style={messageCardStyle}>
          <Text style={messageTextStyle}>{message}</Text>
        </Section>

        <Text style={tipStyle}>
          💡{" "}
          <em>
            Puedes responder directamente a este usuario escribiendo a{" "}
            <strong>{email}</strong>.
          </em>
        </Text>
      </Section>
    </EmailLayout>
  );
};

const sectionStyle: React.CSSProperties = {
  textAlign: "left",
};

const badgeStyle: React.CSSProperties = {
  display: "inline-block",
  backgroundColor: "#fef3c7",
  color: "#b45309",
  border: "1px solid #fde68a",
  fontSize: "11px",
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
  lineHeight: "30px",
  margin: "0 0 20px 0",
};

const metaTableStyle: React.CSSProperties = {
  backgroundColor: "#f8fafc",
  border: "1px solid #e2e8f0",
  borderRadius: "12px",
  padding: "16px 20px",
  margin: "0 0 24px 0",
};

const metaRowStyle: React.CSSProperties = {
  marginBottom: "8px",
};

const metaLabelColStyle: React.CSSProperties = {
  color: "#64748b",
  fontSize: "13px",
  fontWeight: 600,
  width: "100px",
  paddingBottom: "8px",
};

const metaValueColStyle: React.CSSProperties = {
  color: "#1e293b",
  fontSize: "13px",
  paddingBottom: "8px",
};

const messageHeaderStyle: React.CSSProperties = {
  color: "#0f172a",
  fontSize: "13px",
  fontWeight: 700,
  margin: "0 0 8px 0",
  textTransform: "uppercase",
  letterSpacing: "0.05em",
};

const messageCardStyle: React.CSSProperties = {
  backgroundColor: "#ffffff",
  border: "1px solid #e2e8f0",
  borderLeft: "4px solid #dc2626",
  borderRadius: "8px",
  padding: "16px 20px",
  margin: "0 0 20px 0",
};

const messageTextStyle: React.CSSProperties = {
  color: "#334155",
  fontSize: "14px",
  lineHeight: "22px",
  margin: 0,
  whiteSpace: "pre-wrap",
};

const tipStyle: React.CSSProperties = {
  color: "#64748b",
  fontSize: "12px",
  lineHeight: "18px",
  margin: 0,
};
