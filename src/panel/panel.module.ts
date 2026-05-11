import { Module } from "@nestjs/common";
import { PanelController } from "./panel.controller";
import { UsersModule } from "../users/users.module";

@Module({
  imports: [UsersModule],
  controllers: [PanelController],
})
export class PanelModule {}
