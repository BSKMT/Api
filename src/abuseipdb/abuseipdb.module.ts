import { Module, Global } from "@nestjs/common";
import { AbuseIpDbService } from "./abuseipdb.service";
import { KvModule } from "../kv/kv.module";

/**
 * AbuseIpDbModule — global module that provides the {@link AbuseIpDbService}.
 *
 * Depends on {@link KvModule} for KV cache access (imported explicitly
 * rather than relying on the global export chain to keep the dependency
 * graph explicit and testable).
 */
@Global()
@Module({
  imports: [KvModule],
  providers: [AbuseIpDbService],
  exports: [AbuseIpDbService],
})
export class AbuseIpDbModule {}
