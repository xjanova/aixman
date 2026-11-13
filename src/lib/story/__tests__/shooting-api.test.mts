import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

test('script exports require ownership and keep final subtitles pinned after the current script changes', () => {
  const code = String.raw`
import { mock } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest, NextResponse } from 'next/server.js';
import { register } from 'node:module';
register('data:text/javascript,' + encodeURIComponent("export function resolve(s,c,next){return next(s === 'next/server' ? 'next/server.js' : s,c)}"));
let user = null;
let owner = 3;
const project = { id: 1, title: 'Test episode', episodeNumber: 2, seriesId: 1, userId: 3, mode: 'film', finalVideoUrl: 'https://bucket/film.mp4', scriptJson: {}, characters: [], scenes: [], shots: [] };
mock.module('@/lib/auth', { namedExports: { getCurrentUserId: async () => user } });
mock.module('@/lib/story/service', { namedExports: { loadOwnedProject: async (uid, id) => uid === owner && id === 1 ? project : null } });
mock.module('@/lib/story/shooting-service', { namedExports: { previousEpisodeContext: async () => 'EP.1 continuity' } });
mock.module('@/lib/story/http', { namedExports: {
  STORY_REPLY: { signIn: {}, projectNotFound: {}, badRequest: {} },
  storyReply: (msg, locale, status) => NextResponse.json({ error: msg }, { status }),
  storyErrorReply: (error) => { throw error; },
} });
const { GET } = await import('@/app/api/story/[id]/script/route');
const request = (format = 'srt', id = '1') => GET(new NextRequest('http://localhost/api/story/' + id + '/script?format=' + format), { params: Promise.resolve({ id }) });
assert.equal((await request()).status, 401);
user = 3;
owner = 4;
assert.equal((await request()).status, 404);
owner = 3;
assert.equal((await request('script', 'NaN')).status, 404);
assert.equal((await request()).status, 422);
project.scriptJson.delivery = { videoUrl: project.finalVideoUrl, srt: 'FINAL CUT SUBTITLES', script: 'FINAL CUT SCRIPT' };
project.title = 'CURRENT TITLE CHANGED';
assert.equal((await request()).status, 200);
assert.equal(await (await request()).text(), 'FINAL CUT SUBTITLES');
assert.equal(await (await request('final-script')).text(), 'FINAL CUT SCRIPT');
assert.match(await (await request('script')).text(), /CURRENT TITLE CHANGED/);
const exported = await (await request('manifest')).json();
assert.equal(exported.srt, 'FINAL CUT SUBTITLES');
assert.equal((await request('manifest')).headers.get('Cache-Control'), 'private, no-store');
assert.equal((await request('unknown')).status, 400);
project.finalVideoUrl = 'https://bucket/new-film.mp4';
assert.equal((await request()).status, 422, 'a snapshot for a different cut must never be exported');
`;
  const run = spawnSync(process.execPath, ['--experimental-test-module-mocks', '--experimental-transform-types', '--disable-warning=ExperimentalWarning', '--disable-warning=MODULE_TYPELESS_PACKAGE_JSON', '--import', './scripts/alias-loader.mjs', '--input-type=module', '-e', code], { encoding: 'utf8', timeout: 30_000 });
  assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
});
