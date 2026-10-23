import type React from "react";

export const emailHeadStyles = `
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
`;

export const mainStyle: React.CSSProperties = {
  backgroundColor: "transparent",
  fontFamily:
    "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
  margin: 0,
  padding: "32px 12px",
};

export const containerStyle: React.CSSProperties = {
  backgroundColor: "#ffffff",
  margin: "0 auto",
  maxWidth: "580px",
  borderRadius: "16px",
  overflow: "hidden",
  border: "1px solid #e2e8f0",
  boxShadow: "0 8px 30px rgba(0, 0, 0, 0.08)",
};

export const accentBarStyle: React.CSSProperties = {
  height: "4px",
  backgroundColor: "#dc2626",
  width: "100%",
  margin: "0 0 18px 0",
};

export const headerStyle: React.CSSProperties = {
  backgroundColor: "#ffffff",
  padding: "0 28px 24px 28px",
  textAlign: "center",
  borderBottom: "1px solid #f1f5f9",
};

export const logoImgStyle: React.CSSProperties = {
  display: "block",
  margin: "0 auto 12px auto",
  outline: "none",
  border: "none",
  textDecoration: "none",
};

export const logoTextStyle: React.CSSProperties = {
  color: "#0f172a",
  fontSize: "19px",
  fontWeight: 800,
  letterSpacing: "0.08em",
  margin: "0 0 4px 0",
  textTransform: "uppercase",
};

export const taglineStyle: React.CSSProperties = {
  color: "#64748b",
  fontSize: "11px",
  fontWeight: 600,
  letterSpacing: "0.15em",
  margin: 0,
  textTransform: "uppercase",
};

export const contentStyle: React.CSSProperties = {
  backgroundColor: "#ffffff",
  padding: "36px 32px 28px 32px",
};

export const footerStyle: React.CSSProperties = {
  backgroundColor: "#f8fafc",
  padding: "24px 32px 28px 32px",
  textAlign: "center",
  borderTop: "1px solid #e2e8f0",
};

export const hrStyle: React.CSSProperties = {
  borderColor: "#e2e8f0",
  margin: "0 0 18px 0",
};

export const navSectionStyle: React.CSSProperties = {
  margin: "0 0 14px 0",
  textAlign: "center",
};

export const navColStyle: React.CSSProperties = {
  textAlign: "center",
  padding: "0 6px",
};

export const footerNavLinkStyle: React.CSSProperties = {
  color: "#475569",
  fontSize: "11px",
  fontWeight: 600,
  textDecoration: "none",
};

export const socialTextStyle: React.CSSProperties = {
  color: "#64748b",
  fontSize: "11px",
  margin: "0 0 14px 0",
};

export const socialLinkStyle: React.CSSProperties = {
  color: "#dc2626",
  textDecoration: "none",
  fontWeight: 600,
};

export const corporateInfoStyle: React.CSSProperties = {
  color: "#64748b",
  fontSize: "11px",
  lineHeight: "17px",
  margin: "0 0 10px 0",
};

export const footerDisclaimerStyle: React.CSSProperties = {
  color: "#94a3b8",
  fontSize: "10px",
  lineHeight: "15px",
  margin: 0,
};

export const footerLinkStyle: React.CSSProperties = {
  color: "#dc2626",
  textDecoration: "underline",
};
