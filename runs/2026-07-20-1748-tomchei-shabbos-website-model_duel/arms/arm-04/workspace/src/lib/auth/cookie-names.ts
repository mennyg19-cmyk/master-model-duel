/** Shared by middleware (edge) and server code, so this file stays dependency-free. */
export const SESSION_COOKIE = 'tsm_session';
export const IMPERSONATION_COOKIE = 'tsm_impersonation';

/** Holds a guest's draft access token (R-023). Not a session: nobody is signed in. */
export const GUEST_DRAFT_COOKIE = 'tsm_guest_draft';
