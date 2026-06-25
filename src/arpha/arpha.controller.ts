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
import { UsersService } from "../users/users.service";
import { ArphaService } from "./arpha.service";
import { CreateArphaRequestDto } from "./dto/create-arpha-request.dto";
import { RateArphaRequestDto } from "./dto/rate-arpha-request.dto";

interface AuthenticatedRequest extends Request {
  user: { userId: string; email?: string };
}

@Controller("arpha")
@UseGuards(JwtAuthGuard)
export class ArphaController {
  constructor(
    private readonly arphaService: ArphaService,
    private readonly usersService: UsersService,
  ) {}

  @Post("request")
  @HttpCode(HttpStatus.CREATED)
  async createRequest(
    @Req() req: AuthenticatedRequest,
    @Body() dto: CreateArphaRequestDto,
  ) {
    const { userId } = req.user;
    const fullUser = await this.usersService.findById(userId);
    const membershipLevel = fullUser?.membershipLevel ?? null;
    return this.arphaService.createRequest(userId, dto, membershipLevel);
  }

  @Post("cancel/:id")
  @HttpCode(HttpStatus.OK)
  async cancelRequest(
    @Req() req: AuthenticatedRequest,
    @Param("id") requestId: string,
  ) {
    const { userId } = req.user;
    return this.arphaService.cancelRequest(userId, requestId);
  }

  @Post("rate/:id")
  @HttpCode(HttpStatus.OK)
  async rateRequest(
    @Req() req: AuthenticatedRequest,
    @Param("id") requestId: string,
    @Body() dto: RateArphaRequestDto,
  ) {
    const { userId } = req.user;
    return this.arphaService.rateRequest(userId, requestId, dto);
  }

  @Get("my-requests")
  async getMyRequests(@Req() req: AuthenticatedRequest) {
    const { userId } = req.user;
    return this.arphaService.getMyRequests(userId);
  }

  @Get("pricing")
  async getPricing(@Req() req: AuthenticatedRequest) {
    const { userId } = req.user;
    const fullUser = await this.usersService.findById(userId);
    const membershipLevel = fullUser?.membershipLevel ?? null;
    return this.arphaService.getPricingInfo("tecnica", membershipLevel);
  }
}
