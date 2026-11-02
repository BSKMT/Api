import { UsageProfile } from "./schemas/garage-motorcycle.schema";

export const KNOWN_EVENT_KM: Record<string, number> = {
  "kick-off-2026": 120,
  "rally-fundadores": 1800,
  "distinguished-ride": 45,
  "track-day-bsk": 150,
  "aniversario-gala-bsk": 90,
  "last-ride-2026": 140,
  "peregrinaje-motero": 650,
  "ruta-del-corazon": 240,
  "ruta-libertadora": 380,
  "rodada-nocturna": 80,
};

export const ALLIED_WORKSHOPS = [
  {
    id: "bsk-central",
    name: "BSK Central Performance",
    address: "Cra 7 # 73-28, Bogotá",
    city: "Bogotá",
    phone: "+57 310 890 1234",
    services: [
      "Mantenimiento General",
      "Cambio de Aceite",
      "Sincronización",
      "Frenos",
    ],
    discountPercent: 20,
    isAlliedCertified: true,
  },
  {
    id: "motos-accesorios-norte",
    name: "Motos & Accesorios SAS — Taller Norte",
    address: "Autopista Norte # 145-20, Bogotá",
    city: "Bogotá",
    phone: "+57 320 456 7890",
    services: ["Kit de Arrastre", "Pastillas Brembo", "Llantas Pirelli"],
    discountPercent: 15,
    isAlliedCertified: true,
  },
  {
    id: "box54-chia",
    name: "Box 54 Taller Especializado",
    address: "Av. Pradilla # 4-80, Chía",
    city: "Chía / Sabana",
    phone: "+57 315 234 5678",
    services: ["Suspensiones", "Diagnóstico Computarizado", "Mantenimiento"],
    discountPercent: 15,
    isAlliedCertified: true,
  },
  {
    id: "brembo-racing-point",
    name: "Brembo Official Service Partner",
    address: "Calle 127 # 19-35, Bogotá",
    city: "Bogotá",
    phone: "+57 312 345 6789",
    services: ["Pastillas Sinterizadas", "Líquido DOT 5.1", "Discos"],
    discountPercent: 25,
    isAlliedCertified: true,
  },
];

export const PROFILE_DAILY_RATES: Record<UsageProfile, number> = {
  [UsageProfile.DAILY_URBAN]: 28.5,
  [UsageProfile.WEEKEND_TRIPS]: 18.0,
  [UsageProfile.OFF_ROAD]: 12.0,
  [UsageProfile.CIRCUIT]: 8.0,
};

export const OIL_DEGRADATION: Record<UsageProfile, number> = {
  [UsageProfile.DAILY_URBAN]: 1.15,
  [UsageProfile.WEEKEND_TRIPS]: 0.95,
  [UsageProfile.OFF_ROAD]: 1.3,
  [UsageProfile.CIRCUIT]: 1.55,
};

export const CHAIN_DEGRADATION: Record<UsageProfile, number> = {
  [UsageProfile.DAILY_URBAN]: 1.1,
  [UsageProfile.WEEKEND_TRIPS]: 0.9,
  [UsageProfile.OFF_ROAD]: 1.45,
  [UsageProfile.CIRCUIT]: 1.25,
};

export const BRAKE_DEGRADATION: Record<UsageProfile, number> = {
  [UsageProfile.DAILY_URBAN]: 1.3,
  [UsageProfile.WEEKEND_TRIPS]: 0.9,
  [UsageProfile.OFF_ROAD]: 1.15,
  [UsageProfile.CIRCUIT]: 1.6,
};

export const BRAND_MULTIPLIERS: Record<string, number> = {
  bmw: 1.35,
  ducati: 1.3,
  ktm: 1.15,
  triumph: 1.2,
  yamaha: 1.1,
  honda: 1.1,
  kawasaki: 1.1,
  suzuki: 1.0,
  bajaj: 0.85,
  akt: 0.8,
};

export interface ProfileMotorcycleData {
  marcaMoto?: string;
  lineaMoto?: string;
  anioMoto?: number | string;
  cilindraje?: number | string;
  placaMoto?: string;
  colorMoto?: string;
  tipoMoto?: string;
  soatVigencia?: string;
  tecnomecanicaVigencia?: string;
  seguroTodoRiesgo?: string;
  polizaNumero?: string;
}
