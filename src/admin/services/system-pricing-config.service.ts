import { Injectable, Logger } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";
import {
  SystemPricingConfig,
  SystemPricingConfigDocument,
} from "../schemas/system-pricing-config.schema";
import { UpdateSystemPricingConfigDto } from "../dto/system-pricing-config.dto";

export const DEFAULT_PRICING_CONFIG: Omit<SystemPricingConfig, "updatedBy"> = {
  seasonYear: 2027,
  isCurrentSeason: true,
  membership: {
    renewalAmount: 3050000,
    newMemberAmount: 3250000,
    installmentAmount: 300000,
    installmentsTotal: 12,
    durationDays: 365,
  },
  campaign: {
    startDate: "2027-01-10T00:00:00.000Z",
    endDate: "2027-01-31T23:59:59.000Z",
    lotMinCapacity: 150,
    lotMaxCapacity: 200,
    earlyBirdBonusAmount: 150000,
    earlyBirdDays: 5,
    isActive: true,
  },
  perksAndRates: {
    officialKitPrice: 580000,
    annualGalaTicketPrice: 280000,
    shopMemberDiscountPercent: 15,
    courseVirtualDiscountPercent: 100,
    coursePresencialDiscountPercent: 20,
    courseSemipresencialDiscountPercent: 25,
    eventRodadaDiscountPercent: 100,
    eventMediumDiscountPercent: 25,
    eventExpeditionDiscountPercent: 20,
    arphaPricing: {
      tecnica: 55000,
      ruta: 85000,
      emergencia: 145000,
      juridica: 195000,
    },
  },
  features: {
    freeTierFeatures: [
      "Acceso completo a la plataforma web y panel de usuario",
      "Rodadas cortas locales a tarifa plena ($65.000 - $130.000 COP)",
      "Eventos medios a tarifa plena ($650.000 - $1.650.000 COP)",
      "Grandes expediciones a tarifa plena ($2.750.000 - $6.500.000 COP)",
      "Compras en Tienda Oficial BSK a precio de lista PVP",
      "Asistencia vial ARPHA Bogotá por evento ($55.000 - $195.000 COP)",
      "Cursos virtuales y presenciales con tarifa individual por módulo",
    ],
    legendTierFeatures: [
      "Kit Oficial BSK de temporada (chaqueta, parches, regalos valor $580.000 COP) incluido",
      "Rodadas cortas locales (1 día / Cundinamarca) 100% incluidas ($0 COP)",
      "Eventos medios (2-3 días) con 25% de Descuento / Bono",
      "Grandes expediciones y rallies (4+ días) con 20% de Descuento Preferencial",
      "Cursos virtuales Academia BSK 100% incluidos ($0 COP)",
      "Clínicas prácticas y pista presencial con 20% de Descuento",
      "Asistencia vial ARPHA Bogotá 24/7 incluida sin costo ($0 COP)",
      "15% de descuento permanente en Tienda BSK Oficial",
      "1 Entrada VIP para la Gala Anual BSK ($280.000 COP) incluida",
      "Prioridad de cupos en experiencias con aforo limitado",
    ],
    comparisonTable: [
      {
        service: "Membresía Anual (Precio Base)",
        registeredUser: "N/A (Registro Web Gratis)",
        legendRenewal: "$3.050.000 COP",
        legendNew: "$3.250.000 COP",
      },
      {
        service: "Kit Oficial BSK (Chaqueta, Parches, Regalos)",
        registeredUser: "$580.000 COP (PVP Tienda)",
        legendRenewal: "Incluido ($0 COP)",
        legendNew: "Incluido ($0 COP)",
      },
      {
        service: "Rodadas Cortas Locales (1 día / Cundinamarca)",
        registeredUser: "$65.000 - $130.000 COP",
        legendRenewal: "100% Incluidas ($0 COP)",
        legendNew: "100% Incluidas ($0 COP)",
      },
      {
        service: "Eventos Medios (2-3 días)",
        registeredUser: "$650.000 - $1.650.000 COP",
        legendRenewal: "25% Descuento / Bono",
        legendNew: "25% Descuento / Bono",
      },
      {
        service: "Grandes Expediciones / Rallies (4+ días)",
        registeredUser: "$2.750.000 - $6.500.000 COP",
        legendRenewal: "20% Descuento Preferencial",
        legendNew: "20% Descuento Preferencial",
      },
      {
        service: "Cursos Virtuales (Academia BSK)",
        registeredUser: "$120.000 - $330.000 COP",
        legendRenewal: "100% Incluidos ($0 COP)",
        legendNew: "100% Incluidos ($0 COP)",
      },
      {
        service: "Clínicas Prácticas y Pista (Presencial)",
        registeredUser: "$550.000 - $1.950.000 COP",
        legendRenewal: "20% Descuento",
        legendNew: "20% Descuento",
      },
      {
        service: "Asistencia Vial Bogotá 24/7 (ARPHA)",
        registeredUser: "$55.000 - $195.000 COP (Por evento)",
        legendRenewal: "Incluida 24/7 ($0 COP)",
        legendNew: "Incluida 24/7 ($0 COP)",
      },
      {
        service: "Tienda Oficial BSK (Merchandising)",
        registeredUser: "Precio de Lista (PVP)",
        legendRenewal: "15% Descuento Permanente",
        legendNew: "15% Descuento Permanente",
      },
      {
        service: "Gala Anual BSK",
        registeredUser: "$280.000 COP (Ticket individual)",
        legendRenewal: "1 Entrada VIP Incluida",
        legendNew: "1 Entrada VIP Incluida",
      },
    ],
  },
};

@Injectable()
export class SystemPricingConfigService {
  private readonly logger = new Logger(SystemPricingConfigService.name);
  private cachedConfig: SystemPricingConfig | null = null;
  private cacheExpiresAt = 0;
  private readonly CACHE_TTL_MS = 60_000; // 60 segundos

  constructor(
    @InjectModel(SystemPricingConfig.name)
    private readonly configModel: Model<SystemPricingConfigDocument>,
  ) {}

  /**
   * Obtiene la configuración activa de precios y campaña.
   * Utiliza una caché en memoria de 60 segundos para evitar saturar MongoDB en endpoints de alto tráfico.
   */
  async getConfig(seasonYear?: number): Promise<SystemPricingConfig> {
    const now = Date.now();
    if (this.cachedConfig && this.cacheExpiresAt > now && !seasonYear) {
      return this.cachedConfig;
    }

    try {
      const query = seasonYear ? { seasonYear } : { isCurrentSeason: true };
      let doc = await this.configModel.findOne(query).lean().exec();

      if (!doc && !seasonYear) {
        // Fallback al registro más reciente o inicializar con defaults
        doc = await this.configModel
          .findOne()
          .sort({ seasonYear: -1 })
          .lean()
          .exec();
      }

      if (!doc) {
        // No hay configuración en BD aún: sembrar los valores predeterminados
        this.logger.log(
          "Inicializando configuración predeterminada de tarifas en base de datos...",
        );
        const created = await this.configModel.create({
          ...DEFAULT_PRICING_CONFIG,
        });
        doc = created.toObject();
      }

      if (!seasonYear) {
        this.cachedConfig = doc as SystemPricingConfig;
        this.cacheExpiresAt = now + this.CACHE_TTL_MS;
      }

      return doc as SystemPricingConfig;
    } catch (err) {
      this.logger.error("Error al consultar SystemPricingConfig de BD", err);
      // Fallback seguro: retornar siempre la constante de defaults para evitar errores 500
      return DEFAULT_PRICING_CONFIG as SystemPricingConfig;
    }
  }

  /**
   * Actualiza atómicamente la configuración de tarifas para la temporada especificada.
   * Exclusivo para administradores.
   */
  async updateConfig(
    dto: UpdateSystemPricingConfigDto,
    adminUserId: string,
  ): Promise<SystemPricingConfig> {
    const isCurrent = dto.isCurrentSeason !== false;

    if (isCurrent) {
      // Desmarcar cualquier otra temporada como actual
      await this.configModel.updateMany(
        { seasonYear: { $ne: dto.seasonYear } },
        { isCurrentSeason: false },
      );
    }

    const updated = await this.configModel
      .findOneAndUpdate(
        { seasonYear: dto.seasonYear },
        {
          $set: {
            ...dto,
            isCurrentSeason: isCurrent,
            updatedBy: adminUserId,
          },
        },
        { upsert: true, new: true, lean: true },
      )
      .exec();

    this.logger.log(
      `Tarifario actualizado por admin ${adminUserId} para la temporada ${dto.seasonYear}`,
    );

    // Invalidar inmediatamente la caché
    this.cachedConfig = updated as SystemPricingConfig;
    this.cacheExpiresAt = Date.now() + this.CACHE_TTL_MS;

    return updated as SystemPricingConfig;
  }

  /**
   * Invalida manualmente la caché en memoria.
   */
  invalidateCache(): void {
    this.cachedConfig = null;
    this.cacheExpiresAt = 0;
  }
}
