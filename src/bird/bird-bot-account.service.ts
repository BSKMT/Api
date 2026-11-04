import { Injectable, Logger } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";
import { User, type UserDocument } from "../users/schemas/user.schema";
import {
  GarageMotorcycle,
  type GarageMotorcycleDocument,
} from "../garage/schemas/garage-motorcycle.schema";
import { BirdWhatsappService } from "./bird-whatsapp.service";
import { maskEmail, maskPhone } from "../common/utils/log-redact.util";

const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
const DOCUMENT_PREFIX_REGEX =
  /^(cc|c\.c\.|ti|ce|pas|doc|documento|c[eé]dula)?\s*[\d.\s]{6,15}$/i;

const INQUIRY_PATTERNS = [
  /^(consultar|gestionar|ver)?\s*(mi\s*)?cuenta$/i,
  /^gesti[oó]n\s*de\s*(mi\s*)?cuenta$/i,
  /^(mi\s*)?membres[ií]a$/i,
  /^estado\s*de\s*cuenta$/i,
  /^consultar$/i,
];

const ARPHA_COVERED_LEVELS = new Set([
  "Legend",
  "Master",
  "Expert",
  "Friend",
  "Rider",
]);

interface MembershipStatusInfo {
  estado: string;
  fechaVence: string;
  isExpired: boolean;
  hasArphaCoverage: boolean;
}

/**
 * BirdBotAccountService — Asistente de Autogestión de Cuentas vía WhatsApp.
 *
 * Implementa consultas de SOLO LECTURA a la infraestructura de BSKMT (MongoDB)
 * para usuarios que consultan por WhatsApp mediante su Cédula, Correo o Teléfono.
 *
 * Seguridad (NIST CSF 2.0 PR.DS-01, OWASP A01:2025):
 *  - Estrictamente de solo lectura (.lean(), sin mutaciones de estado).
 *  - Enmascaramiento de PII en respuestas y logs.
 *  - Sanitización de entradas para prevenir inyecciones.
 */
@Injectable()
export class BirdBotAccountService {
  private readonly logger = new Logger(BirdBotAccountService.name);

  constructor(
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    @InjectModel(GarageMotorcycle.name)
    private readonly motorcycleModel: Model<GarageMotorcycleDocument>,
    private readonly whatsappService: BirdWhatsappService,
  ) {}

  /**
   * Determina si el texto entrante corresponde a una consulta de cuenta:
   *  1. Número de documento (6 a 12 dígitos).
   *  2. Correo electrónico válido.
   *  3. Comandos clave de consulta de membresía/cuenta.
   */
  isAccountInquiry(text: string): boolean {
    if (!text || typeof text !== "string") return false;
    const trimmed = text.trim();

    if (trimmed.includes("@") && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      return true;
    }

    const cleanDigits = trimmed.replace(/\D/g, "");
    if (
      cleanDigits.length >= 6 &&
      cleanDigits.length <= 12 &&
      DOCUMENT_PREFIX_REGEX.test(trimmed)
    ) {
      return true;
    }

    return this.isGeneralInquiryCommand(trimmed);
  }

  /**
   * Comprueba si el texto es un comando de consulta general que requiere
   * solicitar al usuario su cédula o correo electrónico.
   */
  isGeneralInquiryCommand(text: string): boolean {
    if (!text || typeof text !== "string") return false;
    const trimmed = text.trim();
    return INQUIRY_PATTERNS.some((pattern) => pattern.test(trimmed));
  }

  /**
   * Procesa la consulta de cuenta buscando en MongoDB y enviando la respuesta oficial
   * por WhatsApp al usuario en tiempo real.
   */
  async handleAccountInquiry(params: {
    from: string;
    text: string;
    senderPhone?: string | null;
  }): Promise<boolean> {
    const { from, text, senderPhone } = params;
    const trimmed = (text ?? "").trim();

    this.logger.log(
      `Procesando consulta de cuenta para remitente=${maskPhone(from)} con texto="${trimmed.slice(0, 30)}"`,
    );

    const { user, isSpecificIdentifier } = await this.findUserByIdentifier(
      trimmed,
      senderPhone,
    );

    // Caso A: Usuario encontrado -> Formatear reporte consolidado de solo lectura
    if (user) {
      const responseMessage = await this.buildAccountReport(user);
      await this.whatsappService.sendDirectWhatsapp({
        to: from,
        text: responseMessage,
      });
      return true;
    }

    // Caso B: Si el mensaje era explícitamente un documento o correo pero no se encontró
    if (isSpecificIdentifier) {
      const notFoundMessage = [
        "⚠️ *Cuenta no encontrada en BSKMT*",
        "",
        `No encontramos ninguna cuenta registrada con el dato ingresado (*${trimmed}*).`,
        "",
        "Por favor verifica que esté bien escrito (sin puntos, espacios ni comas).",
        "",
        "Si aún no eres parte de BSK Motorcycle Team, puedes registrarte en nuestra plataforma oficial:",
        "👉 https://bskmt.com/registro",
        "",
        "O si requieres ayuda directa de un asesor, responde con la palabra *Asesor*.",
      ].join("\n");

      await this.whatsappService.sendDirectWhatsapp({
        to: from,
        text: notFoundMessage,
      });
      return true;
    }

    // Caso C: El usuario solicitó gestión/consulta general ("mi cuenta", "gestionar mi cuenta")
    // pero no envió documento o correo en este mensaje.
    if (this.isGeneralInquiryCommand(trimmed)) {
      const promptMessage = [
        "📋 *Gestión y Consulta de Cuenta BSKMT*",
        "",
        "Para consultar el estado de tu cuenta, membresía y vehículos registrados, por favor *responde con tu Número de Cédula o tu Correo Electrónico* registrado en BSKMT.",
        "",
        "Ejemplo: *1020304050* o *usuario@correo.com*",
        "",
        "🔒 *Seguridad:* Esta consulta es de solo lectura y tus datos están protegidos.",
        "Para realizar pagos, renovaciones o trámites avanzados:",
        "👉 https://bskmt.com/login",
      ].join("\n");

      await this.whatsappService.sendDirectWhatsapp({
        to: from,
        text: promptMessage,
      });
      return true;
    }

    return false;
  }

  private async findUserByIdentifier(
    trimmed: string,
    senderPhone?: string | null,
  ): Promise<{ user: UserDocument | null; isSpecificIdentifier: boolean }> {
    let user: UserDocument | null = null;

    // 1. Búsqueda por correo electrónico
    const emailMatch = EMAIL_REGEX.exec(trimmed);
    if (emailMatch) {
      const email = emailMatch[0].toLowerCase();
      user = await this.userModel.findOne({ email }).lean();
      if (user) {
        this.logger.debug(
          `Usuario encontrado por email: ${maskEmail(email)} (id=${String(user._id)})`,
        );
      }
    }

    // 2. Búsqueda por documento de identidad
    const cleanDigits = trimmed.replace(/\D/g, "");
    const isDocLength = cleanDigits.length >= 6 && cleanDigits.length <= 12;
    if (!user && isDocLength) {
      user = await this.userModel
        .findOne({
          $or: [
            { "profile.datos-personales.numeroDocumento": cleanDigits },
            { "profile.datos-personales.numeroDocumento": trimmed },
            { "contractorInfo.identificationNumber": cleanDigits },
            { internalCode: cleanDigits },
          ],
        })
        .lean();

      if (user) {
        this.logger.debug(
          `Usuario encontrado por documento: ${cleanDigits.slice(0, 4)}*** (id=${String(user._id)})`,
        );
      }
    }

    // 3. Búsqueda por número de teléfono
    if (!user && senderPhone) {
      const cleanPhone = senderPhone.replace(/\D/g, "");
      const last10 = cleanPhone.slice(-10);
      user = await this.userModel
        .findOne({
          $or: [
            { phone: senderPhone },
            { phone: last10 },
            { "profile.contacto.celular": senderPhone },
            { "profile.contacto.celular": last10 },
          ],
        })
        .lean();

      if (user) {
        this.logger.debug(
          `Usuario identificado por teléfono remitente: ${maskPhone(senderPhone)} (id=${String(user._id)})`,
        );
      }
    }

    const isSpecificIdentifier = Boolean(emailMatch) || isDocLength;
    return { user, isSpecificIdentifier };
  }

  private getMembershipStatus(
    user: UserDocument,
    now: Date,
  ): MembershipStatusInfo {
    const isExpired =
      Boolean(user.membershipExpired) ||
      (user.membershipExpiryDate
        ? new Date(user.membershipExpiryDate) < now
        : false);

    const estado = isExpired ? "Vencida ⚠️" : "Activa ✅";

    const fechaVence = user.membershipExpiryDate
      ? new Date(user.membershipExpiryDate).toLocaleDateString("es-CO", {
          year: "numeric",
          month: "short",
          day: "numeric",
        })
      : "Vigencia continua";

    const hasArphaCoverage =
      !isExpired && ARPHA_COVERED_LEVELS.has(user.membershipLevel || "");

    return { estado, fechaVence, isExpired, hasArphaCoverage };
  }

  private async buildGarageSection(userId: string, now: Date): Promise<string> {
    try {
      const bikes = await this.motorcycleModel.find({ userId }).lean();

      if (bikes.length === 0) {
        return "• No tienes motocicletas registradas en tu Garage.";
      }

      return bikes
        .map((b) => {
          let soatState = "SOAT: No registrado";
          if (b.soatExpiryDate) {
            soatState =
              new Date(b.soatExpiryDate) > now
                ? "SOAT: Vigente ✅"
                : "SOAT: Vencido ⚠️";
          }
          return `• ${b.brand} ${b.modelLine} [${b.plate}] | ${soatState}`;
        })
        .join("\n");
    } catch (err: unknown) {
      this.logger.warn(
        `No fue posible consultar garage para usuario ${userId}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return "• No tienes motocicletas registradas en tu Garage.";
    }
  }

  /**
   * Construye el mensaje de resumen de cuenta en solo lectura para el usuario.
   */
  private async buildAccountReport(user: UserDocument): Promise<string> {
    const profile = user.profile ?? {};
    const personal = profile["datos-personales"] ?? {};
    const membresiaEcosistema = profile["membresia-ecosistema"] ?? {};

    // 1. Nombre completo
    const primerNombre =
      typeof personal.primerNombre === "string"
        ? personal.primerNombre.trim()
        : "";
    const primerApellido =
      typeof personal.primerApellido === "string"
        ? personal.primerApellido.trim()
        : "";
    const nombreTitular =
      primerNombre || primerApellido
        ? `${primerNombre} ${primerApellido}`.trim()
        : user.username || "Rider BSKMT";

    // 2. Documento de identidad enmascarado (NIST Privacy)
    const rawDoc =
      typeof personal.numeroDocumento === "string"
        ? personal.numeroDocumento.trim()
        : "";
    const maskedDoc =
      rawDoc.length > 5
        ? `${rawDoc.slice(0, 3)}****${rawDoc.slice(-2)}`
        : rawDoc || "No registrado";

    // 3. Número oficial de miembro
    const rawNumeroMiembro =
      typeof membresiaEcosistema.numeroMiembro === "string"
        ? membresiaEcosistema.numeroMiembro.trim()
        : "";
    const numeroMiembroText = rawNumeroMiembro
      ? `#${rawNumeroMiembro}`
      : "Asignación pendiente";

    // 4. Membresía y estado
    const nivel = user.membershipLevel || "Rider (Básica)";
    const now = new Date();
    const { estado, fechaVence, hasArphaCoverage } = this.getMembershipStatus(
      user,
      now,
    );

    // 5. Estado de verificación KYC
    const kycText = user.identityVerified
      ? "Identidad Verificada ✅"
      : "Pendiente de Validación Oficial ⏳";

    // 6. Consulta de motocicletas registradas en el Garage
    const garageSection = await this.buildGarageSection(String(user._id), now);

    // 7. Cobertura de Asistencia ARPHA
    const arphaText = hasArphaCoverage
      ? "• Cobertura activa 100% en ruta para auxilio mecánico y grúa."
      : "• Tarifa preferencial de miembros para asistencias viales.";

    return [
      "🏍️ *ESTADO DE TU CUENTA BSKMT* 🏍️",
      "",
      `👤 *Titular:* ${nombreTitular}`,
      `🆔 *Documento:* ${maskedDoc}`,
      `🏷️ *Membresía:* ${nivel}`,
      `📅 *Estado:* ${estado} (Vence: ${fechaVence})`,
      `🔢 *Número de Miembro:* ${numeroMiembroText}`,
      `🛡️ *Ecosistema BSK:* ${kycText}`,
      "",
      "🏍️ *Garage BSKMT (Vehículos):*",
      garageSection,
      "",
      "🚨 *Asistencia Vial ARPHA:*",
      arphaText,
      "",
      "🔒 *Seguridad:* En WhatsApp únicamente se permiten consultas de lectura.",
      "Para renovaciones, pagos, registrar motos o trámites:",
      "👉 https://bskmt.com/login",
    ].join("\n");
  }
}
