/**
 * One error shape for the whole project. Server code keeps the full cause for
 * logs; `publicMessage` is the only text that may reach a browser, so internal
 * details cannot leak through an error response in production.
 */

export type Ok<T> = { ok: true; value: T };
export type Failure = { ok: false; code: string; publicMessage: string; cause?: unknown };
export type Result<T> = Ok<T> | Failure;

export function ok<T>(value: T): Ok<T> {
  return { ok: true, value };
}

export function failure(code: string, publicMessage: string, cause?: unknown): Failure {
  return { ok: false, code, publicMessage, cause };
}
