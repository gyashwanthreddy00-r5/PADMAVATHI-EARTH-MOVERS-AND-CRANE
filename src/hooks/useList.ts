import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';

export function useList<T>(
  table: string,
  select = '*',
  filter?: Record<string, unknown>,
  orderBy?: string,
  ascending = true,
) {
  const [data, setData] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetch = useCallback(async () => {
    setLoading(true);
    let q = supabase.from(table).select(select);
    if (filter) {
      for (const [k, v] of Object.entries(filter)) {
        if (v != null && v !== '') q = q.eq(k, v);
      }
    }
    if (orderBy) q = q.order(orderBy, { ascending });
    const { data: result, error: err } = await q;
    if (err) setError(err.message);
    else { setData((result ?? []) as T[]); setError(null); }
    setLoading(false);
  }, [table, select, JSON.stringify(filter), orderBy, ascending]);

  useEffect(() => { fetch(); }, [fetch]);

  return { data, loading, error, refetch: fetch, setData };
}

export function useRealtimeTable<T>(table: string, select = '*', callback?: () => void) {
  const [data, setData] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      const { data: result } = await supabase.from(table).select(select);
      setData((result ?? []) as T[]);
      setLoading(false);
    };
    fetchData();

    const channel = supabase
      .channel(`realtime-${table}`)
      .on('postgres_changes', { event: '*', schema: 'public', table }, () => {
        fetchData();
        callback?.();
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [table, select]);

  return { data, loading, setData };
}
