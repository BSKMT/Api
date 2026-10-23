import { Model } from "mongoose";
import { TicketDocument } from "../schemas/ticket.schema";

export async function aggregateTicketStats(
  ticketModel: Model<TicketDocument>,
): Promise<Record<string, unknown>> {
  const [total, byStatus, byPriority, byChannel] = await Promise.all([
    ticketModel.countDocuments().exec(),
    ticketModel.aggregate<{ _id: string; count: number }>([
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]),
    ticketModel.aggregate<{ _id: string; count: number }>([
      { $group: { _id: "$priority", count: { $sum: 1 } } },
    ]),
    ticketModel.aggregate<{ _id: string; count: number }>([
      { $group: { _id: "$channel", count: { $sum: 1 } } },
    ]),
  ]);

  const statusCounts: Record<string, number> = {};
  for (const s of byStatus) {
    statusCounts[s._id] = s.count;
  }
  return { total, byStatus: statusCounts, byPriority, byChannel };
}
