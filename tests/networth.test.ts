import {test} from 'node:test';
import assert from 'node:assert/strict';
import {computeNetWorth, rolloverAmount, toAccountDto} from '../lib/networth';

test('computeNetWorth nets assets against card dues and loans', () => {
  const net = computeNetWorth(
    [
      {id: 'a1', name: 'Savings', type: 'BANK', balance: 120000},
      {id: 'a2', name: 'Cash', type: 'CASH', balance: 4500},
    ],
    [
      {id: 'c1', cardName: 'HDFC', dues: 18000},
      {id: 'c2', cardName: 'ICICI', dues: 0},
    ],
    [
      {id: 'l1', lenderName: 'Car loan', outstanding: 350000},
      {id: 'l2', lenderName: 'Closed', outstanding: 0},
    ],
  );
  assert.equal(net.assets, 124500);
  assert.equal(net.cardDues, 18000);
  assert.equal(net.loanOutstanding, 350000);
  assert.equal(net.liabilities, 368000);
  assert.equal(net.netWorth, -243500);
});

test('computeNetWorth handles empty inputs', () => {
  const net = computeNetWorth([], [], []);
  assert.deepEqual(net, {assets: 0, cardDues: 0, loanOutstanding: 0, liabilities: 0, netWorth: 0});
});

test('computeNetWorth rounds decimals to 2 places', () => {
  const net = computeNetWorth(
    [{id: 'a', name: 'Wallet', type: 'WALLET', balance: 10.105}],
    [{id: 'c', cardName: 'Card', dues: 3.333}],
    [],
  );
  assert.equal(net.assets, 10.11);
  assert.equal(net.cardDues, 3.33);
  assert.equal(net.netWorth, 6.78);
});

test('rolloverAmount carries only unspent budget', () => {
  assert.equal(rolloverAmount(10000, 7500), 2500);
  assert.equal(rolloverAmount(10000, 12000), 0);
  assert.equal(rolloverAmount(0, 500), 0);
  assert.equal(rolloverAmount(999.99, 0), 999.99);
});

test('toAccountDto converts decimal strings to numbers', () => {
  const dto = toAccountDto({id: 'a1', name: 'Bank', type: 'BANK', balance: '25000.75'});
  assert.equal(dto.balance, 25000.75);
  assert.equal(dto.name, 'Bank');
});
