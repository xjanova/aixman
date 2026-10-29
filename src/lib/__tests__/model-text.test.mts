/**
 * Every model the catalogues define reads in English: name (when it has Thai),
 * description, quality modes, price tiers and speech voices — and no English
 * text names an API vendor.
 *
 * Run: npm test   (or: node --experimental-transform-types --import ./scripts/alias-loader.mjs --test src/lib/__tests__/model-text.test.mts)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { KIE_CATALOG } from '@/lib/providers/kie-catalog';
import { MODEL_CATALOG } from '@/lib/gpu/catalog';
import {
  MODEL_TEXT_EN, QUALITY_MODE_EN, modelDescription, modelName, qualityModeText, tierLabel, voiceLabel,
} from '@/lib/i18n/model-text';

const THAI = /[฀-๿]/;
const VENDOR = /\b(kie(\.ai)?|fal(\.ai)?|replicate|byteplus|pollinations|simplepod|runpod|vast\.ai|verda)\b/i;

test('every catalogue model has an English description and, when its name has Thai, an English name', () => {
  const entries = [
    ...KIE_CATALOG.map((e) => ({ key: e.key, name: e.name })),
    ...MODEL_CATALOG.map((e) => ({ key: e.key, name: e.name })),
  ];
  for (const e of entries) {
    const en = MODEL_TEXT_EN[e.key];
    assert.ok(en?.description, `${e.key}: no English description in src/lib/i18n/model-text.ts`);
    if (THAI.test(e.name)) assert.ok(en.name, `${e.key}: "${e.name}" has Thai but no English name`);
  }
});

test('the English never carries Thai or an API vendor’s name', () => {
  for (const [key, en] of Object.entries(MODEL_TEXT_EN)) {
    for (const text of [en.name ?? '', en.description]) {
      assert.ok(!THAI.test(text), `${key}: Thai in "${text}"`);
      assert.ok(!VENDOR.test(text), `${key}: vendor name in "${text}"`);
    }
  }
  for (const [key, mode] of Object.entries(QUALITY_MODE_EN)) {
    assert.ok(!THAI.test(mode.label + mode.description), key);
  }
});

test('quality modes, price tiers and voices all read in English', () => {
  for (const entry of MODEL_CATALOG) {
    for (const mode of entry.qualityModes ?? []) {
      const en = qualityModeText(entry.key, mode, 'en');
      assert.ok(!THAI.test(en.label) && !THAI.test(en.description), `${entry.key}:${mode.id}`);
      assert.ok(en.description, `${entry.key}:${mode.id} has no English description`);
    }
  }
  for (const entry of KIE_CATALOG) {
    for (const tier of entry.tiers ?? []) {
      assert.ok(!THAI.test(tierLabel(tier.label, 'en')), `${entry.key}: tier "${tier.label}"`);
    }
    for (const voice of entry.speech?.voices ?? []) {
      const label = voiceLabel(voice.id, voice.label, 'en');
      assert.ok(!THAI.test(label), `${entry.key}: voice ${voice.id}`);
      assert.ok(label.startsWith(voice.label.split(' — ')[0]), `${entry.key}: voice ${voice.id} renamed`);
    }
  }
});

test('Thai visitors get the row as it is; an untranslated row never shows Thai in English', () => {
  assert.equal(modelName('ltx-2.5', 'LTX-2.5 (วิดีโอ + เสียง)', 'th'), 'LTX-2.5 (วิดีโอ + เสียง)');
  assert.equal(modelName('ltx-2.5', 'LTX-2.5 (วิดีโอ + เสียง)', 'en'), 'LTX-2.5 (video + sound)');
  assert.equal(modelName('kie/veo-3-1', 'Veo 3.1 Quality', 'en'), 'Veo 3.1 Quality');
  assert.equal(modelName('unknown', 'Foo Model (ทดลอง)', 'en'), 'Foo Model');
  assert.equal(modelDescription('unknown', 'ภาพสวย', 'en'), null);
  assert.equal(modelDescription('unknown', 'Pretty pictures', 'en'), 'Pretty pictures');
  assert.equal(modelDescription('unknown', 'ภาพสวย', 'th'), 'ภาพสวย');
});
