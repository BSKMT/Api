import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Req,
  UseGuards,
  HttpCode,
  HttpStatus,
} from "@nestjs/common";
import type { Request } from "express";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { ArphaService } from "./arpha.service";
import { CreateArphaRequestDto } from "./dto/create-arpha-request.dto";
import { RateArphaRequestDto } from "./dto/rate-arpha-request.dto";

@Controller("arpha")
@UseGuards(JwtAuthGuard)
export class ArphaController {
  constructor(private readonly arphaService: ArphaService) {}

  @Post("request")
  @HttpCode(HttpStatus.CREATED)
  async createRequest(@Req() req: Request, @Body() dto: CreateArphaRequestDto) {
    const user = req.user as { userId: string };
    return this.arphaService.createRequest(user.userId, dto);
  }

  @Post("cancel/:id")
  @HttpCode(HttpStatus.OK)
  async cancelRequest(@Req() req: Request, @Param("id") requestId: string) {
    const user = req.user as { userId: string };
    return this.arphaService.cancelRequest(user.userId, requestId);
  }

  @Post("rate/:id")
  @HttpCode(HttpStatus.OK)
  async rateRequest(
    @Req() req: Request,
    @Param("id") requestId: string,
    @Body() dto: RateArphaRequestDto,
  ) {
    const user = req.user as { userId: string };
    return this.arphaService.rateRequest(user.userId, requestId, dto);
  }

  @Get("my-requests")
  async getMyRequests(@Req() req: Request) {
    const user = req.user as { userId: string };
    return this.arphaService.getMyRequests(user.userId);
  }
}
