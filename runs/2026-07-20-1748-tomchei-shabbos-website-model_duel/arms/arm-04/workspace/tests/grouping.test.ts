import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  groupLinesIntoPackages,
  packageGroupingKey,
  type PackageDestination,
} from '../src/lib/orders/grouping';

const MIRIAM: PackageDestination = {
  recipientName: 'Miriam Klein',
  fulfillmentMethodId: 'method-deliver',
  pickupLocationId: null,
  addressLine1: '412 Forest Avenue',
  addressLine2: 'Apt 3B',
  addressCity: 'Lakewood',
  addressState: 'NJ',
  addressPostalCode: '08701',
  addressCountry: 'US',
  greetingMessage: 'Freilichen Purim',
};

test('the same recipient, address, method and greeting share one package', () => {
  assert.equal(packageGroupingKey(MIRIAM), packageGroupingKey({ ...MIRIAM }));
});

test('a different greeting splits the package', () => {
  const otherCard = { ...MIRIAM, greetingMessage: 'With gratitude' };
  assert.notEqual(packageGroupingKey(MIRIAM), packageGroupingKey(otherCard));
});

test('an empty greeting is not the same as a written one', () => {
  assert.notEqual(packageGroupingKey(MIRIAM), packageGroupingKey({ ...MIRIAM, greetingMessage: null }));
});

test('whitespace around a greeting does not split the package', () => {
  const retyped = { ...MIRIAM, greetingMessage: '  Freilichen   Purim ' };
  assert.equal(packageGroupingKey(MIRIAM), packageGroupingKey(retyped));
});

test('case and punctuation in the recipient or address do not split the package', () => {
  const retyped = {
    ...MIRIAM,
    recipientName: 'miriam  klein',
    addressLine1: '412 forest avenue,',
    addressLine2: 'apt 3b',
  };

  assert.equal(packageGroupingKey(MIRIAM), packageGroupingKey(retyped));
});

test('a different fulfillment method splits the package', () => {
  const shipped = { ...MIRIAM, fulfillmentMethodId: 'method-ship' };
  assert.notEqual(packageGroupingKey(MIRIAM), packageGroupingKey(shipped));
});

test('a different recipient at the same address splits the package', () => {
  const brother = { ...MIRIAM, recipientName: 'Dovid Klein' };
  assert.notEqual(packageGroupingKey(MIRIAM), packageGroupingKey(brother));
});

test('grouping keeps one package per distinct destination and holds every line', () => {
  const lines = [
    { id: 'line-1', ...MIRIAM },
    { id: 'line-2', ...MIRIAM },
    { id: 'line-3', ...MIRIAM, greetingMessage: 'With gratitude' },
    { id: 'line-4', ...MIRIAM, recipientName: 'Rabbi Stein' },
  ];

  const groups = groupLinesIntoPackages(lines);

  assert.equal(groups.length, 3);
  assert.deepEqual(
    groups.map((group) => group.lines.map((line) => line.id)),
    [['line-1', 'line-2'], ['line-3'], ['line-4']],
  );
  assert.equal(groups[0].destination.recipientName, 'Miriam Klein');
});
