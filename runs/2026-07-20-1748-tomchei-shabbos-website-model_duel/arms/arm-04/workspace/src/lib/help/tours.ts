import type { Permission } from '../auth/permissions';

/**
 * The staff help centre (R-102).
 *
 * One entry per screen a volunteer is asked to work: when they would be on it,
 * and the steps in the order the screen puts them. Written here rather than in
 * a wiki nobody updates, and gated by the same permissions as the screens
 * themselves — a tour of a page somebody cannot open is a support call, not
 * help.
 *
 * These are the words a manager says to a new volunteer in Purim week, which is
 * why they are short and name buttons rather than concepts.
 */
export type HelpTour = {
  slug: string;
  title: string;
  /** The screen the tour walks, so every entry is one click from being followed. */
  href: string;
  when: string;
  steps: string[];
  permission: Permission;
};

export const HELP_TOURS: HelpTour[] = [
  {
    slug: 'today',
    title: 'Start the day',
    href: '/admin/today',
    when: 'First thing every morning of the season.',
    steps: [
      'Read the counts at the top: orders placed, boxes to pack, boxes to send, money still owed.',
      'Anything in red is a job for today. Open it from the card rather than hunting for it.',
      'The banner across the top of every screen tells you if a season is not open yet, or if this is a rehearsal.',
    ],
    permission: 'orders.view',
  },
  {
    slug: 'orders',
    title: 'Find an order and fix it',
    href: '/admin/orders',
    when: 'A donor rings up about an order.',
    steps: [
      'Search by their name, email, phone or the order number. Partial spellings are fine.',
      'Open the order to see every box on it, where each one is up to, and what has been paid.',
      'Change a recipient or an address from the box itself. The change follows the box wherever it already is.',
      'Take a payment, refund one or void one you entered by mistake, from the payments panel. Every one of those is written down with your name on it.',
    ],
    permission: 'orders.view',
  },
  {
    slug: 'pos',
    title: 'Take an order at the desk',
    href: '/admin/pos',
    when: 'Somebody walks in or phones the office.',
    steps: [
      'Find the household or add them. Their past orders come with them.',
      'Add boxes and say who each one is for, the same way the website asks.',
      'Take the payment — cash, cheque or card at the desk — and print or email the receipt.',
      'A basket you leave behind is still there tomorrow, so nothing is lost if you stop halfway.',
    ],
    permission: 'orders.manage',
  },
  {
    slug: 'fulfillment',
    title: 'Pack tonight and print the paper',
    href: '/admin/fulfillment',
    when: 'Every evening once orders stop coming in.',
    steps: [
      'Press Build tonight\'s batch. Every box that is ready goes into it; a box already in a batch is never taken twice.',
      'Print the packing sheets and the greeting cards from the batch page.',
      'Work the board: New, Printed, Packed, Sent. Move a box on only when it is really done.',
      'A box you cannot pack stays where it is. Say why in the note so the office can ring the family.',
    ],
    permission: 'fulfillment.manage',
  },
  {
    slug: 'routes',
    title: 'Send a van out',
    href: '/admin/routes',
    when: 'Delivery day, once the boxes for that day are packed.',
    steps: [
      'Pick the delivery day and the boxes, then Build route. The stops come back in driving order.',
      'Hand the driver their link. It opens the route on their phone and nothing else.',
      'Print the route sheet as well: a phone with no signal is a normal afternoon.',
      'If the van drives past a box that was going by carrier, the screen offers it. Taking it cancels the label — tick the confirmation to say you meant it.',
      'Press Start when the van leaves. Stops can be ticked off by the driver or by you from here.',
    ],
    permission: 'routes.manage',
  },
  {
    slug: 'pickup',
    title: 'Hand a box over at the counter',
    href: '/admin/pickup',
    when: 'A family comes to collect.',
    steps: [
      'Find their box on the counter list. Only packed boxes are on it.',
      'Press Collected. That is the handover, and it is timestamped with your name.',
      'A box nobody collects appears under Unclaimed after the window closes. The office decides what happens to it.',
    ],
    permission: 'fulfillment.manage',
  },
  {
    slug: 'reports',
    title: 'Read a season and take the files',
    href: '/admin/reports',
    when: 'After the season, and whenever the board asks.',
    steps: [
      'The first table is every season side by side: orders, households, boxes, money in and money owed.',
      'Open a season to see what sold, how it travelled and how it was paid for.',
      'Shipping margin shows what each parcel was charged against what the carrier was actually paid.',
      'Exports gives you the five spreadsheets. Every download is recorded with your name — these files are donors\' addresses and phone numbers.',
      'Payment reconciliation checks the card gateway against our own books. It only ever raises a flag; it never edits a payment.',
    ],
    permission: 'reports.view',
  },
  {
    slug: 'migration',
    title: 'Bring last decade in',
    href: '/admin/migration',
    when: 'Once, in the first year, and again if an old file turns up.',
    steps: [
      'Upload the old system\'s file and choose the year it belongs to. Nothing is written yet.',
      'Read the verdicts: what will import, what is already here, what cannot be read and why, and what needs you to choose between two households.',
      'Answer the questions. The commit will not run while one is open.',
      'Press Commit. It writes five orders at a time and offers Continue until it is done, so it is safe to stop and come back.',
      'Then work the cleanup queue: broken addresses and households on file twice. Merge or keep — a decision you make is not asked again.',
    ],
    permission: 'migration.manage',
  },
  {
    slug: 'seasons',
    title: 'Open next year',
    href: '/admin/seasons',
    when: 'Setting up a new Purim.',
    steps: [
      'Create the season, then copy last year\'s catalogue into it and adjust the prices.',
      'Say what each retired box becomes this year, so a household repeating last year\'s order is asked one clear question.',
      'Open the season when you are ready. That is what puts the shop live.',
    ],
    permission: 'seasons.manage',
  },
  {
    slug: 'email',
    title: 'Write to the list',
    href: '/admin/email',
    when: 'Announcing a season, or chasing unpaid orders.',
    steps: [
      'Build the audience from a list, write the letter, and preview it.',
      'Send yourself a test first. A test send writes to nobody else.',
      'Press Send. Pressing it twice does not send twice — the second press reports how many already had it.',
      'The outbox shows what went out, what failed and why, and what is waiting to be tried again.',
    ],
    permission: 'email.manage',
  },
  {
    slug: 'rehearsal',
    title: 'Rehearse before launch',
    href: '/admin/settings/testing',
    when: 'The fortnight before a season opens.',
    steps: [
      'Turn test mode on. Every screen, staff and public, says so in a band nobody can dismiss.',
      'Seed a demo season and work it end to end: order, pay, pack, print, ship, deliver, collect.',
      'Wipe when you are done. Orders and households go; products, staff and settings stay.',
      'Turn test mode off before the season opens. The band goes and the wipe buttons stop working.',
    ],
    permission: 'settings.manage',
  },
];

export function toursFor(permissions: readonly Permission[]): HelpTour[] {
  return HELP_TOURS.filter((tour) => permissions.includes(tour.permission));
}
