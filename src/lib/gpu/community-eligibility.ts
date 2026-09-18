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
  /** Kinds of work the client measured itself able to do: image · video · upscale · embed. */
  canRun?: string[];
}

export type EligibilityStatus = 'eligible' | 'unassessed' | 'offline' | 'no-matching-model';

export interface Eligibility {
  status: EligibilityStatus;
  /** Thai, and written to be shown to the machine's owner rather than to us. */
  note: string;
  modelKey: string | null;
}

export function assessCommunityNode(
  node: NodeReport,
  catalogue: readonly DispatchableModel[]
): Eligibility {
  if (!node.assessed) {
    return {
      status: 'unassessed',
      note: 'เครื่องยังไม่ผ่านการประเมิน — โปรแกรมจะวัดให้เองเมื่อ ComfyUI พร้อม',
      modelKey: null,
    };
  }

  const kinds = new Set(node.canRun ?? []);
  if (kinds.size === 0) {
    return {
      status: 'no-matching-model',
      note: 'ผลประเมินระบุว่าเครื่องนี้ยังทำงานประเภทใดไม่ได้',
      modelKey: null,
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
    };
  }

  // The heaviest model it can hold. A machine that can serve the demanding one
  // can serve the light one too, and pinning it to the light one would waste
  // the only capacity on the network able to do the hard job.
  const best = candidates.reduce((max, entry) =>
    entry.hardware.minVramMb > max.hardware.minVramMb ? entry : max
  );

  if (!node.online) {
    return {
      status: 'offline',
      note: 'เครื่องผ่านการประเมินแล้ว แต่ตอนนี้ยังไม่ได้เชื่อมต่อ',
      modelKey: best.key,
    };
  }

  return {
    status: 'eligible',
    note: `พร้อมรับงาน ${best.name}`,
    modelKey: best.key,
  };
}
