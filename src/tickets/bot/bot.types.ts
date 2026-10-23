export interface BotProcessResult {
  replyText: string;
  nextState: string;
  escalatedToLiveAgent: boolean;
}

export interface BotEvaluationResult {
  text: string;
  nextState: string;
  escalate?: boolean;
}
