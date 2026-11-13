/**
 * ✨ on the lyrics box (lyrics/write.ts).
 *
 * Run: npm test   (or: node --experimental-transform-types --import ./scripts/alias-loader.mjs --test src/lib/lyrics/__tests__/write.test.mts)
 *
 * What must hold: an answer reaches the box as a song in sections, without what
 * chat models wrap around one; an answer that is no song is refused; a song
 * never overflows the box mid-line or ends on an empty section; the customer's
 * words are told apart from an idea and the ones the model dropped are counted;
 * rough words still get sections with no model; and every failure has a reason
 * a customer can read, with no provider's name in it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LYRICS_BOX_MAX, isDraft, linesChanged, lyricsFailure, lyricsRequest, tagStanzas, tidyLyrics } from '@/lib/lyrics/write';

test('tidyLyrics: talk before the first tag and markdown around the tags are removed', () => {
  const answer = 'นี่คือเนื้อเพลงที่แต่งให้ครับ\n\n**[Verse 1]**\nเธอไปแล้ว\n\n## [Chorus]:\nอย่าไปเลย';
  assert.equal(tidyLyrics(answer), '[Verse 1]\nเธอไปแล้ว\n\n[Chorus]\nอย่าไปเลย');
});

test('tidyLyrics: a heading written without brackets becomes a tag', () => {
  assert.equal(tidyLyrics('[Intro]\nโอ้\n\n**Chorus:**\nอย่าไปเลย\n\n### Verse 2\nกลับมา'), '[Intro]\nโอ้\n\n[Chorus]\nอย่าไปเลย\n\n[Verse 2]\nกลับมา');
});

test('tidyLyrics: tag notes, parentheses and an instrumental intro survive', () => {
  const song = '[Intro: khaen and phin]\n\n[Verse 1: soft, sparse]\nเธอไปแล้ว (ไปแล้ว)';
  assert.equal(tidyLyrics(song), song);
});

test('tidyLyrics: rules, extra blank lines and Thai mistypings are mended', () => {
  assert.equal(tidyLyrics('[Verse]\nน้ําตา\n\n\n\n---\n\n[Chorus]\nเเม่'), '[Verse]\nน้ำตา\n\n[Chorus]\nแม่');
});

test('tidyLyrics: an answer that is no song in sections is refused', () => {
  assert.equal(tidyLyrics('def quicksort(a):\n    return sorted(a)'), null);
  assert.equal(tidyLyrics('ขออภัย ไม่สามารถแต่งเพลงนี้ได้'), null);
  assert.equal(tidyLyrics('[Verse 1]\n[Chorus]'), null, 'sections with nothing to sing');
});

test('tidyLyrics: a song past the box is cut at a line end, with no empty section left', () => {
  const verse = `[Verse]\n${Array.from({ length: 40 }, () => 'เธอไปแล้วไม่หวนคืนมา').join('\n')}`;
  const song = `${verse}\n\n[Chorus]\n${'ก'.repeat(LYRICS_BOX_MAX)}`;
  const out = tidyLyrics(song)!;
  assert.ok(out.length <= LYRICS_BOX_MAX);
  assert.ok(out.endsWith('เธอไปแล้วไม่หวนคืนมา'), 'ends on a whole sung line, not on [Chorus]');
});

test('isDraft: rough words against an idea', () => {
  assert.equal(isDraft('เพลงอกหักจากแฟนที่ไปทำงานกรุงเทพ'), false);
  assert.equal(isDraft('บรรทัดหนึ่ง\nบรรทัดสอง\nบรรทัดสาม'), false);
  assert.equal(isDraft('หนึ่ง\nสอง\n\nสาม\nสี่'), true);
  assert.equal(isDraft('[Chorus]\nอย่าไปเลย'), true, 'a tag means words, however short');
});

test('lyricsRequest: the job follows the text, and the words are fenced as material', () => {
  const idea = lyricsRequest({ text: 'เพลงรัก', style: 'sung in Thai, modern pop' });
  assert.match(idea, /^Job: Write the whole song/);
  assert.match(idea, /Style: sung in Thai, modern pop/);
  assert.match(idea, /"""\nเพลงรัก\n"""$/);
  assert.doesNotMatch(idea, /carry on/);

  const draft = lyricsRequest({ text: 'หนึ่ง\nสอง\nสาม\nสี่', style: '' });
  assert.match(draft, /^Job: Arrange and finish/);
  assert.match(draft, /word for word/);
  assert.match(draft, /Style: not given/);
});

test('lyricsRequest: an extension asks for the next part only', () => {
  assert.match(lyricsRequest({ text: 'ต่อท่อนจบ', style: 'ballad', continuation: true }), /only the next part/);
});

test('linesChanged: kept lines count as kept wherever they went', () => {
  const draft = '[Verse]\nเธอไปแล้ว\nไม่กลับมา\nรอทุกวัน';
  assert.equal(linesChanged(draft, '[Chorus]\nเธอไปแล้ว\n(ไม่กลับมา)\n\n[Verse 1: soft]\nรอทุกวัน\nรอทุกวัน'), 0);
  assert.equal(linesChanged(draft, '[Verse]\nเธอจากไป\nไม่กลับมา'), 2);
});

test('linesChanged: a mistyping the song mended is not a change', () => {
  assert.equal(linesChanged('น้ําตา  ไหล', '[Verse]\nน้ำตา ไหล'), 0);
});

test('tagStanzas: a stanza sung twice is the chorus', () => {
  assert.equal(
    tagStanzas('เธอไปแล้ว\nไม่กลับมา\n\nอย่าไปเลย\nอย่าไปเลย\n\nรอทุกวัน\nรอทุกคืน\n\nอย่าไปเลย\nอย่าไปเลย'),
    '[Verse 1]\nเธอไปแล้ว\nไม่กลับมา\n\n[Chorus]\nอย่าไปเลย\nอย่าไปเลย\n\n[Verse 2]\nรอทุกวัน\nรอทุกคืน\n\n[Chorus]\nอย่าไปเลย\nอย่าไปเลย'
  );
});

test('tagStanzas: words with no blank lines are split every four lines', () => {
  assert.equal(tagStanzas('ก\nข\nค\nง\nจ\nฉ'), '[Verse 1]\nก\nข\nค\nง\n\n[Verse 2]\nจ\nฉ');
});

test('tagStanzas: an idea and words already tagged have nothing for the rules', () => {
  assert.equal(tagStanzas('เพลงรักวัยเรียน'), null);
  assert.equal(tagStanzas('[Verse]\nหนึ่ง\nสอง\nสาม\nสี่'), null);
});

test('lyricsFailure: every failure has its own reason, and no provider is named', () => {
  const noKeys = 'openai: no active openai key in the account pool | minimax: no active minimax key in the account pool';
  const cases: [string, RegExp][] = [
    ['ปิดผู้ช่วย AI ไว้', /ปิดผู้ช่วย AI/],
    [`deepseek: This operation was aborted | ${noKeys}`, /ช้าเกินเวลา/],
    [`deepseek: deepseek ran out of tokens while reasoning and gave no answer — try another model | ${noKeys}`, /เนื้อเพลงที่ใช้ได้/],
    ['deepseek · deepseek-flash answered with no song sections', /เนื้อเพลงที่ใช้ได้/],
    [`deepseek: deepseek HTTP 429: {"error":"too many"} | ${noKeys}`, /ใช้ AI เต็ม/],
    [`deepseek: deepseek HTTP 402: {"error":"insufficient balance"} | ${noKeys}`, /บัญชี AI/],
    [noKeys, /ยังไม่ได้เชื่อมต่อ/],
    ['fetch failed', /เชื่อมต่อ AI ไม่สำเร็จ/],
  ];
  for (const [reason, expected] of cases) {
    const message = lyricsFailure(reason);
    assert.match(message.th, expected, reason);
    assert.ok(message.en.length > 0);
    assert.doesNotMatch(`${message.th} ${message.en}`, /deepseek|openai|minimax|byteplus|HTTP/i);
  }
});
