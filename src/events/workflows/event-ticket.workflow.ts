import { Logger } from "@nestjs/common";
import type { Model } from "mongoose";
import type { ConfigService } from "@nestjs/config";
import type { EventRegistrationDocument } from "../schemas/event-registration.schema";
import type { EventDocument } from "../schemas/event.schema";
import type { UserDocument } from "../../users/schemas/user.schema";
import type { BirdEmailService } from "../../bird/bird-email.service";
import { dispatchConfirmedEventTicketNotification } from "../events-ticket-notification.helper";
import { ensureRegistrationCheckInCode } from "../events-ticket-dispatch.helper";

export interface TicketWorkflowContext {
  registrationId: string;
  eventSlug: string;
  userId: string;
}

/**
 * EventTicketWorkflow - Orquestación de emisión y despacho de boletos de eventos.
 *
 * Diseñado con el patrón de pasos atómicos (Durable Steps):
 * 1. Generación determinista de código de Check-in y QR
 * 2. Carga de datos de evento y usuario
 * 3. Despacho de boleto vía Bird (Email / WhatsApp) con reintento ante fallos transitorios
 * 4. Actualización de estado en base de datos
 */
export class EventTicketWorkflow {
  private readonly logger = new Logger(EventTicketWorkflow.name);

  constructor(
    private readonly registrationModel: Model<EventRegistrationDocument>,
    private readonly eventModel: Model<EventDocument>,
    private readonly userModel: Model<UserDocument>,
    private readonly birdEmailService: BirdEmailService,
    private readonly configService: ConfigService,
  ) {}

  private async dispatchWithBackoff(
    registration: EventRegistrationDocument,
    event: EventDocument,
    panelUrl: string,
    currentAttempt: number,
    maxAttempts: number,
  ): Promise<boolean> {
    try {
      await dispatchConfirmedEventTicketNotification(
        registration,
        event,
        this.userModel,
        this.birdEmailService,
        panelUrl,
        this.logger,
      );
      return true;
    } catch (err) {
      this.logger.warn(
        `Intento ${currentAttempt}/${maxAttempts} falló despachando boleto para reg=${String(registration._id)}: ${err instanceof Error ? err.message : String(err)}`,
      );
      if (currentAttempt >= maxAttempts) {
        return false;
      }
      await new Promise((resolve) =>
        setTimeout(resolve, currentAttempt * 1000),
      );
      return this.dispatchWithBackoff(
        registration,
        event,
        panelUrl,
        currentAttempt + 1,
        maxAttempts,
      );
    }
  }

  async execute(
    ctx: TicketWorkflowContext,
  ): Promise<{ success: boolean; checkInCode?: string; error?: string }> {
    this.logger.log(
      `Iniciando workflow de boleto para registrationId=${ctx.registrationId}, slug=${ctx.eventSlug}`,
    );

    // Paso 1: Garantizar Check-In code y payload de QR
    const registration = await this.registrationModel.findById(
      ctx.registrationId,
    );
    if (!registration) {
      this.logger.error(`Registration ${ctx.registrationId} not found`);
      return { success: false, error: "Registration not found" };
    }

    const codeGenerated = ensureRegistrationCheckInCode(
      registration,
      ctx.eventSlug,
      ctx.userId,
    );
    if (codeGenerated) {
      await registration.save();
    }

    // Paso 2: Cargar evento
    const event = await this.eventModel.findOne({ slug: ctx.eventSlug });
    if (!event) {
      this.logger.error(`Event ${ctx.eventSlug} not found`);
      return { success: false, error: "Event not found" };
    }

    // Paso 3: Despacho de boleto con reintentos recursivos
    const panelUrl =
      this.configService.get<string>("PANEL_URL") ?? "https://panel.bskmt.com";
    const maxAttempts = 3;
    const dispatched = await this.dispatchWithBackoff(
      registration,
      event,
      panelUrl,
      1,
      maxAttempts,
    );

    return {
      success: dispatched,
      checkInCode: registration.checkInCode ?? undefined,
      error: dispatched
        ? undefined
        : "Max notification delivery attempts reached",
    };
  }
}
