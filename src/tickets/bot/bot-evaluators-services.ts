import { BotEvaluationResult } from "./bot.types";
import {
  getArphaTowText,
  getArphaRoadsideText,
  getArphaEmergencyText,
  getArphaCoverageText,
} from "./bot-texts-arpha";
import {
  getShopJacketsText,
  getShopRainwearText,
  getShopApparelText,
  getShopShippingText,
  getShopCatalogText,
} from "./bot-texts-shop";
import {
  getAccountCarnetText,
  getAccountRenewText,
  getAccountGarageText,
  getAccountBillingText,
} from "./bot-texts-account";
import {
  getFaqHeadquartersText,
  getFaqBikesText,
  getFaqSocialText,
} from "./bot-texts-faq";
import { handleNaturalLanguageIntent } from "./bot-intent.helper";

export function evaluateArphaMenu(
  normalized: string,
  rawText: string,
): BotEvaluationResult {
  if (
    normalized === "1" ||
    normalized === "4.1" ||
    normalized.includes("grua") ||
    normalized.includes("plataforma")
  ) {
    return { text: getArphaTowText(), nextState: "ARPHA" };
  }
  if (
    normalized === "2" ||
    normalized === "4.2" ||
    normalized.includes("gasolina") ||
    normalized.includes("corriente") ||
    normalized.includes("despinche")
  ) {
    return { text: getArphaRoadsideText(), nextState: "ARPHA" };
  }
  if (
    normalized === "3" ||
    normalized === "4.3" ||
    normalized.includes("reportar") ||
    normalized.includes("emergencia") ||
    normalized.includes("varado")
  ) {
    return {
      text: getArphaEmergencyText(),
      nextState: "ARPHA",
      escalate: true,
    };
  }
  if (
    normalized === "4" ||
    normalized === "4.4" ||
    normalized.includes("cobertura") ||
    normalized.includes("ciudad")
  ) {
    return { text: getArphaCoverageText(), nextState: "ARPHA" };
  }
  return handleNaturalLanguageIntent(normalized, rawText);
}

export function evaluateShopMenu(
  normalized: string,
  rawText: string,
): BotEvaluationResult {
  if (
    normalized === "1" ||
    normalized === "5.1" ||
    normalized.includes("chaqueta")
  ) {
    return { text: getShopJacketsText(), nextState: "SHOP" };
  }
  if (
    normalized === "2" ||
    normalized === "5.2" ||
    normalized.includes("impermeable")
  ) {
    return { text: getShopRainwearText(), nextState: "SHOP" };
  }
  if (
    normalized === "3" ||
    normalized === "5.3" ||
    normalized.includes("jersey") ||
    normalized.includes("hoodie") ||
    normalized.includes("parche")
  ) {
    return { text: getShopApparelText(), nextState: "SHOP" };
  }
  if (
    normalized === "4" ||
    normalized === "5.4" ||
    normalized.includes("envio") ||
    normalized.includes("pago")
  ) {
    return { text: getShopShippingText(), nextState: "SHOP" };
  }
  if (
    normalized === "5" ||
    normalized === "5.5" ||
    normalized.includes("catalogo") ||
    normalized.includes("ver")
  ) {
    return { text: getShopCatalogText(), nextState: "SHOP" };
  }
  return handleNaturalLanguageIntent(normalized, rawText);
}

export function evaluateAccountMenu(
  normalized: string,
  rawText: string,
): BotEvaluationResult {
  if (
    normalized === "1" ||
    normalized === "6.1" ||
    normalized.includes("carnet") ||
    normalized.includes("qr")
  ) {
    return { text: getAccountCarnetText(), nextState: "ACCOUNT" };
  }
  if (
    normalized === "2" ||
    normalized === "6.2" ||
    normalized.includes("renovar")
  ) {
    return { text: getAccountRenewText(), nextState: "ACCOUNT" };
  }
  if (
    normalized === "3" ||
    normalized === "6.3" ||
    normalized.includes("moto") ||
    normalized.includes("actualizar") ||
    normalized.includes("garage")
  ) {
    return { text: getAccountGarageText(), nextState: "ACCOUNT" };
  }
  if (
    normalized === "4" ||
    normalized === "6.4" ||
    normalized.includes("factura") ||
    normalized.includes("certificado")
  ) {
    return { text: getAccountBillingText(), nextState: "ACCOUNT" };
  }
  return handleNaturalLanguageIntent(normalized, rawText);
}

export function evaluateFaqMenu(
  normalized: string,
  rawText: string,
): BotEvaluationResult {
  if (
    normalized === "1" ||
    normalized === "7.1" ||
    normalized.includes("sede") ||
    normalized.includes("horario") ||
    normalized.includes("donde")
  ) {
    return { text: getFaqHeadquartersText(), nextState: "FAQ" };
  }
  if (
    normalized === "2" ||
    normalized === "7.2" ||
    normalized.includes("cilindraje") ||
    normalized.includes("moto")
  ) {
    return { text: getFaqBikesText(), nextState: "FAQ" };
  }
  if (
    normalized === "3" ||
    normalized === "7.3" ||
    normalized.includes("red") ||
    normalized.includes("canal") ||
    normalized.includes("instagram")
  ) {
    return { text: getFaqSocialText(), nextState: "FAQ" };
  }
  return handleNaturalLanguageIntent(normalized, rawText);
}
