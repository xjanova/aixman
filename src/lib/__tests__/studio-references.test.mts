/**
 * The roles of a several-reference studio order, written into the prompt and
 * read back out when the order is reopened.
 *
 * Run: npm test   (or: node --experimental-transform-types --import ./scripts/alias-loader.mjs --test src/lib/__tests__/studio-references.test.mts)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  composeReferencePrompt,
  nextRole,
  REFERENCE_ROLES,
  splitReferencePrompt,
  type ReferenceRole,
} from '@/lib/studio-references';

test('each picture gets one numbered line, in the order sent', () => {
  const out = composeReferencePrompt('ผู้หญิงจาก ภาพ 1 สวมชุดจาก ภาพ 2', ['character', 'outfit', 'place']);
  assert.equal(
    out,
    [
      'ผู้หญิงจาก ภาพ 1 สวมชุดจาก ภาพ 2',
      '',
      'References:',
      'Image 1 (ภาพ 1) is the person: keep exactly this face, hair and body.',
      'Image 2 (ภาพ 2) is the outfit: dress the person in exactly these clothes.',
      'Image 3 (ภาพ 3) is the place: keep its architecture, layout and colours.',
    ].join('\n')
  );
});

test('no pictures, nothing added', () => {
  assert.equal(composeReferencePrompt('  a cat  ', []), 'a cat');
});

test('reopening gives back the words and the roles, for every role', () => {
  const roles = REFERENCE_ROLES.map((r) => r.id);
  const prompt = 'หน้าร้านกาแฟ\nสองบรรทัด';
  assert.deepEqual(splitReferencePrompt(composeReferencePrompt(prompt, roles)), { prompt, roles });
});

test('a prompt without the block is left alone', () => {
  assert.deepEqual(splitReferencePrompt('just words'), { prompt: 'just words', roles: null });
});

test('a block the customer typed or edited is not taken for ours', () => {
  const edited = 'x\n\nReferences:\nImage 1 (ภาพ 1) is my cat.';
  assert.deepEqual(splitReferencePrompt(edited), { prompt: edited, roles: null });
  const skipped = 'x\n\nReferences:\nImage 2 (ภาพ 2) is a reference.';
  assert.deepEqual(splitReferencePrompt(skipped), { prompt: skipped, roles: null });
});

test('tapping a label walks every role and comes back round', () => {
  let role: ReferenceRole = 'character';
  const seen = new Set<ReferenceRole>();
  for (let i = 0; i < REFERENCE_ROLES.length; i++) {
    seen.add(role);
    role = nextRole(role);
  }
  assert.equal(seen.size, REFERENCE_ROLES.length);
  assert.equal(role, 'character');
});
