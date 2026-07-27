/**
 * The two legacy files the P12 smoke run imports.
 *
 * They are written here rather than checked in as `.csv` so the expectations in
 * the run can be derived from the same values that are exported — a fixture
 * whose totals are stated in one place and asserted in another is a fixture
 * that drifts.
 *
 * The clean file is what a competent export from the old system looks like. The
 * messy one is what the office actually has: a comma in an order number, a
 * price somebody typed as a word, a row with nobody's email on it and two
 * households on file with that name, an order that came across in an earlier
 * batch, and an address with no ZIP code.
 */
export const LEGACY_HEADER =
  'orderNo,orderDate,donor,donorEmail,donorPhone,recipient,street,street2,city,state,zip,itemCode,item,qty,price,greeting';

export type LegacyFixtureRow = {
  orderNo: string;
  orderDate: string;
  donor: string;
  donorEmail: string;
  donorPhone: string;
  recipient: string;
  street: string;
  street2: string;
  city: string;
  state: string;
  zip: string;
  itemCode: string;
  item: string;
  qty: string;
  price: string;
  greeting: string;
};

/** Two households share this name, which is what makes the messy file ambiguous. */
export const AMBIGUOUS_DONOR = 'Chaya Klein';
export const FIRST_KLEIN_EMAIL = 'chayaklein@example.test';
export const SECOND_KLEIN_EMAIL = 'chaya.klein2@example.test';
/** The same mailbox as the first Klein, written the way a mail provider reads it. */
export const ALIAS_KLEIN_EMAIL = 'chaya.klein+shul@example.test';

/** A name a volunteer typed that a spreadsheet would run as a formula. */
export const FORMULA_DONOR = '=SUM(1,2)';

export const CLEAN_ORDER_COUNT = 18;
/** One of the eighteen orders sent two boxes. */
export const CLEAN_ROW_COUNT = CLEAN_ORDER_COUNT + 1;

/**
 * How many order numbers a run of these two files uses: the clean file's
 * eighteen, then a gap, then the five the messy file adds. The caller starts the
 * block above every reference the season already holds, so a second run imports
 * a history the database has not seen rather than nineteen duplicates.
 */
export const REFERENCE_BLOCK_SIZE = 25;

/** Where the messy file's own order numbers sit inside the block. */
const MESSY_OFFSET = 20;

const PRICES = [3600, 5400, 4200, 2500];

export function cleanLegacyFile(
  year: number,
  base: number,
): { csv: string; totalCents: number; references: string[] } {
  const references = Array.from({ length: CLEAN_ORDER_COUNT }, (_, index) => String(base + index));
  const rows: LegacyFixtureRow[] = [];

  for (let index = 0; index < CLEAN_ORDER_COUNT; index += 1) {
    const number = base + index;
    rows.push(orderRow(year, number, index));

    // The seventh household sent two boxes on one order, so the run has an
    // order whose lines have to stay together through the chunking.
    if (index === 6) rows.push({ ...orderRow(year, number, index + 100), recipient: 'Bubby Adler' });
  }

  // Two Kleins, so a later file naming one of them without an email cannot be
  // resolved without asking.
  rows[3] = { ...rows[3], donor: AMBIGUOUS_DONOR, donorEmail: FIRST_KLEIN_EMAIL };
  rows[4] = { ...rows[4], donor: AMBIGUOUS_DONOR, donorEmail: SECOND_KLEIN_EMAIL };

  // A name that a spreadsheet would treat as a formula, so the export has
  // something real to escape.
  rows[5] = { ...rows[5], donor: FORMULA_DONOR, donorEmail: 'formula@example.test' };

  return {
    csv: toCsv(rows),
    totalCents: rows.reduce((total, row) => total + cents(row), 0),
    references,
  };
}

export type MessyFixture = {
  csv: string;
  /** What the file is worth once the two unreadable rows are left out. */
  totalCents: number;
  duplicateReference: string;
  /** The two ways the old system wrote the one order number. */
  writtenReferences: [string, string];
  repairedReference: string;
  /** The row a person has to answer before the file can be committed. */
  mappedReference: string;
};

export function messyLegacyFile(year: number, base: number): MessyFixture {
  const date = `03/${String((year % 28) + 1).padStart(2, '0')}/${year}`;

  const repaired = base + MESSY_OFFSET;
  const written: [string, string] = [`#${withThousands(repaired)} `, `0${repaired}`];

  const rows: LegacyFixtureRow[] = [
    // A comma and a hash in the order number, and a second line of the same
    // order written with a leading zero.
    row({ orderNo: written[0], orderDate: date, donor: 'Yaakov Stein', donorEmail: 'stein@example.test', recipient: 'Reb Shmuel', price: '$36.00' }),
    row({ orderNo: written[1], orderDate: date, donor: 'Yaakov Stein', donorEmail: 'stein@example.test', recipient: 'Reb Aharon', price: '54.00' }),
    // Nothing to hang an order on.
    row({ orderNo: '  ', orderDate: date, donor: 'Nameless Order', donorEmail: 'nobody@example.test', recipient: 'Somebody', price: '36.00' }),
    // A price nobody can add up.
    row({ orderNo: String(repaired + 1), orderDate: date, donor: 'Free Giver', donorEmail: 'free@example.test', recipient: 'A Neighbour', price: 'free' }),
    // No email, and two households are called this.
    row({ orderNo: String(repaired + 2), orderDate: date, donor: AMBIGUOUS_DONOR, donorEmail: '', recipient: 'Tante Rivka', price: '42.00' }),
    // Already imported by the clean file.
    row({ orderNo: String(base), orderDate: date, donor: 'Household 1', donorEmail: 'household1@example.test', recipient: 'Recipient 1', price: '36.00' }),
    // Deliverable enough to keep, broken enough for the cleanup queue. Its own
    // door, so a second run of the smoke has a new address to find rather than
    // the one a person already looked at and decided to keep.
    row({ orderNo: String(repaired + 3), orderDate: date, donor: 'Malka Berger', donorEmail: 'berger@example.test', recipient: 'The Rov', street: `${repaired + 3} Main Street`, zip: '', price: '25.00' }),
    // The first Klein's mailbox under an alias, which is a second customer row.
    row({ orderNo: String(repaired + 4), orderDate: date, donor: AMBIGUOUS_DONOR, donorEmail: ALIAS_KLEIN_EMAIL, recipient: 'Cousin Leah', price: '36.00' }),
  ];

  const readable = rows.filter((entry) => entry.orderNo.trim() !== '' && entry.price !== 'free');

  return {
    csv: toCsv(rows),
    totalCents: readable.reduce((total, entry) => total + cents(entry), 0),
    duplicateReference: String(base),
    writtenReferences: written,
    repairedReference: String(repaired),
    mappedReference: String(repaired + 2),
  };
}

function withThousands(number: number): string {
  return String(number).replace(/\B(?=(\d{3})+$)/g, ',');
}

function orderRow(year: number, number: number, index: number): LegacyFixtureRow {
  return row({
    orderNo: String(number),
    orderDate: `02/${String((index % 27) + 1).padStart(2, '0')}/${year}`,
    donor: `Household ${index + 1}`,
    donorEmail: `household${index + 1}@example.test`,
    recipient: `Recipient ${index + 1}`,
    street: `${100 + index} Legacy Avenue`,
    price: (PRICES[index % PRICES.length] / 100).toFixed(2),
    greeting: index % 3 === 0 ? 'A freilichen Purim, from the Klein family' : '',
  });
}

function row(overrides: Partial<LegacyFixtureRow>): LegacyFixtureRow {
  return {
    orderNo: '',
    orderDate: '02/14/2026',
    donor: '',
    donorEmail: '',
    donorPhone: '',
    recipient: '',
    street: '12 Main Street',
    street2: '',
    city: 'Lakewood',
    state: 'NJ',
    zip: '08701',
    itemCode: 'CLASSIC',
    item: 'Classic Purim box',
    qty: '1',
    price: '36.00',
    greeting: '',
    ...overrides,
  };
}

function cents(entry: LegacyFixtureRow): number {
  const price = Number(entry.price.replace(/[$,\s]/g, ''));
  return Math.round(price * 100) * Number(entry.qty || '1');
}

function toCsv(rows: LegacyFixtureRow[]): string {
  const order = LEGACY_HEADER.split(',') as (keyof LegacyFixtureRow)[];

  return [
    LEGACY_HEADER,
    ...rows.map((entry) => order.map((column) => quote(entry[column])).join(',')),
  ].join('\r\n');
}

function quote(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}
