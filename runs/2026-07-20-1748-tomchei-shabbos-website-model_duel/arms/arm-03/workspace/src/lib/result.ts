export type Result<T, E = string> =
  | { ok: true; value: T }
  | { ok: false; error: E; publicMessage: string };

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

export function err<E = string>(
  error: E,
  publicMessage = "Something went wrong. Please try again.",
): Result<never, E> {
  return { ok: false, error, publicMessage };
}

export function maskError(error: unknown): string {
  if (process.env.NODE_ENV === "production") {
    return "Something went wrong. Please try again.";
  }
  if (error instanceof Error) return error.message;
  return String(error);
}
