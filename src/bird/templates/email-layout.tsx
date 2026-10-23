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
import {
  emailHeadStyles,
  mainStyle,
  containerStyle,
  accentBarStyle,
  headerStyle,
  logoImgStyle,
  logoTextStyle,
  taglineStyle,
  contentStyle,
  footerStyle,
  hrStyle,
  navSectionStyle,
  navColStyle,
  footerNavLinkStyle,
  socialTextStyle,
  socialLinkStyle,
  corporateInfoStyle,
  footerDisclaimerStyle,
  footerLinkStyle,
} from "./email-layout.styles";

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
        <style>{emailHeadStyles}</style>
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
              <strong>Organización Motear S.A.S.</strong> &bull; NIT
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
