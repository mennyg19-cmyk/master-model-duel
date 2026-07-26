/**
 * Failure codes the staff form actions can hand back through a redirect.
 *
 * The actions pass a code rather than the service's `publicMessage`, so nothing
 * a caller puts in the URL is ever rendered as our own copy. Anything the map
 * does not know about falls back to the generic line.
 */
const STAFF_ACTION_ERRORS: Record<string, string> = {
  stale_version: 'Someone else changed this staff member while you were editing. Reload and try again.',
  staff_not_found: 'That staff member no longer exists.',
  self_target_blocked: 'You cannot change your own role, status or permissions. Ask another manager.',
  unknown_permission: 'That is not a permission this app defines.',
};

const GENERIC_STAFF_ACTION_ERROR =
  'That change did not go through because the form sent a value this app does not accept. Reload and try again.';

export function staffActionError(code: string | undefined): string | null {
  if (!code) return null;
  return STAFF_ACTION_ERRORS[code] ?? GENERIC_STAFF_ACTION_ERROR;
}
