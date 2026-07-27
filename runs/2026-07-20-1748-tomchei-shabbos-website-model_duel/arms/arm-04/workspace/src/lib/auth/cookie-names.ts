/** Shared by middleware (edge) and server code, so this file stays dependency-free. */
export const SESSION_COOKIE = 'tsm_session';
export const IMPERSONATION_COOKIE = 'tsm_impersonation';

/** Holds a guest's draft access token (R-023). Not a session: nobody is signed in. */
export const GUEST_DRAFT_COOKIE = 'tsm_guest_draft';

/** Remembers that a driver already answered this link's PIN (UR-015). */
export const DRIVER_LINK_COOKIE = 'tsm_driver_link';
