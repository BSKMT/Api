import { Module } from "@nestjs/common";
import { VerifikService } from "./verifik.service";

/**
 * VerifikModule — exports the Verifik HTTP client so the profile
 * module's identity-verification flow can consume it.
 *
 * The provider reads its credentials (VERIFIK_API_TOKEN) from the
 * global ConfigService; no token material is ever exported.
 */
@Module({
  providers: [VerifikService],
  exports: [VerifikService],
})
export class VerifikModule {}
