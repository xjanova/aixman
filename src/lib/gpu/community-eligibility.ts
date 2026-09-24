/**
 * The part of a catalogue entry this decision needs.
 *
 * Named separately, and passed in rather than imported, so the rule can be
 * exercised without loading the real catalogue — which imports every workflow
 * template as JSON and cannot be loaded by a plain `node --test` at all.
 */
export interface DispatchableModel {
  key: string;
  name: string;
  kind: string;
  hardware: { minVramMb: number };
  /**
   * Which machines the entry runs on (catalog.ts `pools`). An entry that
   * declares pools without `community` is never offered to a home node, even
   * when a caller hands in the whole catalogue: its weights are downloaded
   * onto rented machines and no home PC has them. Absent (test fixtures,
   * older callers) means no restriction.
   */
  pools?: readonly string[];
}

/** The entries a community node may be matched to at all. */
export function communityEntries<T extends DispatchableModel>(catalogue: readonly T[]): T[] {
  return catalogue.filter((entry) => !entry.pools || entry.pools.includes('community'));
}

/**
 * Whether a community machine can be given work, and which model.
 *
 * Kept out of the route handler so it can be tested without a database: this
 * is the one judgement in the whole hand-off, and getting it wrong is either a
 * customer's job dying on a card that was never going to hold the weights, or
 * an owner's machine sitting idle for a reason nobody can name.
 */

export interface NodeReport {
  /** False until the client has measured itself. Nothing is dispatched before then. */
  assessed?: boolean;
  online?: boolean;
  vramTotalMb?: number;
  /** Kinds of work the client measured itself able to do: image · video · audio · upscale · embed. */
  canRun?: string[];
  /**
   * How fast each of those kinds is on this machine: `full` for work somebody
   * is waiting on, `slow` for work sitting in a queue.
   *
   * Absent on a node that has not been re-measured since the client learned to
   * report it, and absence means the fast lane — which is what this platform
   * assumed about every node before lanes existed.
   */
  lanes?: Record<string, string>;
  /** Kinds whose lane the node was given on trust and has not yet earned on real jobs. */
  provisional?: string[];
}

export type EligibilityStatus = 'eligible' | 'unassessed' | 'offline' | 'no-matching-model';

/** How quickly the assigned model runs here, and therefore who may be waiting on it. */
export type Lane = 'full' | 'slow';

export interface Eligibility {
  status: EligibilityStatus;
  /** Thai, and written to be shown to the machine's owner rather than to us. */
  note: string;
  modelKey: string | null;
  /**
   * `slow` means this machine really does the work and should be given it —
   * just not with a customer watching a progress bar on the other end.
   */
  lane: Lane;
  /** True while the lane is the node's opening assumption rather than a measured fact. */
  provisional: boolean;
}

export function assessCommunityNode(
  node: NodeReport,
  fullCatalogue: readonly DispatchableModel[]
): Eligibility {
  const catalogue = communityEntries(fullCatalogue);

  if (!node.assessed) {
    return {
      status: 'unassessed',
      note: 'เครื่องยังไม่ผ่านการประเมิน — โปรแกรมจะวัดให้เองเมื่อ ComfyUI พร้อม',
      modelKey: null,
      lane: 'full',
      provisional: false,
    };
  }

  const kinds = new Set(node.canRun ?? []);
  if (kinds.size === 0) {
    return {
      status: 'no-matching-model',
      note: 'ผลประเมินระบุว่าเครื่องนี้ยังทำงานประเภทใดไม่ได้',
      modelKey: null,
      lane: 'full',
      provisional: false,
    };
  }

  const vram = node.vramTotalMb ?? 0;

  // Strict about VRAM on purpose. The catalogue's `minVramMb` is what the model
  // needs to hold its weights; a card below it fails every job of that kind, so
  // being generous here would only move the failure to after the customer has
  // paid and waited.
  //
  // The vocabularies meet at `kind`: the client reports image/video/upscale/
  // embed, the catalogue is keyed the same way for the first two. `upscale` and
  // `embed` are real work a node can do that nothing on this platform
  // dispatches yet — worth saying plainly rather than hiding.
  const candidates = catalogue.filter(
    (entry) => kinds.has(entry.kind) && vram >= entry.hardware.minVramMb
  );

  if (candidates.length === 0) {
    // `reduce` with no seed throws on an empty array, and an empty catalogue is
    // a real state during setup — every node would 500 on its first sync.
    const cheapest = catalogue.length > 0
      ? catalogue.reduce((min, entry) => (entry.hardware.minVramMb < min.hardware.minVramMb ? entry : min))
      : null;

    return {
      status: 'no-matching-model',
      note:
        cheapest !== null && vram > 0 && vram < cheapest.hardware.minVramMb
          ? `การ์ดมี VRAM ${(vram / 1024).toFixed(1)} GB · โมเดลที่กินน้อยที่สุดในระบบต้องการ ${(
              cheapest.hardware.minVramMb / 1024
            ).toFixed(0)} GB`
          : 'ยังไม่มีโมเดลในแคตตาล็อกที่ตรงกับงานที่เครื่องนี้รับได้',
      modelKey: null,
      lane: 'full',
      provisional: false,
    };
  }

  // Fast work first, and only then the heaviest.
  //
  // The old rule was "the heaviest model it can hold", on the reasoning that a
  // machine able to do the hard job should not be pinned to the easy one. That
  // still holds inside a lane. Across lanes it does not: a card that is quick
  // at music and four minutes slow at images should be given the music, not an
  // image assignment that keeps a customer waiting because the image model
  // happens to be the bigger one.
  const laneOf = (kind: string): Lane => (node.lanes?.[kind] === 'slow' ? 'slow' : 'full');

  const fast = candidates.filter((entry) => laneOf(entry.kind) === 'full');
  const pool = fast.length > 0 ? fast : candidates;
  const lane: Lane = fast.length > 0 ? 'full' : 'slow';

  const best = pool.reduce((max, entry) =>
    entry.hardware.minVramMb > max.hardware.minVramMb ? entry : max
  );

  const provisional = (node.provisional ?? []).includes(best.kind);

  if (!node.online) {
    return {
      status: 'offline',
      note: 'เครื่องผ่านการประเมินแล้ว แต่ตอนนี้ยังไม่ได้เชื่อมต่อ',
      modelKey: best.key,
      lane,
      provisional,
    };
  }

  return {
    status: 'eligible',
    note:
      lane === 'slow'
        ? `พร้อมรับงาน ${best.name} — แต่ช้ากว่าที่คนนั่งรอจะยอม ส่งเฉพาะงานที่ไม่มีคนรอ`
        : provisional
          ? `พร้อมรับงาน ${best.name} — รอบแรก ยังไม่มีเวลาจริงมายืนยัน`
          : `พร้อมรับงาน ${best.name}`,
    modelKey: best.key,
    lane,
    provisional,
  };
}
