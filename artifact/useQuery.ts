import { useLocation } from './router';
export function useQueryParam(name: string): string | null {
  return useLocation().query.get(name);
}
