import * as React from "react";
import { Heading, Text, Button, Section } from "@react-email/components";
import { EmailLayout } from "./email-layout";

export interface NotificationEmailProps {
  title: string;
  message: string;
  ctaUrl?: string;
  ctaText?: string;
}

export const NotificationEmail: React.FC<NotificationEmailProps> = ({
  title,
  message,
  ctaUrl,
  ctaText,
}) => {
  return (
    <EmailLayout
      previewText={`${title} — Notificación oficial de BSK Motorcycle Team`}
    >
      <Section style={sectionStyle}>
        <div style={badgeStyle}>NOTIFICACIÓN DEL SISTEMA</div>
        <Heading style={headingStyle}>{title}</Heading>

        <Section style={messageCardStyle}>
          <Text style={messageTextStyle}>{message}</Text>
        </Section>

        {ctaUrl && (
          <Section style={buttonContainerStyle}>
            <Button href={ctaUrl} style={buttonStyle}>
              {ctaText || "VER EN EL PANEL"}
            </Button>
          </Section>
        )}

        <Text style={infoTextStyle}>
          Puedes administrar tus preferencias de alertas en cualquier momento
          desde los ajustes de tu cuenta en el panel de control.
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
  backgroundColor: "#f1f5f9",
  color: "#475569",
  border: "1px solid #e2e8f0",
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

const messageCardStyle: React.CSSProperties = {
  backgroundColor: "#f8fafc",
  border: "1px solid #e2e8f0",
  borderLeft: "4px solid #dc2626",
  borderRadius: "12px",
  padding: "18px 20px",
  margin: "0 0 24px 0",
};

const messageTextStyle: React.CSSProperties = {
  color: "#334155",
  fontSize: "15px",
  lineHeight: "24px",
  margin: 0,
  whiteSpace: "pre-wrap",
};

const buttonContainerStyle: React.CSSProperties = {
  textAlign: "center",
  margin: "24px 0 28px 0",
};

const buttonStyle: React.CSSProperties = {
  backgroundColor: "#dc2626",
  borderRadius: "9999px",
  color: "#ffffff",
  fontSize: "13px",
  fontWeight: 700,
  letterSpacing: "0.06em",
  padding: "12px 32px",
  textDecoration: "none",
  textAlign: "center",
  display: "inline-block",
  boxShadow: "0 4px 14px rgba(220, 38, 38, 0.4)",
};

const infoTextStyle: React.CSSProperties = {
  color: "#94a3b8",
  fontSize: "12px",
  lineHeight: "18px",
  margin: "16px 0 0 0",
};
