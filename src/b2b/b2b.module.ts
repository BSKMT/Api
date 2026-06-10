import { Module } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";
import { B2bController } from "./b2b.controller";
import { B2bService } from "./b2b.service";
import { B2bContact, B2bContactSchema } from "./schemas/b2b-contact.schema";

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: B2bContact.name, schema: B2bContactSchema },
    ]),
  ],
  controllers: [B2bController],
  providers: [B2bService],
})
export class B2bModule {}
