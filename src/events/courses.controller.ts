import {
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
  BadRequestException,
} from "@nestjs/common";
import { Public } from "../common/decorators";
import { EventsService } from "./events.service";

@Controller("courses")
@UseGuards()
export class CoursesController {
  constructor(private readonly eventsService: EventsService) {}

  @Public()
  @Get("available")
  async getAvailableCourses(@Query("limit") limit?: string) {
    const parsedLimit = limit ? parseInt(limit, 10) : 6;
    return this.eventsService.getAvailableCourses(parsedLimit);
  }

  @Public()
  @Get("detail/:slug")
  async getCourseBySlug(@Param("slug") slug: string) {
    const course = await this.eventsService.getCourseBySlug(slug);
    if (!course) {
      throw new BadRequestException("Curso no encontrado");
    }
    return course;
  }
}
