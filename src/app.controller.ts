import { Controller, Get } from "@nestjs/common";
import { Public } from "./common/decorators";

@Controller()
export class AppController {
  @Public()
  @Get()
  getRoot() {
    return {
      status: "ok",
      name: "BSKMT API",
      timestamp: new Date().toISOString(),
    };
  }

  @Public()
  @Get("api")
  getApiRoot() {
    return {
      status: "ok",
      name: "BSKMT API",
      timestamp: new Date().toISOString(),
    };
  }

  @Public()
  @Get("health")
  getHealth() {
    return {
      status: "ok",
      name: "BSKMT API",
      timestamp: new Date().toISOString(),
    };
  }

  @Public()
  @Get(".well-known/assetlinks.json")
  getAssetLinks() {
    return [
      {
        relation: [
          "delegate_permission/common.handle_all_urls",
          "delegate_permission/common.get_login_creds",
        ],
        target: {
          namespace: "android_app",
          package_name: "com.bskmt.app",
          sha256_cert_fingerprints: [
            "5D:88:48:70:09:20:85:33:3F:28:1A:1A:0E:F2:27:47:E1:AA:73:D2:EA:B5:60:4C:2F:5D:7D:0C:B0:51:05:4B",
          ],
        },
      },
    ];
  }
}
