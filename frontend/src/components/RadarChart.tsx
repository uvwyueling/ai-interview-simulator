type RadarDim = {
  key: string;
  value: number;
};

type Props = {
  dims: RadarDim[];
  centerScore?: number;
  isLoading?: boolean;
};

function RadarSkeleton() {
  return (
    <div className="w-full max-w-[400px] mx-auto flex flex-col items-center gap-4">
      <div className="w-64 h-64 rounded-full bg-slate-200 animate-pulse" />
      <div className="grid grid-cols-5 gap-3 w-full">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="flex flex-col items-center gap-1">
            <div className="h-3 w-10 bg-slate-200 rounded animate-pulse" />
            <div className="h-4 w-6 bg-slate-200 rounded animate-pulse" />
          </div>
        ))}
      </div>
    </div>
  );
}

export default function RadarChart({
  dims,
  centerScore,
  isLoading = false,
}: Props) {
  if (isLoading) return <RadarSkeleton />;

  const size = 360;
  const cx = size / 2;
  const cy = size / 2;
  const radius = 120;
  const n = dims.length;

  const point = (angle: number, r: number): [number, number] => {
    const a = angle - Math.PI / 2;
    return [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
  };

  const levels = [0.25, 0.5, 0.75, 1];
  const angles = dims.map((_, i) => (i / n) * Math.PI * 2);
  const polygonAt = (r: number) =>
    angles.map((a) => point(a, r).join(",")).join(" ");
  const valuePolygon = dims
    .map((d, i) => point(angles[i], (radius * d.value) / 100).join(","))
    .join(" ");

  return (
    <svg viewBox={`0 0 ${size} ${size}`} className="w-full max-w-[400px]">
      {/* Grid rings */}
      {levels.map((l, i) => (
        <polygon
          key={i}
          points={polygonAt(radius * l)}
          fill="none"
          stroke="#e2e8f0"
          strokeWidth={i === levels.length - 1 ? 1.2 : 0.8}
          strokeDasharray={i === levels.length - 1 ? "" : "3 4"}
        />
      ))}

      {/* Spokes */}
      {angles.map((a, i) => {
        const [x, y] = point(a, radius);
        return (
          <line
            key={i}
            x1={cx}
            y1={cy}
            x2={x}
            y2={y}
            stroke="#e2e8f0"
            strokeWidth="0.8"
          />
        );
      })}

      {/* Value polygon — Indigo, 30% fill */}
      <polygon
        points={valuePolygon}
        fill="rgba(99,102,241,0.3)"
        stroke="#4f46e5"
        strokeWidth="2"
        strokeLinejoin="round"
        className="radar-shape"
      />

      {/* Value dots */}
      {dims.map((d, i) => {
        const [x, y] = point(angles[i], (radius * d.value) / 100);
        return (
          <circle
            key={i}
            cx={x}
            cy={y}
            r="4"
            fill="white"
            stroke="#4f46e5"
            strokeWidth="2"
          />
        );
      })}

      {/* Labels */}
      {dims.map((d, i) => {
        const [x, y] = point(angles[i], radius + 30);
        return (
          <g key={i}>
            <text
              x={x}
              y={y - 4}
              textAnchor="middle"
              fill="#334155"
              style={{ fontSize: 12, fontWeight: 500 }}
            >
              {d.key}
            </text>
            <text
              x={x}
              y={y + 11}
              textAnchor="middle"
              fill="#4f46e5"
              style={{ fontSize: 11, fontFamily: "monospace", fontWeight: 600 }}
            >
              {d.value}
            </text>
          </g>
        );
      })}

      {/* Center score */}
      {centerScore !== undefined && (
        <>
          <circle cx={cx} cy={cy} r="32" fill="white" fillOpacity="0.92" />
          <text
            x={cx}
            y={cy - 4}
            textAnchor="middle"
            fill="#4f46e5"
            style={{ fontSize: 26, fontWeight: 700 }}
          >
            {centerScore}
          </text>
          <text
            x={cx}
            y={cy + 14}
            textAnchor="middle"
            fill="#94a3b8"
            style={{ fontSize: 11 }}
          >
            总分
          </text>
        </>
      )}
    </svg>
  );
}
