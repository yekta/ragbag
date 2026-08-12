// Timestamps cross the Zero sync boundary as epoch milliseconds (numbers).
export function nowMs(): number {
  return Date.now();
}
