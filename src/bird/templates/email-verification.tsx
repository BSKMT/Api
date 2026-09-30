import * as React from "react";
import { Heading, Text, Button, Section, Link } from "@react-email/components";
import { EmailLayout } from "./email-layout";

export interface EmailVerificationEmailProps {
  name: string;
  verificationUrl: string;
}

export const EmailVerificationEmail: React.FC<EmailVerificationEmailProps> = ({
  name,
  verificationUrl,
}) => {
  return (
    <EmailLayout previewText="Confirma tu correo electrónico para activar tu cuenta en BSK Motorcycle Team">
      <Section style={sectionStyle}>
        <div style={badgeStyle}>VERIFICACIÓN DE CUENTA</div>
        <Heading style={headingStyle}>¡Hola {name || "Rider"}!</Heading>
        <Text style={paragraphStyle}>
          Te damos la bienvenida a <strong>BSK Motorcycle Team</strong>. Para
          comenzar a disfrutar de todos los beneficios de la comunidad,
          gestionar tus rodadas y activar tu perfil oficial, confirma tu
          dirección de correo electrónico haciendo clic en el siguiente botón:
        </Text>

        <Section style={buttonContainerStyle}>
          <Button href={verificationUrl} style={buttonStyle}>
            VERIFICAR MI CORREO
          </Button>
        </Section>

        <Section style={fallbackBoxStyle}>
          <Text style={fallbackTextStyle}>
            Si el botón no funciona, copia y pega este enlace seguro en tu
            navegador:
          </Text>
          <Link href={verificationUrl} style={rawLinkStyle}>
            {verificationUrl}
          </Link>
        </Section>

        <Section style={securityBoxStyle}>
          <Text style={securityTextStyle}>
            <strong>Seguridad:</strong> Si tú no solicitaste crear una cuenta en
            BSK Motorcycle Team, puedes ignorar este mensaje de forma segura.
            Nadie podrá acceder a tu cuenta sin verificar este enlace.
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

const securityBoxStyle: React.CSSProperties = {
  borderLeft: "3px solid #94a3b8",
  paddingLeft: "12px",
  margin: "16px 0 0 0",
};

const securityTextStyle: React.CSSProperties = {
  color: "#64748b",
  fontSize: "12px",
  lineHeight: "18px",
  margin: 0,
};
