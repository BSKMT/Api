import { Module, Global } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { CsrfService } from "./csrf.service";
import { CsrfGuard } from "./csrf.guard";
import { CsrfController } from "./csrf.controller";

@Global()
@Module({
  controllers: [CsrfController],
  providers: [
    CsrfService,
    {
      provide: APP_GUARD,
      useClass: CsrfGuard,
    },
  ],
  exports: [CsrfService],
})
export class CsrfModule {}
