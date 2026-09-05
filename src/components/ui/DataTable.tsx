import { useState, useMemo, type ReactNode } from 'react';
import { ChevronUp, ChevronDown, ChevronLeft, ChevronRight, Search, Inbox, X } from 'lucide-react';

export interface Column<T> {
  key: string;
  header: string;
  render?: (row: T) => ReactNode;
  sortable?: boolean;
  align?: 'left' | 'right' | 'center';
  className?: string;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  loading?: boolean;
  pageSize?: number;
  searchKeys?: (keyof T)[];
  searchPlaceholder?: string;
  emptyMessage?: string;
  toolbar?: ReactNode;
  onRowClick?: (row: T) => void;
  rowClassName?: (row: T) => string;
  totalsRow?: ReactNode;
  selectable?: boolean;
  selectedIds?: Set<string>;
  onSelectionChange?: (ids: Set<string>) => void;
  getRowId?: (row: T) => string;
  stickyHeader?: boolean;
  pageSizeOptions?: number[];
  showSerialNumber?: boolean;
}

export function DataTable<T extends { id?: string }>({
  columns,
  data,
  loading,
  pageSize = 10,
  searchKeys,
  searchPlaceholder = 'Search...',
  emptyMessage = 'No records found',
  toolbar,
  onRowClick,
  rowClassName,
  totalsRow,
  selectable = false,
  selectedIds,
  onSelectionChange,
  getRowId,
  stickyHeader = false,
  pageSizeOptions = [10, 25, 50, 100],
  showSerialNumber = false,
}: DataTableProps<T>) {
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [page, setPage] = useState(1);
  const [currentPageLen, setCurrentPageLen] = useState(pageSize);

  const rowId = (row: T, index: number): string => {
    if (getRowId) return getRowId(row);
    return row.id ?? String(index);
  };

  const filtered = useMemo(() => {
    let result = data;
    if (search && searchKeys) {
      const q = search.toLowerCase();
      result = result.filter(row =>
        searchKeys.some(k => String(row[k] ?? '').toLowerCase().includes(q))
      );
    }
    if (sortKey) {
      result = [...result].sort((a, b) => {
        const av = (a as Record<string, unknown>)[sortKey];
        const bv = (b as Record<string, unknown>)[sortKey];
        if (av == null) return 1;
        if (bv == null) return -1;
        if (typeof av === 'number' && typeof bv === 'number') {
          return sortDir === 'asc' ? av - bv : bv - av;
        }
        return sortDir === 'asc'
          ? String(av).localeCompare(String(bv))
          : String(bv).localeCompare(String(av));
      });
    }
    return result;
  }, [data, search, searchKeys, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / currentPageLen));
  const currentPage = Math.min(page, totalPages);
  const paged = filtered.slice((currentPage - 1) * currentPageLen, currentPage * currentPageLen);

  const handleSort = (key: string) => {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  const allFilteredIds = useMemo(() => filtered.map((r, i) => rowId(r, i)), [filtered, getRowId]);
  const allOnPageSelected = paged.every(r => {
    const id = rowId(r, 0);
    return selectedIds?.has(id);
  });

  const toggleAllOnPage = () => {
    if (!onSelectionChange || !selectedIds) return;
    const next = new Set(selectedIds);
    if (allOnPageSelected) {
      paged.forEach((r, i) => next.delete(rowId(r, i)));
    } else {
      paged.forEach((r, i) => next.add(rowId(r, i)));
    }
    onSelectionChange(next);
  };

  const toggleRow = (row: T, index: number) => {
    if (!onSelectionChange || !selectedIds) return;
    const id = rowId(row, index);
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onSelectionChange(next);
  };

  const selectAllFiltered = () => {
    if (!onSelectionChange) return;
    onSelectionChange(new Set(allFilteredIds));
  };

  const clearSelection = () => {
    if (!onSelectionChange) return;
    onSelectionChange(new Set());
  };

  const serialColumn: Column<T> = {
    key: '__serial',
    header: 'Sl. No.',
    align: 'center',
    render: (_row: T) => null, // placeholder — actual value rendered inline below
  };

  const baseColumns = showSerialNumber ? [serialColumn, ...columns] : columns;
  const displayColumns = selectable
    ? [{ key: '__select', header: '', align: 'center' as const }, ...baseColumns]
    : baseColumns;

  const headerClass = stickyHeader
    ? 'sticky top-0 z-10 bg-slate-100 shadow-sm'
    : 'bg-slate-100';

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
      {(searchKeys || toolbar) && (
        <div className="flex flex-col sm:flex-row gap-3 p-4 border-b border-slate-100 bg-slate-50/50">
          {searchKeys && (
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                type="text"
                value={search}
                onChange={e => { setSearch(e.target.value); setPage(1); }}
                placeholder={searchPlaceholder}
                className="w-full pl-9 pr-9 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-colors"
              />
              {search && (
                <button
                  onClick={() => { setSearch(''); setPage(1); }}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          )}
          {toolbar && <div className="flex gap-2 flex-wrap items-center">{toolbar}</div>}
        </div>
      )}

      {selectable && selectedIds && selectedIds.size > 0 && (
        <div className="flex items-center justify-between px-4 py-2 bg-blue-50 border-b border-blue-100">
          <span className="text-xs font-medium text-blue-700">
            {selectedIds.size} record{selectedIds.size !== 1 ? 's' : ''} selected
          </span>
          <div className="flex gap-2">
            <button onClick={selectAllFiltered} className="text-xs text-blue-600 hover:text-blue-800 font-medium">
              Select all ({filtered.length})
            </button>
            <span className="text-slate-300">|</span>
            <button onClick={clearSelection} className="text-xs text-slate-500 hover:text-slate-700 font-medium">
              Clear
            </button>
          </div>
        </div>
      )}

      <div className="overflow-x-auto" style={{ maxHeight: stickyHeader ? '70vh' : undefined }}>
        <table className="w-full">
          <thead>
            <tr className={classNames2(headerClass, 'border-b border-slate-200')}>
              {displayColumns.map(col => {
                if (col.key === '__select') {
                  return (
                    <th key="__select" className="px-4 py-3 text-center w-10">
                      <input
                        type="checkbox"
                        checked={!!allOnPageSelected && paged.length > 0}
                        onChange={toggleAllOnPage}
                        className="w-4 h-4 accent-blue-600 cursor-pointer rounded"
                      />
                    </th>
                  );
                }
                return (
                  <th
                    key={col.key}
                    className={`px-4 py-3 text-[11px] font-bold text-slate-800 uppercase tracking-wider whitespace-nowrap ${
                      col.align === 'right' ? 'text-right' : col.align === 'center' ? 'text-center' : 'text-left'
                    } ${col.sortable ? 'cursor-pointer hover:bg-slate-200' : ''}`}
                    onClick={() => col.sortable && handleSort(col.key)}
                  >
                    <span className="inline-flex items-center gap-1">
                      {col.header}
                      {col.sortable && sortKey === col.key && (
                        sortDir === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />
                      )}
                    </span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading ? (
              <tr>
                <td colSpan={displayColumns.length} className="px-4 py-12 text-center text-slate-400">
                  <div className="inline-flex items-center gap-2">
                    <div className="w-4 h-4 border-2 border-slate-300 border-t-blue-600 rounded-full animate-spin" />
                    Loading...
                  </div>
                </td>
              </tr>
            ) : paged.length === 0 ? (
              <tr>
                <td colSpan={displayColumns.length} className="px-4 py-12 text-center text-slate-400">
                  <Inbox className="w-10 h-10 mx-auto mb-2 text-slate-300" />
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              paged.map((row, i) => {
                const id = rowId(row, (currentPage - 1) * currentPageLen + i);
                const isSelected = selectedIds?.has(id) ?? false;
                return (
                  <tr
                    key={id}
                    onClick={() => onRowClick?.(row)}
                    className={`hover:bg-blue-50/30 transition-colors ${onRowClick ? 'cursor-pointer' : ''} ${isSelected ? 'bg-blue-50/50' : ''} ${rowClassName?.(row) ?? ''}`}
                  >
                    {selectable && (
                      <td className="px-4 py-3 text-center w-10" onClick={e => { e.stopPropagation(); toggleRow(row, (currentPage - 1) * currentPageLen + i); }}>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => {}}
                          className="w-4 h-4 accent-blue-600 cursor-pointer rounded"
                        />
                      </td>
                    )}
                    {baseColumns.map(col => {
                      if (col.key === '__serial') {
                        return (
                          <td key="__serial" className="px-4 py-3 text-sm text-slate-500 text-center tabular-nums">
                            {i + 1}
                          </td>
                        );
                      }
                      return (
                        <td
                        key={col.key}
                        className={`px-4 py-3 text-sm text-slate-800 whitespace-nowrap ${
                          col.align === 'right' ? 'text-right tabular-nums font-medium' : col.align === 'center' ? 'text-center' : 'text-left'
                        } ${col.className ?? ''}`}
                      >
                        {col.render ? col.render(row) : String((row as Record<string, unknown>)[col.key] ?? '-')}
                      </td>
                      );
                    })}
                  </tr>
                );
              })
            )}
          </tbody>
          {totalsRow && <tfoot className="bg-slate-50 border-t-2 border-slate-200">{totalsRow}</tfoot>}
        </table>
      </div>

      {filtered.length > 0 && (
        <div className="flex flex-col sm:flex-row items-center justify-between gap-2 px-4 py-3 border-t border-slate-100 bg-slate-50/50">
          <div className="flex items-center gap-3">
            <span className="text-xs font-medium text-slate-500 tabular-nums">
              Showing {(currentPage - 1) * currentPageLen + 1}–{Math.min(currentPage * currentPageLen, filtered.length)} of {filtered.length}
            </span>
            <select
              value={currentPageLen}
              onChange={e => { setCurrentPageLen(Number(e.target.value)); setPage(1); }}
              className="text-xs border border-slate-200 rounded-md px-2 py-1 text-slate-600 focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              {pageSizeOptions.map(opt => (
                <option key={opt} value={opt}>{opt} / page</option>
              ))}
            </select>
          </div>
          {totalPages > 1 && (
            <div className="flex items-center gap-1">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="p-1.5 rounded-md hover:bg-slate-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="text-xs font-semibold text-slate-600 px-2 tabular-nums">{currentPage} / {totalPages}</span>
              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
                className="p-1.5 rounded-md hover:bg-slate-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function classNames2(...cls: (string | undefined | false)[]): string {
  return cls.filter(Boolean).join(' ');
}
