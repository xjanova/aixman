/**
 * Sends one real job to a community node through aixman's own dispatch path.
 *
 * Not a curl at the tunnel: this builds the graph the way a customer's job
 * would — catalogue entry, checkpoint chosen from what the worker reports,
 * validation against its /object_info, submission — so what it proves is that
 * aixman can put work on somebody's home card, not merely that the tunnel is
 * open.
 *
 * Reads the node's own identity file rather than the production database: the
 * credentials are already on the machine the node runs on, and this way the
 * check needs no database and moves no secret anywhere.
 *
 * Run: node --experimental-strip-types --import ./scripts/alias-loader.mjs \
 *        scripts/community-dispatch-check.mts
 */
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { WorkerClient } from '@/lib/gpu/worker-client';

const identityPath =
  process.env.GPUXMINE_AGENT_JSON ?? join(homedir(), 'AppData', 'Roaming', 'GPUxMINE', 'agent.json');

const identity = JSON.parse(readFileSync(identityPath, 'utf8')) as Record<string, string>;

/** The file is written by a .NET host, so keys arrive PascalCase. */
function field(...names: string[]): string {
  for (const name of names) {
    for (const key of Object.keys(identity)) {
      if (key.toLowerCase() === name.toLowerCase() && identity[key]) return identity[key];
    }
  }
  throw new Error(`agent.json has none of: ${names.join(', ')}`);
}

const workerId = field('WorkerId');
const token = field('WorkerToken', 'Token');
// agent.json holds the agent's own dial-out URL (…/agent). The tunnel a
// dispatcher talks to is the same origin with /w/<workerId>, so the dial-out
// path has to come off before the worker path goes on.
const relay = field('RelayUrl').replace(/\/+$/, '').replace(/\/agent$/, '');
const endpoint = `${relay.replace(/^ws/, 'http')}/w/${workerId}`;

console.log('worker  ', workerId);
console.log('endpoint', endpoint);

// `apiKind` is what picks the ComfyUI path; nothing else on the profile is
// read once the worker is already running.
const client = new WorkerClient(endpoint, { apiKind: 'comfyui' } as never, token, 'sdxl-community');

const result = await client.submit({
  prompt: 'a red vintage bicycle leaning against a white wall, soft daylight, photograph',
  negativePrompt: 'blurry, watermark, text',
  width: 512,
  height: 512,
  duration: 0,
  fps: 0,
  seed: 20260919,
  // Kept low on purpose: the card this runs against is power-limited to half
  // its rating and has already lost the host twice under a long render.
  extra: { steps: 8 },
});

console.log('SUBMITTED', JSON.stringify(result));
