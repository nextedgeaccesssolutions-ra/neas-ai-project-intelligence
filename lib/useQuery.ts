'use client';
import { useEffect, useState } from 'react';

/** Reads a query-string value after mount (avoids Suspense requirements of useSearchParams in static pages). */
export function useQueryParam(name: string): string | null {
  const [v, setV] = useState<string | null>(null);
  useEffect(() => {
    setV(new URLSearchParams(window.location.search).get(name));
  }, [name]);
  return v;
}
