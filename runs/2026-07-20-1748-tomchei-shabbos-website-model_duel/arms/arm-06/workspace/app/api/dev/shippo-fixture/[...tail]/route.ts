// The fixture lives under subpaths (/shipments, /transactions, /tracks/...) —
// a catch-all segment is required or Next routing 404s everything below the
// bare route. Handlers stay in ../route; this segment just re-exports them.
export { GET, POST } from "../route";
