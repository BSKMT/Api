import { Module } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";
import {
  EventRegistration,
  EventRegistrationSchema,
} from "./schemas/event-registration.schema";
import { Event, EventSchema } from "./schemas/event.schema";
import { Course, CourseSchema } from "./schemas/course.schema";
import {
  CourseEnrollment,
  CourseEnrollmentSchema,
} from "./schemas/course-enrollment.schema";
import { EventsController } from "./events.controller";
import { CoursesController } from "./courses.controller";
import { EventsService } from "./events.service";
import { UsersModule } from "../users/users.module";

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: EventRegistration.name, schema: EventRegistrationSchema },
      { name: Event.name, schema: EventSchema },
      { name: Course.name, schema: CourseSchema },
      { name: CourseEnrollment.name, schema: CourseEnrollmentSchema },
    ]),
    UsersModule,
  ],
  controllers: [EventsController, CoursesController],
  providers: [EventsService],
  exports: [EventsService],
})
export class EventsModule {}
