import React from 'react';

interface Column<T> {
  key: string;
  header: string;
  render?: (item: T) => React.ReactNode;
  sortable?: boolean;
  width?: string;
}

interface TableProps<T> {
  columns: Column<T>[];
  data: T[];
  onRowClick?: (item: T) => void;
  loading?: boolean;
  emptyMessage?: string;
  selectedIds?: string[];
  onSelect?: (id: string) => void;
  onSelectAll?: () => void;
  selectable?: boolean;
}

export default function Table<T extends { id: string }>({
  columns,
  data,
  onRowClick,
  loading = false,
  emptyMessage = 'No data found',
  selectedIds = [],
  onSelect,
  onSelectAll,
  selectable = false,
}: TableProps<T>) {
  const allSelected = data.length > 0 && selectedIds.length === data.length;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-text-muted">
        <p className="text-sm">{emptyMessage}</p>
      </div>
    );
  }

  return (
    <div>
      {/* Mobile card view */}
      <div className="space-y-3 md:hidden">
        {selectable && (
          <div className="flex items-center justify-between rounded-lg bg-surface px-3.5 py-2 text-xs font-medium text-text-muted">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={onSelectAll}
                className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
              />
              <span>Select all ({data.length})</span>
            </label>
            {selectedIds.length > 0 && <span>{selectedIds.length} selected</span>}
          </div>
        )}
        {data.map((item) => (
          <div
            key={item.id}
            className={`rounded-xl border border-gray-100 bg-white p-4 shadow-sm space-y-2.5 transition-colors ${
              onRowClick ? 'cursor-pointer active:bg-surface/60' : ''
            } ${selectedIds.includes(item.id) ? 'ring-2 ring-primary/40 bg-primary/[0.02]' : ''}`}
            onClick={() => onRowClick?.(item)}
          >
            {selectable && (
              <div className="flex items-center justify-between border-b border-gray-100 pb-2">
                <label
                  className="flex items-center gap-2 text-xs font-medium text-text-muted cursor-pointer"
                  onClick={(e) => e.stopPropagation()}
                >
                  <input
                    type="checkbox"
                    checked={selectedIds.includes(item.id)}
                    onChange={() => onSelect?.(item.id)}
                    className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                  />
                  <span>Select</span>
                </label>
              </div>
            )}
            {columns.map((col) => {
              if (!col.header) {
                return (
                  <div
                    key={col.key}
                    className="flex items-center justify-end gap-2 border-t border-gray-100 pt-2"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {col.render ? col.render(item) : (item as any)[col.key]}
                  </div>
                );
              }
              return (
                <div key={col.key} className="flex items-center justify-between gap-3 text-sm py-0.5">
                  <span className="text-xs font-semibold uppercase tracking-wider text-text-muted shrink-0">
                    {col.header}
                  </span>
                  <div className="text-right text-text">
                    {col.render ? col.render(item) : (item as any)[col.key]}
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>

      {/* Desktop table view */}
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-gray-100">
              {selectable && (
                <th className="w-12 px-4 py-3">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={onSelectAll}
                    className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                  />
                </th>
              )}
              {columns.map((col) => (
                <th
                  key={col.key}
                  className="table-header px-4 py-3 text-left"
                  style={col.width ? { width: col.width } : undefined}
                >
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.map((item) => (
              <tr
                key={item.id}
                className={`border-b border-gray-50 transition-colors hover:bg-surface/50 ${
                  onRowClick ? 'cursor-pointer' : ''
                } ${selectedIds.includes(item.id) ? 'bg-primary/5' : ''}`}
                onClick={() => onRowClick?.(item)}
              >
                {selectable && (
                  <td className="px-4 py-3">
                    <input
                      type="checkbox"
                      checked={selectedIds.includes(item.id)}
                      onChange={() => onSelect?.(item.id)}
                      onClick={(e) => e.stopPropagation()}
                      className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                    />
                  </td>
                )}
                {columns.map((col) => (
                  <td key={col.key} className="px-4 py-3 text-sm text-text">
                    {col.render ? col.render(item) : (item as any)[col.key]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}