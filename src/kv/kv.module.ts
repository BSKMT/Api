import { Module, Global } from "@nestjs/common";
import { KvCacheService } from "./kv-cache.service";

@Global()
@Module({
  providers: [KvCacheService],
  exports: [KvCacheService],
})
export class KvModule {}
