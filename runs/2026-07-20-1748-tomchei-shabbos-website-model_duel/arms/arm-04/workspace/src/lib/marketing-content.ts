/**
 * Homepage copy (R-001, R-007, R-008). It lives here rather than inside the page
 * so the org can hand back edited wording without anyone touching layout code,
 * and so the numbers have one home instead of three.
 *
 * These are editorial figures the office publishes each year, not live counts
 * from the database — an order total that moved while a donor read the page
 * would be worse, not better.
 */
export const MISSION = {
  headline: 'Send mishloach manos. Feed a family all year.',
  body:
    'Every package you send on Purim pays for Shabbos groceries for a neighbour who would ' +
    'otherwise go without. You pick the boxes and the recipients; volunteers pack, drive and ' +
    'deliver them before yom tov.',
} as const;

export const IMPACT_STATS = [
  { value: '1,400', label: 'packages delivered last Purim' },
  { value: '260', label: 'families fed every Shabbos' },
  { value: '90¢', label: 'of every dollar reaches the food budget' },
] as const;

export const HOW_IT_WORKS = [
  {
    title: 'Choose your packages',
    body: 'Browse this season’s collection and pick the boxes you want to send.',
  },
  {
    title: 'Name your recipients',
    body: 'Add each person once. Delivery, shipping and pickup are all options.',
  },
  {
    title: 'We handle the rest',
    body: 'Volunteers pack every box, print the cards and deliver before Purim.',
  },
] as const;

export const TESTIMONIALS = [
  {
    quote:
      'I sent forty packages in ten minutes and never touched a spreadsheet. The cards came out exactly as I wrote them.',
    attribution: 'Chana R., Lakewood',
  },
  {
    quote:
      'My kids come with me on the delivery route every year. It is the best hour of Purim.',
    attribution: 'Dov S., volunteer driver',
  },
] as const;
