import { ArrowDownRight, ArrowUpRight } from 'lucide-react';

interface Props {
  label: string;
  value: string;
  delta: number | null;
}

// KPI stat tile with % change vs the previous period. A null delta means
// there is no comparison period (all-time view or an empty previous period).
export default function KpiCard({ label, value, delta }: Props) {
  const positive = (delta ?? 0) >= 0;
  return (
    <div className="card p-5">
      <p className="text-xs font-medium uppercase tracking-wider text-text-muted">{label}</p>
      <p className="mt-2 text-2xl font-bold text-text">{value}</p>
      {delta === null ? (
        <p className="mt-1 text-xs text-text-muted">—</p>
      ) : (
        <p
          className={`mt-1 flex items-center gap-1 text-xs font-medium ${
            positive ? 'text-success' : 'text-error'
          }`}
        >
          {positive ? <ArrowUpRight className="h-3.5 w-3.5" /> : <ArrowDownRight className="h-3.5 w-3.5" />}
          {Math.abs(delta).toFixed(1)}% vs previous period
        </p>
      )}
    </div>
  );
}
