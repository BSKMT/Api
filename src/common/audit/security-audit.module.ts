import { Global, Module } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";
import {
  SecurityAuditLog,
  SecurityAuditLogSchema,
} from "./schemas/security-audit-log.schema";
import { SecurityAuditService } from "./security-audit.service";
import { BirdModule } from "../../bird/bird.module";

/**
 * Módulo Global de Auditoría de Ciberseguridad.
 * Satisface NIST CSF 2.0 RS.AN-03, RS.AN-06, RS.AN-07 y RS.CO-02.
 */
@Global()
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: SecurityAuditLog.name, schema: SecurityAuditLogSchema },
    ]),
    BirdModule,
  ],
  providers: [SecurityAuditService],
  exports: [SecurityAuditService, MongooseModule],
})
export class SecurityAuditModule {}
