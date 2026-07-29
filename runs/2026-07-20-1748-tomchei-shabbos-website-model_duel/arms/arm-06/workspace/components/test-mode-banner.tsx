import { env } from "@/lib/env";

// R-014/R-103: the test-mode banner. Any screen on the test deployment
// declares itself — disposable data is never mistaken for live. When the
// live URL is configured, the banner doubles as the env switch back.
export function TestModeBanner() {
  if (env.APP_ENV !== "test") return null;
  return (
    <p
      className="bg-fuchsia-700 px-4 py-1.5 text-center text-sm font-semibold text-white"
      role="status"
      data-test-mode-banner
    >
      TEST ENVIRONMENT — data here is disposable and resets without warning.
      {env.LIVE_BASE_URL && (
        <>
          {" "}
          <a href={env.LIVE_BASE_URL} className="underline" data-env-switch>
            Go to live ↗
          </a>
        </>
      )}
    </p>
  );
}

// R-103: the reverse switch — on the live deployment, a quiet link to the
// test deployment in the admin header (rendered only when configured).
export function TestEnvSwitch() {
  if (env.APP_ENV === "test" || !env.TEST_BASE_URL) return null;
  return (
    <a href={`${env.TEST_BASE_URL}/admin`} className="rounded-md border border-brand-600 px-2.5 py-1 hover:bg-brand-700" data-env-switch-test>
      Test env ↗
    </a>
  );
}
