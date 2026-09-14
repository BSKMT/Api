import { BadRequestException, NotFoundException, Logger } from "@nestjs/common";
import { Model } from "mongoose";
import { MembershipTransactionDocument } from "./schemas/membership-transaction.schema";
import { AlegraService } from "../alegra/alegra.service";
import type { AlegraBillingContext } from "../alegra/alegra.interfaces";
import { formatStoredMembershipDescription } from "./membership-formatting.helpers";

export async function processAlegraInvoicingHelper(
  deps: { alegraService: AlegraService; logger: Logger },
  transaction: MembershipTransactionDocument,
): Promise<void> {
  try {
    const description = formatStoredMembershipDescription(
      transaction.paymentPlan,
      transaction.isRenewal,
      transaction.installmentNumber,
      transaction.installmentTotal,
    );

    const context: AlegraBillingContext = {
      userId: transaction.userId,
      transactionReference: transaction.reference,
      purpose: "membership",
      amount: transaction.amount,
      description,
    };

    await deps.alegraService.processApprovedPayment(context);
  } catch (err: unknown) {
    deps.logger.warn(
      `Alegra invoicing skipped for membership ref=${transaction.reference}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

export async function retryMembershipInvoiceHelper(
  deps: {
    transactionModel: Model<MembershipTransactionDocument>;
    alegraService: AlegraService;
  },
  userId: string,
  reference: string,
): Promise<{ message: string }> {
  const transaction = await deps.transactionModel.findOne({
    userId,
    reference,
  });

  if (!transaction) {
    throw new NotFoundException("Transacción de membresía no encontrada");
  }

  if (transaction.status !== "APPROVED") {
    throw new BadRequestException(
      "Solo se pueden reintentar facturas de transacciones aprobadas",
    );
  }

  const retried = await deps.alegraService.retryFailedInvoice(
    reference,
    "membership",
  );

  if (!retried) {
    throw new BadRequestException(
      "No hay una factura fallida para reintentar, o ya fue procesada exitosamente",
    );
  }

  return { message: "Reintento de factura electrónica en proceso" };
}
