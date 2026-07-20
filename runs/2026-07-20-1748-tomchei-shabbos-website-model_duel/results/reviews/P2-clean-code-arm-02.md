# Reviewer specialist — Clean-code

**Run:** `2026-07-20-1748-tomchei-shabbos-website-model_duel`
**Arm:** `arm-02`
**Tree / phase:** `arms/arm-02/workspace/` — P2
**Rule scope:** `arms/arm-02/rules/clean-code.md` (clean-code is in arm rules — in scope)

Findings only. Severity: HIGH / MED / LOW.

---

## Finding 1 — Duplicated grouping logic (HIGH)

`lib/domain/finalize.ts:62-68` inlines a Map-based group-by-key loop:

```62:68:arms/arm-02/workspace/lib/domain/finalize.ts
  const byKey = new Map<string, LineForGrouping[]>();
  for (const line of lines) {
    const key = packageGroupingKey(line);
    const group = byKey.get(key);
    if (group) group.push(line);
    else byKey.set(key, [line]);
  }
```

This is a verbatim reimplementation of the exported `groupByPackageKey` helper in `lib/domain/grouping.ts:36-47`, which is already tested in `tests/grouping.test.ts` and which `finalize.ts` already imports from (it pulls `packageGroupingKey` from the same module on line 5). Rule of 2 is satisfied: two call sites for the pattern exist (the helper + this inline copy). Should be `const byKey = groupByPackageKey(lines);`.

**Category:** duplicated logic. **Rule:** "pull into `lib/` helpers", Rule of 2.

---

## Finding 2 — Swallowed error in empty catch (MED)

`app/error.tsx:23` ends the client-error report with `.catch(() => {})`:

```14:24:arms/arm-02/workspace/app/error.tsx
  useEffect(() => {
    // Redacted report: message + path only, no stack or user data (R-132).
    fetch("/api/client-error", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: error.digest ?? error.message.slice(0, 500),
        path: window.location.pathname,
      }),
    }).catch(() => {});
  }, [error]);
```

The empty arrow handler swallows every failure of the report POST. The preceding comment states intent (redacted telemetry) but the catch itself gives no signal when the report endpoint is down. Clean-code rule: "No swallowed errors (empty catch blocks)." At minimum the handler should be a named no-op with a comment, or log at debug level.

**Category:** error handling. **Rule:** "No swallowed errors (empty catch blocks)."

---

## Finding 3 — Defensive optional chaining for a condition that can't happen (LOW)

`app/(admin)/admin/page.tsx:17-18` reads `staff?.actingAs.name` / `staff?.actingAs.role`:

```13:18:arms/arm-02/workspace/app/(admin)/admin/page.tsx
  return (
    <div>
      <h1 className="text-2xl font-semibold mb-1">Dashboard</h1>
      <p className="text-sm text-muted mb-6">
        Signed in as {staff?.actingAs.name} ({staff?.actingAs.role}).
      </p>
```

The parent `app/(admin)/admin/layout.tsx:18` does `if (!staff) redirect("/login?next=/admin")`, so `staff` is guaranteed non-null by the time the page renders. The `?.` is defensive code for a condition that cannot happen. Either drop the chaining (`staff.actingAs.name`) or, if the page is meant to be safe standalone, gate explicitly.

**Category:** anti-AI-tics. **Rule:** "No defensive code for conditions that can't happen."

---

## Finding 4 — UI consistency: rogue raw `<button>` next to a shared `Button` (LOW)

`components/session-buttons.tsx:21-34` renders `LogoutButton` as a raw `<button>` with ad-hoc class strings, while `StopImpersonationButton` in the same file uses the shared `Button` component:

```21:34:arms/arm-02/workspace/components/session-buttons.tsx
export function LogoutButton() {
  const router = useRouter();
  return (
    <button
      className="text-xs text-muted hover:text-danger hover:underline"
      onClick={async () => {
        await fetch("/api/auth/logout", { method: "POST" });
        router.push("/login");
      }}
    >
      Sign out
    </button>
  );
}
```

Every other clickable surface in the app routes styling through `components/ui/button.tsx`. A "link-styled logout" is a real variant; encode it as a `Button` variant (or a dedicated `LinkButton`) instead of a one-off raw `<button>` with bespoke classes.

**Category:** duplicated UI / inconsistent patterns. **Rule:** "No rogue styling", "One styling approach per project."

---

## Finding 5 — Inline styles in `global-error.tsx` (LOW)

`app/global-error.tsx:6,9` uses `style={{...}}` inline styles:

```4:14:arms/arm-02/workspace/app/global-error.tsx
export default function GlobalError({ reset }: { error: Error; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "sans-serif", padding: "4rem", textAlign: "center" }}>
        <h1>Something went wrong</h1>
        <p>The page failed to load. Please try again.</p>
        <button onClick={reset} style={{ padding: "0.5rem 1rem", cursor: "pointer" }}>
          Try again
        </button>
      </body>
    </html>
  );
}
```

Every other surface uses Tailwind utility classes and the shared `Card`/`Button` components. Nuance: `global-error.tsx` replaces the root layout so it cannot rely on the app shell — but Tailwind utilities are still available at this level, so the inline styles are avoidable. Replace with utility classes to keep one styling approach.

**Category:** inline styles / UI consistency. **Rule:** "No rogue styling", "One styling approach per project."

---

## Finding 6 — Type/schema drift: hand-mapped client `StaffMember` shape (LOW)

`components/staff-manager.tsx:11-18` declares its own `StaffMember` type:

```11:18:arms/arm-02/workspace/components/staff-manager.tsx
type StaffMember = {
  id: string;
  name: string;
  email: string;
  role: "MANAGER" | "STAFF" | "DRIVER";
  status: "ACTIVE" | "REVOKED";
  overrides: { permission: string; effect: "GRANT" | "DENY" }[];
};
```

`app/(admin)/admin/staff/page.tsx:18-28` hand-maps Prisma rows into this shape, and `app/api/staff/route.ts` returns Prisma objects directly with no shared DTO. Three places own a piece of the "staff over the wire" shape; they can drift silently (e.g. a new `StaffRole` enum value updates in Prisma but not in this string-literal union). Centralize a `StaffView` type in `lib/` derived from the Prisma payload, and have both the API route and the page project into it.

**Category:** type/schema drift. **Rule:** "Centralize types, single source of truth."

---

## Summary

| # | Severity | Category | Location |
|---|----------|----------|----------|
| 1 | HIGH | Duplicated logic | `lib/domain/finalize.ts:62-68` |
| 2 | MED | Swallowed error | `app/error.tsx:23` |
| 3 | LOW | Defensive code | `app/(admin)/admin/page.tsx:17-18` |
| 4 | LOW | UI consistency | `components/session-buttons.tsx:21-34` |
| 5 | LOW | Inline styles | `app/global-error.tsx:6,9` |
| 6 | LOW | Type/schema drift | `components/staff-manager.tsx:11-18` |

**Finding count: 6** (1 HIGH, 1 MED, 4 LOW).
