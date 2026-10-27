import {
  ASPECTS,
  LIMITS,
  LOOKS,
  MOODS,
  SHOT_SIZES,
  extractJson,
  type CharacterLite,
  type PlanInput,
  type StoryMode,
} from './cinematic';

/**
 * A project's reference library (characters, props, places), its acts and
 * scenes, and the opening picture of a shot composed from them. Pure, so the
 * rules can be read and tested without a database.
 *
 * Why an opening picture: our video models take one first frame. A shot with
 * two characters, a sword and a temple used to open on the lead's photo alone,
 * and the model invented the rest — a different sword in every shot. An image
 * model that takes several references (Seedream, gpt-image; reference-caps.ts)
 * composes them into one frame first, and the clip opens on that.
 */

export const ASSET_KINDS = {
  character: { label: 'ตัวละคร', max: 8 },
  prop: { label: 'ของ / อาวุธ / ยานพาหนะ', max: 12 },
  location: { label: 'สถานที่', max: 12 },
} as const;
export type AssetKind = keyof typeof ASSET_KINDS;

export const isAssetKind = (v: unknown): v is AssetKind => typeof v === 'string' && v in ASSET_KINDS;

/** Pictures per library item: the main one and up to three more angles. */
export const MAX_ASSET_PICTURES = 4;

export const TIMES_OF_DAY: Record<string, { label: string; en: string }> = {
  dawn: { label: 'รุ่งเช้า', en: 'at dawn, soft pink first light' },
  day: { label: 'กลางวัน', en: 'in daylight' },
  golden: { label: 'แดดเย็น', en: 'at golden hour, warm low sun' },
  dusk: { label: 'พลบค่ำ', en: 'at dusk, blue hour' },
  night: { label: 'กลางคืน', en: 'at night' },
};

export const STRUCTURE_LIMITS = { acts: 5, scenes: 24, title: 200, summary: 1200 } as const;

export interface LibraryAsset {
  id: number;
  kind: AssetKind;
  name: string;
  description: string;
  /** Main picture first, then the other angles. */
  pictures: string[];
}

/** The pictures a row holds, main first, without repeats or blanks. */
export function assetPictures(row: { referenceUrl: string | null; images: unknown }): string[] {
  const extra = Array.isArray(row.images) ? row.images.filter((u): u is string => typeof u === 'string' && u !== '') : [];
  return [...new Set([row.referenceUrl ?? '', ...extra].filter(Boolean))].slice(0, MAX_ASSET_PICTURES);
}

export const asLite = (a: LibraryAsset): CharacterLite => ({ id: a.id, name: a.name, description: a.description, hasReference: a.pictures.length > 0 });

// ---------------------------------------------------------------------------
// The opening picture
// ---------------------------------------------------------------------------

export interface ShotRefs {
  characterIds: number[];
  propIds: number[];
  /** The shot's own place, else its scene's. */
  locationId: number | null;
}

export interface PickedRef {
  url: string;
  asset: LibraryAsset;
  /** 0 for an item's main picture, 1+ for its other angles. */
  angle: number;
}

/**
 * Which pictures go to a model that takes `cap` of them: every item's main
 * picture first — the characters in order (the lead first), the place, the
 * props — then other angles, characters first, until the model is full. An
 * item with no picture is left to the words.
 */
export function pickReferences(shot: ShotRefs, library: LibraryAsset[], cap: number): PickedRef[] {
  const byId = new Map(library.map((a) => [a.id, a]));
  const items = [
    ...shot.characterIds.map((id) => byId.get(id)).filter((a) => a?.kind === 'character'),
    byId.get(shot.locationId ?? -1)?.kind === 'location' ? byId.get(shot.locationId!) : undefined,
    ...shot.propIds.map((id) => byId.get(id)).filter((a) => a?.kind === 'prop'),
  ].filter((a): a is LibraryAsset => Boolean(a) && a!.pictures.length > 0);
  const unique = [...new Map(items.map((a) => [a.id, a])).values()];
  const picked: PickedRef[] = [];
  const max = Math.max(0, cap);
  for (const asset of unique) if (picked.length < max) picked.push({ url: asset.pictures[0], asset, angle: 0 });
  for (let angle = 1; angle < MAX_ASSET_PICTURES && picked.length < max; angle++) {
    for (const asset of unique) if (picked.length < max && asset.pictures[angle]) picked.push({ url: asset.pictures[angle], asset, angle });
  }
  return picked;
}

/** How many pictures a shot could use at most — the page shows "3 of 5 sent". */
export function referencesWanted(shot: ShotRefs, library: LibraryAsset[]): number {
  return pickReferences(shot, library, Number.MAX_SAFE_INTEGER).length;
}

export interface KeyframeContext {
  mode: StoryMode;
  look: string;
  mood: string;
  aspect: string;
  shotSize: string;
  visual: string;
  timeOfDay: string | null;
  /** Everything visible, pictured or not: named in words too. */
  characters: LibraryAsset[];
  props: LibraryAsset[];
  location: LibraryAsset | null;
}

/**
 * The image model's instruction: number each reference as it was sent
 * ("Image 1 is …"), then the frame itself. Seedream and gpt-image both read
 * references by their order.
 */
export function keyframePrompt(refs: PickedRef[], ctx: KeyframeContext): string {
  const style = ctx.mode === 'mv' ? MOODS[ctx.mood] ?? MOODS.romantic : LOOKS[ctx.look] ?? LOOKS.film;
  const size = SHOT_SIZES[ctx.shotSize] ?? SHOT_SIZES.medium;
  const frame = ASPECTS[ctx.aspect] ?? ASPECTS['16:9'];
  const lines = refs.map((r, k) => {
    const n = `Image ${k + 1}`;
    const angle = r.angle > 0 ? ' (another angle of the same)' : '';
    if (r.asset.kind === 'character') return `${n} is ${r.asset.name}${angle}: keep exactly this face, hair, body and clothes.`;
    if (r.asset.kind === 'location') return `${n} is the place, ${r.asset.name}${angle}: keep its architecture and colours.`;
    return `${n} is ${r.asset.name}${angle}: keep its exact shape, design and colours.`;
  });
  const pictured = new Set(refs.map((r) => r.asset.id));
  const described = [...ctx.characters, ...(ctx.location ? [ctx.location] : []), ...ctx.props]
    .filter((a) => a.description.trim())
    .map((a) => `${a.name}${pictured.has(a.id) ? '' : ' (no picture)'}: ${a.description.trim()}`);
  const when = ctx.timeOfDay ? TIMES_OF_DAY[ctx.timeOfDay]?.en : undefined;
  return [
    `One still frame: the opening frame of a film shot, ${frame.width > frame.height ? 'landscape' : frame.width < frame.height ? 'portrait' : 'square'} ${ctx.aspect}.`,
    `${style.style}. ${capital(size.en)}.`,
    ...(lines.length ? ['References:', ...lines] : []),
    ...(described.length ? [`Who and what is in it — ${described.join('; ')}.`] : []),
    `The frame: ${ctx.visual.trim()}${when ? ` ${capital(when)}.` : ''}`,
    'Photorealistic, natural skin and light, every person facing the camera or in three-quarter view, faces clear. No text, no captions, no watermark, no borders, one single image.',
  ].join('\n');
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// ---------------------------------------------------------------------------
// Acts and scenes — the planner's first step
// ---------------------------------------------------------------------------

export interface PlannedScene {
  title: string;
  summary: string;
  /** A library location id, or a new place's index in `newLocations` (as -1 - index), or null. */
  locationRef: number | null;
  timeOfDay: string | null;
  /** Library character ids. */
  cast: number[];
  /** Library prop ids, or new props as -1 - index into `newProps`. */
  props: number[];
  seconds: number;
}

export interface PlannedAct {
  title: string;
  summary: string;
  scenes: PlannedScene[];
}

export interface NewAsset {
  name: string;
  description: string;
}

export interface StructurePlan {
  title: string;
  acts: PlannedAct[];
  newLocations: NewAsset[];
  newProps: NewAsset[];
}

export interface StructureInput extends PlanInput {
  props: CharacterLite[];
  locations: CharacterLite[];
}

function numbered(list: CharacterLite[], empty: string): string {
  if (list.length === 0) return empty;
  return list.map((c, k) => `${k + 1}. ${c.name} — ${c.description || '(no description)'}${c.hasReference ? ' (has a picture)' : ''}`).join('\n');
}

/** System + user message: the story as acts and scenes, before any shot. */
export function structureMessages(input: StructureInput): { system: string; user: string } {
  const target = input.targetSeconds ?? null;
  const length = target
    ? `The film runs about ${Math.round(target / 60)} minute(s): the scenes' "seconds" add up to about ${target}.`
    : 'A short film of 40 to 90 seconds: the scenes\' "seconds" add up to that.';
  const acts = target && target >= 300 ? '3 to 5 acts' : target && target >= 120 ? '2 or 3 acts' : '1 act';
  const system = `You are a screenwriter. Break the user's story into acts and scenes before any shot is planned. A scene is one place at one time.
Return ONLY JSON, no markdown: {"title": string, "acts": [{"title": string, "summary": string, "scenes": [{"title": string, "summary": string, "location": number|string, "time": string, "cast": [numbers], "props": [numbers|strings], "seconds": number}]}], "newLocations": [{"name": string, "description": string}], "newProps": [{"name": string, "description": string}]}
Rules:
- ${acts}, at most ${STRUCTURE_LIMITS.scenes} scenes in all. ${length} A scene runs 10 to 90 seconds.
- Titles and summaries in the story's language (Thai stays Thai). A summary is 1 to 3 sentences: what happens, who says what.
- "location": a number from the location list, or the name of a NEW place — then also list it in "newLocations". Reuse places: a story returns to the same rooms.
- "time": one of ${Object.keys(TIMES_OF_DAY).join(', ')}.
- "cast": numbers from the cast list of who appears. "props": numbers from the prop list, or names of NEW objects that matter to the story (a weapon, a letter, a car) — then also list them in "newProps". Only objects that appear in more than one shot or drive the plot.
- New places and props: "name" short in the story's language; "description" in English, 15 to 40 words, purely visual (materials, colours, shape, era) so an artist can draw it the same way every time.
- Invent scenes the story implies when it is short; never contradict it. Never add new characters beyond the cast unless the story names them.`;
  const user = `Cast:\n${numbered(input.characters, 'No named characters.')}\n\nLocations:\n${numbered(input.locations, 'None yet.')}\n\nProps:\n${numbered(input.props, 'None yet.')}\n\nStory:\n${input.brief}`;
  return { system, user };
}

const clip = (s: unknown, max: number): string => (typeof s === 'string' ? s.trim().slice(0, max) : '');

/** The acts and scenes from the model's answer, every field checked; null when unusable. */
export function parseStructure(text: string, input: StructureInput): StructurePlan | null {
  const data = extractJson(text) as Record<string, unknown> | null;
  if (!data || !Array.isArray(data.acts)) return null;
  const newLocations: NewAsset[] = [];
  const newProps: NewAsset[] = [];
  const declared = (raw: unknown): NewAsset[] =>
    (Array.isArray(raw) ? raw : [])
      .map((a) => ({ name: clip((a as NewAsset)?.name, LIMITS.characterName), description: clip((a as NewAsset)?.description, LIMITS.characterDescription) }))
      .filter((a) => a.name);
  const declaredLocations = declared(data.newLocations);
  const declaredProps = declared(data.newProps);
  const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

  // A number picks from the library; a name picks a library item of that
  // name, else a new one (described if the answer described it).
  const resolve = (raw: unknown, library: CharacterLite[], fresh: NewAsset[], declaredList: NewAsset[], max: number): number | null => {
    const n = Number(raw);
    if (Number.isInteger(n) && n >= 1 && n <= library.length) return library[n - 1].id;
    const name = clip(raw, LIMITS.characterName);
    if (!name || /^\d+$/.test(name)) return null;
    const known = library.find((c) => sameName(c.name, name));
    if (known) return known.id;
    let at = fresh.findIndex((a) => sameName(a.name, name));
    if (at < 0) {
      if (library.length + fresh.length >= max) return null;
      fresh.push(declaredList.find((a) => sameName(a.name, name)) ?? { name, description: '' });
      at = fresh.length - 1;
    }
    return -1 - at;
  };

  const acts: PlannedAct[] = [];
  let sceneCount = 0;
  for (const rawAct of (data.acts as Record<string, unknown>[]).slice(0, STRUCTURE_LIMITS.acts)) {
    const scenes: PlannedScene[] = [];
    for (const raw of (Array.isArray(rawAct?.scenes) ? (rawAct.scenes as Record<string, unknown>[]) : [])) {
      if (sceneCount >= STRUCTURE_LIMITS.scenes) break;
      const title = clip(raw?.title, STRUCTURE_LIMITS.title);
      const summary = clip(raw?.summary, STRUCTURE_LIMITS.summary);
      if (!title && !summary) continue;
      const cast = (Array.isArray(raw.cast) ? raw.cast : [])
        .map((c) => input.characters[Number(c) - 1]?.id)
        .filter((id): id is number => id !== undefined);
      const props = (Array.isArray(raw.props) ? raw.props : [])
        .map((p) => resolve(p, input.props, newProps, declaredProps, ASSET_KINDS.prop.max))
        .filter((id): id is number => id !== null);
      const seconds = Number(raw.seconds);
      scenes.push({
        title: title || summary.slice(0, 60),
        summary,
        locationRef: resolve(raw.location, input.locations, newLocations, declaredLocations, ASSET_KINDS.location.max),
        timeOfDay: typeof raw.time === 'string' && raw.time in TIMES_OF_DAY ? raw.time : null,
        cast: [...new Set(cast)],
        props: [...new Set(props)],
        seconds: Number.isFinite(seconds) ? Math.min(180, Math.max(5, seconds)) : 30,
      });
      sceneCount++;
    }
    if (scenes.length) acts.push({ title: clip(rawAct?.title, STRUCTURE_LIMITS.title) || `องก์ ${acts.length + 1}`, summary: clip(rawAct?.summary, STRUCTURE_LIMITS.summary), scenes });
  }
  if (sceneCount === 0) return null;

  // Scale the scenes toward the asked-for length; a planner rarely adds up.
  const target = input.targetSeconds ?? null;
  const total = acts.reduce((n, a) => n + a.scenes.reduce((m, s) => m + s.seconds, 0), 0);
  if (target && total > 0 && Math.abs(total - target) > target * 0.1) {
    const f = target / total;
    for (const a of acts) for (const s of a.scenes) s.seconds = Math.max(5, Math.round(s.seconds * f));
  }
  return { title: clip(data.title, LIMITS.title), acts, newLocations, newProps };
}

/**
 * Consecutive scenes grouped into planning calls of about `partSeconds` each,
 * so no single answer is long; a scene longer than that is a call of its own.
 */
export function groupScenes(seconds: number[], partSeconds: number): number[][] {
  const groups: number[][] = [];
  let current: number[] = [];
  let sum = 0;
  seconds.forEach((s, k) => {
    if (current.length && sum + s > partSeconds) {
      groups.push(current);
      current = [];
      sum = 0;
    }
    current.push(k);
    sum += s;
  });
  if (current.length) groups.push(current);
  return groups;
}

/**
 * Where a shot goes when its scene's shots are re-planned: the new ones take
 * the old ones' place in the film, or — a scene that had none — follow the
 * shots of the scenes before it. Returns the new order of shot keys.
 */
export function spliceScene<T>(
  shots: { key: T; sceneOrder: number | null; inScene: boolean }[],
  fresh: T[],
  sceneOrder: number
): T[] {
  const first = shots.findIndex((s) => s.inScene);
  const kept = shots.filter((s) => !s.inScene);
  let at: number;
  if (first >= 0) at = shots.slice(0, first).filter((s) => !s.inScene).length;
  else {
    const after = kept.findIndex((s) => s.sceneOrder !== null && s.sceneOrder > sceneOrder);
    at = after >= 0 ? after : kept.length;
  }
  const keys = kept.map((s) => s.key);
  keys.splice(at, 0, ...fresh);
  return keys;
}
