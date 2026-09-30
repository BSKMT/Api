import {
  renderEmailVerification,
  renderPasswordReset,
  renderNotification,
  renderContactInternal,
} from "./templates";
import { BirdEmailService } from "./bird-email.service";
import { BirdService } from "./bird.service";

describe("React Email Templates Suite", () => {
  describe("Email Renderers", () => {
    it("should render modern email verification with HTML and plain text", async () => {
      const result = await renderEmailVerification({
        name: "Carlos",
        verificationUrl:
          "https://bskmt.com/verificar-correo#token=test_token_123",
      });

      expect(result.html).toContain("BSK MOTORCYCLE TEAM");
      expect(result.html).toContain("Carlos");
      expect(result.html).toContain("VERIFICAR MI CORREO");
      expect(result.html).toContain(
        "https://bskmt.com/verificar-correo#token=test_token_123",
      );
      expect(result.text).toContain("Carlos");
      expect(result.text).toContain(
        "https://bskmt.com/verificar-correo#token=test_token_123",
      );
    });

    it("should render modern password reset with security notice and expiration warning", async () => {
      const result = await renderPasswordReset({
        name: "Andrés",
        resetUrl:
          "https://bskmt.com/restaurar-contrasena#token=reset_token_456",
      });

      expect(result.html).toContain("Andrés");
      expect(result.html).toContain("RESTABLECER MI CONTRASEÑA");
      expect(result.html).toContain("1 hora");
      expect(result.text).toContain("1 hora");
    });

    it("should render system notification with card styling", async () => {
      const result = await renderNotification({
        title: "Renovación de Membresía",
        message: "Tu membresía Gold ha sido renovada exitosamente.",
        ctaUrl: "https://dash.bskmt.com/membresia",
        ctaText: "VER MEMBRESÍA",
      });

      expect(result.html).toContain("Renovación de Membresía");
      expect(result.html).toContain("Tu membresía Gold ha sido renovada");
      expect(result.html).toContain("https://dash.bskmt.com/membresia");
      expect(result.text).toContain("Renovación de Membresía");
    });

    it("should render internal contact message with metadata table", async () => {
      const result = await renderContactInternal({
        name: "Juan Perez",
        email: "juan@example.com",
        subject: "Consulta sobre rodadas",
        message: "¿Cuándo es la próxima rodada a Villa de Leyva?",
        source: "Landing Page Footer",
      });

      expect(result.html).toContain("Juan Perez");
      expect(result.html).toContain("juan@example.com");
      expect(result.html).toContain("Consulta sobre rodadas");
      expect(result.html).toContain("Villa de Leyva");
      expect(result.text).toContain("Juan Perez");
    });
  });

  describe("BirdEmailService Integration with React Email", () => {
    let emailService: BirdEmailService;
    let mockBirdService: Partial<BirdService>;
    let mockClient: any;

    beforeEach(() => {
      mockClient = {
        email: {
          send: jest.fn().mockResolvedValue({ id: "msg_email_123" }),
        },
      };
      mockBirdService = {
        isConfigured: jest.fn().mockReturnValue(true),
        getClient: jest.fn().mockResolvedValue(mockClient),
      };
      emailService = new BirdEmailService(mockBirdService as BirdService);
    });

    it("should send verification email via Bird with HTML and text rendered by React Email", async () => {
      const ok = await emailService.sendVerificationEmail({
        to: "rider@bskmt.com",
        name: "Rider Test",
        verificationUrl: "https://bskmt.com/verify",
      });

      expect(ok).toBe(true);
      expect(mockClient.email.send).toHaveBeenCalledTimes(1);
      const callArgs = mockClient.email.send.mock.calls[0][0];
      expect(callArgs.to).toEqual(["rider@bskmt.com"]);
      expect(callArgs.category).toBe("transactional");
      expect(callArgs.html).toContain("BSK MOTORCYCLE TEAM");
      expect(callArgs.html).toContain("Rider Test");
      expect(callArgs.text).toBeDefined();
    });

    it("should send password reset email via Bird with HTML and text rendered by React Email", async () => {
      const ok = await emailService.sendPasswordResetEmail({
        to: "rider@bskmt.com",
        name: "Rider Test",
        resetUrl: "https://bskmt.com/reset",
      });

      expect(ok).toBe(true);
      expect(mockClient.email.send).toHaveBeenCalledTimes(1);
      const callArgs = mockClient.email.send.mock.calls[0][0];
      expect(callArgs.category).toBe("transactional");
      expect(callArgs.html).toContain("RESTABLECER MI CONTRASEÑA");
      expect(callArgs.text).toBeDefined();
    });

    it("should send notification email via Bird with HTML and text rendered by React Email", async () => {
      const ok = await emailService.sendNotificationEmail({
        to: "rider@bskmt.com",
        title: "Alerta de Ruta",
        message: "La rodada comenzará a las 7:00 AM.",
      });

      expect(ok).toBe(true);
      expect(mockClient.email.send).toHaveBeenCalledTimes(1);
      const callArgs = mockClient.email.send.mock.calls[0][0];
      expect(callArgs.category).toBe("transactional");
      expect(callArgs.subject).toBe("Alerta de Ruta");
      expect(callArgs.html).toContain("Alerta de Ruta");
      expect(callArgs.text).toBeDefined();
    });

    it("should send contact message to team email with React Email layout", async () => {
      const result = await emailService.sendContactMessages({
        name: "Soporte",
        email: "soporte@example.com",
        subject: "Duda técnica",
        message: "Mensaje de prueba",
      });

      expect(result.delivered).toBe(true);
      expect(mockClient.email.send).toHaveBeenCalledTimes(1);
      const callArgs = mockClient.email.send.mock.calls[0][0];
      expect(callArgs.subject).toBe("[Contacto web] Duda técnica");
      expect(callArgs.html).toContain("Formulario de Contacto Web");
      expect(callArgs.text).toBeDefined();
    });
  });
});
