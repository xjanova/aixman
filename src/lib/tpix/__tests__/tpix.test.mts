/**
 * The /tpix campaign: coin maths, the quote check, and the request signature
 * xmanstudio verifies.
 *
 * Run: npm test   (or: node --experimental-transform-types --import ./scripts/alias-loader.mjs --test src/lib/tpix/__tests__/tpix.test.mts)
 *
 * What must hold: an amount reaches the chain as exactly the wei that was
 * quoted (no float on the way), only TPIX Chain counts as TPIX Chain, a quote
 * that does not add up is never handed to the page to pay, and the signature
 * matches the contract byte for byte.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  TPIX_CHAIN,
  addChainParams,
  discountedThb,
  estimateTpix,
  isTpixChain,
  parseWeiHex,
  tpixToWei,
  weiToHex,
  weiToTpix,
} from '@/lib/tpix/chain';
import { pickQuote, pickStatus } from '@/lib/tpix/quote';
import { signTpixRequest } from '@/lib/tpix/xman-api';

test('the chain id in hex is 4289', () => {
  assert.equal(Number(TPIX_CHAIN.hex), 4289);
  assert.equal(addChainParams().chainId, '0x10c1');
  assert.equal(addChainParams().nativeCurrency.decimals, 18);
});

test('only TPIX Chain is TPIX Chain, whatever case or form the wallet reports', () => {
  for (const id of ['0x10c1', '0x10C1', '0x010c1', '4289', 4289]) assert.equal(isTpixChain(id), true, String(id));
  for (const id of ['0x1', '0x38', '1', 56, '', null, undefined, '0xzz', '4289.0']) assert.equal(isTpixChain(id), false, String(id));
});

test('TPIX to wei is exact, digit for digit', () => {
  assert.equal(tpixToWei('94.51234567'), BigInt('94512345670000000000'));
  assert.equal(tpixToWei('0.000000000000000001'), BigInt(1));
  assert.equal(tpixToWei('1'), BigInt('1000000000000000000'));
  // A float would have lost this one
  assert.equal(tpixToWei('123456789.123456789123456789'), BigInt('123456789123456789123456789'));
  for (const bad of ['', '-1', '1.', '.5', '1e3', '0x10', '1.0000000000000000001', '1,000']) {
    assert.throws(() => tpixToWei(bad), String(bad));
  }
});

test('wei to hex and back to people', () => {
  assert.equal(weiToHex(BigInt('1000000000000000000')), '0xde0b6b3a7640000');
  assert.equal(weiToHex('0'), '0x0');
  assert.equal(weiToTpix(BigInt('94512345670000000000')), '94.5123');
  assert.equal(weiToTpix(BigInt('1234567000000000000000000')), '1,234,567');
  assert.equal(weiToTpix(BigInt('999999999999999999'), 2), '0.99'); // cut, never rounded up
  assert.equal(parseWeiHex('0xde0b6b3a7640000'), BigInt('1000000000000000000'));
  assert.equal(parseWeiHex('12'), null);
});

test('the discount matches xmanstudio: to the satang, half-up', () => {
  assert.deepEqual(discountedThb(399, 20), { discount: 79.8, total: 319.2 });
  assert.deepEqual(discountedThb(99, 20), { discount: 19.8, total: 79.2 });
  assert.deepEqual(discountedThb(2499, 20), { discount: 499.8, total: 1999.2 });
  assert.deepEqual(discountedThb(99, 15), { discount: 14.85, total: 84.15 });
  assert.deepEqual(discountedThb(0.05, 50), { discount: 0.03, total: 0.02 }); // 2.5 satang rounds up
  assert.deepEqual(discountedThb(399, 0), { discount: 0, total: 399 });
});

test('an estimate never undersells the quote', () => {
  assert.equal(estimateTpix(319.2, 3.3772095), 94.52);
  assert.equal(estimateTpix(100, 0), null);
  assert.equal(estimateTpix(0, 3.3), null);
});

const goodQuote = {
  reference: 'TPXABCDEFGHJK123',
  order_number: 'AIC-261029-ABCDE',
  status: 'pending',
  package: { slug: 'creator', name: 'Creator', credits: 500, bonus_credits: 50 },
  price_thb: '399.00',
  discount_thb: '79.80',
  total_thb: '319.20',
  discount_percent: 20,
  amount_tpix: '94.51234567',
  amount_wei: '94512345670000000000',
  receive_address: '0x4BcC1844Ad9E8587f7005f092928a5D14C30F463',
  chain_id: 4289,
  rate_thb: '3.377209500000',
  expires_at: '2026-10-29T06:00:00+00:00',
  seconds_left: 1800,
  payment_uri: 'ethereum:0x4bcc1844ad9e8587f7005f092928a5d14c30f463@4289?value=94512345670000000000',
  pay_url: 'https://xman4289.com/pay/tpix/TPXABCDEFGHJK123',
};

test('a quote that adds up is passed on, narrowed', () => {
  const q = pickQuote(goodQuote);
  assert.ok(q);
  assert.equal(q.amountWei, '94512345670000000000');
  assert.equal(q.receiveAddress, goodQuote.receive_address);
  assert.equal(q.package.bonusCredits, 50);
  assert.equal(q.paymentUri, goodQuote.payment_uri);
  assert.equal('pay_url' in q, false);
});

test('a quote that does not add up is never handed to the page', () => {
  const broken: Record<string, unknown>[] = [
    { ...goodQuote, chain_id: 56 },
    { ...goodQuote, chain_id: undefined },
    { ...goodQuote, receive_address: '0x123' },
    { ...goodQuote, amount_wei: '94512345670000000001' }, // differs from amount_tpix by one wei
    { ...goodQuote, amount_wei: '0' },
    { ...goodQuote, amount_tpix: '94.5' },
    { ...goodQuote, reference: '../admin' },
    { ...goodQuote, total_thb: 'NaN' },
  ];
  for (const q of broken) assert.equal(pickQuote(q), null, JSON.stringify(q).slice(0, 80));
});

test('a payment link to another address or chain is dropped', () => {
  const q = pickQuote({ ...goodQuote, payment_uri: 'ethereum:0x000000000000000000000000000000000000dEaD@4289?value=1' });
  assert.equal(q?.paymentUri, '');
});

test('status keeps only links to the TPIX explorer', () => {
  const st = pickStatus({
    reference: 'TPXABCDEFGHJK123', status: 'confirming', settled: false, payable: true,
    confirmations: 1, required_confirmations: 3,
    tx_hash: '0x' + 'a'.repeat(64), explorer_url: 'https://evil.example/tx/1',
  });
  assert.equal(st.explorerUrl, null);
  assert.equal(st.requiredConfirmations, 3);
  assert.equal(pickStatus({ explorer_url: `${TPIX_CHAIN.explorer}/tx/0x1` }).explorerUrl, `${TPIX_CHAIN.explorer}/tx/0x1`);
  assert.equal(pickStatus({ tx_hash: 'nope' }).txHash, null);
});

test('the signature matches the contract (vector computed with openssl)', () => {
  const sig = signTpixRequest('test-secret', 1761710000, 'POST', '/api/aixman/tpix/orders', '{"user_id":7,"package_slug":"creator"}');
  assert.equal(sig, '75647e6716da121cbbb1dc5779a8574fb85844d2ca9863de39d4e40649e86420');
  // Any change to the signed parts changes it
  assert.notEqual(signTpixRequest('test-secret', 1761710001, 'POST', '/api/aixman/tpix/orders', '{"user_id":7,"package_slug":"creator"}'), sig);
  assert.notEqual(signTpixRequest('test-secret', 1761710000, 'POST', '/api/aixman/tpix/orders', '{"user_id":8,"package_slug":"creator"}'), sig);
});
