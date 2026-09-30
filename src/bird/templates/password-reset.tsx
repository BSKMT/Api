import * as React from "react";
import { Heading, Text, Button, Section, Link } from "@react-email/components";
import { EmailLayout } from "./email-layout";

export interface PasswordResetEmailProps {
  name: string;
  resetUrl: string;
}

export const PasswordResetEmail: React.FC<PasswordResetEmailProps> = ({
  name,
  resetUrl,
}) => {
  return (
    <EmailLayout previewText="Restablecimiento de contraseña para tu cuenta de BSK Motorcycle Team">
      <Section style={sectionStyle}>
        <div style={badgeStyle}>SEGURIDAD DE LA CUENTA</div>
        <Heading style={headingStyle}>Hola {name || "Rider"}</Heading>
        <Text style={paragraphStyle}>
          Hemos recibido una solicitud para restablecer la contraseña de acceso
          a tu cuenta en <strong>BSK Motorcycle Team</strong>. Si fuiste tú,
          puedes crear tu nueva clave haciendo clic en el siguiente botón:
        </Text>

        <Section style={buttonContainerStyle}>
          <Button href={resetUrl} style={buttonStyle}>
            RESTABLECER MI CONTRASEÑA
          </Button>
        </Section>

        <Section style={fallbackBoxStyle}>
          <Text style={fallbackTextStyle}>
            Si el botón no responde, copia y abre este enlace directamente en tu
            navegador:
          </Text>
          <Link href={resetUrl} style={rawLinkStyle}>
            {resetUrl}
          </Link>
        </Section>

        <Section style={warningBoxStyle}>
          <Text style={warningTextStyle}>
            ⏳ <strong>Atención:</strong> Por motivos de seguridad, este enlace
            expirará automáticamente en <strong>1 hora</strong>. Si no
            solicitaste este cambio de contraseña, ignora este correo de
            inmediato; tu cuenta continúa segura y protegida.
          </Text>
        </Section>
      </Section>
    </EmailLayout>
  );
};

const sectionStyle: React.CSSProperties = {
  textAlign: "left",
};

const badgeStyle: React.CSSProperties = {
  display: "inline-block",
  backgroundColor: "#fef2f2",
  color: "#dc2626",
  border: "1px solid #fecaca",
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
  fontSize: "24px",
  fontWeight: 800,
  lineHeight: "32px",
  margin: "0 0 16px 0",
};

const paragraphStyle: React.CSSProperties = {
  color: "#334155",
  fontSize: "15px",
  lineHeight: "24px",
  margin: "0 0 24px 0",
};

const buttonContainerStyle: React.CSSProperties = {
  textAlign: "center",
  margin: "28px 0 32px 0",
};

const buttonStyle: React.CSSProperties = {
  backgroundColor: "#dc2626",
  borderRadius: "9999px",
  color: "#ffffff",
  fontSize: "14px",
  fontWeight: 700,
  letterSpacing: "0.06em",
  padding: "14px 36px",
  textDecoration: "none",
  textAlign: "center",
  display: "inline-block",
  boxShadow: "0 4px 14px rgba(220, 38, 38, 0.4)",
};

const fallbackBoxStyle: React.CSSProperties = {
  backgroundColor: "#f8fafc",
  border: "1px solid #e2e8f0",
  borderRadius: "10px",
  padding: "14px 16px",
  margin: "0 0 20px 0",
};

const fallbackTextStyle: React.CSSProperties = {
  color: "#64748b",
  fontSize: "12px",
  margin: "0 0 6px 0",
};

const rawLinkStyle: React.CSSProperties = {
  color: "#dc2626",
  fontSize: "12px",
  lineHeight: "18px",
  wordBreak: "break-all",
  textDecoration: "underline",
};

const warningBoxStyle: React.CSSProperties = {
  backgroundColor: "#fff7ed",
  border: "1px solid #ffedd5",
  borderLeft: "3px solid #ea580c",
  borderRadius: "8px",
  padding: "12px 16px",
  margin: "16px 0 0 0",
};

const warningTextStyle: React.CSSProperties = {
  color: "#9a3412",
  fontSize: "12px",
  lineHeight: "18px",
  margin: 0,
};
