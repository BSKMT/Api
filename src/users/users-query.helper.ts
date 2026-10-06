import { Model } from "mongoose";
import { UserDocument } from "./schemas/user.schema";

export async function executeListUsers(
  userModel: Model<UserDocument>,
  filters: {
    search?: string;
    role?: string;
    subrol?: string;
    limit?: number;
    page?: number;
  },
) {
  const filter: Record<string, unknown> = {};

  if (filters.role && typeof filters.role === "string") {
    filter.role = filters.role.trim().toLowerCase();
  }
  if (filters.subrol && typeof filters.subrol === "string") {
    filter.subrol = filters.subrol.trim().toLowerCase();
  }
  if (filters.search && typeof filters.search === "string") {
    const cleanSearch = filters.search.trim().slice(0, 100);
    const searchRegex = new RegExp(
      cleanSearch.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`),
      "i",
    );
    filter.$or = [
      { email: searchRegex },
      { "profile.datos-personales.primerNombre": searchRegex },
      { "profile.datos-personales.primerApellido": searchRegex },
      { "profile.membresia-ecosistema.numeroMiembro": searchRegex },
    ];
  }

  const limit = Math.min(Math.max(filters.limit ?? 20, 1), 100);
  const page = Math.max(filters.page ?? 1, 1);
  const skip = (page - 1) * limit;

  const [items, total] = await Promise.all([
    userModel
      .find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .select("-settings")
      .lean(),
    userModel.countDocuments(filter),
  ]);

  return {
    items,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  };
}

export async function executeFindStaffBySubroles(
  userModel: Model<UserDocument>,
  subroles: string[],
) {
  return userModel
    .find({
      subrol: { $in: subroles },
      isActive: true,
    })
    .select("_id email role subrol profile.datos-personales phone")
    .lean();
}
