import { BotEvaluationResult } from "./bot.types";
import {
  getMembershipMenuText,
  getMembershipBenefitsText,
  getMembershipPricesText,
  getMembershipKitText,
  getMembershipOnlineText,
  getMembershipRequirementsText,
} from "./bot-texts-membership";
import {
  getEventsMenuText,
  getUpcomingEventText,
  getMeetingPointsText,
  getEventRequirementsText,
  getEventTypesText,
  getEventSecurityText,
} from "./bot-texts-events";
import {
  getAcademyMenuText,
  getAcademyPreventiveText,
  getAcademyCurvesText,
  getAcademyMechanicsText,
  getAcademyPricingText,
  getAcademyEnrollmentText,
} from "./bot-texts-academy";
import { getArphaMenuText } from "./bot-texts-arpha";
import { getShopMenuText } from "./bot-texts-shop";
import { getAccountMenuText } from "./bot-texts-account";
import { getFaqMenuText } from "./bot-texts-faq";
import { handleNaturalLanguageIntent } from "./bot-intent.helper";

export function evaluateMainMenu(
  normalized: string,
  rawText: string,
): BotEvaluationResult {
  switch (normalized) {
    case "1":
    case "membresia":
    case "membresias":
      return { text: getMembershipMenuText(), nextState: "MEMBERSHIP" };
    case "2":
    case "rodada":
    case "rodadas":
    case "calendario":
    case "evento":
    case "eventos":
      return { text: getEventsMenuText(), nextState: "EVENTS" };
    case "3":
    case "academia":
    case "curso":
    case "cursos":
    case "aprender":
      return { text: getAcademyMenuText(), nextState: "ACADEMY" };
    case "4":
    case "arpha":
    case "grua":
    case "auxilio":
    case "emergencia":
    case "asistencia":
      return { text: getArphaMenuText(), nextState: "ARPHA" };
    case "5":
    case "tienda":
    case "chaqueta":
    case "impermeable":
    case "merch":
    case "comprar":
      return { text: getShopMenuText(), nextState: "SHOP" };
    case "6":
    case "tramite":
    case "tramites":
    case "carnet":
    case "cuenta":
      return { text: getAccountMenuText(), nextState: "ACCOUNT" };
    case "7":
    case "faq":
    case "sede":
    case "horario":
    case "pregunta":
    case "preguntas":
      return { text: getFaqMenuText(), nextState: "FAQ" };
    default:
      return handleNaturalLanguageIntent(normalized, rawText);
  }
}

export function evaluateMembershipMenu(
  normalized: string,
  rawText: string,
): BotEvaluationResult {
  if (
    normalized === "1" ||
    normalized === "1.1" ||
    normalized.includes("beneficio")
  ) {
    return { text: getMembershipBenefitsText(), nextState: "MEMBERSHIP" };
  }
  if (
    normalized === "2" ||
    normalized === "1.2" ||
    normalized.includes("precio") ||
    normalized.includes("costo") ||
    normalized.includes("plan")
  ) {
    return { text: getMembershipPricesText(), nextState: "MEMBERSHIP" };
  }
  if (
    normalized === "3" ||
    normalized === "1.3" ||
    normalized.includes("kit")
  ) {
    return { text: getMembershipKitText(), nextState: "MEMBERSHIP" };
  }
  if (
    normalized === "4" ||
    normalized === "1.4" ||
    normalized.includes("afiliar") ||
    normalized.includes("inscribir") ||
    normalized.includes("link")
  ) {
    return { text: getMembershipOnlineText(), nextState: "MEMBERSHIP" };
  }
  if (
    normalized === "5" ||
    normalized === "1.5" ||
    normalized.includes("requisito")
  ) {
    return { text: getMembershipRequirementsText(), nextState: "MEMBERSHIP" };
  }
  return handleNaturalLanguageIntent(normalized, rawText);
}

export function evaluateEventsMenu(
  normalized: string,
  rawText: string,
): BotEvaluationResult {
  if (
    normalized === "1" ||
    normalized === "2.1" ||
    normalized.includes("proxima") ||
    normalized.includes("fecha")
  ) {
    return { text: getUpcomingEventText(), nextState: "EVENTS" };
  }
  if (
    normalized === "2" ||
    normalized === "2.2" ||
    normalized.includes("punto") ||
    normalized.includes("salida") ||
    normalized.includes("encuentro")
  ) {
    return { text: getMeetingPointsText(), nextState: "EVENTS" };
  }
  if (
    normalized === "3" ||
    normalized === "2.3" ||
    normalized.includes("requisito") ||
    normalized.includes("checklist")
  ) {
    return { text: getEventRequirementsText(), nextState: "EVENTS" };
  }
  if (
    normalized === "4" ||
    normalized === "2.4" ||
    normalized.includes("abierta") ||
    normalized.includes("privada")
  ) {
    return { text: getEventTypesText(), nextState: "EVENTS" };
  }
  if (
    normalized === "5" ||
    normalized === "2.5" ||
    normalized.includes("seguridad") ||
    normalized.includes("capitan")
  ) {
    return { text: getEventSecurityText(), nextState: "EVENTS" };
  }
  return handleNaturalLanguageIntent(normalized, rawText);
}

export function evaluateAcademyMenu(
  normalized: string,
  rawText: string,
): BotEvaluationResult {
  if (
    normalized === "1" ||
    normalized === "3.1" ||
    normalized.includes("frenado") ||
    normalized.includes("preventiva")
  ) {
    return { text: getAcademyPreventiveText(), nextState: "ACADEMY" };
  }
  if (
    normalized === "2" ||
    normalized === "3.2" ||
    normalized.includes("curva") ||
    normalized.includes("inclinacion")
  ) {
    return { text: getAcademyCurvesText(), nextState: "ACADEMY" };
  }
  if (
    normalized === "3" ||
    normalized === "3.3" ||
    normalized.includes("mecanica") ||
    normalized.includes("despinche")
  ) {
    return { text: getAcademyMechanicsText(), nextState: "ACADEMY" };
  }
  if (
    normalized === "4" ||
    normalized === "3.4" ||
    normalized.includes("precio") ||
    normalized.includes("costo") ||
    normalized.includes("certificacion")
  ) {
    return { text: getAcademyPricingText(), nextState: "ACADEMY" };
  }
  if (
    normalized === "5" ||
    normalized === "3.5" ||
    normalized.includes("inscribir") ||
    normalized.includes("cupo")
  ) {
    return { text: getAcademyEnrollmentText(), nextState: "ACADEMY" };
  }
  return handleNaturalLanguageIntent(normalized, rawText);
}
