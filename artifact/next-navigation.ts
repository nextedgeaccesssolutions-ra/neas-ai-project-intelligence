import { useLocation } from './router';
export const usePathname = () => useLocation().path;
