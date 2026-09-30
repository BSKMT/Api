import * as React from "react";
import {
  Html,
  Head,
  Body,
  Container,
  Section,
  Text,
  Font,
  Preview,
  Hr,
  Link,
} from "@react-email/components";

export interface EmailLayoutProps {
  previewText?: string;
  children: React.ReactNode;
}

export const EmailLayout: React.FC<EmailLayoutProps> = ({
  previewText,
  children,
}) => {
  return (
    <Html lang="es" dir="ltr">
      <Head>
        <Font
          fontFamily="Inter"
          fallbackFontFamily="Helvetica"
          webFont={{
            url: "https://fonts.gstatic.com/s/inter/v13/UcCO3FwrK3iLTeHuS_fvQtMwCp50KnMw2boKoduKmMEVuLyfAZ9hiA.woff2",
            format: "woff2",
          }}
          fontWeight={400}
          fontStyle="normal"
        />
        <Font
          fontFamily="Inter"
          fallbackFontFamily="Helvetica"
          webFont={{
            url: "https://fonts.gstatic.com/s/inter/v13/UcC73FwrK3iLTeHuS_fvQtMwCp50KnMa1ZL7W0Q5nw.woff2",
            format: "woff2",
          }}
          fontWeight={700}
          fontStyle="normal"
        />
      </Head>
      {previewText && <Preview>{previewText}</Preview>}
      <Body style={mainStyle}>
        <Container style={containerStyle}>
          {/* Top Brand Bar */}
          <Section style={headerStyle}>
            <div style={accentBarStyle} />
            <Text style={logoTextStyle}>BSK MOTORCYCLE TEAM</Text>
            <Text style={taglineStyle}>
              CLUB &bull; COMUNIDAD &bull; SEGURIDAD VIAL
            </Text>
          </Section>

          {/* Main Content Area */}
          <Section style={contentStyle}>{children}</Section>

          {/* Footer Area */}
          <Section style={footerStyle}>
            <Hr style={hrStyle} />
            <Text style={footerTextStyle}>
              &copy; {new Date().getFullYear()} BSK Motorcycle Team.
              Bogot&aacute;, Colombia.
            </Text>
            <Text style={footerDisclaimerStyle}>
              Este es un correo electr&oacute;nico transaccional
              autom&aacute;tico enviado desde{" "}
              <Link href="https://bskmt.com" style={footerLinkStyle}>
                bskmt.com
              </Link>
              . Por favor no respondas directamente a este mensaje.
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
};

const mainStyle: React.CSSProperties = {
  backgroundColor: "#0b0f19",
  fontFamily:
    "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
  margin: 0,
  padding: "32px 16px",
};

const containerStyle: React.CSSProperties = {
  backgroundColor: "#ffffff",
  margin: "0 auto",
  maxWidth: "580px",
  borderRadius: "16px",
  overflow: "hidden",
  border: "1px solid #1e293b",
  boxShadow: "0 10px 30px rgba(0, 0, 0, 0.35)",
};

const accentBarStyle: React.CSSProperties = {
  height: "4px",
  backgroundColor: "#dc2626",
  width: "100%",
  margin: "0 0 20px 0",
};

const headerStyle: React.CSSProperties = {
  backgroundColor: "#0f172a",
  padding: "0 28px 24px 28px",
  textAlign: "center",
};

const logoTextStyle: React.CSSProperties = {
  color: "#ffffff",
  fontSize: "20px",
  fontWeight: 800,
  letterSpacing: "0.1em",
  margin: "0 0 4px 0",
  textTransform: "uppercase",
};

const taglineStyle: React.CSSProperties = {
  color: "#94a3b8",
  fontSize: "11px",
  fontWeight: 600,
  letterSpacing: "0.15em",
  margin: 0,
  textTransform: "uppercase",
};

const contentStyle: React.CSSProperties = {
  padding: "36px 32px 28px 32px",
};

const footerStyle: React.CSSProperties = {
  backgroundColor: "#ffffff",
  padding: "0 32px 28px 32px",
  textAlign: "center",
};

const hrStyle: React.CSSProperties = {
  borderColor: "#e2e8f0",
  margin: "0 0 20px 0",
};

const footerTextStyle: React.CSSProperties = {
  color: "#64748b",
  fontSize: "12px",
  fontWeight: 600,
  margin: "0 0 6px 0",
};

const footerDisclaimerStyle: React.CSSProperties = {
  color: "#94a3b8",
  fontSize: "11px",
  lineHeight: "16px",
  margin: 0,
};

const footerLinkStyle: React.CSSProperties = {
  color: "#dc2626",
  textDecoration: "underline",
};
