import { chatViaPool } from '@/lib/services/prompt-enhancer';
import {
  FILM_PART_SECONDS,
  LIMITS,
  filmPlannerMessages,
  fitToTarget,
  mvPlannerMessages,
  parseFilmPlan,
  parseMvPlan,
  planFromRules,
  type CharacterLite,
  type PartScene,
  type ShotDraft,
  type TimelineSlot,
} from './cinematic';
import { TIMES_OF_DAY, groupScenes, parseStructure, structureMessages, type StructureInput, type StructurePlan } from './library';

/**
 * Planning a film as acts → scenes → shots: one call cuts the story into acts
 * and scenes (and names the places and props it needs), then the scenes'
 * shots are written in groups of about FILM_PART_SECONDS, all at once. Each
 * shot knows its scene, so a scene can later be re-planned on its own.
 *
 * Talks to the chat models only; storing the result is service.ts's job.
 */

/** A scene as the shot planner sees it. */
export interface SceneBrief {
  title: string;
  summary: string;
  /** Library location id (negative = a place the structure step added). */
  locationRef: number | null;
  timeOfDay: string | null;
  cast: number[];
  props: number[];
  seconds: number;
}

export interface StructuredFilm {
  structure: StructurePlan;
  /** `scene` is the 1-based scene number in film order; props may be negative (new). */
  shots: ShotDraft[];
  engine: string;
  fallbackReason?: string;
}

/** The new places and props as planner list entries, with the negative ids library.ts uses for them. */
export function withNewAssets(input: StructureInput, structure: Pick<StructurePlan, 'newLocations' | 'newProps'>): { props: CharacterLite[]; locations: CharacterLite[] } {
  const fresh = (list: { name: string; description: string }[]) =>
    list.map((a, k) => ({ id: -1 - k, name: a.name, description: a.description, hasReference: false }));
  return { props: [...input.props, ...fresh(structure.newProps)], locations: [...input.locations, ...fresh(structure.newLocations)] };
}

function partScene(scene: SceneBrief, number: number, input: StructureInput, props: CharacterLite[], locations: CharacterLite[]): PartScene {
  const indexOf = (list: CharacterLite[], id: number) => list.findIndex((c) => c.id === id) + 1;
  return {
    number,
    title: scene.title,
    summary: scene.summary,
    place: locations.find((l) => l.id === scene.locationRef)?.name ?? '',
    time: scene.timeOfDay ? TIMES_OF_DAY[scene.timeOfDay]?.prompt ?? '' : '',
    seconds: scene.seconds,
    cast: scene.cast.map((id) => indexOf(input.characters, id)).filter((n) => n > 0),
    props: scene.props.map((id) => indexOf(props, id)).filter((n) => n > 0),
  };
}

/** The rules' shots for one scene, when the model gave nothing usable for it. */
function rulesForScene(input: StructureInput, scene: SceneBrief, number: number, maxShots: number): ShotDraft[] {
  const cast = input.characters.filter((c) => scene.cast.includes(c.id));
  return planFromRules({ ...input, characters: cast.length ? cast : input.characters, brief: scene.summary || scene.title, targetSeconds: scene.seconds })
    .slice(0, Math.max(1, maxShots))
    .map((s) => ({ ...s, scene: number, propIds: scene.props }));
}

/**
 * The shots of a run of scenes, `numbers[k]` being scene k's number in the
 * film. One call (two tries), then the rules per scene. Every shot comes back
 * tagged with a scene of the run.
 */
export async function planSceneShots(
  input: StructureInput,
  all: SceneBrief[],
  numbers: number[],
  opts: { index: number; count: number; maxShots: number; props: CharacterLite[]; locations: CharacterLite[] },
  failed: string[]
): Promise<ShotDraft[]> {
  const scenes = numbers.map((n) => all[n - 1]);
  const seconds = scenes.reduce((n, s) => n + s.seconds, 0);
  const part = {
    index: opts.index,
    count: opts.count,
    summary: scenes.map((s) => s.title).join(' / '),
    seconds,
    outline: all.map((s) => `${s.title}: ${s.summary}`),
    maxShots: opts.maxShots,
    scenes: scenes.map((s, k) => partScene(s, numbers[k], input, opts.props, opts.locations)),
  };
  const shotInput = { ...input, props: opts.props, locations: opts.locations };
  const { system, user } = filmPlannerMessages(shotInput, part);
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const answer = await chatViaPool(system, user, { maxTokens: 16_000, maxChars: 60_000, timeoutMs: 120_000 });
      const plan = parseFilmPlan(answer.text, shotInput);
      if (plan) {
        let last = numbers[0];
        const shots = plan.shots.slice(0, opts.maxShots).map((s) => {
          // A shot tagged with a scene outside this run, or none, stays with the one before it.
          const scene = s.scene && numbers.includes(s.scene) && s.scene >= last ? s.scene : last;
          last = scene;
          return { ...s, scene };
        });
        return fitToTarget(shots, seconds);
      }
      failed.push(`scenes ${numbers.join(',')} try ${attempt}: no usable shots`);
    } catch (error) {
      failed.push(`scenes ${numbers.join(',')} try ${attempt}: ${(error as Error).message.slice(0, 200)}`);
    }
  }
  const share = Math.max(1, Math.floor(opts.maxShots / numbers.length));
  return numbers.flatMap((n) => rulesForScene(input, all[n - 1], n, share));
}

export function flattenScenes(structure: StructurePlan): SceneBrief[] {
  return structure.acts.flatMap((a) => a.scenes);
}

/** The whole film, structure first. Null when the structure step gave nothing usable. */
export async function planStructuredFilm(input: StructureInput): Promise<StructuredFilm | null> {
  const head = structureMessages(input);
  const reply = await chatViaPool(head.system, head.user, { maxTokens: 12_000, maxChars: 60_000, timeoutMs: 120_000 });
  const structure = parseStructure(reply.text, input);
  if (!structure) return null;

  const scenes = flattenScenes(structure);
  const total = scenes.reduce((n, s) => n + s.seconds, 0);
  const groups = groupScenes(scenes.map((s) => s.seconds), FILM_PART_SECONDS);
  const { props, locations } = withNewAssets(input, structure);
  const failed: string[] = [];
  const parts = await Promise.all(
    groups.map((group, index) => {
      const seconds = group.reduce((n, k) => n + scenes[k].seconds, 0);
      // Each run's share of the film's shots, so together they never pass the limit.
      const maxShots = Math.max(group.length, Math.floor((LIMITS.shotsFilm * seconds) / Math.max(1, total)));
      return planSceneShots(input, scenes, group.map((k) => k + 1), { index, count: groups.length, maxShots, props, locations }, failed);
    })
  );
  return {
    structure,
    shots: parts.flat().slice(0, LIMITS.shotsFilm),
    engine: `${reply.engine} · ${structure.acts.length} acts · ${scenes.length} scenes`,
    fallbackReason: failed.length ? failed.join(' | ') : undefined,
  };
}

/** An MV scene's shots again, on the slots its shots hold now. Null when the model gave nothing usable. */
export async function planMvSlots(input: StructureInput, slots: TimelineSlot[]): Promise<ShotDraft[] | null> {
  const { system, user } = mvPlannerMessages(input, slots);
  const reply = await chatViaPool(system, user, { maxTokens: 8000, maxChars: 60_000, timeoutMs: 120_000 });
  return parseMvPlan(reply.text, input, slots)?.shots ?? null;
}
