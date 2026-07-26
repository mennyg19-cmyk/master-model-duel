import { env } from '@/lib/env';

/** Only mounts Clerk's React context when Clerk is the configured provider. */
export async function AuthProvider({ children }: { children: React.ReactNode }) {
  if (env.AUTH_PROVIDER !== 'clerk') return <>{children}</>;

  const { ClerkProvider } = await import('@clerk/nextjs');
  return <ClerkProvider>{children}</ClerkProvider>;
}
