export async function register() {
  // Validates required env vars at server startup; throws a clear message if any are missing.
  await import("./lib/env");
}
