// Client portal links: /client/<project code>/<slug of the project title>.
// The code keeps the link unique; the title part is for people and is ignored by the portal.
export function titleSlug(title: string, max = 60): string {
  const s = title
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  return (cut.includes('-') ? cut.slice(0, cut.lastIndexOf('-')) : cut).replace(/-+$/, '');
}

export function clientPath(p: { code: string; name?: string | null }): string {
  const slug = titleSlug(p.name ?? '');
  return `/client/${encodeURIComponent(p.code)}${slug ? `/${slug}` : ''}`;
}
