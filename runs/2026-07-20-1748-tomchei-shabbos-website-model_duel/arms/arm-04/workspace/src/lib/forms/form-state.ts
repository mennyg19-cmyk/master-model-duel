/**
 * What a single-form page hands back to `useActionState`: what went wrong, or
 * what just happened. The account screens and the staff customer screen are one
 * form each and both report this way. Only the builder — a dozen forms on one
 * page — redirects with the outcome in the query string instead.
 *
 * It lives here rather than beside either set of actions because a `'use server'`
 * module may only export async functions, and because two copies of the same
 * shape drift.
 */
export type FormState = { error: string | null; notice: string | null };

export const EMPTY_FORM_STATE: FormState = { error: null, notice: null };
