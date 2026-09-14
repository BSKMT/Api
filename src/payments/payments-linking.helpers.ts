import { Logger } from "@nestjs/common";
import { TransactionDocument } from "./schemas/transaction.schema";
import { ShopService } from "../shop/shop.service";
import { ArphaService } from "../arpha/arpha.service";
import { EventsService } from "../events/events.service";
import { AlegraService } from "../alegra/alegra.service";
import type { AlegraBillingContext } from "../alegra/alegra.interfaces";

export interface PaymentsLinkingDeps {
  shopService: ShopService;
  arphaService: ArphaService;
  eventsService: EventsService;
  logger: Logger;
}

export interface AlegraInvoicingDeps {
  shopService: ShopService;
  alegraService: AlegraService;
  logger: Logger;
}

export async function linkPaymentByPurposeHelper(
  deps: PaymentsLinkingDeps,
  transaction: TransactionDocument,
): Promise<void> {
  try {
    if (transaction.purpose === "shop" && transaction.relatedReference) {
      await deps.shopService.linkOrderPayment(
        transaction.relatedReference,
        transaction.reference,
      );
      deps.logger.log(
        `Shop order payment linked: order=${transaction.relatedReference} ref=${transaction.reference}`,
      );
    } else if (transaction.purpose === "arpha") {
      await deps.arphaService.linkArphaPayment(
        transaction.userId,
        transaction.eventSlug,
        transaction.reference,
      );
      deps.logger.log(
        `ARPHA payment linked: user=${transaction.userId} request=${transaction.eventSlug}`,
      );
    } else if (transaction.purpose === "course") {
      await deps.eventsService.linkCoursePayment(
        transaction.userId,
        transaction.eventSlug,
        transaction.reference,
      );
      deps.logger.log(
        `Course payment linked: user=${transaction.userId} course=${transaction.eventSlug}`,
      );
    } else {
      await deps.eventsService.linkPayment(
        transaction.userId,
        transaction.eventSlug,
        transaction.reference,
      );
      deps.logger.log(
        `Event registration payment linked: user=${transaction.userId} event=${transaction.eventSlug}`,
      );
    }
  } catch (err: unknown) {
    deps.logger.warn(
      `Failed to link payment: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

export async function processAlegraInvoicingHelper(
  deps: AlegraInvoicingDeps,
  transaction: TransactionDocument,
): Promise<void> {
  try {
    const context: AlegraBillingContext = {
      userId: transaction.userId,
      transactionReference: transaction.reference,
      purpose: transaction.purpose,
      amount: transaction.amount,
      description: transaction.description,
    };

    if (transaction.purpose === "shop" && transaction.relatedReference) {
      const order = await deps.shopService.getOrderByOrderNumber(
        transaction.relatedReference,
      );
      if (order?.items && Array.isArray(order.items)) {
        context.items = order.items.map((item) => ({
          name: item.productName,
          description: `Producto BSK — ${item.productSlug}`,
          reference: item.productSlug,
          price: item.unitPrice,
          quantity: item.quantity,
        }));
      }
    }

    await deps.alegraService.processApprovedPayment(context);
  } catch (err: unknown) {
    deps.logger.warn(
      `Alegra invoicing skipped for ref=${transaction.reference}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
