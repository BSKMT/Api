import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { MapboxService } from "./mapbox.service";
import { MapboxController } from "./mapbox.controller";

@Module({
  imports: [ConfigModule],
  controllers: [MapboxController],
  providers: [MapboxService],
  exports: [MapboxService],
})
export class MapboxModule {}
