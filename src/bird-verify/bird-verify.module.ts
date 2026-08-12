import { Module } from "@nestjs/common";
import { BirdModule } from "../bird/bird.module";
import { BirdVerifyService } from "./bird-verify.service";

/**
 * BirdVerifyModule — Expone {@link BirdVerifyService} a LoginOtpModule.
 *
 * Importa `BirdModule` para acceder al `BirdService` compartido
 * ( BirdClient SDK ).
 */
@Module({
  imports: [BirdModule],
  providers: [BirdVerifyService],
  exports: [BirdVerifyService],
})
export class BirdVerifyModule {}
