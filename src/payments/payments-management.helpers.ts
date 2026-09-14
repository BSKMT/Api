import {
  BadRequestException,
  NotFoundException,
  ConflictException,
  Logger,
} from "@nestjs/common";
import { Model } from "mongoose";
import { TransactionDocument } from "./schemas/transaction.schema";
import { SubmitCompanionDto } from "./dto/submit-companion.dto";
import { AlegraService } from "../alegra/alegra.service";
import { maskReference } from "../common/utils/log-redact.util";

export async function submitCompanionDataHelper(
  deps: { transactionModel: Model<TransactionDocument>; logger: Logger },
  userId: string,
  reference: string,
  dto: SubmitCompanionDto,
) {
  const transaction = await deps.transactionModel.findOne({
    userId,
    reference,
  });

  if (!transaction) {
    throw new NotFoundException("Transacción no encontrada");
  }

  if (!transaction.hasCompanion) {
    throw new BadRequestException("Esta transacción no incluye acompañante");
  }

  if (transaction.companionData) {
    throw new ConflictException(
      "Los datos del acompañante ya fueron registrados",
    );
  }

  transaction.companionData = {
    fullName: dto.fullName,
    documentId: dto.documentId,
    phone: dto.phone,
    email: dto.email,
  };

  await transaction.save();
  deps.logger.log(`Companion data submitted for reference: ${reference}`);

  return { message: "Datos del acompañante registrados exitosamente" };
}

export async function getTransactionsByUserHelper(
  deps: {
    transactionModel: Model<TransactionDocument>;
    alegraService: AlegraService;
  },
  userId: string,
) {
  const transactions = await deps.transactionModel
    .find({ userId })
    .sort({ createdAt: -1 })
    .select("-webhookEvents -__v");

  const alegraInvoices = await deps.alegraService.getInvoicesForUser(userId);

  return transactions.map((t) => {
    const key = `${t.reference}:${t.purpose}`;
    const inv = alegraInvoices.get(key);

    return {
      reference: t.reference,
      eventSlug: t.eventSlug,
      status: t.status,
      amount: t.amount,
      description: t.description,
      tier: t.tier,
      purpose: t.purpose,
      relatedReference: t.relatedReference,
      hasCompanion: t.hasCompanion,
      companionData: t.companionData
        ? {
            fullName: t.companionData.fullName,
            documentId: t.companionData.documentId,
            phone: t.companionData.phone,
            email: t.companionData.email,
          }
        : null,
      paymentMethod: t.paymentMethod,
      createdAt: t.createdAt,
      invoice: inv
        ? {
            alegraInvoiceId: inv.alegraInvoiceId,
            invoiceNumber: inv.alegraInvoiceNumber,
            cufe: inv.cufe,
            stampStatus: inv.stampStatus,
            status: inv.status,
            emailed: inv.emailed,
            errorMessage: inv.errorMessage,
          }
        : null,
    };
  });
}

export async function cancelPendingTransactionHelper(
  deps: { transactionModel: Model<TransactionDocument>; logger: Logger },
  userId: string,
  reference: string,
): Promise<{ message: string }> {
  const transaction = await deps.transactionModel.findOne({
    userId,
    reference,
  });

  if (!transaction) {
    throw new NotFoundException("Transacción no encontrada");
  }

  if (transaction.status !== "PENDING" && transaction.status !== "PROCESSING") {
    throw new BadRequestException(
      "Solo se pueden cancelar transacciones pendientes o en proceso",
    );
  }

  transaction.status = "VOIDED";
  await transaction.save();
  deps.logger.log(
    `Transaction cancelled by user: ref=${maskReference(reference)}`,
  );

  return { message: "Transacción cancelada exitosamente" };
}

export async function retryInvoiceHelper(
  deps: {
    transactionModel: Model<TransactionDocument>;
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
    throw new NotFoundException("Transacción no encontrada");
  }

  if (transaction.status !== "APPROVED") {
    throw new BadRequestException(
      "Solo se pueden reintentar facturas de transacciones aprobadas",
    );
  }

  const retried = await deps.alegraService.retryFailedInvoice(
    reference,
    transaction.purpose,
  );

  if (!retried) {
    throw new BadRequestException(
      "No hay una factura fallida para reintentar, o ya fue procesada exitosamente",
    );
  }

  return { message: "Reintento de factura electrónica en proceso" };
}

export async function getInvoicePdfUrlHelper(
  deps: {
    transactionModel: Model<TransactionDocument>;
    alegraService: AlegraService;
  },
  userId: string,
  reference: string,
  purpose?: string,
): Promise<{ pdfUrl: string }> {
  const transaction = await deps.transactionModel.findOne({
    userId,
    reference,
  });

  const effectivePurpose = transaction?.purpose ?? purpose;

  if (!transaction && !effectivePurpose) {
    throw new NotFoundException("Transacción no encontrada");
  }

  const pdfUrl = await deps.alegraService.getInvoicePdfUrlByTransaction(
    userId,
    reference,
    effectivePurpose ?? "membership",
  );

  if (!pdfUrl) {
    throw new BadRequestException(
      "La factura electrónica no está disponible para descarga. Puede estar pendiente de generación o no configurada.",
    );
  }

  return { pdfUrl };
}

export async function checkPendingForPurposeHelper(
  transactionModel: Model<TransactionDocument>,
  userId: string,
  purpose: string,
  eventSlug?: string,
): Promise<{ hasPending: boolean; reference: string | null }> {
  const query: Record<string, unknown> = {
    userId,
    purpose,
    status: { $in: ["PENDING", "PROCESSING"] },
  };
  if (eventSlug) query.eventSlug = eventSlug;

  const pending = await transactionModel.findOne(query).sort({ createdAt: -1 });

  return {
    hasPending: !!pending,
    reference: pending?.reference ?? null,
  };
}

export async function assertNoPendingForPurposeHelper(
  transactionModel: Model<TransactionDocument>,
  userId: string,
  purpose: string,
  eventSlug: string,
): Promise<void> {
  const { hasPending, reference } = await checkPendingForPurposeHelper(
    transactionModel,
    userId,
    purpose,
    eventSlug,
  );
  if (hasPending && reference) {
    throw new ConflictException(
      `Ya tienes una transacción pendiente (${reference}). Continúa o cancélala antes de iniciar una nueva.`,
    );
  }
}
