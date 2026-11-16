import { Module } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";
import { ArphaController } from "./arpha.controller";
import { ArphaService } from "./arpha.service";
import {
  ArphaRequest,
  ArphaRequestSchema,
} from "./schemas/arpha-request.schema";
import { UsersModule } from "../users/users.module";
import { MapboxModule } from "../mapbox/mapbox.module";

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ArphaRequest.name, schema: ArphaRequestSchema },
    ]),
    UsersModule,
    MapboxModule,
  ],
  controllers: [ArphaController],
  providers: [ArphaService],
  exports: [ArphaService],
})
export class ArphaModule {}
