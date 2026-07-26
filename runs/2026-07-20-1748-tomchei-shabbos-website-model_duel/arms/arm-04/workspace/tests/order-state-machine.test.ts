import assert from 'node:assert/strict';
import { test } from 'node:test';

import { checkPackageStage, ILLEGAL_STAGE } from '../src/lib/fulfillment/package-stages';
import {
  canTransitionOrder,
  checkOrderTransition,
  ILLEGAL_TRANSITION,
} from '../src/lib/orders/state-machine';

test('a draft can be placed or discarded', () => {
  assert.ok(canTransitionOrder('DRAFT', 'PLACED'));
  assert.ok(canTransitionOrder('DRAFT', 'DISCARDED'));
});

test('a placed order moves through fulfillment or is cancelled', () => {
  assert.ok(canTransitionOrder('PLACED', 'IN_FULFILLMENT'));
  assert.ok(canTransitionOrder('PLACED', 'CANCELLED'));
  assert.ok(canTransitionOrder('IN_FULFILLMENT', 'COMPLETED'));
});

test('an illegal transition is refused and says why', () => {
  const skipped = checkOrderTransition('DRAFT', 'COMPLETED');

  assert.equal(skipped.ok, false);
  assert.equal(skipped.ok === false && skipped.code, ILLEGAL_TRANSITION);
  assert.match(skipped.ok === false ? skipped.publicMessage : '', /still a draft.*completed/);
});

test('an order never goes backwards and a finished order never reopens', () => {
  for (const [from, to] of [
    ['PLACED', 'DRAFT'],
    ['IN_FULFILLMENT', 'PLACED'],
    ['COMPLETED', 'IN_FULFILLMENT'],
    ['CANCELLED', 'PLACED'],
    ['DISCARDED', 'PLACED'],
  ] as const) {
    assert.equal(canTransitionOrder(from, to), false, `${from} must not become ${to}`);
  }
});

test('a discarded draft and a cancelled order are different endings', () => {
  assert.equal(canTransitionOrder('DRAFT', 'CANCELLED'), false);
  assert.equal(canTransitionOrder('PLACED', 'DISCARDED'), false);
});

test('a package may skip stages forward', () => {
  assert.equal(checkPackageStage('NEW', 'PACKED', 'DELIVERY').ok, true);
  assert.equal(checkPackageStage('NEW', 'PRINTED', 'SHIPPING').ok, true);
});

test('printing does not imply sent, and a package never moves back', () => {
  assert.equal(checkPackageStage('SENT', 'PRINTED', 'SHIPPING').ok, false);
  assert.equal(checkPackageStage('PRINTED', 'PRINTED', 'SHIPPING').ok, false);

  const backwards = checkPackageStage('PACKED', 'NEW', 'DELIVERY');
  assert.equal(backwards.ok === false && backwards.code, ILLEGAL_STAGE);
});

test('sent and picked up are two endings, not two steps', () => {
  assert.equal(checkPackageStage('SENT', 'PICKED_UP', 'SHIPPING').ok, false);
  assert.equal(checkPackageStage('PACKED', 'PICKED_UP', 'SHIPPING').ok, false);
  assert.equal(checkPackageStage('PACKED', 'SENT', 'PICKUP').ok, false);
  assert.equal(checkPackageStage('PACKED', 'PICKED_UP', 'PICKUP').ok, true);
});
