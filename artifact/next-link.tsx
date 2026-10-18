import type { AnchorHTMLAttributes, MouseEvent, ReactNode } from 'react';
import { navigate } from './router';

type Props = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> & { href: string; children?: ReactNode };

export default function Link({ href, onClick, children, ...rest }: Props) {
  const path = href.split('?')[0];
  const token = path === '/' ? 'overview' : path.slice(1);
  return (
    <a
      {...rest}
      href={'#' + token}
      onClick={(e: MouseEvent<HTMLAnchorElement>) => {
        onClick?.(e);
        if (e.defaultPrevented || e.metaKey || e.ctrlKey) return;
        e.preventDefault();
        navigate(href);
      }}
    >
      {children}
    </a>
  );
}
