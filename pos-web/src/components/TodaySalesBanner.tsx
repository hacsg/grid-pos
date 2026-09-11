import { useQuery } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { formatCurrency, getTodayMetrics } from '@/api/client';
import { formatSgtTime } from '@/utils/datetime';
import { tapFeedback } from '@/utils/haptics';

interface TodaySalesBannerProps {
  outletId: string;
}

export const TODAY_SALES_QUERY_KEY = 'today-metrics';

function percent(value: number | undefined): string {
  return value === undefined ? '—' : `${Math.round(value)}%`;
}

/**
 * Headline figures for the current SGT business day at this outlet: net
 * sales, average ticket, waffle/drink attachment and pints sold. Refreshes
 * on its own so a till left on this tab stays current between sales.
 */
export default function TodaySalesBanner({ outletId }: TodaySalesBannerProps) {
  const query = useQuery({
    queryKey: [TODAY_SALES_QUERY_KEY, outletId],
    queryFn: () => getTodayMetrics(outletId),
    // Always re-read on mount: staff usually land here right after a sale, and
    // the app-wide 5 min staleTime would show a figure that misses it.
    staleTime: 0,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });

  const metrics = query.data;
  const updatedAt = query.dataUpdatedAt ? formatSgtTime(new Date(query.dataUpdatedAt).toISOString()) : null;

  function handleRefresh() {
    tapFeedback();
    void query.refetch();
  }

  let meta: string;
  if (query.isLoading) {
    meta = 'Loading…';
  } else if (query.isError || !metrics) {
    meta = "Could not load today's figures";
  } else {
    meta = `${metrics.order_count} ${metrics.order_count === 1 ? 'order' : 'orders'}`;
  }

  return (
    <section className="today-sales-banner" aria-label="Today's sales">
      <div className="today-sales-headline">
        <span className="today-sales-label">Today's sales</span>
        <strong className="today-sales-total">{metrics ? formatCurrency(metrics.net_sales) : '—'}</strong>
        <span className="today-sales-meta">{meta}</span>
      </div>

      <dl className="today-sales-breakdown">
        <div>
          <dt>Avg ticket</dt>
          <dd>{metrics ? formatCurrency(metrics.average_ticket) : '—'}</dd>
        </div>
        <div>
          <dt>Waffle attach</dt>
          <dd>{percent(metrics?.waffle_attach_rate)}</dd>
        </div>
        <div>
          <dt>Drink attach</dt>
          <dd>{percent(metrics?.drink_attach_rate)}</dd>
        </div>
        <div>
          <dt>Pints sold</dt>
          <dd>{metrics ? metrics.pints_sold : '—'}</dd>
        </div>
      </dl>

      <button
        className="today-sales-refresh"
        type="button"
        disabled={query.isFetching}
        onClick={handleRefresh}
        aria-label="Refresh today's sales"
      >
        <RefreshCw size={16} className={query.isFetching ? 'spin' : ''} aria-hidden="true" />
        {updatedAt ? <span>Updated {updatedAt}</span> : <span>Refresh</span>}
      </button>
    </section>
  );
}
