/**
 * Where routes and the driver's link live. Built in one place for the same
 * reason the print paths are: four screens and the smoke run ask for the same
 * URLs, and a driver link typed out twice is a link that works on one of them.
 */
export const ROUTES_PATH = '/admin/routes';
export const PICKUP_PATH = '/admin/pickup';
export const FOLLOW_UP_PATH = '/admin/follow-up';

export const ROUTE_ARTIFACTS = ['sheet', 'cards'] as const;
export type RouteArtifact = (typeof ROUTE_ARTIFACTS)[number];

export function isRouteArtifact(value: string): value is RouteArtifact {
  return (ROUTE_ARTIFACTS as readonly string[]).includes(value);
}

export function routePath(routeId: string): string {
  return `${ROUTES_PATH}/${routeId}`;
}

export function routeArtifactPath(routeId: string, artifact: RouteArtifact): string {
  return `${routePath(routeId)}/print/${artifact}`;
}

/** The driver's own URL. Not under `/admin`: it is reached without a staff session. */
export function driverRoutePath(token: string): string {
  return `/drive/${token}`;
}

export function pickupDoorListPath(): string {
  return `${PICKUP_PATH}/door-list`;
}
