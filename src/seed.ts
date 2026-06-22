import { NestFactory } from "@nestjs/core";
import { Logger } from "@nestjs/common";
import { AppModule } from "./app.module";
import { Model } from "mongoose";
import {
  EventDocument,
  EventCategory,
  EventStatus,
} from "./events/schemas/event.schema";
import {
  CourseDocument,
  CourseLevel,
  CourseFormat,
  CourseStatus,
} from "./events/schemas/course.schema";
import { ProductDocument, ProductStatus } from "./shop/schemas/product.schema";

const logger = new Logger("SeedScript");

const eventsSeed = [
  {
    slug: "kick-off-2026",
    title: "Kick-Off BSK 2026",
    subtitle:
      "Rodada oficial de apertura de temporada y entrega de kits de membresía.",
    date: new Date("2026-01-15T08:30:00"),
    endDate: new Date("2026-01-15T22:00:00"),
    location: "Bogotá D.C.",
    meetingPoint: "Sede Principal BSK",
    meetingTime: "07:00 AM",
    departureTime: "08:30 AM",
    category: EventCategory.RODADA,
    tag: "Temporada BSK",
    icon: "lucide:rocket",
    difficulty: "Básico",
    duration: "1 Día",
    description:
      "La rodada oficial de apertura de año, presentación del calendario anual y entrega oficial de los kits de membresía 2026.",
    membersFree: true,
    nonMemberPrice: 585000,
    companionPrice: 190000,
    maxCapacity: 150,
    status: EventStatus.PUBLISHED,
    featured: true,
    featuresIncluded: [
      "Entrega física del Kit de Membresía 2026",
      "Presentación exclusiva del calendario anual",
      "Escolta de Road Captains y marshals",
      "Almuerzo de lanzamiento de temporada",
    ],
  },
  {
    slug: "taller-conduccion-q1",
    title: "Taller de Conducción Q1",
    subtitle:
      "Clínica práctica en pista cerrada sobre trazado de curvas y frenado de emergencia.",
    date: new Date("2026-02-20T08:00:00"),
    endDate: new Date("2026-02-20T17:00:00"),
    location: "Autódromo Privado",
    meetingPoint: "Autódromo / Pista de Pruebas Privada",
    meetingTime: "07:30 AM",
    departureTime: "08:15 AM",
    category: EventCategory.TALLER,
    tag: "Academia",
    icon: "lucide:target",
    difficulty: "Todos los Niveles",
    duration: "1 Jornada",
    description:
      "Clínica práctica en pista cerrada sobre trazado de curvas, control de tracción y frenado de emergencia.",
    membersFree: true,
    nonMemberPrice: 250000,
    companionPrice: 40000,
    maxCapacity: 30,
    status: EventStatus.PUBLISHED,
    featured: true,
    featuresIncluded: [
      "Acceso completo a la pista",
      "Instrucción profesional certificada",
      "Certificado de participación",
      "Snack pack incluido",
    ],
  },
  {
    slug: "rodada-nocturna",
    title: "Rodada Nocturna",
    subtitle:
      "Experiencia de conducción nocturna por las montañas de Bogotá con cena incluida.",
    date: new Date("2026-03-15T18:00:00"),
    endDate: new Date("2026-03-15T23:00:00"),
    location: "Montañas de Bogotá",
    meetingPoint: "Punto de encuentro a definir",
    meetingTime: "18:00",
    departureTime: "18:30",
    category: EventCategory.RODADA,
    tag: "Exclusivo",
    icon: "lucide:moon",
    difficulty: "Intermedio",
    duration: "1 Noche",
    description:
      "Experiencia de conducción nocturna por las montañas de Bogotá con cena incluida en restaurante premium.",
    membersFree: true,
    nonMemberPrice: 320000,
    companionPrice: 150000,
    maxCapacity: 40,
    status: EventStatus.PUBLISHED,
    featured: true,
    featuresIncluded: [
      "Ruta escénica nocturna",
      "Cena en restaurante premium",
      "Fotografía profesional",
      "Apoyo mecánico en ruta",
    ],
  },
  {
    slug: "rally-fundadores",
    title: "Rally Raid: Fundadores",
    subtitle:
      "Edición Sikuani 2026 - 9 días, 1800 km de navegación y resistencia.",
    date: new Date("2026-05-31T05:30:00"),
    endDate: new Date("2026-06-07T20:00:00"),
    location: "Cundinamarca - Vichada - Guaviare",
    meetingPoint: "Bogotá — Punto de verificación técnica",
    meetingTime: "18:00",
    departureTime: "05:30",
    category: EventCategory.RALLY,
    tag: "Rally Raid",
    icon: "lucide:compass",
    difficulty: "Avanzado / Experto",
    duration: "9 Días / 9 Noches",
    description:
      "Un verdadero reto de navegación, resistencia y trabajo en equipo por la cordillera oriental colombiana.",
    membersFree: true,
    nonMemberPrice: 3200000,
    companionPrice: 830000,
    maxCapacity: 50,
    status: EventStatus.PUBLISHED,
    featured: true,
    featuresIncluded: [
      "Roadbook oficial digital",
      "Dorsal con sistema de cronometraje",
      "Asistencia médica en ruta",
      "Campamento base incluido",
      "Comidas incluidas",
    ],
  },
  {
    slug: "track-day-bsk",
    title: "BSK Track Day Privado",
    subtitle:
      "Alquiler exclusivo del Autódromo de Tocancipá con cronometraje y coaches.",
    date: new Date("2026-06-20T06:30:00"),
    endDate: new Date("2026-06-20T18:00:00"),
    location: "Autódromo de Tocancipá",
    meetingPoint: "Autódromo Internacional de Tocancipá",
    meetingTime: "06:30 AM",
    departureTime: "08:00 AM",
    category: EventCategory.TRACK_DAY,
    tag: "Track Day",
    icon: "lucide:flag",
    difficulty: "Todos los Niveles",
    duration: "1 Día",
    description:
      "Alquiler exclusivo del Autódromo de Tocancipá con cronometraje por telemetría y coaches profesionales.",
    membersFree: true,
    nonMemberPrice: 250000,
    companionPrice: 40000,
    maxCapacity: 60,
    status: EventStatus.PUBLISHED,
    featured: false,
    featuresIncluded: [
      "Acceso exclusivo al autódromo",
      "Transpondedor de telemetría",
      "Coaching profesional",
      "Almuerzo en paddock VIP",
    ],
  },
  {
    slug: "aniversario-gala-bsk",
    title: "Gala Anual BSK",
    subtitle: "Rodada conmemorativa de día y gala formal de noche.",
    date: new Date("2026-08-15T08:00:00"),
    endDate: new Date("2026-08-15T23:00:00"),
    location: "Bogotá D.C.",
    meetingPoint: "BSK Flagship Clubhouse",
    meetingTime: "08:00 AM",
    departureTime: "08:45 AM",
    category: EventCategory.GALA,
    tag: "Gala",
    icon: "lucide:crown",
    difficulty: "Relajado",
    duration: "1 Día / 2 Fases",
    description:
      "Rodada conmemorativa de día para honrar nuestra historia, seguida de una sofisticada fiesta de gala formal.",
    membersFree: true,
    nonMemberPrice: 450000,
    companionPrice: 200000,
    maxCapacity: 100,
    status: EventStatus.PUBLISHED,
    featured: false,
    featuresIncluded: [
      "Parche conmemorativo de aniversario",
      "Rodada conmemorativa",
      "Cena de gala formal",
      "Jazz en vivo",
    ],
  },
  {
    slug: "distinguished-ride",
    title: "BSK Distinguished Ride",
    subtitle: "Gala urbana sobre dos ruedas — Traje impecable, moto impecable.",
    date: new Date("2026-11-15T15:00:00"),
    endDate: new Date("2026-11-15T22:00:00"),
    location: "Carrera 7, Bogotá",
    meetingPoint: "Museo Nacional",
    meetingTime: "15:00",
    departureTime: "16:30",
    category: EventCategory.GALA,
    tag: "Gala Urbana",
    icon: "lucide:glasses",
    difficulty: "Principiante",
    duration: "Media Jornada",
    description:
      "Rodada de gala con traje formal por el centro de Bogotá. Cena en lounge exclusivo.",
    membersFree: true,
    nonMemberPrice: 180000,
    companionPrice: 120000,
    maxCapacity: 80,
    status: EventStatus.PUBLISHED,
    featured: false,
    featuresIncluded: [
      "Pin conmemorativo edición limitada",
      "Cena formal de tres tiempos",
      "Sesión de fotografía profesional",
      "Lounge privado",
    ],
  },
  {
    slug: "last-ride-2026",
    title: "The Last Ride 2026",
    subtitle:
      "Final de temporada — Rodada de atardecer y cena de agradecimiento.",
    date: new Date("2026-12-10T15:30:00"),
    endDate: new Date("2026-12-10T23:00:00"),
    location: "Bogotá D.C.",
    meetingPoint: "BSK Headquarters",
    meetingTime: "03:30 PM",
    departureTime: "04:15 PM",
    category: EventCategory.RODADA,
    tag: "Cierre de Temporada",
    icon: "lucide:sunset",
    difficulty: "Intermedio",
    duration: "1 Tarde-Noche",
    description:
      "La rodada de cierre de año con cena de agradecimiento y reconocimiento a pilotos.",
    membersFree: true,
    nonMemberPrice: 280000,
    companionPrice: 130000,
    maxCapacity: 100,
    status: EventStatus.PUBLISHED,
    featured: false,
    featuresIncluded: [
      "Rodada de atardecer",
      "Cena premium de 3 tiempos",
      "Certificado conmemorativo",
      "Reconocimiento a pilotos",
    ],
  },
];

const coursesSeed = [
  {
    slug: "motociclismo-general",
    title: "Motociclismo General",
    subtitle:
      "Fundamentos de conducción, postura, técnica de frenado y visibilidad defensiva.",
    level: CourseLevel.PRINCIPIANTE,
    format: CourseFormat.VIRTUAL,
    icon: "lucide:hard-hat",
    description:
      "Fundamentos de conducción, postura, técnica de frenado y visibilidad defensiva para nuevos motociclistas.",
    durationHours: 8,
    modules: [
      "Postura y control de la moto",
      "Técnica de frenado básico",
      "Visibilidad defensiva",
      "Normas de circulación",
    ],
    membersFree: true,
    nonMemberPrice: 150000,
    memberSemipresencialDiscount: 25,
    memberPresencialDiscount: 50,
    status: CourseStatus.PUBLISHED,
    featured: true,
    featuresIncluded: [
      "Certificado de finalización",
      "Material descargable",
      "Acceso de por vida",
    ],
  },
  {
    slug: "mecanica-motera",
    title: "Mecánica Motera",
    subtitle:
      "Diagnóstico básico, mantenimiento preventivo y procedimientos de emergencia.",
    level: CourseLevel.INTERMEDIO,
    format: CourseFormat.VIRTUAL,
    icon: "lucide:wrench",
    description:
      "Aprende diagnóstico básico de la moto, mantenimiento preventivo y procedimientos de emergencia en ruta.",
    durationHours: 12,
    modules: [
      "Sistema de frenos",
      "Sistema eléctrico básico",
      "Cadena y transmisión",
      "Neumáticos y presión",
      "Kit de emergencia",
    ],
    membersFree: true,
    nonMemberPrice: 200000,
    memberSemipresencialDiscount: 25,
    memberPresencialDiscount: 50,
    status: CourseStatus.PUBLISHED,
    featured: true,
    featuresIncluded: [
      "Certificado de finalización",
      "Material descargable",
      "Acceso de por vida",
    ],
  },
  {
    slug: "primeros-auxilios-moteros",
    title: "Primeros Auxilios Moteros",
    subtitle:
      "Estabilización básica en ruta, señales de emergencia y protocolos ante accidentes.",
    level: CourseLevel.TODOS,
    format: CourseFormat.VIRTUAL,
    icon: "lucide:heart-pulse",
    description:
      "Estabilización básica en ruta, señales de emergencia y protocolos ante accidentes para motociclistas.",
    durationHours: 6,
    modules: [
      "Evaluación inicial del accidentado",
      "RCP básico",
      "Inmovilización",
      "Señalización de accidente",
    ],
    membersFree: true,
    nonMemberPrice: 120000,
    memberSemipresencialDiscount: 25,
    memberPresencialDiscount: 50,
    status: CourseStatus.PUBLISHED,
    featured: true,
    featuresIncluded: [
      "Certificado de finalización",
      "Material descargable",
      "Acceso de por vida",
    ],
  },
  {
    slug: "conduccion-defensiva",
    title: "Conducción Defensiva",
    subtitle:
      "Técnicas avanzadas de anticipación y reacción ante situaciones de riesgo.",
    level: CourseLevel.INTERMEDIO,
    format: CourseFormat.VIRTUAL,
    icon: "lucide:shield",
    description:
      "Técnicas avanzadas de anticipación y reacción ante situaciones de riesgo en la vía.",
    durationHours: 10,
    modules: [
      "Lectura de la vía",
      "Distancias de seguridad",
      "Puntos ciegos",
      "Conducción en lluvia",
      "Conducción nocturna",
    ],
    membersFree: true,
    nonMemberPrice: 180000,
    memberSemipresencialDiscount: 25,
    memberPresencialDiscount: 50,
    status: CourseStatus.PUBLISHED,
    featured: false,
    featuresIncluded: [
      "Certificado de finalización",
      "Material descargable",
      "Acceso de por vida",
    ],
  },
  {
    slug: "legalidad-motera",
    title: "Legalidad Motera",
    subtitle:
      "Normativa de tránsito, derechos del motociclista y procedimientos legales.",
    level: CourseLevel.TODOS,
    format: CourseFormat.VIRTUAL,
    icon: "lucide:scale",
    description:
      "Normativa de tránsito, derechos del motociclista y procedimientos legales en caso de accidente o retención.",
    durationHours: 5,
    modules: [
      "Código de tránsito",
      "Documentos obligatorios",
      "Derechos en retención",
      "Procedimiento post-accidente",
    ],
    membersFree: true,
    nonMemberPrice: 100000,
    memberSemipresencialDiscount: 25,
    memberPresencialDiscount: 50,
    status: CourseStatus.PUBLISHED,
    featured: false,
    featuresIncluded: [
      "Certificado de finalización",
      "Material descargable",
      "Acceso de por vida",
    ],
  },
];

const productsSeed = [
  {
    slug: "chaqueta-bsk-stormline",
    name: "Chaqueta BSK Stormline",
    collection: "Riding Core",
    description:
      "Chaqueta técnica con protección D3O, membrana impermeable y ventilación estratégica.",
    image: null,
    publicPrice: 600000,
    memberDiscountPercent: 20,
    stock: 15,
    isNew: true,
    featured: true,
    status: ProductStatus.PUBLISHED,
  },
  {
    slug: "guantes-bsk-precision",
    name: "Guantes BSK Precision",
    collection: "Performance Lab",
    description:
      "Guantes de cuero con protección de nudillos, pantalla táctil y cierre de seguridad.",
    image: null,
    publicPrice: 180000,
    memberDiscountPercent: 20,
    stock: 28,
    isNew: false,
    featured: true,
    status: ProductStatus.PUBLISHED,
  },
  {
    slug: "botas-bsk-carbon-route",
    name: "Botas BSK Carbon Route",
    collection: "Legacy Signature",
    description:
      "Botas touring de edición limitada con suela Vibram y protección de tobillo reforzada.",
    image: null,
    publicPrice: 700000,
    memberDiscountPercent: 20,
    stock: 8,
    isNew: true,
    featured: true,
    status: ProductStatus.PUBLISHED,
  },
  {
    slug: "casco-bsk-aero-pro",
    name: "Casco BSK Aero Pro",
    collection: "Performance Lab",
    description:
      "Casco integral de fibra de carbono con ventilación avanzada y visor antiempañante.",
    image: null,
    publicPrice: 900000,
    memberDiscountPercent: 20,
    stock: 12,
    isNew: false,
    featured: true,
    status: ProductStatus.PUBLISHED,
  },
  {
    slug: "pantalon-bsk-touring-pro",
    name: "Pantalón BSK Touring Pro",
    collection: "Performance Lab",
    description:
      "Pantalón touring con protección reforzada y paneles reflectivos.",
    image: null,
    publicPrice: 480000,
    memberDiscountPercent: 20,
    stock: 20,
    isNew: false,
    featured: false,
    status: ProductStatus.PUBLISHED,
  },
  {
    slug: "chaleco-bsk-safety",
    name: "Chaleco BSK Safety",
    collection: "Riding Core",
    description:
      "Chaleco reflectivo de alta visibilidad con protección dorsal integrada.",
    image: null,
    publicPrice: 250000,
    memberDiscountPercent: 20,
    stock: 35,
    isNew: false,
    featured: false,
    status: ProductStatus.PUBLISHED,
  },
];

async function seed() {
  logger.log("Starting database seed...");

  const app = await NestFactory.createApplicationContext(AppModule);

  const eventModel = app.get<Model<EventDocument>>("EventModel");
  const courseModel = app.get<Model<CourseDocument>>("CourseModel");
  const productModel = app.get<Model<ProductDocument>>("ProductModel");

  logger.log("Seeding events...");
  for (const eventData of eventsSeed) {
    const existing = await eventModel.findOne({ slug: eventData.slug });
    if (!existing) {
      await eventModel.create(eventData);
      logger.log(`Created event: ${eventData.title}`);
    } else {
      logger.log(`Event already exists: ${eventData.title}`);
    }
  }

  logger.log("Seeding courses...");
  for (const courseData of coursesSeed) {
    const existing = await courseModel.findOne({ slug: courseData.slug });
    if (!existing) {
      await courseModel.create(courseData);
      logger.log(`Created course: ${courseData.title}`);
    } else {
      logger.log(`Course already exists: ${courseData.title}`);
    }
  }

  logger.log("Seeding shop products...");
  for (const productData of productsSeed) {
    const existing = await productModel.findOne({ slug: productData.slug });
    if (!existing) {
      await productModel.insertMany([productData]);
      logger.log(`Created product: ${productData.name}`);
    } else {
      logger.log(`Product already exists: ${productData.name}`);
    }
  }

  await app.close();
  logger.log("Seed completed!");
}

seed().catch((err) => {
  logger.error("Seed failed:", err);
  process.exit(1);
});
