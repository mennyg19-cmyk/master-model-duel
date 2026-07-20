import { randomBytes } from "node:crypto";

export function createSecureToken() {
  return randomBytes(32).toString("base64url");
}

export function createRequestId() {
  return randomBytes(12).toString("hex");
}
