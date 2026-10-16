import type { UserDocument } from "../users/schemas/user.schema";

export function deriveRecipientName(
  user: UserDocument | null,
  fallback: string,
): { name: string; phone?: string; plate?: string } {
  if (!user) return { name: fallback };

  const rawProfile = user.profile as
    Record<string, Record<string, string>> | undefined;
  const personal = rawProfile?.["datos-personales"];
  const contact = rawProfile?.["contacto"];
  const vehicle = rawProfile?.["vehiculo"];

  const primerNombre =
    typeof personal?.primerNombre === "string" ? personal.primerNombre : "";
  const primerApellido =
    typeof personal?.primerApellido === "string" ? personal.primerApellido : "";
  const fullName = `${primerNombre} ${primerApellido}`.trim();

  return {
    name: fullName || user.email || fallback,
    phone: typeof contact?.celular === "string" ? contact.celular : undefined,
    plate: typeof vehicle?.placa === "string" ? vehicle.placa : undefined,
  };
}
