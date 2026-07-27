// Inline SVG route map (R-074, G-023). Server-rendered from stop coordinates —
// no map-tile provider needed in dev; swap for Mapbox GL when a token exists.

export type MapPoint = {
  latitude: number;
  longitude: number;
  label: string;
  kind: "stop" | "delivered" | "suggestion";
};

export function RouteMap({ points }: { points: MapPoint[] }) {
  const placed = points.filter((point) => Number.isFinite(point.latitude) && Number.isFinite(point.longitude));
  if (placed.length === 0) {
    return <p className="text-sm text-muted">No geocoded stops to map yet.</p>;
  }

  const lats = placed.map((point) => point.latitude);
  const lngs = placed.map((point) => point.longitude);
  const pad = 0.002;
  const minLat = Math.min(...lats) - pad;
  const maxLat = Math.max(...lats) + pad;
  const minLng = Math.min(...lngs) - pad;
  const maxLng = Math.max(...lngs) + pad;
  const width = 640;
  const height = 360;
  const x = (lng: number) => ((lng - minLng) / (maxLng - minLng || 1)) * (width - 40) + 20;
  const y = (lat: number) => height - (((lat - minLat) / (maxLat - minLat || 1)) * (height - 40) + 20);

  const stops = placed.filter((point) => point.kind !== "suggestion");
  const color = { stop: "#7c3aed", delivered: "#16a34a", suggestion: "#ea580c" } as const;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full rounded-md border border-border bg-surface" role="img" aria-label="Route map">
      {stops.length > 1 && (
        <polyline
          points={stops.map((point) => `${x(point.longitude)},${y(point.latitude)}`).join(" ")}
          fill="none"
          stroke="#c4b5fd"
          strokeWidth={2}
          strokeDasharray="6 4"
        />
      )}
      {placed.map((point, index) => (
        <g key={index}>
          <circle cx={x(point.longitude)} cy={y(point.latitude)} r={point.kind === "suggestion" ? 7 : 9} fill={color[point.kind]} />
          <text x={x(point.longitude)} y={y(point.latitude) + 3.5} textAnchor="middle" fontSize={9} fill="white">
            {point.label}
          </text>
        </g>
      ))}
    </svg>
  );
}
