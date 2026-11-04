import { Injectable, Logger } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";
import { User, type UserDocument } from "../users/schemas/user.schema";
import {
  GarageMotorcycle,
  type GarageMotorcycleDocument,
} from "../garage/schemas/garage-motorcycle.schema";
import {
  Event as BskEvent,
  EventStatus,
  type EventDocument,
} from "../events/schemas/event.schema";
import { Course, type CourseDocument } from "../events/schemas/course.schema";
import { Product, type ProductDocument } from "../shop/schemas/product.schema";
import {
  ArphaRequest,
  type ArphaRequestDocument,
} from "../arpha/schemas/arpha-request.schema";
import { BirdWhatsappService } from "./bird-whatsapp.service";
import { maskEmail, maskPhone } from "../common/utils/log-redact.util";

const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
const DOCUMENT_PREFIX_REGEX =
  /^(cc|c\.c\.|ti|ce|pas|doc|documento|c[eé]dula)?\s*[\d.\s]{6,15}$/i;

const ARPHA_COVERED_LEVELS = new Set([
  "Legend",
  "Master",
  "Expert",
  "Friend",
  "Rider",
]);

export enum BotMenuState {
  MAIN = "MAIN",
  CUENTA = "CUENTA",
  RUTAS = "RUTAS",
  ARPHA = "ARPHA",
  BENEFICIOS = "BENEFICIOS",
}

interface UserConversationSession {
  user?: UserDocument | null;
  state: BotMenuState;
  lastActivity: number;
}

/**
 * BirdBotAccountService — Asistente de Autogestión por Niveles y Menús Jerárquicos BSKMT.
 *
 * Implementa una navegación conversacional progresiva de múltiples pasos (Turn-by-Turn):
 *  - Nivel 0: Menú Principal con 4 grandes áreas + Soporte humano.
 *  - Nivel 1: Submenús temáticos (Cuenta, Rutas, ARPHA, Beneficios).
 *  - Nivel 2: Respuestas detalladas con opciones de volver al menú anterior (0),
 *             menú principal (00) o finalizar chat (salir).
 *  - Sesión en memoria persistente durante 30 minutos.
 */
@Injectable()
export class BirdBotAccountService {
  private readonly logger = new Logger(BirdBotAccountService.name);
  private readonly sessionCache = new Map<string, UserConversationSession>();
  private readonly SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutos

  constructor(
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    @InjectModel(GarageMotorcycle.name)
    private readonly motorcycleModel: Model<GarageMotorcycleDocument>,
    @InjectModel(BskEvent.name)
    private readonly eventModel: Model<EventDocument>,
    @InjectModel(Course.name)
    private readonly courseModel: Model<CourseDocument>,
    @InjectModel(Product.name)
    private readonly productModel: Model<ProductDocument>,
    @InjectModel(ArphaRequest.name)
    private readonly arphaModel: Model<ArphaRequestDocument>,
    private readonly whatsappService: BirdWhatsappService,
  ) {}

  /**
   * Determina si el texto entrante corresponde a una consulta o interacción válida del Bot.
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

    // Opciones numéricas de menú: 0, 00, 1 al 9, o subniveles como 1.1, 2.1, etc.
    if (/^(0|00|[0-9]|[1-5]\.[1-5])$/.test(trimmed)) {
      return true;
    }

    return this.isKeywordCommand(trimmed);
  }

  private isKeywordCommand(trimmed: string): boolean {
    const patterns = [
      /^(menu|inicio|hola|buenas|opciones|volver|ayuda)$/i,
      /^(salir|chao|adios|finalizar|cerrar|cancelar)$/i,
      /^(garage|motos?|soat|placas?|tecnomecanica|rtm)$/i,
      /^(pagos?|cuotas?|membres[ií]a|plan|vencimiento|carnet)$/i,
      /^(arpha|asistencia|emergencia|gr[uú]a|varado|auxilio)$/i,
      /^(rutas?|rodadas?|eventos?|salidas?|convoy)$/i,
      /^(academia|cursos?|aprender|clases?|talleres?)$/i,
      /^(alianzas?|convenios?|descuentos?|beneficios?)$/i,
      /^(tienda|merch|productos?|chaquetas?|gorras?|comprar)$/i,
      /^(asesor|humano|soporte|agente)$/i,
      /^(conocer|nosotros|quienes\s*somos|club)$/i,
      /^(gestionar\s*(mi\s*)?cuenta|mi\s*cuenta|cuenta)$/i,
    ];
    return patterns.some((p) => p.test(trimmed));
  }

  /**
   * Manejador central de mensajes: coordina la máquina de estados conversacional.
   */
  async handleAccountInquiry(params: {
    from: string;
    text: string;
    senderPhone?: string | null;
  }): Promise<boolean> {
    const { from, text, senderPhone } = params;
    const trimmed = (text ?? "").trim();

    this.logger.log(
      `Procesando interacción bot para remitente=${maskPhone(from)} con texto="${trimmed.slice(0, 30)}"`,
    );

    const session = this.getOrCreateSession(from);

    // 1. Comando de salida / despedida
    if (/^(salir|chao|adios|finalizar|cerrar|cancelar)$/i.test(trimmed)) {
      this.sessionCache.delete(from);
      const msg = this.buildFarewellMessage();
      await this.whatsappService.sendDirectWhatsapp({ to: from, text: msg });
      return true;
    }

    // 2. Comprobación de Cédula o Correo para identificación
    const { foundUser, isSpecificIdentifier } = await this.findUserByIdentifier(
      trimmed,
      senderPhone,
    );

    if (foundUser) {
      session.user = foundUser;
      this.sessionCache.set(from, session);
    }

    if (isSpecificIdentifier && !session.user) {
      return this.sendNotFoundResponse(from, trimmed);
    }

    if (isSpecificIdentifier && session.user) {
      session.state = BotMenuState.CUENTA;
      const report = this.buildAccountReport(session.user);
      await this.whatsappService.sendDirectWhatsapp({ to: from, text: report });
      return true;
    }

    // 3. Comandos de volver o menú principal
    if (/^(00|menu|inicio|hola|buenas|opciones)$/i.test(trimmed)) {
      session.state = BotMenuState.MAIN;
      const msg = this.buildMainMenu(
        session.user ? this.getNombreTitular(session.user) : undefined,
      );
      await this.whatsappService.sendDirectWhatsapp({ to: from, text: msg });
      return true;
    }

    if (trimmed === "0") {
      return this.handleBackNavigation(from, session);
    }

    // 4. Salto directo por palabras clave globales (Garage, ARPHA, etc.)
    const handledByKeyword = await this.handleGlobalKeywords(
      from,
      trimmed,
      session,
    );
    if (handledByKeyword) {
      return true;
    }

    // 5. Despacho según el estado actual de la conversación
    return this.dispatchStateAction(from, trimmed, session);
  }

  private getOrCreateSession(from: string): UserConversationSession {
    const existing = this.sessionCache.get(from);
    const now = Date.now();
    if (existing && now - existing.lastActivity <= this.SESSION_TTL_MS) {
      existing.lastActivity = now;
      return existing;
    }
    const fresh: UserConversationSession = {
      state: BotMenuState.MAIN,
      lastActivity: now,
    };
    this.sessionCache.set(from, fresh);
    return fresh;
  }

  private async handleBackNavigation(
    from: string,
    session: UserConversationSession,
  ): Promise<boolean> {
    // Si estaba en un submenú, regresa al menú principal
    session.state = BotMenuState.MAIN;
    const msg = this.buildMainMenu(
      session.user ? this.getNombreTitular(session.user) : undefined,
    );
    await this.whatsappService.sendDirectWhatsapp({ to: from, text: msg });
    return true;
  }

  private async handleGlobalKeywords(
    from: string,
    trimmed: string,
    session: UserConversationSession,
  ): Promise<boolean> {
    if (/^(garage|motos?|soat|placas?)$/i.test(trimmed)) {
      session.state = BotMenuState.CUENTA;
      const msg = await this.buildGarageDetails(session.user ?? null);
      await this.whatsappService.sendDirectWhatsapp({ to: from, text: msg });
      return true;
    }

    if (/^(arpha|asistencia|emergencia|gr[uú]a)$/i.test(trimmed)) {
      session.state = BotMenuState.ARPHA;
      const msg = this.buildMenuArpha(session.user ?? null);
      await this.whatsappService.sendDirectWhatsapp({ to: from, text: msg });
      return true;
    }

    if (/^(rutas?|rodadas?|eventos?)$/i.test(trimmed)) {
      session.state = BotMenuState.RUTAS;
      const msg = await this.buildRutasEventosDetails();
      await this.whatsappService.sendDirectWhatsapp({ to: from, text: msg });
      return true;
    }

    if (/^(academia|cursos?)$/i.test(trimmed)) {
      session.state = BotMenuState.RUTAS;
      const msg = await this.buildAcademiaDetails();
      await this.whatsappService.sendDirectWhatsapp({ to: from, text: msg });
      return true;
    }

    if (/^(tienda|merch|comprar)$/i.test(trimmed)) {
      session.state = BotMenuState.BENEFICIOS;
      const msg = await this.buildTiendaDetails();
      await this.whatsappService.sendDirectWhatsapp({ to: from, text: msg });
      return true;
    }

    if (/^(asesor|humano|soporte|agente)$/i.test(trimmed)) {
      const msg = this.buildAsesorHandoff();
      await this.whatsappService.sendDirectWhatsapp({ to: from, text: msg });
      return true;
    }

    return false;
  }

  private async dispatchStateAction(
    from: string,
    trimmed: string,
    session: UserConversationSession,
  ): Promise<boolean> {
    switch (session.state) {
      case BotMenuState.MAIN:
        return this.handleMainMenuState(from, trimmed, session);
      case BotMenuState.CUENTA:
        return this.handleCuentaMenuState(from, trimmed, session);
      case BotMenuState.RUTAS:
        return this.handleRutasMenuState(from, trimmed, session);
      case BotMenuState.ARPHA:
        return this.handleArphaMenuState(from, trimmed, session);
      case BotMenuState.BENEFICIOS:
        return this.handleBeneficiosMenuState(from, trimmed, session);
      default:
        session.state = BotMenuState.MAIN;
        return this.handleMainMenuState(from, trimmed, session);
    }
  }

  /**
   * Navegación Nivel 0 -> Menú Principal (Opciones 1 al 5)
   */
  private async handleMainMenuState(
    from: string,
    trimmed: string,
    session: UserConversationSession,
  ): Promise<boolean> {
    if (trimmed === "1" || /^(cuenta|gestionar)/i.test(trimmed)) {
      session.state = BotMenuState.CUENTA;
      const msg = this.buildMenuCuenta(session.user ?? null);
      await this.whatsappService.sendDirectWhatsapp({ to: from, text: msg });
      return true;
    }

    if (trimmed === "2" || /^(rutas|eventos|academia)/i.test(trimmed)) {
      session.state = BotMenuState.RUTAS;
      const msg = this.buildMenuRutas();
      await this.whatsappService.sendDirectWhatsapp({ to: from, text: msg });
      return true;
    }

    if (trimmed === "3" || /^(arpha|asistencia)/i.test(trimmed)) {
      session.state = BotMenuState.ARPHA;
      const msg = this.buildMenuArpha(session.user ?? null);
      await this.whatsappService.sendDirectWhatsapp({ to: from, text: msg });
      return true;
    }

    if (trimmed === "4" || /^(beneficios|tienda|alianzas)/i.test(trimmed)) {
      session.state = BotMenuState.BENEFICIOS;
      const msg = this.buildMenuBeneficios();
      await this.whatsappService.sendDirectWhatsapp({ to: from, text: msg });
      return true;
    }

    if (trimmed === "5" || /^(asesor|soporte)/i.test(trimmed)) {
      const msg = this.buildAsesorHandoff();
      await this.whatsappService.sendDirectWhatsapp({ to: from, text: msg });
      return true;
    }

    // Por defecto, mostrar el Menú Principal
    const msg = this.buildMainMenu(
      session.user ? this.getNombreTitular(session.user) : undefined,
    );
    await this.whatsappService.sendDirectWhatsapp({ to: from, text: msg });
    return true;
  }

  /**
   * Navegación Nivel 1 -> Área 1: Cuenta y Garage
   */
  private async handleCuentaMenuState(
    from: string,
    trimmed: string,
    session: UserConversationSession,
  ): Promise<boolean> {
    if (
      trimmed === "1" ||
      trimmed === "1.1" ||
      /^(garage|motos?|soat)/i.test(trimmed)
    ) {
      const msg = await this.buildGarageDetails(session.user ?? null);
      await this.whatsappService.sendDirectWhatsapp({ to: from, text: msg });
      return true;
    }

    if (
      trimmed === "2" ||
      trimmed === "1.2" ||
      /^(pagos?|cuotas?|membresia)/i.test(trimmed)
    ) {
      const msg = this.buildMembershipAndPaymentsDetails(session.user ?? null);
      await this.whatsappService.sendDirectWhatsapp({ to: from, text: msg });
      return true;
    }

    if (
      trimmed === "3" ||
      trimmed === "1.3" ||
      /^(carnet|digital)/i.test(trimmed)
    ) {
      const msg = this.buildCarnetDetails(session.user ?? null);
      await this.whatsappService.sendDirectWhatsapp({ to: from, text: msg });
      return true;
    }

    if (trimmed === "4" || trimmed === "1.4") {
      session.user = null;
      const msg = [
        "🔄 *CONSULTAR OTRA CUENTA BSKMT*",
        "",
        "Por favor escribe el *Número de Cédula* o *Correo Electrónico* que deseas consultar:",
        "",
        "0️⃣ ↩️ _Escribe *0* para volver al menú de Cuenta._",
      ].join("\n");
      await this.whatsappService.sendDirectWhatsapp({ to: from, text: msg });
      return true;
    }

    // Mensaje de submenú si no coincide
    const msg = this.buildMenuCuenta(session.user ?? null);
    await this.whatsappService.sendDirectWhatsapp({ to: from, text: msg });
    return true;
  }

  /**
   * Navegación Nivel 1 -> Área 2: Rutas, Rodadas y Academia
   */
  private async handleRutasMenuState(
    from: string,
    trimmed: string,
    _session: UserConversationSession,
  ): Promise<boolean> {
    if (
      trimmed === "1" ||
      trimmed === "2.1" ||
      /^(rodadas?|salidas?)/i.test(trimmed)
    ) {
      const msg = await this.buildRutasEventosDetails();
      await this.whatsappService.sendDirectWhatsapp({ to: from, text: msg });
      return true;
    }

    if (
      trimmed === "2" ||
      trimmed === "2.2" ||
      /^(cursos?|academia)/i.test(trimmed)
    ) {
      const msg = await this.buildAcademiaDetails();
      await this.whatsappService.sendDirectWhatsapp({ to: from, text: msg });
      return true;
    }

    if (
      trimmed === "3" ||
      trimmed === "2.3" ||
      /^(convoy|reglas)/i.test(trimmed)
    ) {
      const msg = this.buildConvoyRules();
      await this.whatsappService.sendDirectWhatsapp({ to: from, text: msg });
      return true;
    }

    if (
      trimmed === "4" ||
      trimmed === "2.4" ||
      /^(inscribir|registro)/i.test(trimmed)
    ) {
      const msg = this.buildEventEnrollGuidance();
      await this.whatsappService.sendDirectWhatsapp({ to: from, text: msg });
      return true;
    }

    const msg = this.buildMenuRutas();
    await this.whatsappService.sendDirectWhatsapp({ to: from, text: msg });
    return true;
  }

  /**
   * Navegación Nivel 1 -> Área 3: Asistencia ARPHA
   */
  private async handleArphaMenuState(
    from: string,
    trimmed: string,
    session: UserConversationSession,
  ): Promise<boolean> {
    if (
      trimmed === "1" ||
      trimmed === "3.1" ||
      /^(gr[uú]a|varada)/i.test(trimmed)
    ) {
      const msg = this.buildArphaTowTruckDetails(session.user ?? null);
      await this.whatsappService.sendDirectWhatsapp({ to: from, text: msg });
      return true;
    }

    if (
      trimmed === "2" ||
      trimmed === "3.2" ||
      /^(mecanico|bateria|gasolina)/i.test(trimmed)
    ) {
      const msg = this.buildArphaMechanicalDetails();
      await this.whatsappService.sendDirectWhatsapp({ to: from, text: msg });
      return true;
    }

    if (
      trimmed === "3" ||
      trimmed === "3.3" ||
      /^(juridica|legal)/i.test(trimmed)
    ) {
      const msg = this.buildArphaLegalDetails();
      await this.whatsappService.sendDirectWhatsapp({ to: from, text: msg });
      return true;
    }

    if (trimmed === "4" || trimmed === "3.4" || /^(cobertura)/i.test(trimmed)) {
      const msg = this.buildArphaCoverageCheck(session.user ?? null);
      await this.whatsappService.sendDirectWhatsapp({ to: from, text: msg });
      return true;
    }

    if (
      trimmed === "5" ||
      trimmed === "3.5" ||
      /^(linea|llamar)/i.test(trimmed)
    ) {
      const msg = this.buildArphaHotlineDetails();
      await this.whatsappService.sendDirectWhatsapp({ to: from, text: msg });
      return true;
    }

    const msg = this.buildMenuArpha(session.user ?? null);
    await this.whatsappService.sendDirectWhatsapp({ to: from, text: msg });
    return true;
  }

  /**
   * Navegación Nivel 1 -> Área 4: Beneficios y Tienda
   */
  private async handleBeneficiosMenuState(
    from: string,
    trimmed: string,
    _session: UserConversationSession,
  ): Promise<boolean> {
    if (
      trimmed === "1" ||
      trimmed === "4.1" ||
      /^(talleres?|repuestos?)/i.test(trimmed)
    ) {
      const msg = this.buildTalleresDetails();
      await this.whatsappService.sendDirectWhatsapp({ to: from, text: msg });
      return true;
    }

    if (
      trimmed === "2" ||
      trimmed === "4.2" ||
      /^(cascos?|indumentaria)/i.test(trimmed)
    ) {
      const msg = this.buildCascosDetails();
      await this.whatsappService.sendDirectWhatsapp({ to: from, text: msg });
      return true;
    }

    if (
      trimmed === "3" ||
      trimmed === "4.3" ||
      /^(tienda|merch|comprar)/i.test(trimmed)
    ) {
      const msg = await this.buildTiendaDetails();
      await this.whatsappService.sendDirectWhatsapp({ to: from, text: msg });
      return true;
    }

    if (
      trimmed === "4" ||
      trimmed === "4.4" ||
      /^(aliado|afiliar)/i.test(trimmed)
    ) {
      const msg = this.buildPartnerOnboardingDetails();
      await this.whatsappService.sendDirectWhatsapp({ to: from, text: msg });
      return true;
    }

    const msg = this.buildMenuBeneficios();
    await this.whatsappService.sendDirectWhatsapp({ to: from, text: msg });
    return true;
  }

  // ==========================================
  // CONSTRUCTORES DE MENÚS Y SUBMENÚS (NIVELES)
  // ==========================================

  buildMainMenu(userName?: string): string {
    const saludo = userName
      ? `¡Hola, *${userName}*! 👋 Bienvenido al Centro de Autogestión BSKMT.`
      : "¡Hola! 👋 Bienvenido al *Centro de Autogestión BSK Motorcycle Team* 🏍️🔥";

    return [
      saludo,
      "",
      "Selecciona una categoría escribiendo el número correspondiente (1 al 5):",
      "",
      "1️⃣ 👤 *Mi Cuenta y Garage* (Membresía, motos, SOAT y cuotas)",
      "2️⃣ 🏁 *Rutas, Rodadas y Academia* (Salidas oficiales y cursos)",
      "3️⃣ 🚨 *Asistencia Vial ARPHA* (Grúa, auxilio 24/7 y coberturas)",
      "4️⃣ 🏷️ *Beneficios y Tienda* (Convenios, descuentos y merch)",
      "5️⃣ 💬 *Hablar con un Asesor* (Atención personalizada)",
      "",
      "💡 *Tip:* Escribe tu *Cédula* o *Correo* para consultar tu cuenta de inmediato.",
      "❌ _Escribe *Salir* en cualquier momento para finalizar._",
    ].join("\n");
  }

  buildMenuCuenta(user: UserDocument | null): string {
    const estadoIdentificacion = user
      ? `👤 Identificado como: *${this.getNombreTitular(user)}*`
      : "ℹ️ _Para ver datos privados, envía tu Cédula o Correo._";

    return [
      "👤 *ÁREA 1: MI CUENTA Y GARAGE BSKMT*",
      estadoIdentificacion,
      "",
      "Selecciona la opción que deseas consultar:",
      "1️⃣ 🏍️ *Mis Motos y SOAT* (Vigencia, RTM y Pico y Placa)",
      "2️⃣ 💳 *Estado de Membresía y Cuotas* (Plan de pagos y saldo)",
      "3️⃣ 🆔 *Mi Carnet Digital y Número de Miembro*",
      "4️⃣ 🔄 *Consultar otra Cédula o Correo*",
      "",
      "0️⃣ ↩️ *Volver al Menú Principal*",
      "❌ Escribe *Salir* para finalizar.",
    ].join("\n");
  }

  buildMenuRutas(): string {
    return [
      "🏁 *ÁREA 2: RUTAS, RODADAS Y FORMACIÓN BSKMT*",
      "",
      "Selecciona una opción:",
      "1️⃣ 📅 *Próximas Rodadas Oficiales* (Fechas, horarios y rutas)",
      "2️⃣ 🎓 *Academia de Conducción* (Cursos y talleres prácticos)",
      "3️⃣ 🛡️ *Reglamento y Decálogo de Convoy*",
      "4️⃣ 🎟️ *Cómo Inscribirse a Eventos*",
      "",
      "0️⃣ ↩️ *Volver al Menú Principal*",
      "❌ Escribe *Salir* para finalizar.",
    ].join("\n");
  }

  buildMenuArpha(user: UserDocument | null): string {
    const nivel = user?.membershipLevel
      ? `(Tu nivel: *${user.membershipLevel}*)`
      : "";
    return [
      `🚨 *ÁREA 3: CENTRO DE ASISTENCIA VIAL ARPHA 24/7* ${nivel}`,
      "",
      "Selecciona el servicio que necesitas:",
      "1️⃣ 🚜 *Solicitar Grúa en Ruta* (Plataforma por varada/accidente)",
      "2️⃣ 🛞 *Auxilio Mecánico en Sitio* (Pinchazo, batería, gasolina)",
      "3️⃣ ⚖️ *Asistencia Legal y Tránsito*",
      "4️⃣ 📋 *Consultar mi Cobertura ARPHA*",
      "5️⃣ 📞 *Línea Telefónica de Emergencia Directa*",
      "",
      "0️⃣ ↩️ *Volver al Menú Principal*",
      "❌ Escribe *Salir* para finalizar.",
    ].join("\n");
  }

  buildMenuBeneficios(): string {
    return [
      "🏷️ *ÁREA 4: BENEFICIOS, CONVENIOS Y TIENDA OFICIAL*",
      "",
      "Selecciona una opción:",
      "1️⃣ 🔧 *Descuentos en Talleres y Repuestos* (15% a 20% OFF)",
      "2️⃣ 🪖 *Descuentos en Cascos e Indumentaria*",
      "3️⃣ 🛒 *Tienda Oficial BSK* (Chaquetas, hoodies y parches)",
      "4️⃣ 🤝 *Afiliar mi Empresa como Aliado Comercial*",
      "",
      "0️⃣ ↩️ *Volver al Menú Principal*",
      "❌ Escribe *Salir* para finalizar.",
    ].join("\n");
  }

  buildFarewellMessage(): string {
    return [
      "¡Buenas rutas, Rider! 🏍️💨",
      "",
      "Gracias por comunicarte con BSK Motorcycle Team.",
      "Cuando necesites consultar nuevamente, simplemente escribe *Hola*.",
      "¡Rueda seguro y en familia!",
    ].join("\n");
  }

  // ==========================================
  // CONSTRUCTORES DE DETALLES (NIVEL 2)
  // ==========================================

  async buildGarageDetails(user: UserDocument | null): Promise<string> {
    if (!user) {
      return [
        "🏍️ *DETALLE DE TU GARAGE BSKMT*",
        "",
        "Para ver tus motocicletas registradas, vigencia del SOAT y alertas de Pico y Placa:",
        "👉 *Escribe tu Número de Cédula o Correo Electrónico.*",
        "",
        "0️⃣ ↩️ _Escribe *0* para volver al menú de Cuenta._",
      ].join("\n");
    }

    const now = new Date();
    try {
      const bikes = await this.motorcycleModel
        .find({ userId: String(user._id) })
        .lean();

      if (bikes.length === 0) {
        return [
          "🏍️ *TU GARAGE BSKMT*",
          "",
          `Hola *${this.getNombreTitular(user)}*, no tienes motocicletas registradas en tu perfil.`,
          "",
          "¡Registra tu moto para activar alertas y auxilio vial ARPHA!",
          "👉 https://bskmt.com/login",
          "",
          "0️⃣ ↩️ _Escribe *0* para volver al menú anterior._",
        ].join("\n");
      }

      const bikesList = bikes
        .map((b, idx) => {
          let soatState = "SOAT: No registrado";
          if (b.soatExpiryDate) {
            const exp = new Date(b.soatExpiryDate);
            const diffDays = Math.ceil(
              (exp.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
            );
            soatState =
              diffDays > 0
                ? `SOAT: Vigente hasta ${exp.toLocaleDateString("es-CO")} (${diffDays} días rest.) ✅`
                : `SOAT: VENCIDO hace ${Math.abs(diffDays)} días ⚠️ (¡Alerta!)`;
          }

          let rtmState = "RTM: No registrada";
          if (b.rtmExpiryDate) {
            const expRtm = new Date(b.rtmExpiryDate);
            rtmState =
              expRtm > now
                ? `RTM: Vigente hasta ${expRtm.toLocaleDateString("es-CO")} ✅`
                : "RTM: Vencida ⚠️";
          }

          return [
            `*${idx + 1}. ${b.brand} ${b.modelLine} (${b.year})*`,
            `   • Placa: *${b.plate}* | Color: ${b.color || "Negro"}`,
            `   • ${soatState}`,
            `   • ${rtmState}`,
            `   • Pico y Placa: Bogotá sin restricción | Medellín por 1er dígito`,
          ].join("\n");
        })
        .join("\n\n");

      return [
        "🏍️ *ESTADO DE TU GARAGE BSKMT* 🏍️",
        "",
        `👤 *Titular:* ${this.getNombreTitular(user)}`,
        "",
        bikesList,
        "",
        "Para añadir otra moto o actualizar SOAT:",
        "👉 https://bskmt.com/login",
        "",
        "0️⃣ ↩️ _Escribe *0* para volver al menú de Cuenta._",
        "00️⃣ 🏠 _Escribe *00* para el Menú Principal._",
      ].join("\n");
    } catch (err: unknown) {
      this.logger.error(`Error en garage: ${String(err)}`);
      return "Error temporal al consultar el garage. Escribe 0 para volver.";
    }
  }

  buildMembershipAndPaymentsDetails(user: UserDocument | null): string {
    if (!user) {
      return [
        "💳 *PLANES Y MEMBRESÍAS BSKMT*",
        "",
        "Niveles de membresía:",
        "• 🟢 *Rider (Básica):* Entrada a eventos y comunidad.",
        "• 🔵 *Friend:* Descuentos en convenios y rodadas.",
        "• 🟣 *Expert:* Asistencia vial ARPHA y formación.",
        "• 🟡 *Master:* Grúa en ruta y eventos VIP.",
        "• 👑 *Legend:* Cobertura total 100%, auxilio ilimitado y kit oficial.",
        "",
        "👉 *Para consultar tus pagos:* Escribe tu *Cédula* o *Correo*.",
        "",
        "0️⃣ ↩️ _Escribe *0* para volver al menú de Cuenta._",
      ].join("\n");
    }

    const now = new Date();
    const { estado, fechaVence } = this.getMembershipStatus(user, now);
    const plan =
      user.membershipPaymentPlan === "installments"
        ? `Cuotas Mensuales (*${user.installmentsPaid ?? 0} de ${user.installmentsTotal ?? 12} pagadas*)`
        : "Pago Único Anual al día ✅";

    return [
      "💳 *ESTADO DE TU MEMBRESÍA Y PAGOS* 💳",
      "",
      `👤 *Titular:* ${this.getNombreTitular(user)}`,
      `🏷️ *Nivel:* ${user.membershipLevel || "Rider"}`,
      `📅 *Estado:* ${estado} (Vence: ${fechaVence})`,
      `📋 *Modalidad:* ${plan}`,
      `🛡️ *Identidad:* ${user.identityVerified ? "Verificada con Verifik ✅" : "Pendiente de validación ⏳"}`,
      "",
      "Para pagar tu cuota o renovar:",
      "👉 https://bskmt.com/login",
      "",
      "0️⃣ ↩️ _Escribe *0* para volver al menú de Cuenta._",
      "00️⃣ 🏠 _Escribe *00* para el Menú Principal._",
    ].join("\n");
  }

  buildCarnetDetails(user: UserDocument | null): string {
    if (!user) {
      return [
        "🆔 *CARNET DIGITAL BSKMT*",
        "",
        "Para visualizar tu número de miembro y carnet oficial:",
        "👉 *Escribe tu Número de Cédula o Correo Electrónico.*",
        "",
        "0️⃣ ↩️ _Escribe *0* para volver._",
      ].join("\n");
    }

    const rawNumMiembro = user.profile?.["membresia-ecosistema"]?.numeroMiembro;
    const numMiembro =
      typeof rawNumMiembro === "string" || typeof rawNumMiembro === "number"
        ? String(rawNumMiembro)
        : user.internalCode || "En trámite";

    return [
      "🆔 *TU CARNET DIGITAL BSKMT*",
      "",
      `👤 *Rider:* ${this.getNombreTitular(user)}`,
      `🔢 *Número de Miembro:* #${numMiembro}`,
      `🏷️ *Categoría:* ${user.membershipLevel || "Rider"}`,
      `🛡️ *Estado:* ${user.identityVerified ? "Miembro Oficial Verificado ✅" : "Activo"}`,
      "",
      "📲 *Descarga tu Carnet Digital en PDF o imagen:*",
      "👉 https://bskmt.com/login",
      "",
      "0️⃣ ↩️ _Escribe *0* para volver al menú de Cuenta._",
      "00️⃣ 🏠 _Escribe *00* para el Menú Principal._",
    ].join("\n");
  }

  async buildRutasEventosDetails(): Promise<string> {
    const now = new Date();
    try {
      const events = await this.eventModel
        .find({ status: EventStatus.PUBLISHED, date: { $gte: now } })
        .sort({ date: 1 })
        .limit(3)
        .lean();

      let eventosText = "";
      if (events.length > 0) {
        eventosText = events
          .map((ev, idx) => {
            const dateVal = ev.date as unknown as string | number | Date;
            const fechaStr = new Date(dateVal).toLocaleDateString("es-CO", {
              weekday: "short",
              year: "numeric",
              month: "short",
              day: "numeric",
            });
            return [
              `*${idx + 1}. ${ev.title}*`,
              `   📅 ${fechaStr} | Dificultad: ${ev.difficulty || "Media"}`,
              `   📍 ${ev.meetingPoint || "Punto oficial BSK"} (${ev.departureTime || "6:00 AM"})`,
              `   👉 Info: https://bskmt.com/eventos/${ev.slug}`,
            ].join("\n");
          })
          .join("\n\n");
      } else {
        eventosText = [
          "• *Sábados de Curvas:* Rutas de media y larga distancia.",
          "• *Jueves de Rodada Urbana:* Encuentro e integración ciudadana.",
          "Consulta el calendario completo: https://bskmt.com/eventos",
        ].join("\n");
      }

      return [
        "📅 *PRÓXIMAS RODADAS OFICIALES BSKMT*",
        "",
        eventosText,
        "",
        "0️⃣ ↩️ _Escribe *0* para volver al menú de Rutas._",
        "00️⃣ 🏠 _Escribe *00* para el Menú Principal._",
      ].join("\n");
    } catch (err: unknown) {
      this.logger.error(`Error en eventos: ${String(err)}`);
      return "Consulta rodadas en https://bskmt.com/eventos. Escribe 0 para volver.";
    }
  }

  async buildAcademiaDetails(): Promise<string> {
    try {
      const courses = await this.courseModel
        .find({ status: "published" })
        .sort({ createdAt: -1 })
        .limit(3)
        .lean();

      let coursesText = "";
      if (courses.length > 0) {
        coursesText = courses
          .map((c, idx) => {
            return `*${idx + 1}. ${c.title}* [${c.level.toUpperCase()}]\n   📝 ${c.subtitle}`;
          })
          .join("\n\n");
      } else {
        coursesText = [
          "• *Conducción Defensiva Urbana:* Frenado seguro y evasión.",
          "• *Trazado de Curvas y Postura:* Control de inclinación.",
          "• *Mecánica Preventiva de Ruta:* Desvare y soluciones rápidas.",
        ].join("\n");
      }

      return [
        "🎓 *CURSOS ACADEMIA BSKMT*",
        "",
        coursesText,
        "",
        "👉 Inscríbete en: https://bskmt.com/eventos",
        "",
        "0️⃣ ↩️ _Escribe *0* para volver al menú de Rutas._",
        "00️⃣ 🏠 _Escribe *00* para el Menú Principal._",
      ].join("\n");
    } catch (err: unknown) {
      this.logger.error(`Error en cursos: ${String(err)}`);
      return "Consulta cursos en https://bskmt.com/eventos. Escribe 0 para volver.";
    }
  }

  buildConvoyRules(): string {
    return [
      "🛡️ *DECALOGO Y REGLAS DE CONVOY BSKMT*",
      "",
      "1. *Formación en Zig-Zag:* Mantiene el espacio visual y la distancia segura de frenado.",
      "2. *Líder y Barredora:* Nadie sobrepasa al líder de ruta; la barredora asiste a los rezagados.",
      "3. *Equipo Completo:* Casco certificado, guantes, chaqueta con protecciones y calzado adecuado.",
      "4. *Luces Encendidas:* Visibilidad total en carretera.",
      "5. *Cero Alcohol y Sustancias:* Tolerancia cero en rodadas.",
      "",
      "0️⃣ ↩️ _Escribe *0* para volver al menú de Rutas._",
    ].join("\n");
  }

  buildEventEnrollGuidance(): string {
    return [
      "🎟️ *CÓMO INSCRIBIRSE A EVENTOS Y RODADAS*",
      "",
      "1. Ingresa a https://bskmt.com/eventos con tu cuenta.",
      "2. Selecciona la rodada o curso deseado.",
      "3. Haz clic en *Inscribirme* y confirma los datos de tu moto.",
      "4. Recibirás tu pase digital y las coordenadas de salida por WhatsApp y correo.",
      "",
      "0️⃣ ↩️ _Escribe *0* para volver al menú de Rutas._",
    ].join("\n");
  }

  buildArphaTowTruckDetails(user: UserDocument | null): string {
    const hasCoverage =
      user?.membershipLevel && ARPHA_COVERED_LEVELS.has(user.membershipLevel);
    const cobertura = hasCoverage
      ? "✅ *Tu membresía incluye servicio de grúa 100% cubierto.*"
      : "ℹ️ _Tarifa preferencial para miembros._";

    return [
      "🚜 *SOLICITUD DE GRÚA DE PLATAFORMA - ARPHA*",
      cobertura,
      "",
      "📍 *PASOS INMEDIATOS:*",
      "1️⃣ Envíanos tu *UBICACIÓN EN TIEMPO REAL* por este chat de WhatsApp.",
      "2️⃣ Escribe la placa de tu moto y describe si fue varada mecánica o siniestro.",
      "",
      "📞 O llama de inmediato a la línea de urgencias: *+57 316 958 8444*",
      "",
      "0️⃣ ↩️ _Escribe *0* para volver al menú ARPHA._",
    ].join("\n");
  }

  buildArphaMechanicalDetails(): string {
    return [
      "🛞 *AUXILIO MECÁNICO EN SITIO - ARPHA*",
      "",
      "Servicios de asistencia en sitio:",
      "• 🔋 Paso de corriente por batería descargada.",
      "• 🛞 Calibración o sellado de pinchazo en ruta.",
      "• ⛽ Suministro de combustible de emergencia.",
      "",
      "📍 *Para solicitar auxilio:* Envía tu ubicación actual por este chat y describe tu inconveniente.",
      "📞 Línea de atención: *+57 316 958 8444*",
      "",
      "0️⃣ ↩️ _Escribe *0* para volver al menú ARPHA._",
    ].join("\n");
  }

  buildArphaLegalDetails(): string {
    return [
      "⚖️ *ASISTENCIA JURÍDICA DE TRÁNSITO - ARPHA*",
      "",
      "Acompañamiento legal especializado para motociclistas:",
      "• Orientación legal telefónica inmediata ante accidentes de tránsito.",
      "• Asesoría en comparendos y procedimientos policiales.",
      "• Peritaje técnico preliminar.",
      "",
      "📞 Comunícate al *+57 316 958 8444* y marca la opción Asistencia Jurídica.",
      "",
      "0️⃣ ↩️ _Escribe *0* para volver al menú ARPHA._",
    ].join("\n");
  }

  buildArphaCoverageCheck(user: UserDocument | null): string {
    if (!user) {
      return [
        "📋 *CONSULTAR COBERTURA ARPHA*",
        "",
        "Para verificar si tu membresía tiene grúa y auxilio 100% activo:",
        "👉 *Escribe tu Número de Cédula o Correo Electrónico.*",
        "",
        "0️⃣ ↩️ _Escribe *0* para volver._",
      ].join("\n");
    }

    const nivel = user.membershipLevel || "Rider";
    const hasCoverage = ARPHA_COVERED_LEVELS.has(nivel);
    const estado = hasCoverage
      ? "✅ *ACTIVA AL 100%:* Cuentas con grúa y auxilio vial sin costo adicional en ruta."
      : "ℹ️ *TARIFA PREFERENCIAL:* Cuentas con descuento de miembro en todos los servicios de grúa.";

    return [
      "📋 *ESTADO DE TU COBERTURA ARPHA*",
      "",
      `👤 *Rider:* ${this.getNombreTitular(user)}`,
      `🏷️ *Nivel de Membresía:* ${nivel}`,
      estado,
      "",
      "📞 Línea de emergencias 24/7: *+57 316 958 8444*",
      "",
      "0️⃣ ↩️ _Escribe *0* para volver al menú ARPHA._",
      "00️⃣ 🏠 _Escribe *00* para el Menú Principal._",
    ].join("\n");
  }

  buildArphaHotlineDetails(): string {
    return [
      "📞 *LÍNEA DE EMERGENCIA VIAL ARPHA 24/7*",
      "",
      "Atención prioritaria inmediata en carretera:",
      "👉 *+57 316 958 8444*",
      "",
      "Disponible las 24 horas del día, los 365 días del año.",
      "",
      "0️⃣ ↩️ _Escribe *0* para volver al menú ARPHA._",
    ].join("\n");
  }

  buildTalleresDetails(): string {
    return [
      "🔧 *CONVENIOS EN TALLERES MECÁNICOS Y REPUESTOS*",
      "",
      "Beneficios para miembros BSKMT:",
      "• 15% a 20% de descuento en mano de obra y mantenimiento general.",
      "• Descuentos en repuestos originales y aceites sintéticos certificados.",
      "• Montallantas y balanceo computarizado preferencial.",
      "",
      "📲 *Cómo redimir:* Presenta tu carnet digital de miembro en los talleres aliados.",
      "Ver lista de talleres en tu ciudad: https://bskmt.com/alianzas",
      "",
      "0️⃣ ↩️ _Escribe *0* para volver al menú de Beneficios._",
    ].join("\n");
  }

  buildCascosDetails(): string {
    return [
      "🪖 *CONVENIOS EN CASCOS E INDUMENTARIA*",
      "",
      "Descuentos en tiendas oficiales:",
      "• Cascos certificados (ECE 22.06, DOT): HJC, Shaft, MT, Shoei.",
      "• Chaquetas con protecciones y reflectivos, guantes y botas de ruta.",
      "• Intercomunicadores y accesorios.",
      "",
      "👉 Conoce las marcas aliadas: https://bskmt.com/alianzas",
      "",
      "0️⃣ ↩️ _Escribe *0* para volver al menú de Beneficios._",
    ].join("\n");
  }

  async buildTiendaDetails(): Promise<string> {
    try {
      const products = await this.productModel
        .find({ status: "published" })
        .sort({ featured: -1, createdAt: -1 })
        .limit(3)
        .lean();

      let items = "";
      if (products.length > 0) {
        items = products
          .map((p, idx) => {
            const memberPrice = Math.round(
              p.publicPrice * (1 - (p.memberDiscountPercent || 20) / 100),
            );
            return `*${idx + 1}. ${p.name}*\n   Precio: $${p.publicPrice.toLocaleString("es-CO")} | *Miembros: $${memberPrice.toLocaleString("es-CO")}*`;
          })
          .join("\n\n");
      } else {
        items =
          "• Chaqueta Oficial BSKMT con protecciones\n• Hoodie BSKMT Lifestyle\n• Gorra Oficial Bordada";
      }

      return [
        "🛒 *TIENDA OFICIAL BSK MOTORCYCLE TEAM*",
        "",
        items,
        "",
        "📦 Envíos a todo el país con 20% de descuento para miembros.",
        "👉 Compra online: https://bskmt.com/tienda",
        "",
        "0️⃣ ↩️ _Escribe *0* para volver al menú de Beneficios._",
        "00️⃣ 🏠 _Escribe *00* para el Menú Principal._",
      ].join("\n");
    } catch (err: unknown) {
      this.logger.error(`Error en tienda: ${String(err)}`);
      return "Visita la tienda oficial en https://bskmt.com/tienda. Escribe 0 para volver.";
    }
  }

  buildPartnerOnboardingDetails(): string {
    return [
      "🤝 *AFILIAR MI NEGOCIO COMO ALIADO BSKMT*",
      "",
      "Si tienes un taller, almacén de accesorios, hotel o restaurante y deseas conectar con nuestra comunidad:",
      "📧 Escríbenos a: *alianzas@bskmt.com*",
      "🌐 Registra tu propuesta comercial en: https://bskmt.com/alianzas",
      "",
      "0️⃣ ↩️ _Escribe *0* para volver al menú de Beneficios._",
    ].join("\n");
  }

  buildAsesorHandoff(): string {
    return [
      "💬 *ATENCIÓN AL CLIENTE BSKMT*",
      "",
      "Hemos asignado tu caso a nuestro equipo de atención humana.",
      "Un asesor responderá por este chat en breve.",
      "",
      "🕒 *Horario de Atención:* Lunes a Sábado de 8:00 AM a 6:00 PM.",
      "🚨 *Emergencias Viales ARPHA:* +57 316 958 8444 (24/7).",
      "",
      "0️⃣ ↩️ _Escribe *0* para volver al menú principal._",
    ].join("\n");
  }

  private async sendNotFoundResponse(
    from: string,
    trimmed: string,
  ): Promise<boolean> {
    const notFoundMessage = [
      "⚠️ *Cuenta no encontrada en BSKMT*",
      "",
      `No encontramos ninguna cuenta con el dato (*${trimmed}*).`,
      "Verifica que esté bien escrito (sin puntos ni espacios).",
      "",
      "Si aún no eres parte de BSKMT, regístrate en:",
      "👉 https://bskmt.com/registro",
      "",
      "0️⃣ ↩️ _Escribe *0* para volver al Menú Principal._",
      "5️⃣ 💬 _Escribe *5* para hablar con un Asesor._",
    ].join("\n");

    await this.whatsappService.sendDirectWhatsapp({
      to: from,
      text: notFoundMessage,
    });
    return true;
  }

  private async findUserByIdentifier(
    trimmed: string,
    senderPhone?: string | null,
  ): Promise<{
    foundUser: UserDocument | null;
    isSpecificIdentifier: boolean;
  }> {
    let user: UserDocument | null = null;

    const emailMatch = EMAIL_REGEX.exec(trimmed);
    if (emailMatch) {
      const email = emailMatch[0].toLowerCase();
      user = await this.userModel.findOne({ email }).lean();
      if (user) {
        this.logger.debug(`Usuario por email: ${maskEmail(email)}`);
      }
    }

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
          `Usuario por documento: ${cleanDigits.slice(0, 4)}***`,
        );
      }
    }

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
        this.logger.debug(`Usuario por teléfono: ${maskPhone(senderPhone)}`);
      }
    }

    const isSpecificIdentifier = Boolean(emailMatch) || isDocLength;
    return { foundUser: user, isSpecificIdentifier };
  }

  private getNombreTitular(user: UserDocument): string {
    const personal = user.profile?.["datos-personales"] ?? {};
    const primerNombre =
      typeof personal.primerNombre === "string"
        ? personal.primerNombre.trim()
        : "";
    const primerApellido =
      typeof personal.primerApellido === "string"
        ? personal.primerApellido.trim()
        : "";
    return primerNombre || primerApellido
      ? `${primerNombre} ${primerApellido}`.trim()
      : user.username || "Rider BSKMT";
  }

  private getMembershipStatus(
    user: UserDocument,
    now: Date,
  ): {
    estado: string;
    fechaVence: string;
    isExpired: boolean;
    hasArphaCoverage: boolean;
  } {
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

  buildAccountReport(user: UserDocument): string {
    const personal = user.profile?.["datos-personales"] ?? {};
    const membresiaEcosistema = user.profile?.["membresia-ecosistema"] ?? {};

    const nombreTitular = this.getNombreTitular(user);

    const rawDoc =
      typeof personal.numeroDocumento === "string"
        ? personal.numeroDocumento.trim()
        : "";
    const maskedDoc =
      rawDoc.length > 5
        ? `${rawDoc.slice(0, 3)}****${rawDoc.slice(-2)}`
        : rawDoc || "No registrado";

    const rawNumeroMiembro =
      typeof membresiaEcosistema.numeroMiembro === "string"
        ? membresiaEcosistema.numeroMiembro.trim()
        : "";
    const numeroMiembroText = rawNumeroMiembro
      ? `#${rawNumeroMiembro}`
      : "Asignación pendiente";

    const nivel = user.membershipLevel || "Rider (Básica)";
    const now = new Date();
    const { estado, fechaVence } = this.getMembershipStatus(user, now);

    return [
      "👤 *RESUMEN DE TU CUENTA BSKMT*",
      "",
      `🏍️ *Titular:* ${nombreTitular}`,
      `🆔 *Documento:* ${maskedDoc}`,
      `🏷️ *Membresía:* ${nivel} | ${estado}`,
      `📅 *Vigencia:* ${fechaVence}`,
      `🔢 *Número de Miembro:* ${numeroMiembroText}`,
      `🛡️ *Identidad:* ${user.identityVerified ? "Verificada ✅" : "Pendiente de validación ⏳"}`,
      "",
      "━━━━━━━━━━━━━━━━━━",
      "📌 *¿QUÉ DESEAS CONSULTAR AHORA?*",
      "1️⃣ 🏍️ Ver detalle de mis Motos y SOAT",
      "2️⃣ 💳 Ver estado de mis pagos y cuotas",
      "3️⃣ 🆔 Ver mi Carnet Digital",
      "0️⃣ ↩️ Volver al Menú Principal",
      "❌ Escribe *Salir* para finalizar.",
    ].join("\n");
  }
}
