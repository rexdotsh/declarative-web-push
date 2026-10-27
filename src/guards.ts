export function isUnsigned(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}
