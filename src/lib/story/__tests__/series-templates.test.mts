/**
 * Example stories a new series starts from, and the genres and looks they use.
 *
 * Run: npm test   (or: node --experimental-transform-types --import ./scripts/alias-loader.mjs --test src/lib/story/__tests__/series-templates.test.mts)
 *
 * What must hold: a template is sent through the same form and API as a story
 * the customer typed, so every value in it is one they accept unchanged — a
 * genre or look the tables do not hold falls back silently and the series is
 * made as something else. The premise decides the series' language, and the
 * cast is who the plot is about.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ASPECTS, LIMITS, LOOKS, pickKey } from '@/lib/story/cinematic';
import { EPISODE_LENGTHS, SERIES_FORMATS, SERIES_GENRES, SERIES_LIMITS, bibleMessages, castOf, episodeCountOf, isSeriesFormat, seriesLanguage } from '@/lib/story/series';
import { SERIES_TEMPLATES, templateForm } from '@/lib/story/series-templates';

const THAI = /[฀-๿]/;
const LOCALES = ['th', 'en'] as const;

test('every genre suggests a look the films have, and every look can be drawn and scored', () => {
  for (const [key, genre] of Object.entries(SERIES_GENRES)) {
    assert.ok(key.length <= 30, `genre ${key} fits ai_story_series.genre VARCHAR(30)`);
    assert.ok(Object.prototype.hasOwnProperty.call(LOOKS, genre.look), `genre ${key} → look ${genre.look}`);
    assert.ok(genre.label.th && genre.label.en && genre.direction, `genre ${key} is written out`);
  }
  for (const [key, look] of Object.entries(LOOKS)) {
    assert.ok(key.length <= 50, `look ${key} fits template_key VARCHAR(50)`);
    assert.ok(look.label.th && look.label.en && look.style && look.music, `look ${key} is written out`);
    assert.doesNotMatch(look.style + look.music, THAI, `look ${key}: prompt text is English`);
  }
  for (const key of ['wuxia', 'xianxia', 'period', 'timetravel']) assert.ok(SERIES_GENRES[key], `genre ${key}`);
  for (const key of ['wuxia', 'palace', 'xianxia', 'siam']) assert.ok(LOOKS[key], `look ${key}`);
});

test('a template holds only what the form and the API take as they are', () => {
  const keys = SERIES_TEMPLATES.map((x) => x.key);
  assert.equal(new Set(keys).size, keys.length, 'keys are unique');
  assert.ok(SERIES_TEMPLATES.length >= 4);

  for (const tpl of SERIES_TEMPLATES) {
    const at = `template ${tpl.key}`;
    assert.ok(isSeriesFormat(tpl.format), `${at}: format`);
    // What POST /api/story/series does with each field.
    assert.equal(pickKey(tpl.genre, SERIES_GENRES, 'romance'), tpl.genre, `${at}: genre`);
    assert.equal(pickKey(tpl.look, LOOKS, 'film'), tpl.look, `${at}: look`);
    assert.ok(EPISODE_LENGTHS.includes(tpl.episodeSeconds), `${at}: episode length`);
    assert.equal(episodeCountOf(tpl.episodeCount, 0), tpl.episodeCount, `${at}: episode count`);
    assert.ok(Object.prototype.hasOwnProperty.call(ASPECTS, SERIES_FORMATS[tpl.format].aspect), `${at}: frame`);

    assert.ok(tpl.cast.length >= 2 && tpl.cast.length <= LIMITS.characters, `${at}: cast size`);
    for (const locale of LOCALES) {
      assert.ok(tpl.label[locale] && tpl.pitch[locale], `${at}: label and pitch (${locale})`);
      const title = tpl.title[locale];
      const premise = tpl.premise[locale];
      assert.ok(title && title.length <= SERIES_LIMITS.title && title === title.trim(), `${at}: title (${locale})`);
      assert.ok(premise.length >= 400 && premise.length <= SERIES_LIMITS.premise && premise === premise.trim(), `${at}: premise length (${locale}, ${premise.length})`);
      assert.equal(seriesLanguage(premise), locale, `${at}: the ${locale} premise makes a ${locale} series`);

      const names = tpl.cast.map((c) => c.name[locale]);
      assert.equal(new Set(names.map((n) => n.toLowerCase())).size, names.length, `${at}: cast names are unique (${locale})`);
      for (const name of names) {
        assert.ok(name && name.length <= LIMITS.characterName && name === name.trim(), `${at}: name ${name}`);
        assert.ok(premise.includes(name), `${at}: ${name} is in the ${locale} premise`);
      }
    }
    for (const c of tpl.cast) {
      assert.ok(c.description.length >= 40 && c.description.length <= LIMITS.characterDescription, `${at}: ${c.name.en} description length`);
      assert.doesNotMatch(c.description, THAI, `${at}: ${c.name.en} is described in English`);
    }
  }
});

test('templateForm: the form in one language, the frame of the format, nothing for an unknown key', () => {
  assert.equal(templateForm('nope', 'th'), null);
  for (const tpl of SERIES_TEMPLATES) {
    for (const locale of LOCALES) {
      const form = templateForm(tpl.key, locale)!;
      assert.equal(form.title, tpl.title[locale]);
      assert.equal(form.premise, tpl.premise[locale]);
      assert.equal(form.aspect, SERIES_FORMATS[tpl.format].aspect);
      assert.deepEqual([form.format, form.genre, form.look, form.episodeCount, form.episodeSeconds], [tpl.format, tpl.genre, tpl.look, tpl.episodeCount, tpl.episodeSeconds]);
      // The cast survives the check the series stores it through, name and description whole.
      const stored = castOf(form.cast.map((c) => ({ ...c, referenceUrl: null })));
      assert.deepEqual(stored.map((c) => [c.name, c.description]), form.cast.map((c) => [c.name, c.description]));
    }
  }
});

test('a template reaches the head writer whole: its genre, its cast by name, its plot', () => {
  for (const tpl of SERIES_TEMPLATES) {
    const form = templateForm(tpl.key, 'th')!;
    const { system, user } = bibleMessages({
      title: form.title,
      premise: form.premise,
      format: form.format,
      genre: form.genre,
      language: seriesLanguage(form.premise),
      episodeSeconds: form.episodeSeconds,
      count: form.episodeCount,
      cast: form.cast.map((c) => ({ ...c, referenceUrl: null })),
      characters: [],
      done: [],
      from: 1,
      to: Math.min(8, form.episodeCount),
    });
    assert.ok(system.includes(SERIES_GENRES[tpl.genre].direction), `${tpl.key}: the genre's direction`);
    assert.match(system, /in Thai\./);
    assert.ok(user.includes(form.premise), `${tpl.key}: the whole plot`);
    for (const c of form.cast) assert.ok(user.includes(`${c.name} — ${c.description}`), `${tpl.key}: ${c.name}`);
  }
});
