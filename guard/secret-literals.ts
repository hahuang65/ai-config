// Shared high-confidence credential formats; placeholder strings do not match.
const PATTERNS: RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{20,}/,
  /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/,
  /\bgh[pousra]_[A-Za-z0-9]{30,}/,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/,
  /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----/,
];

export const containsSecretLiteral = (text: string): boolean => PATTERNS.some(pattern => pattern.test(text));
