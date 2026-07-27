import { verifyRegistrationToken } from "@/lib/auth/registration-token";
import { VerifyEmailForm } from "@/components/account/verify-email-form";

// Landing page for the emailed registration-confirmation link (SR-01). Lives
// outside /account because that layout redirects sessionless visitors away.
export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  const email = token ? verifyRegistrationToken(token) : null;

  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col items-center px-6 py-16">
      <h1 className="text-2xl font-semibold">Finish creating your account</h1>
      {!email || !token ? (
        <p className="mt-4 text-muted" data-testid="token-invalid">
          This confirmation link is invalid or has expired. Create your account again from the
          sign-in page to get a fresh one.
        </p>
      ) : (
        <>
          <p className="mt-2 text-sm text-muted">Choose a password for {email}</p>
          <div className="mt-6 w-full max-w-sm">
            <VerifyEmailForm token={token} />
          </div>
        </>
      )}
    </main>
  );
}
