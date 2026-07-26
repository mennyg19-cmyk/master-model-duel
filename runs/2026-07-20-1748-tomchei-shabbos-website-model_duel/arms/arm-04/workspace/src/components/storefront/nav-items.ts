/** One nav list for the desktop bar and the mobile menu, so the two cannot drift. */
export const STOREFRONT_NAV = [
  { href: '/', label: 'Home' },
  { href: '/collection', label: 'This season' },
  { href: '/archive', label: 'Past collections' },
  { href: '/newsletter', label: 'Newsletter' },
] as const;
