export class DigitalOperationsError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "DigitalOperationsError";
  }
}

export function requirePositiveId(value: unknown, label: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new DigitalOperationsError(400, "INVALID_ID", `${label} is invalid.`);
  }
  return parsed;
}
