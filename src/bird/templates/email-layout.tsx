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
  Img,
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
        <meta name="color-scheme" content="light dark" />
        <meta name="supported-color-schemes" content="light dark" />
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
        <style>{`
          :root {
            color-scheme: light dark;
            supported-color-schemes: light dark;
          }
          @media (prefers-color-scheme: dark) {
            .bsk-container {
              background-color: #0f172a !important;
              border-color: #1e293b !important;
              box-shadow: 0 12px 36px rgba(0, 0, 0, 0.6) !important;
            }
            .bsk-header {
              background-color: #020617 !important;
              border-bottom: 1px solid #1e293b !important;
            }
            .bsk-brand-title {
              color: #f8fafc !important;
            }
            .bsk-brand-tagline {
              color: #94a3b8 !important;
            }
            .bsk-content {
              background-color: #0f172a !important;
            }
            .bsk-heading {
              color: #f8fafc !important;
            }
            .bsk-paragraph {
              color: #cbd5e1 !important;
            }
            .bsk-muted {
              color: #94a3b8 !important;
            }
            .bsk-box {
              background-color: #1e293b !important;
              border-color: #334155 !important;
            }
            .bsk-box-text {
              color: #94a3b8 !important;
            }
            .bsk-warning-box {
              background-color: #2a1205 !important;
              border-color: #7c2d12 !important;
            }
            .bsk-warning-text {
              color: #fdba74 !important;
            }
            .bsk-badge-verify {
              background-color: #450a0a !important;
              color: #fca5a5 !important;
              border-color: #7f1d1d !important;
            }
            .bsk-badge-security {
              background-color: #431407 !important;
              color: #fdba74 !important;
              border-color: #9a3412 !important;
            }
            .bsk-badge-notify {
              background-color: #1e293b !important;
              color: #cbd5e1 !important;
              border-color: #334155 !important;
            }
            .bsk-badge-contact {
              background-color: #451a03 !important;
              color: #fde68a !important;
              border-color: #78350f !important;
            }
            .bsk-meta-table {
              background-color: #1e293b !important;
              border-color: #334155 !important;
            }
            .bsk-meta-label {
              color: #94a3b8 !important;
            }
            .bsk-meta-value {
              color: #f8fafc !important;
            }
            .bsk-footer {
              background-color: #020617 !important;
              border-top-color: #1e293b !important;
            }
            .bsk-hr {
              border-color: #1e293b !important;
            }
            .bsk-footer-link {
              color: #94a3b8 !important;
            }
            .bsk-footer-corporate {
              color: #94a3b8 !important;
            }
            .bsk-footer-disclaimer {
              color: #64748b !important;
            }
            .bsk-logo-light {
              display: none !important;
            }
            .bsk-logo-dark {
              display: block !important;
            }
          }
          [data-ogsc] .bsk-container {
            background-color: #0f172a !important;
            border-color: #1e293b !important;
          }
          [data-ogsc] .bsk-heading {
            color: #f8fafc !important;
          }
          [data-ogsc] .bsk-paragraph {
            color: #cbd5e1 !important;
          }
          [data-ogsc] .bsk-box {
            background-color: #1e293b !important;
            border-color: #334155 !important;
          }
          [data-ogsc] .bsk-footer {
            background-color: #020617 !important;
          }
          [data-ogsc] .bsk-logo-light {
            display: none !important;
          }
          [data-ogsc] .bsk-logo-dark {
            display: block !important;
          }
        `}</style>
      </Head>
      {previewText && <Preview>{previewText}</Preview>}
      <Body style={mainStyle}>
        <Container style={containerStyle} className="bsk-container">
          {/* Top Brand Header */}
          <Section style={headerStyle} className="bsk-header">
            <div style={accentBarStyle} />

            {/* Light Mode Logo */}
            <div className="bsk-logo-light">
              <Img
                src="https://bskmt.com/assets/Motoclub_BSK_Motorcycle_Team_Claro.png"
                alt="BSK Motorcycle Team"
                width={56}
                height={56}
                style={logoImgStyle}
              />
            </div>

            {/* Dark Mode Logo */}
            <div className="bsk-logo-dark" style={{ display: "none" }}>
              <Img
                src="https://bskmt.com/assets/Motoclub_BSK_Motorcycle_Team_Oscuro.png"
                alt="BSK Motorcycle Team"
                width={56}
                height={56}
                style={logoImgStyle}
              />
            </div>

            <Text style={logoTextStyle} className="bsk-brand-title">
              BSK MOTORCYCLE TEAM
            </Text>
            <Text style={taglineStyle} className="bsk-brand-tagline">
              CLUB &bull; COMUNIDAD &bull; SEGURIDAD VIAL
            </Text>
          </Section>

          {/* Main Content Area */}
          <Section style={contentStyle} className="bsk-content">
            {children}
          </Section>

          {/* Footer Area with Official Corporate Information */}
          <Section style={footerStyle} className="bsk-footer">
            <Hr style={hrStyle} className="bsk-hr" />

            {/* Quick Links Navigation */}
            <Section style={navSectionStyle}>
              <Row>
                <Column style={navColStyle}>
                  <Link
                    href="https://bskmt.com"
                    style={footerNavLinkStyle}
                    className="bsk-footer-link"
                  >
                    Portal Web
                  </Link>
                </Column>
                <Column style={navColStyle}>
                  <Link
                    href="https://dash.bskmt.com"
                    style={footerNavLinkStyle}
                    className="bsk-footer-link"
                  >
                    Panel de Miembro
                  </Link>
                </Column>
                <Column style={navColStyle}>
                  <Link
                    href="https://bskmt.com/terminos-y-condiciones"
                    style={footerNavLinkStyle}
                    className="bsk-footer-link"
                  >
                    Términos
                  </Link>
                </Column>
                <Column style={navColStyle}>
                  <Link
                    href="https://bskmt.com/politica-de-privacidad"
                    style={footerNavLinkStyle}
                    className="bsk-footer-link"
                  >
                    Privacidad
                  </Link>
                </Column>
                <Column style={navColStyle}>
                  <Link
                    href="https://bskmt.com/contacto"
                    style={footerNavLinkStyle}
                    className="bsk-footer-link"
                  >
                    Contacto
                  </Link>
                </Column>
              </Row>
            </Section>

            {/* Social Channels */}
            <Text style={socialTextStyle} className="bsk-footer-text">
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
            <Text style={corporateInfoStyle} className="bsk-footer-corporate">
              <strong>Organización Motera S.A.S.</strong> &bull; NIT
              901.444.877-6
              <br />
              Domicilio Principal: Bogotá D.C., Colombia &bull; Cámara de
              Comercio de Bogotá
            </Text>

            <Text
              style={footerDisclaimerStyle}
              className="bsk-footer-disclaimer"
            >
              Este es un correo transaccional automático enviado a tu dirección
              registrada en la plataforma de BSK Motorcycle Team. Para ejercer
              tus derechos de protección de datos personales (Ley 1581 de 2012),
              escribe a{" "}
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
  backgroundColor: "transparent",
  fontFamily:
    "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
  margin: 0,
  padding: "32px 12px",
};

const containerStyle: React.CSSProperties = {
  backgroundColor: "#ffffff",
  margin: "0 auto",
  maxWidth: "580px",
  borderRadius: "16px",
  overflow: "hidden",
  border: "1px solid #e2e8f0",
  boxShadow: "0 8px 30px rgba(0, 0, 0, 0.08)",
};

const accentBarStyle: React.CSSProperties = {
  height: "4px",
  backgroundColor: "#dc2626",
  width: "100%",
  margin: "0 0 18px 0",
};

const headerStyle: React.CSSProperties = {
  backgroundColor: "#ffffff",
  padding: "0 28px 24px 28px",
  textAlign: "center",
  borderBottom: "1px solid #f1f5f9",
};

const logoImgStyle: React.CSSProperties = {
  display: "block",
  margin: "0 auto 12px auto",
  outline: "none",
  border: "none",
  textDecoration: "none",
};

const logoTextStyle: React.CSSProperties = {
  color: "#0f172a",
  fontSize: "19px",
  fontWeight: 800,
  letterSpacing: "0.08em",
  margin: "0 0 4px 0",
  textTransform: "uppercase",
};

const taglineStyle: React.CSSProperties = {
  color: "#64748b",
  fontSize: "11px",
  fontWeight: 600,
  letterSpacing: "0.15em",
  margin: 0,
  textTransform: "uppercase",
};

const contentStyle: React.CSSProperties = {
  backgroundColor: "#ffffff",
  padding: "36px 32px 28px 32px",
};

const footerStyle: React.CSSProperties = {
  backgroundColor: "#f8fafc",
  padding: "24px 32px 28px 32px",
  textAlign: "center",
  borderTop: "1px solid #e2e8f0",
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
