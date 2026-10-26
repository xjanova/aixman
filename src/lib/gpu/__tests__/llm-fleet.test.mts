/**
 * Self-hosted language models: when their machines should be up, and what a
 * machine is told to boot.
 *
 * Run: npm test
 *
 * An API machine bills by the hour whether or not anyone calls it, so the
 * uptime rules are money: a schedule that is open an hour late wastes a day's
 * budget slowly, one that never closes wastes it fast. The boot script is the
 * machine's whole life — a typo in it is found only after a 30-minute rental.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

process.env.DATABASE_URL ??= 'mysql://test:test@127.0.0.1:3306/test';

const {
  DEFAULT_LLM_POLICY,
  DEMAND_WINDOW_MS,
  baselineMachines,
  inSchedule,
  parseFleet,
  parsePolicy,
  shouldRelease,
  wantedMachines,
} = await import('@/lib/gpu/llm-policy');
const { LLM_CATALOG, LLM_KEY_PREFIX, VLLM_VERSION, isLlmModelKey } = await import('@/lib/gpu/llm-catalog');
const { MODEL_CATALOG } = await import('@/lib/gpu/catalog');
const { buildVllmStartScript } = await import('@/lib/gpu/provision-llm');

/** A Bangkok wall-clock time (UTC+7, no DST) as a Date. */
const bkk = (iso: string) => new Date(`${iso}+07:00`);

test('policy: stored values are coerced, never trusted', () => {
  const p = parsePolicy({ mode: 'turbo', idleMinutes: 1, maxMachines: 99, scheduleStart: '25:00', scheduleDays: [1, 1, 9, 'x'], timezone: 'Mars/Base' });
  assert.equal(p.mode, 'off', 'an unknown mode is off, not on');
  assert.equal(p.idleMinutes, 5);
  assert.equal(p.maxMachines, 8);
  assert.equal(p.scheduleStart, DEFAULT_LLM_POLICY.scheduleStart);
  assert.deepEqual(p.scheduleDays, [1]);
  assert.equal(p.timezone, 'Asia/Bangkok');
  assert.deepEqual(parsePolicy(null), DEFAULT_LLM_POLICY);
  const f = parseFleet({ dailyBudgetUsd: -5, maxWorkers: 'many', maxPricePerHourUsd: 0 });
  assert.equal(f.dailyBudgetUsd, 0);
  assert.equal(f.maxWorkers, 2);
  assert.equal(f.maxPricePerHourUsd, 0.1);
});

test('schedule: Bangkok hours, the end excluded, days respected', () => {
  const p = parsePolicy({ mode: 'schedule', scheduleStart: '09:00', scheduleEnd: '23:00', scheduleDays: [1, 2, 3, 4, 5] });
  assert.equal(inSchedule(p, bkk('2026-10-26T08:59:00')), false, 'Monday before opening');
  assert.equal(inSchedule(p, bkk('2026-10-26T09:00:00')), true);
  assert.equal(inSchedule(p, bkk('2026-10-26T22:59:00')), true);
  assert.equal(inSchedule(p, bkk('2026-10-26T23:00:00')), false);
  assert.equal(inSchedule(p, bkk('2026-10-25T12:00:00')), false, 'Sunday is not a working day here');
  // 02:00 UTC is 09:00 in Bangkok: the server's own clock must not matter.
  assert.equal(inSchedule(p, new Date('2026-10-26T02:00:00Z')), true);
});

test('schedule: a night window belongs to the day it opened on', () => {
  const p = parsePolicy({ mode: 'schedule', scheduleStart: '22:00', scheduleEnd: '06:00', scheduleDays: [5] });
  assert.equal(inSchedule(p, bkk('2026-10-30T22:30:00')), true, 'Friday night');
  assert.equal(inSchedule(p, bkk('2026-10-31T03:00:00')), true, "Saturday small hours, Friday's window");
  assert.equal(inSchedule(p, bkk('2026-10-31T06:00:00')), false);
  assert.equal(inSchedule(p, bkk('2026-10-31T23:00:00')), false, 'Saturday night is not Friday');
  assert.equal(inSchedule(p, bkk('2026-10-30T03:00:00')), false, "Friday small hours are Thursday's");
});

test('baseline: off and on-demand keep nothing, always keeps one', () => {
  const now = bkk('2026-10-26T03:00:00');
  assert.equal(baselineMachines(parsePolicy({ mode: 'off' }), now), 0);
  assert.equal(baselineMachines(parsePolicy({ mode: 'on-demand' }), now), 0);
  assert.equal(baselineMachines(parsePolicy({ mode: 'always' }), now), 1);
  assert.equal(baselineMachines(parsePolicy({ mode: 'schedule' }), now), 0, '03:00 is outside 09–23');
});

test('wanted: demand starts a machine for a while, a busy one asks for another, never past the cap', () => {
  const now = bkk('2026-10-26T03:00:00');
  const t = now.getTime();
  const onDemand = parsePolicy({ mode: 'on-demand', maxMachines: 2 });
  assert.equal(wantedMachines(onDemand, now, undefined, 0), 0);
  assert.equal(wantedMachines(onDemand, now, { at: t - 60_000 }, 0), 1);
  assert.equal(wantedMachines(onDemand, now, { at: t - DEMAND_WINDOW_MS - 1 }, 0), 0, 'old demand has expired');
  assert.equal(wantedMachines(onDemand, now, { busyAt: t - 1000 }, 1), 2, 'busy: one more');
  assert.equal(wantedMachines(onDemand, now, { busyAt: t - 1000 }, 2), 2, 'capped at maxMachines');
  assert.equal(wantedMachines(parsePolicy({ mode: 'off' }), now, { at: t }, 0), 0, 'off refuses demand');
  assert.equal(wantedMachines(parsePolicy({ mode: 'always' }), now, undefined, 0), 1);
});

test('release: the baseline machine stays however idle, the rest close after their idle time', () => {
  const now = bkk('2026-10-26T12:00:00');
  const idle = (min: number) => new Date(now.getTime() - min * 60_000);
  const always = parsePolicy({ mode: 'always', idleMinutes: 20 });
  assert.equal(shouldRelease(always, now, 0, idle(600)), false, 'the always-on machine');
  assert.equal(shouldRelease(always, now, 1, idle(25)), true, "a burst's extra");
  assert.equal(shouldRelease(always, now, 1, idle(10)), false);
  const onDemand = parsePolicy({ mode: 'on-demand', idleMinutes: 20 });
  assert.equal(shouldRelease(onDemand, now, 0, idle(21)), true);
  const night = bkk('2026-10-26T23:30:00');
  const sched = parsePolicy({ mode: 'schedule', idleMinutes: 20 });
  assert.equal(shouldRelease(sched, night, 0, new Date(night.getTime() - 40 * 60_000)), true, 'closes after hours once idle');
});

test('catalogue: every API model key is told apart from every render model', () => {
  for (const e of LLM_CATALOG) assert.ok(isLlmModelKey(e.key), e.key);
  for (const e of MODEL_CATALOG) assert.ok(!e.key.startsWith(LLM_KEY_PREFIX), `render model ${e.key} would be treated as an API machine`);
  assert.equal(new Set(LLM_CATALOG.map((e) => e.key)).size, LLM_CATALOG.length);
});

test('boot script: valid bash, the pinned vLLM, the model served under its key, behind the proxy', () => {
  for (const entry of LLM_CATALOG) {
    for (const tunnel of [false, true]) {
      const script = buildVllmStartScript({ publicPort: 8189, entry, env: { AIXMAN_WORKER_TOKEN: 'secret' }, tunnel });
      const check = spawnSync('bash', ['-n'], { input: script });
      assert.equal(check.status, 0, `${entry.key}: ${check.stderr}`);
      assert.ok(script.includes(`'vllm==${VLLM_VERSION}'`));
      assert.ok(script.includes(`'--served-model-name' '${entry.key}'`));
      assert.ok(script.includes("'--host' '127.0.0.1'"), 'vLLM never listens publicly');
      assert.ok(script.includes('export AIXMAN_PROXY_MODE=llm'));
      assert.ok(script.includes('export AIXMAN_HEALTH_PATH=/health'));
      for (const arg of entry.vllmArgs) assert.ok(script.includes(`'${arg}'`), `${entry.key} lost ${arg}`);
      assert.equal(script.includes('export AIXMAN_PROXY_BIND=127.0.0.1'), tunnel, 'loopback only behind a tunnel');
      assert.equal(script.includes('fetching cloudflared'), tunnel, 'the tunnel binary only where a tunnel is the way in');
    }
  }
  const devstral = LLM_CATALOG.find((e) => e.key === 'llm-devstral-small-2')!;
  const script = buildVllmStartScript({ publicPort: 8189, entry: devstral });
  assert.ok(script.includes('"allow":["consolidated*.safetensors","params.json","tekken.json"]'), 'only one copy of the weights');
});
