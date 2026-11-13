import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import prisma from '@/lib/db';
import { audioDurationSeconds } from '@/lib/audio-duration';
import { GenerationService } from '@/lib/services/generation';
import { generationErrorResponse } from '@/lib/services/generation-errors';
import { ModelReadiness } from '@/lib/services/model-readiness';
import { kieQuote, readKiePriceTable, speechChars } from '@/lib/providers/kie-pricing';
import { uploadBuffer } from '@/lib/storage/r2';
import { packMsg } from '@/lib/i18n/messages';
import type { Msg } from '@/lib/i18n/locale';
import { StoryError, customerMsg, type StoryProjectFull } from './service';
import { download } from './media';
import { DUB_MODEL_KEY, dubbingSettings, dubShotSeconds, dubText, shotVoice, spokenText } from './dubbing';

const ORPHAN_MS = 10 * 60_000;
const FAILED: Msg = { th: 'พากย์ไม่สำเร็จ ตรวจคำสั่งในแกลเลอรีแล้วลองใหม่', en: 'Dubbing failed. Check the order in your gallery, then try again.' };
const INCOMPLETE: Msg = { th: 'คำสั่งพากย์ค้าง ตรวจในแกลเลอรีก่อนสั่งใหม่', en: 'The dubbing order got stuck. Check the gallery before ordering again.' };
const UNREADABLE: Msg = { th: 'อ่านความยาวเสียงพากย์ไม่ได้ ลองพากย์ใหม่', en: 'Could not read the dub’s duration. Try dubbing again.' };

export async function speechModel(admin: boolean) {
  const row = await prisma.aiModel.findFirst({
    where: { modelId: DUB_MODEL_KEY, isActive: true, provider: { slug: 'kie', isActive: true } },
    select: { id: true, name: true, creditsPerUnit: true, defaultParams: true, readiness: true },
  });
  return row ? { ...row, orderable: ModelReadiness.canOrder(row.readiness, admin) } : null;
}
export function speechCredits(model: Awaited<ReturnType<typeof speechModel>>, text: string): number | null {
  if (!model || !spokenText(text)) return null;
  const table = readKiePriceTable(model.defaultParams);
  return table ? kieQuote(table, { chars: speechChars(text) }) : model.creditsPerUnit;
}
export interface SpeechClaim { id: number; startedAt: Date }

export async function claimSpeech(project: StoryProjectFull, ids: number[]): Promise<SpeechClaim[]> {
  if (project.mode !== 'film') throw new StoryError({ th: 'พากย์บทพูดใช้กับโหมดหนังและซีรีส์', en: 'Dialogue dubbing is for films and series.' });
  if (!dubbingSettings(project.scriptJson).enabled) throw new StoryError({ th: 'เปิดใช้เสียงพากย์ตามบทก่อน', en: 'Turn on dialogue dubbing first.' }, 409);
  if (project.status === 'assembling') throw new StoryError({ th: 'รอตัดต่อเสร็จก่อน', en: 'Wait for the cut to finish first.' }, 409);
  const shots = project.shots.filter((s) => ids.includes(s.id) && spokenText(s.narration ?? ''));
  for (const s of shots) {
    if (!shotVoice(s, project)) throw new StoryError({ th: `ช็อต ${s.shotNumber}: เลือกเสียงให้ผู้พูดก่อน`, en: `Shot ${s.shotNumber}: choose the speaker’s voice first.` }, 422);
  }
  const claims: SpeechClaim[] = [];
  for (const shot of shots) {
    const startedAt = new Date();
    const r = await prisma.aiStoryShot.updateMany({
      where: { id: shot.id, projectId: project.id, updatedAt: shot.updatedAt, status: { not: 'rendering' },
        AND: [{ OR: [{ dubStatus: null }, { dubStatus: { not: 'rendering' } }] }, { OR: [{ lipsyncStatus: null }, { lipsyncStatus: { not: 'rendering' } }] }] },
      data: { dubStatus: 'rendering', dubGenerationId: null, dubStartedAt: startedAt, dubError: null,
        dubText: dubText(shot.narration ?? '', shot.delivery), dubVoiceId: shotVoice(shot, project), audioUrl: null, dubSeconds: null },
    });
    if (r.count) claims.push({ id: shot.id, startedAt });
  }
  return claims;
}

export async function placeSpeech(userId: number, admin: boolean, projectId: number, claims: SpeechClaim[]): Promise<void> {
  const fail = (c: SpeechClaim, msg: Msg) => prisma.aiStoryShot.updateMany({
    where: { id: c.id, projectId, dubStatus: 'rendering', dubStartedAt: c.startedAt, dubGenerationId: null },
    data: { dubStatus: 'failed', dubError: packMsg(msg) },
  });
  try {
    const model = await speechModel(admin);
    if (!model?.orderable) throw new StoryError({ th: 'ElevenLabs V3 ยังไม่เปิดให้ใช้', en: 'ElevenLabs V3 is not available yet.' }, 409);
    for (const [k, claim] of claims.entries()) {
      const shot = await prisma.aiStoryShot.findFirst({ where: { id: claim.id, projectId, dubStatus: 'rendering', dubStartedAt: claim.startedAt, dubGenerationId: null } });
      if (!shot?.dubText || !shot.dubVoiceId) continue;
      try {
        const result = await GenerationService.generate(userId,
          { modelId: model.id, type: 'audio', prompt: shot.dubText, params: { voice: shot.dubVoiceId } },
          { isAdmin: admin, deferApi: true });
        await prisma.aiStoryShot.updateMany({
          where: { id: claim.id, projectId, dubStatus: 'rendering', dubStartedAt: claim.startedAt, dubGenerationId: null },
          data: { dubGenerationId: result.id },
        });
      } catch (e) {
        await fail(claim, customerMsg(e));
        if (generationErrorResponse(e)?.status === 402) {
          for (const rest of claims.slice(k + 1)) await fail(rest, customerMsg(e));
          break;
        }
      }
    }
  } catch (e) {
    for (const c of claims) await fail(c, customerMsg(e));
  }
}

const syncing = new Set<number>();
export async function syncSpeech(project: StoryProjectFull): Promise<boolean> {
  if (project.mode !== 'film') return false;
  let changed = false;
  let measured = 0;
  for (const shot of project.shots.filter((s) => s.dubStatus === 'rendering')) {
    if (syncing.has(shot.id)) continue;
    syncing.add(shot.id);
    try {
      const where = { id: shot.id, dubStatus: 'rendering', dubGenerationId: shot.dubGenerationId, dubStartedAt: shot.dubStartedAt };
      let data: Parameters<typeof prisma.aiStoryShot.updateMany>[0]['data'] | null = null;
      if (!shot.dubGenerationId) {
        if (shot.dubStartedAt && Date.now() - shot.dubStartedAt.getTime() > ORPHAN_MS) data = { dubStatus: 'failed', dubError: packMsg(INCOMPLETE) };
      } else {
        const gen = await prisma.aiGeneration.findFirst({ where: { id: shot.dubGenerationId, userId: project.userId }, select: { status: true, resultUrl: true, creditsRefunded: true } });
        if (gen?.status === 'completed' && gen.resultUrl) {
          if (measured >= 3) continue;
          measured++;
          const dir = await mkdtemp(path.join(tmpdir(), 'aixman-dub-'));
          try {
            await download(gen.resultUrl, path.join(dir, 'voice.bin'), 20 * 1024 * 1024, { th: 'เสียงพากย์', en: 'the dub' });
            const bytes = await readFile(path.join(dir, 'voice.bin'));
            const ext = ['mp3', 'wav', 'm4a', 'flac', 'ogg'].find((e) => audioDurationSeconds(bytes, e) !== null);
            const seconds = ext ? audioDurationSeconds(bytes, ext) : null;
            if (!ext || !seconds) data = { dubStatus: 'failed', dubError: packMsg(UNREADABLE) };
            else {
              const mime = { mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', flac: 'audio/flac', ogg: 'audio/ogg' }[ext]!;
              const audioUrl = await uploadBuffer(bytes, `story/${project.userId}/${project.id}/dub-${shot.id}-${shot.dubGenerationId}.${ext}`, mime);
              const durationSec = dubShotSeconds(seconds);
              data = { dubStatus: 'done', audioUrl, dubSeconds: seconds, dubError: null, ...(durationSec ? { durationSec } : {}) };
            }
          } catch (e) {
            console.error(`[story] measure dub ${shot.id}:`, e);
            // A transient storage error can be retried by the next poll without buying another dub.
            if (shot.dubStartedAt && Date.now() - shot.dubStartedAt.getTime() > 30 * 60_000) data = { dubStatus: 'failed', dubError: packMsg(UNREADABLE) };
          } finally { await rm(dir, { recursive: true, force: true }); }
        } else if (!gen || ['failed', 'cancelled'].includes(gen.status)) {
          data = { dubStatus: 'failed', dubError: packMsg(gen?.creditsRefunded ? { th: `${FAILED.th} (คืนเครดิตแล้ว)`, en: `${FAILED.en} (Credits refunded.)` } : FAILED) };
        }
      }
      if (data) changed = (await prisma.aiStoryShot.updateMany({ where, data })).count > 0 || changed;
    } finally { syncing.delete(shot.id); }
  }
  return changed;
}
