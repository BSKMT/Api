import { BotEvaluationResult } from "./bot.types";
import { getMembershipMenuText } from "./bot-texts-membership";
import { getEventsMenuText } from "./bot-texts-events";
import { getAcademyMenuText } from "./bot-texts-academy";
import { getArphaMenuText } from "./bot-texts-arpha";
import { getShopMenuText } from "./bot-texts-shop";
import { getAccountMenuText } from "./bot-texts-account";
import { getFaqHeadquartersText } from "./bot-texts-faq";
import { getDefaultFallbackText } from "./bot-texts-main";

export function handleNaturalLanguageIntent(
  normalized: string,
  _rawText: string,
): BotEvaluationResult {
  if (
    normalized.includes("afili") ||
    normalized.includes("membresia") ||
    normalized.includes("cuanto cuesta unirme") ||
    normalized.includes("precio de unirme")
  ) {
    return { text: getMembershipMenuText(), nextState: "MEMBERSHIP" };
  }

  if (
    normalized.includes("rodada") ||
    normalized.includes("calendario") ||
    normalized.includes("ruta") ||
    normalized.includes("salida")
  ) {
    return { text: getEventsMenuText(), nextState: "EVENTS" };
  }

  if (
    normalized.includes("curso") ||
    normalized.includes("clase") ||
    normalized.includes("academia") ||
    normalized.includes("freno") ||
    normalized.includes("aprender a manejar")
  ) {
    return { text: getAcademyMenuText(), nextState: "ACADEMY" };
  }

  if (
    normalized.includes("grua") ||
    normalized.includes("varado") ||
    normalized.includes("varada") ||
    normalized.includes("auxilio") ||
    normalized.includes("despinche") ||
    normalized.includes("arpha")
  ) {
    return { text: getArphaMenuText(), nextState: "ARPHA" };
  }

  if (
    normalized.includes("tienda") ||
    normalized.includes("chaqueta") ||
    normalized.includes("impermeable") ||
    normalized.includes("comprar") ||
    normalized.includes("producto")
  ) {
    return { text: getShopMenuText(), nextState: "SHOP" };
  }

  if (
    normalized.includes("carnet") ||
    normalized.includes("qr") ||
    normalized.includes("mi cuenta") ||
    normalized.includes("renovacion")
  ) {
    return { text: getAccountMenuText(), nextState: "ACCOUNT" };
  }

  if (
    normalized.includes("sede") ||
    normalized.includes("horario") ||
    normalized.includes("donde queda") ||
    normalized.includes("direccion")
  ) {
    return { text: getFaqHeadquartersText(), nextState: "FAQ" };
  }

  return { text: getDefaultFallbackText(), nextState: "MAIN" };
}
