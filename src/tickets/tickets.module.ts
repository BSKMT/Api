import { Module } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";
import { Ticket, TicketSchema } from "./schemas/ticket.schema";
import { TicketsService } from "./tickets.service";
import { TicketsAdminController } from "./controllers/tickets-admin.controller";
import { TicketsGestionController } from "./controllers/tickets-gestion.controller";
import { TicketsPanelController } from "./controllers/tickets-panel.controller";
import { BirdModule } from "../bird/bird.module";
import { UsersModule } from "../users/users.module";
import { WhatsappBotService } from "./whatsapp-bot.service";

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Ticket.name, schema: TicketSchema }]),
    BirdModule,
    UsersModule,
  ],
  controllers: [
    TicketsAdminController,
    TicketsGestionController,
    TicketsPanelController,
  ],
  providers: [TicketsService, WhatsappBotService],
  exports: [TicketsService, WhatsappBotService],
})
export class TicketsModule {}
