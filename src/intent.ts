const CASUAL_PATTERNS = [
  /^(hi|hey|hello|hiya|yo|sup)[!.?]*$/i,
  /^(thanks|thank you|cheers)[!.?]*$/i,
  /^(good morning|good afternoon|good evening)[!.?]*$/i,
  /^(how are you|how's it going|what can you do)[!.?]*$/i
];

/** Return true only when a message is clearly an engineering request. */
export function isEngineeringRequest(message: string): boolean {
  const text = message.trim();
  if (!text) return false;
  if (CASUAL_PATTERNS.some(pattern => pattern.test(text))) return false;
  return true;
}
