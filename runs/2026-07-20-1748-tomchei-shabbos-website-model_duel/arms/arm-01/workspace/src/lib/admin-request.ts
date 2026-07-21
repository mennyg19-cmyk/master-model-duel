import { NextResponse } from "next/server";

export class AdminCsrfError extends Error {
  constructor(message = "This admin request must come from the same site.") {
    super(message);
    this.name = "AdminCsrfError";
  }
}

export function requireSameOriginAdminRequest(request: Request) {
  const source = request.headers.get("origin") ?? request.headers.get("referer");
  if (!source) throw new AdminCsrfError();

  let sourceOrigin: string;
  try {
    sourceOrigin = new URL(source).origin;
  } catch {
    throw new AdminCsrfError();
  }

  if (sourceOrigin !== new URL(request.url).origin) {
    throw new AdminCsrfError();
  }
}

export function adminRequestErrorResponse(error: unknown) {
  if (error instanceof AdminCsrfError) {
    return NextResponse.json({ error: error.message }, { status: 403 });
  }
  throw error;
}
