import { Controller, Get, Req, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";
import { SessionGuard } from "../auth/session.guard";
import { UsersService } from "../users/users.service";
import {
  EventRegistration,
  EventRegistrationDocument,
} from "../events/schemas/event-registration.schema";
import {
  CourseEnrollment,
  CourseEnrollmentDocument,
} from "../events/schemas/course-enrollment.schema";
import {
  ArphaRequest,
  ArphaRequestDocument,
  ArphaRequestStatus,
} from "../arpha/schemas/arpha-request.schema";
import {
  Order,
  OrderDocument,
  OrderStatus,
} from "../shop/schemas/order.schema";

interface AuthenticatedRequest extends Request {
  user: { userId: string; email: string };
}

@Controller("panel")
@UseGuards(SessionGuard)
export class PanelController {
  constructor(
    private readonly usersService: UsersService,
    @InjectModel(EventRegistration.name)
    private readonly eventRegistrationModel: Model<EventRegistrationDocument>,
    @InjectModel(CourseEnrollment.name)
    private readonly courseEnrollmentModel: Model<CourseEnrollmentDocument>,
    @InjectModel(ArphaRequest.name)
    private readonly arphaRequestModel: Model<ArphaRequestDocument>,
    @InjectModel(Order.name)
    private readonly orderModel: Model<OrderDocument>,
  ) {}

  @Get()
  async getPanel(@Req() req: AuthenticatedRequest) {
    const user = req.user;
    const fullUser = await this.usersService.findById(user.userId);

    if (!fullUser) {
      return { user: null, activity: {}, profile: {} };
    }

    const profile = fullUser.profile ?? {};
    const completedSections = fullUser.completedSections ?? [];
    const membershipLevel = fullUser.membershipLevel ?? null;
    const isLegend = membershipLevel === "Legend";

    const personalData = profile["datos-personales"] ?? {};
    const contactData = profile["contacto"] ?? {};

    const displayName =
      (personalData.primerNombre as string) ||
      (personalData.primerApellido as string) ||
      fullUser.email.split("@")[0];

    const [
      completedEvents,
      completedCourses,
      assistanceReceived,
      purchasedProducts,
      activeArphaRequests,
      pendingOrders,
      activeEnrollments,
      upcomingRegistrations,
    ] = await Promise.all([
      this.eventRegistrationModel.countDocuments({
        userId: user.userId,
        status: "CONFIRMED",
      }),
      this.courseEnrollmentModel.countDocuments({
        userId: user.userId,
        status: "COMPLETED",
      }),
      this.arphaRequestModel.countDocuments({
        userId: user.userId,
        status: ArphaRequestStatus.COMPLETED,
      }),
      this.orderModel.countDocuments({
        userId: user.userId,
        status: { $ne: OrderStatus.CANCELLED },
      }),
      this.arphaRequestModel.countDocuments({
        userId: user.userId,
        status: {
          $in: [ArphaRequestStatus.PENDING, ArphaRequestStatus.EN_CAMINO],
        },
      }),
      this.orderModel.countDocuments({
        userId: user.userId,
        status: OrderStatus.PENDING,
      }),
      this.courseEnrollmentModel.countDocuments({
        userId: user.userId,
        status: "ACTIVE",
      }),
      this.eventRegistrationModel.countDocuments({
        userId: user.userId,
        status: "PENDING",
      }),
    ]);

    const motorcycleCount = profile["motocicleta"] ? 1 : 0;
    const hasSecondMoto =
      (profile["motocicleta"]?.tieneMoto2 as string) === "Si";
    const totalMotos = motorcycleCount + (hasSecondMoto ? 1 : 0);

    return {
      user: {
        userId: String(fullUser._id),
        email: fullUser.email,
        displayName,
        membershipLevel,
        role: fullUser.role,
        profileCompleted: fullUser.profileCompleted,
      },
      activity: {
        completedEvents,
        completedCourses,
        assistanceReceived,
        purchasedProducts,
        activeArphaRequests,
        pendingOrders,
        activeEnrollments,
        upcomingRegistrations,
      },
      session: {
        accountStatus: fullUser.isActive ? "Activa" : "Inactiva",
        accountVerified: fullUser.emailVerified,
        identityVerified: fullUser.identityVerified ?? false,
        membershipLevel,
        isLegend,
        profileCompleted: fullUser.profileCompleted,
        completedSectionsCount: completedSections.length,
        totalSections: 7,
      },
      profile: {
        personal: personalData,
        contact: contactData,
        motorcycle: profile["motocicleta"] ?? {},
        totalMotos,
      },
    };
  }
}
