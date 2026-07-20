import { clerkMiddleware } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { isClerkConfigured } from "@/lib/env";

const clerkProxy = clerkMiddleware();

export default isClerkConfigured()
  ? clerkProxy
  : function localDevelopmentProxy() {
      return NextResponse.next();
    };

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|png|gif|svg|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
