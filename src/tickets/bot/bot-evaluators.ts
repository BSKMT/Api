import { BotEvaluationResult } from "./bot.types";
import {
  evaluateMainMenu,
  evaluateMembershipMenu,
  evaluateEventsMenu,
  evaluateAcademyMenu,
} from "./bot-evaluators-core";
import {
  evaluateArphaMenu,
  evaluateShopMenu,
  evaluateAccountMenu,
  evaluateFaqMenu,
} from "./bot-evaluators-services";
import { handleNaturalLanguageIntent } from "./bot-intent.helper";

export function evaluateBotResponse(
  state: string,
  normalized: string,
  rawText: string,
): BotEvaluationResult {
  switch (state) {
    case "MAIN":
    case "":
      return evaluateMainMenu(normalized, rawText);
    case "MEMBERSHIP":
      return evaluateMembershipMenu(normalized, rawText);
    case "EVENTS":
      return evaluateEventsMenu(normalized, rawText);
    case "ACADEMY":
      return evaluateAcademyMenu(normalized, rawText);
    case "ARPHA":
      return evaluateArphaMenu(normalized, rawText);
    case "SHOP":
      return evaluateShopMenu(normalized, rawText);
    case "ACCOUNT":
      return evaluateAccountMenu(normalized, rawText);
    case "FAQ":
      return evaluateFaqMenu(normalized, rawText);
    default:
      return handleNaturalLanguageIntent(normalized, rawText);
  }
}

export {
  evaluateMainMenu,
  evaluateMembershipMenu,
  evaluateEventsMenu,
  evaluateAcademyMenu,
  evaluateArphaMenu,
  evaluateShopMenu,
  evaluateAccountMenu,
  evaluateFaqMenu,
  handleNaturalLanguageIntent,
};
