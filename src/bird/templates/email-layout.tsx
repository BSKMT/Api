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
  Row,
  Column,
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

          {/* Footer Area with Official Corporate Information */}
          <Section style={footerStyle}>
            <Hr style={hrStyle} />

            {/* Quick Links Navigation */}
            <Section style={navSectionStyle}>
              <Row>
                <Column style={navColStyle}>
                  <Link href="https://bskmt.com" style={footerNavLinkStyle}>
                    Portal Web
                  </Link>
                </Column>
                <Column style={navColStyle}>
                  <Link
                    href="https://dash.bskmt.com"
                    style={footerNavLinkStyle}
                  >
                    Panel de Miembro
                  </Link>
                </Column>
                <Column style={navColStyle}>
                  <Link
                    href="https://bskmt.com/terminos-y-condiciones"
                    style={footerNavLinkStyle}
                  >
                    Términos
                  </Link>
                </Column>
                <Column style={navColStyle}>
                  <Link
                    href="https://bskmt.com/politica-de-privacidad"
                    style={footerNavLinkStyle}
                  >
                    Privacidad
                  </Link>
                </Column>
                <Column style={navColStyle}>
                  <Link
                    href="https://bskmt.com/contacto"
                    style={footerNavLinkStyle}
                  >
                    Contacto
                  </Link>
                </Column>
              </Row>
            </Section>

            {/* Social Channels */}
            <Text style={socialTextStyle}>
              Síguenos en{" "}
              <Link
                href="https://www.instagram.com/bsk_motorcycle_team"
                style={socialLinkStyle}
              >
                Instagram (@bsk_motorcycle_team)
              </Link>{" "}
              &bull;{" "}
              <Link
                href="https://www.tiktok.com/@bsk_motorcycle_team"
                style={socialLinkStyle}
              >
                TikTok
              </Link>
            </Text>

            {/* Official Legal Identification */}
            <Text style={corporateInfoStyle}>
              <strong>Organización Motera S.A.S.</strong> &bull; NIT
              901.444.877-6<br />
              Domicilio Principal: Bogotá D.C., Colombia &bull; Cámara de Comercio de
              Bogotá
            </Text>

            <Text style={footerDisclaimerStyle}>
              Este es un correo transaccional automático enviado a tu dirección
              registrada en la plataforma de BSK Motorcycle Team. Para
              ejercer tus derechos de protección de datos personales (Ley 1581 de
              2012), escribe a{" "}
              <Link href="mailto:datos@bskmt.com" style={footerLinkStyle}>
                datos@bskmt.com
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
  backgroundColor: "#f8fafc",
  padding: "24px 32px 28px 32px",
  textAlign: "center",
  borderTop: "1px solid #f1f5f9",
};

const hrStyle: React.CSSProperties = {
  borderColor: "#e2e8f0",
  margin: "0 0 18px 0",
};

const navSectionStyle: React.CSSProperties = {
  margin: "0 0 14px 0",
  textAlign: "center",
};

const navColStyle: React.CSSProperties = {
  textAlign: "center",
  padding: "0 6px",
};

const footerNavLinkStyle: React.CSSProperties = {
  color: "#475569",
  fontSize: "11px",
  fontWeight: 600,
  textDecoration: "none",
};

const socialTextStyle: React.CSSProperties = {
  color: "#64748b",
  fontSize: "11px",
  margin: "0 0 14px 0",
};

const socialLinkStyle: React.CSSProperties = {
  color: "#dc2626",
  textDecoration: "none",
  fontWeight: 600,
};

const corporateInfoStyle: React.CSSProperties = {
  color: "#64748b",
  fontSize: "11px",
  lineHeight: "17px",
  margin: "0 0 10px 0",
};

const footerDisclaimerStyle: React.CSSProperties = {
  color: "#94a3b8",
  fontSize: "10px",
  lineHeight: "15px",
  margin: 0,
};

const footerLinkStyle: React.CSSProperties = {
  color: "#dc2626",
  textDecoration: "underline",
};
