import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { AuthError } from "@/lib/auth";
import { maskError } from "@/lib/result";

/** Single API error response path — Auth/Zod pass through; internals masked. */
export function apiErrorResponse(error: unknown): NextResponse {
  if (error instanceof AuthError) {
    return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
  }
  if (error instanceof ZodError) {
    return NextResponse.json({ ok: false, error: error.flatten() }, { status: 400 });
  }
  return NextResponse.json({ ok: false, error: maskError(error) }, { status: 500 });
}
