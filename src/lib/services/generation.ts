import { after } from 'next/server';
import prisma, { SLOW_DB_TX } from '@/lib/db';
import { Prisma } from '@/generated/prisma/client';
import { getProvider } from '@/lib/providers';
import { KieProvider } from '@/lib/providers/kie';
import { FalProvider } from '@/lib/providers/fal';
import { decrypt } from '@/lib/utils/encryption';
import { getGpuProvider } from '@/lib/gpu';
import { AccountPoolManager } from './account-pool';
import { ApiProgress } from './api-progress';
import { ModelReadiness, TUNING_MESSAGE } from './model-readiness';
import { persistAssetSafe, isStorageConfigured, keyFromPublicUrl } from '@/lib/storage/r2';
import { referenceCaps } from '@/lib/reference-caps';
import { songLyrics } from '@/lib/output-lyrics';
import type { GenerationRequest, GenerationResult, ProviderResponse, ProviderSlug } from '@/types';
import { fitFrame } from '@/lib/gpu/frame';
import { getCatalogEntry, isAdminOnlyPreset, isCommunityOnlyModel, isRetiredCatalogKey, orderNeedsProviderAccount } from '@/lib/gpu/catalog';
import { isAcceptedAudioSource, isAcceptedFrameSource, isAcceptedVideoSource, openVideoSource, readAudioSource } from '@/lib/gpu/frame-input';
import { probeVideo } from '@/lib/video-probe';
import { apiVideoLipsyncRule, checkClip, checkVoice, lipsyncCredits, type ClipFacts } from '@/lib/lipsync-rules';
import { audioDurationSeconds } from '@/lib/audio-duration';
import { voiceRenderSeconds, type LengthFromAudio } from '@/lib/voice-length';
import { creditsForDuration } from '@/lib/pricing';
import { sanitizeMusicParams } from '@/lib/music-style';
import { getGpuConfig } from '@/lib/gpu/config';
import { getStoredWorkflow, pickQualityMode } from '@/lib/gpu/workflow-overrides';
import { GpuBalance, RENDERING_PAUSED_MESSAGE } from './gpu-balance';
import { raiseAlert } from '@/lib/notify/alerts';
import { BLOCKED_LABEL, blockedMessage, classifyContent, type ContentAssessment } from '@/lib/safety/content-tier';
import { communityOrderRefusal, communityRefusalMessage } from '@/lib/gpu/community-dispatch';
import { communityMachineAvailable } from '@/lib/gpu/community-availability';
import { OrderRefusedError } from './order-refusal';
import { LLM_CATEGORY } from '@/lib/llm/pricing';
import { getKieEntry, kieImageCount, kiePriceTable } from '@/lib/providers/kie-catalog';
import {
  checkSunoSource,
  sanitizeSunoParams,
  sunoMissingSource,
  sunoTakesSource,
  type SunoParams,
} from '@/lib/providers/kie-suno';
import { kieQuote, pickKieDuration, pickKieTier, readKiePriceTable, speechChars } from '@/lib/providers/kie-pricing';
import { fallbackParams, kieRefusalReason, routeKieOrder, type FallbackOrder } from '@/lib/providers/kie-fallback';
import { kieUnavailable, loadFallbackSettings, pickFallback, type ModelWithProvider, type PoolAccount } from './kie-route';

/**
 * Why an order was refused when its type and its model disagree about whether
 * a 3D model is coming. Thai, because /api/generate shows it as it is.
 */
export const TYPE_MISMATCH_MESSAGE = 'โมเดลนี้ไม่รองรับงานประเภทนี้';

/**
 * Orders this process is waiting on right now (runApiOrder), and whether a
 * restart could still collect each one (its vendor job is stored).
 */
const runningOrders = new Map<number, { resumable: boolean }>();

/** Vendors whose jobs can be read back after a restart (resumeApiOrder). */
export const RESUMABLE_PROVIDERS = new Set(['kie', 'fal']);

/** An API order already charged, handed to the call that runs it. */
interface ApiOrderRun {
  userId: number;
  generationId: number;
  model: ModelWithProvider;
  request: GenerationRequest;
  styleSuffix: string;
  /** The key the order runs on: KIE's, or its fallback's when `kie.preRouted`. */
  account: PoolAccount;
  requiredCredits: number;
  /** How long the provider may take (lipsync-rules.ts); its own default when unset. */
  maxWaitSeconds?: number;
  /**
   * A KIE order (kie-fallback.ts): what a fallback row must be able to do,
   * and the row chosen before charging when no KIE key could take it.
   */
  kie?: { order: FallbackOrder; preRouted: { model: ModelWithProvider; reason: string } | null };
}

/** What `params.route` says on an order a fallback row ran: read by /admin/kie. */
function orderRoute(target: ModelWithProvider, reason: string): Record<string, unknown> {
  return {
    via: 'fallback',
    provider: target.provider.slug,
    modelId: target.modelId,
    name: target.name,
    reason,
    at: new Date().toISOString(),
  };
}

/**
 * Generation Service
 * Orchestrates AI generation requests across providers with account pool rotation
 */
export class GenerationService {
  /**
   * Submit a new generation request
   */
  static async generate(
    userId: number,
    request: GenerationRequest,
    options: {
      isAdmin?: boolean;
      /**
       * The attached image is one of this customer's own finished renders (an
       * upscale), not a photo they uploaded: "clothes off an attached photo"
       * does not apply to it. It still never goes to a community machine.
       */
      inputIsOwnRender?: boolean;
      /**
       * Run an API order after the response, as video lip-sync does, and
       * answer `processing` at once: the movie studio orders a whole scene's
       * opening pictures in one request and polls them.
       */
      deferApi?: boolean;
    } = {}
  ): Promise<GenerationResult> {
    // 1. Get the model and provider info
    const model = await prisma.aiModel.findUnique({
      where: { id: request.modelId },
      include: { provider: true },
    });

    // Language models are sold through /api/v1 by token, not as a studio order.
    if (!model || !model.isActive || model.category === LLM_CATEGORY) {
      throw new Error('Model not found or inactive');
    }

    if (!model.provider.isActive) {
      throw new Error('Provider is currently unavailable');
    }

    // Checked before any credit is deducted: an unproven model must not be able
    // to take payment for a render it cannot deliver. Admins are exempt because
    // running it is exactly how a model gets proven and promoted.
    if (!ModelReadiness.canOrder(model.readiness, options.isAdmin === true)) {
      throw new Error(TUNING_MESSAGE);
    }

    // The row's type is what the gallery, the studios and the download read to
    // know a GLB is coming rather than a picture. A 3D order sent to a picture
    // model — or a picture order to a 3D one — is refused before credits move.
    if ((request.type === 'model3d') !== (model.category === 'model3d')) {
      throw new Error(TYPE_MISMATCH_MESSAGE);
    }

    // What the order asks for, from its words, before anything is charged
    // (owner decision D4). Terms §6 content is refused here for every model
    // and every provider; the tier is stored with the order and decides
    // whether a GPUxMINE home PC may ever see it. A style's suffix and song
    // lyrics are words the model reads too.
    // A speech order's prompt is the text read aloud: a style's suffix would be read out with it.
    const speech = model.provider.slug === 'kie' ? getKieEntry(model.modelId)?.speech : undefined;
    const styleSuffix = request.styleId && !speech ? await this.getStyleSuffix(request.styleId) : '';
    const references = this.checkReferences(model, request.referenceImages);
    const hasInputMedia =
      references.length > 0 ||
      [request.inputImage, request.inputImageEnd, request.inputAudio, request.inputVideo].some(
        (v) => typeof v === 'string' && v.trim() !== ''
      );
    const content = classifyContent({
      prompt: request.prompt,
      negativePrompt: request.negativePrompt,
      extraText: [
        styleSuffix,
        typeof request.params?.lyrics === 'string' ? request.params.lyrics : undefined,
        typeof request.params?.speechStyle === 'string' ? request.params.speechStyle : undefined,
      ],
      hasInputMedia: hasInputMedia && options.inputIsOwnRender !== true,
    });
    if (content.tier === 'blocked') this.refuseBlocked(userId, model.name, content);

    // A rented-GPU render has to be copied to R2 before the machine goes, and
    // the queue will not rent without it. Refuse here, before credits move,
    // instead of charging and refunding a tick later.
    const gpuModel = getGpuProvider(model.provider.slug) !== null;
    // Its row can still be active until an admin syncs the catalogue, and with
    // no entry the queue would rent an H3 machine for it.
    if (gpuModel && isRetiredCatalogKey(model.modelId)) {
      throw new OrderRefusedError('โมเดลนี้ถูกปลดออกแล้ว กรุณาเลือกโมเดลอื่น', 'model-retired', 422);
    }
    // A KIE row is priced and built from its catalogue entry (kie-catalog.ts).
    // One whose entry was removed would be sent to KIE as a model it does not
    // know, after the customer was charged.
    const kie = model.provider.slug === 'kie' ? getKieEntry(model.modelId) : undefined;
    if (model.provider.slug === 'kie' && !kie) {
      throw new OrderRefusedError('โมเดลนี้ถูกปลดออกแล้ว กรุณาเลือกโมเดลอื่น', 'model-retired', 422);
    }
    if (kie?.category === 'edit' && !request.inputImage?.trim()) {
      throw new OrderRefusedError('ต้องอัปโหลดภาพที่จะแก้ก่อน', 'missing-image', 422);
    }
    if (kie?.lengthFromAudio) {
      if (!isAcceptedAudioSource(request.inputAudio)) {
        throw new OrderRefusedError('ต้องอัปโหลดไฟล์เสียงที่จะให้พูดก่อน', 'missing-audio', 422);
      }
      if (!request.inputImage?.trim()) throw new OrderRefusedError('ต้องอัปโหลดรูปคนที่จะให้พูดก่อน', 'missing-image', 422);
    }
    // KIE fetches every picture, voice and clip itself, on our account, so
    // each must be one of ours (or a picture the adapter uploads from a data:
    // URI). /api/generate checks voices, clips and last frames; the first
    // frame, and orders from MCP, are checked only here.
    if (kie) {
      const strange =
        [request.inputImage, request.inputImageEnd].some((src) => !!src?.trim() && !isAcceptedFrameSource(src)) ||
        [request.inputAudio, request.inputVideo].some((src) => !!src?.trim() && !keyFromPublicUrl(src));
      if (strange) throw new OrderRefusedError('ไฟล์ที่แนบไม่ถูกต้อง กรุณาอัปโหลดใหม่', 'invalid-input', 422);
    }
    if (kie?.needsImage && !request.inputImage?.trim()) {
      throw new OrderRefusedError('ต้องอัปโหลดภาพตัวละครก่อน', 'missing-image', 422);
    }
    // A Suno tool that works on a track (cover, extension, stems …) is checked
    // against the stored file before charging — KIE refuses a long one after
    // taking the order — and an extension's start is fixed inside the track.
    let suno: SunoParams | undefined = kie?.suno ? sanitizeSunoParams(request.params?.suno) : undefined;
    if (kie?.suno && sunoTakesSource(kie.suno)) {
      if (!isAcceptedAudioSource(request.inputAudio)) {
        throw new OrderRefusedError(sunoMissingSource(kie.suno), 'missing-audio', 422);
      }
      // A mashup's second track is held to the first one's rules: ours, readable, not too long.
      const mashWith = kie.suno === 'mashup' ? suno?.mashWith : undefined;
      if (mashWith && !keyFromPublicUrl(mashWith)) throw new OrderRefusedError('ไฟล์ที่แนบไม่ถูกต้อง กรุณาอัปโหลดใหม่', 'invalid-input', 422);
      const second = mashWith ? await this.voiceFacts(mashWith) : undefined;
      const fits = checkSunoSource(kie.suno, await this.voiceFacts(request.inputAudio), suno ?? {}, second);
      if (!fits.ok) throw new OrderRefusedError(fits.message, fits.code, 422);
      if (fits.continueAt !== undefined) suno = { ...suno, continueAt: fits.continueAt };
    }
    // Speech is priced by its characters, so the text is checked here, not after the charge.
    const speechLength = speech ? speechChars(request.prompt) : 0;
    if (speech && speechLength === 0) throw new OrderRefusedError('ใส่ข้อความที่จะให้อ่านก่อน', 'missing-text', 422);
    if (speech && speechLength > speech.maxChars) {
      throw new OrderRefusedError(
        `ข้อความยาวเกินไป (${speechLength.toLocaleString('en-US')} ตัวอักษร) — โมเดลนี้อ่านได้ครั้งละไม่เกิน ${speech.maxChars.toLocaleString('en-US')} ตัวอักษร`,
        'text-too-long',
        422
      );
    }

    if (gpuModel && !isStorageConfigured()) {
      raiseAlert({
        type: 'config-error',
        key: 'storage',
        level: 'critical',
        title: 'ยังไม่ได้ตั้งค่า R2 — ลูกค้าสั่งงานโมเดลเช่า GPU ไม่ได้',
        lines: [`ลูกค้าเพิ่งโดนปฏิเสธที่โมเดล ${model.name}`, 'ตั้งค่า R2_* ใน .env ของเซิร์ฟเวอร์แล้วรีสตาร์ต'],
      });
      throw new Error('โมเดลนี้ยังตั้งค่าไม่เสร็จ กรุณาติดต่อผู้ดูแลระบบ');
    }

    // The vendor balance cannot rent a machine and none is running for this
    // model: an order now would only wait out the grace and be refunded.
    // Refuse it up front instead (gpu-balance.ts). A community-only model is
    // never paused this way — nothing is rented for it.
    if (gpuModel && (await GpuBalance.pausesModel(await getGpuConfig(), model.modelId))) {
      throw new Error(RENDERING_PAUSED_MESSAGE);
    }

    // A model that only runs on GPUxMINE home PCs has no rental to fall back
    // on (owner decision D5). Refuse, before charging, an order no community
    // machine may take (adult, unreadable, or carrying an upload — D4), or
    // one that has no machine to go to right now.
    if (gpuModel && isCommunityOnlyModel(model.modelId)) {
      const refusal = communityOrderRefusal({
        contentTier: content.tier,
        hasInputMedia,
        machineAvailable: await communityMachineAvailable(model.modelId),
      });
      if (refusal) {
        throw new OrderRefusedError(
          communityRefusalMessage(refusal),
          `community-${refusal}`,
          refusal === 'no-machine' ? 503 : 422
        );
      }
    }

    // A rented worker gets its frame stills from *our server*, which reads them
    // (frame-input.ts). Refuse a source it would refuse, before credits move,
    // rather than charge and refund when the job reaches a machine.
    if (gpuModel && request.type === 'video') {
      for (const src of [request.inputImage, request.inputImageEnd]) {
        if (src !== undefined && !isAcceptedFrameSource(src)) {
          throw new Error('ไฟล์ภาพที่แนบไม่ถูกต้อง กรุณาอัปโหลดใหม่');
        }
      }
    }

    // Same rule for a cover's reference song, and for a portrait's voice and
    // face: the model has nothing to work from without them, and the failure
    // would otherwise land after the machine was rented and the credits taken.
    const catalogEntry = gpuModel ? getCatalogEntry(model.modelId) : undefined;
    const speaks = catalogEntry?.kind === 'lipsync';
    if (catalogEntry?.needs?.audio && !isAcceptedAudioSource(request.inputAudio)) {
      throw new OrderRefusedError(
        speaks ? 'ต้องอัปโหลดไฟล์เสียงที่จะให้พูดก่อน' : 'โหมดคัฟเวอร์ต้องอัปโหลดเพลงต้นฉบับก่อน',
        'missing-audio',
        422
      );
    }
    if (catalogEntry?.needs?.image && !isAcceptedFrameSource(request.inputImage)) {
      throw new OrderRefusedError('ต้องอัปโหลดรูปคนที่จะให้พูดก่อน', 'missing-image', 422);
    }

    // A clip to re-dub. What it may be — length, picture size, file — is the
    // vendor's rule for an API row (lipsync-rules.ts) or the card's for a
    // rented model (`sourceVideo`), checked against the file we stored before
    // anything is charged. An API row also prices by the clip and checks the
    // voice beside it; a rented one prices by the voice, below.
    const apiLipsync = gpuModel ? undefined : apiVideoLipsyncRule(model.modelId);
    // A KIE upscale or motion reference is checked the same way, and priced by it below.
    const clipRule = catalogEntry?.sourceVideo ?? apiLipsync?.clip ?? kie?.sourceClip;
    let clip: ClipFacts | null = null;
    if (clipRule) {
      clip = await this.clipFacts(
        request.inputVideo,
        kie?.sourceClip ? 'ต้องอัปโหลดคลิปก่อน' : 'ต้องอัปโหลดคลิปต้นฉบับที่จะพากย์ทับก่อน'
      );
      const fits = checkClip(clipRule, clip);
      if (!fits.ok) throw new OrderRefusedError(fits.message, fits.code, 422);
    }
    let voiceFile: { seconds: number; bytes: number } | null = null;
    if (apiLipsync && clip) {
      voiceFile = await this.voiceFacts(request.inputAudio);
      const fits = checkVoice(apiLipsync.voice, voiceFile, clip.seconds);
      if (!fits.ok) throw new OrderRefusedError(fits.message, fits.code, 422);
    }

    // A portrait speaks for as long as its voice runs, so the voice sets the
    // length that is priced and rendered — read here from the file we stored,
    // never from a number the client sends (lipsync is priced per second, and
    // the studio's own measurement is only a preview of this one).
    let voiceSeconds: number | null = null;
    const lengthRule = catalogEntry?.lengthFromAudio ?? kie?.lengthFromAudio;
    if (lengthRule) {
      voiceSeconds = await this.voiceLength(request.inputAudio as string, lengthRule, model.maxDuration);
    }

    // The model's limits are what its price was set against and what a rented
    // card can hold. The API (and the mobile app) can send anything — an
    // unclamped 60 s request would cost far more than it paid for, or not fit.
    const bounded = (value: unknown, fallback: number, max: number | null | undefined) => {
      const n = Number(value);
      const v = Number.isFinite(n) && n > 0 ? n : fallback;
      return max && max > 0 ? Math.min(v, max) : v;
    };
    // Default to a short clip, not the longest the model allows. A song's
    // "short" is a different number: five seconds of music is not a render
    // anyone ordered, and the music tab always sends a length anyway.
    //
    // …except on a model that decides its own length. YuE2 stops at its end
    // token and is sized from the frames it produced, so `duration` there is a
    // token budget, not an order — and a budget set from a client's number (or
    // from the 60 s fallback when it sends none) is just a place for the song
    // to get cut off. Those models always get their full budget; the price no
    // longer depends on it either, since the entry carries no duration curve.
    const gpuDuration =
      voiceSeconds ??
      (catalogEntry?.music?.autoLength === true
        ? catalogEntry.limits?.maxDuration ?? model.maxDuration ?? 0
        : bounded(request.params?.duration, request.type === 'audio' ? 60 : 5, model.maxDuration));

    // A rented-GPU job is one render with one output, whatever count was asked
    // for — charging per requested output sold four images and delivered one.
    // A KIE task yields one output too: its catalogue builds one per order.
    const numOutputs = gpuModel || kie ? 1 : request.params?.numOutputs || 1;
    // Length-priced types are video *and* audio: a rented card renders a four
    // minute song for four times what it renders one minute for, and the curve
    // is what keeps the price on the same slope. Restricting this to 'video'
    // sold long songs at the one-minute price.
    const curve = gpuModel && (request.type === 'video' || request.type === 'audio')
      ? catalogEntry?.pricing.durationCurve
      : undefined;
    // A quality mode (Qwen-Image "คุณภาพสูง") costs more GPU and is priced by
    // its multiplier. Only a mode this caller may use is honoured — a mode still
    // being tried by admins falls back to the default for everyone else — and
    // the one chosen is stored, so the render and the price cannot disagree.
    const qualityMode = catalogEntry?.qualityModes?.length
      ? pickQualityMode(
          catalogEntry,
          await getStoredWorkflow(model.modelId).catch(() => null),
          request.params?.quality,
          options.isAdmin === true
        )
      : null;
    // A KIE row prices from the credits table its sync wrote (kie-pricing.ts),
    // by tier, length and pictures attached — the same table the studio shows.
    // A row synced before the table existed is priced from the catalogue.
    const kieTable = kie ? readKiePriceTable(model.defaultParams) ?? kiePriceTable(kie) : null;
    const kieTier = kieTable ? pickKieTier(kieTable, kieTable.tierParam ? request.params?.[kieTable.tierParam] : undefined) : null;
    // The length priced: the voice a portrait speaks, the clip an upscale or a
    // motion copy runs for (whole seconds, as KIE bills), else the length ordered.
    const kieSeconds = kieTable
      ? voiceSeconds ?? (kie?.sourceClip && clip ? Math.ceil(clip.seconds) : pickKieDuration(kieTable, request.params?.duration))
      : null;
    const requiredCredits =
      apiLipsync && clip
        ? lipsyncCredits(apiLipsync.billing, model.creditsPerUnit, clip.seconds)
        : kie && kieTable
          ? kieQuote(kieTable, {
              tier: kieTier?.id,
              seconds: kieSeconds,
              images: kieImageCount(kie, {
                references: references.length || (request.inputImage ? 1 : 0),
                inputImage: request.inputImage,
                inputImageEnd: request.inputImageEnd,
              }),
              chars: speechLength,
            })
          : Math.ceil(creditsForDuration(model.creditsPerUnit, curve, gpuDuration) * (qualityMode?.creditsMultiplier ?? 1)) *
          numOutputs;

    // Uploaded inputs are folded into params so they are persisted with the
    // row. `ai_generations` has an `inputImage` column but no audio or video
    // equivalent, and adding them would mean a migration on a table the
    // retention sweep, the gallery and Laravel all read — params is already
    // JSON and already stored, so it carries them instead. RetentionService
    // knows to look here; see INPUT_URL_PARAMS there.
    const baseParams: Record<string, unknown> = { ...(request.params ?? {}) };
    // An admin-only preset (an experiment the price does not cover yet) is
    // dropped for anyone else — only reachable by hand, since /api/models
    // never lists it for them — and the model's default renders instead.
    if (gpuModel && options.isAdmin !== true && isAdminOnlyPreset(model.modelId, baseParams.resolution)) {
      delete baseParams.resolution;
    }
    // Song controls are kept as the choices themselves, not as the sentence
    // they compose into — the catalogue entry builds the model's `[Tags]` line
    // from these at render time, so every client agrees, and a customer
    // reopening the order still sees "หญิง / ลูกทุ่ง / 92 BPM".
    const music =
      catalogEntry?.music?.controls === true || kie?.music === true ? sanitizeMusicParams(baseParams.music) : undefined;
    delete baseParams.music;
    // Suno's choices as checked above, or nothing for any other model.
    delete baseParams.suno;
    // The mode priced above, or nothing for a model without modes.
    delete baseParams.quality;
    if (qualityMode) baseParams.quality = qualityMode.id;
    // The tier and length priced above, kept where the studio reads them back
    // and where the adapter builds the task from — never re-derived.
    if (kieTable && kieTier) {
      if (kieTable.tierParam) baseParams[kieTable.tierParam] = kieTier.id;
      baseParams.kieTier = kieTier.id;
      if (kieSeconds !== null) baseParams.duration = kieSeconds;
      else delete baseParams.duration;
      baseParams.numOutputs = 1;
    }
    // The voice that was priced and will speak: one of the model's own, never a raw id.
    if (speech) {
      baseParams.voice = (speech.voices.find((v) => v.id === baseParams.voice) ?? speech.voices[0]).id;
      const style = speech.style && typeof baseParams.speechStyle === 'string' ? baseParams.speechStyle.trim().slice(0, 300) : '';
      if (style) baseParams.speechStyle = style;
      else delete baseParams.speechStyle;
    } else {
      delete baseParams.voice;
      delete baseParams.speechStyle;
    }

    const storedParams: Record<string, unknown> = {
      ...baseParams,
      ...(music ? { music } : {}),
      ...(suno ? { suno } : {}),
      ...(request.inputAudio ? { inputAudio: request.inputAudio } : {}),
      ...(request.inputVideo ? { inputVideo: request.inputVideo } : {}),
      ...(request.inputImageEnd ? { inputImageEnd: request.inputImageEnd } : {}),
      ...(references.length ? { referenceImages: references } : {}),
    };

    // 2. Select an account from the pool — unless the model is community-only
    //    (orderNeedsProviderAccount). Asking for one tied sdxl-community to the
    //    SimplePod row's key: on a deploy where that key was missing, over quota
    //    or in cooldown every order was refused as "Service temporarily
    //    unavailable", by a rental vendor the model never uses.
    const needsAccount = orderNeedsProviderAccount(model.modelId, gpuModel);
    let account = needsAccount ? await AccountPoolManager.selectAccount(model.providerId) : null;
    // What a KIE order's fallback must be able to do: the order as priced.
    // A portrait's picture and a clip tool's character are inputs, not frames.
    const framed = kie?.category === 'video' && !kie.lengthFromAudio && !kie.sourceClip;
    const kieOrder: FallbackOrder | null = kie
      ? {
          kieKey: model.modelId,
          references: references.length || (request.inputImage ? 1 : 0),
          firstFrame: framed && !!request.inputImage?.trim(),
          lastFrame: framed && !!request.inputImage?.trim() && !!request.inputImageEnd?.trim(),
          seconds: kieSeconds,
          clip,
          voice: voiceFile,
        }
      : null;
    // No KIE key can take it now (switched off, cooling down after errors):
    // straight to KIE's fallback, before anything is charged, at KIE's price.
    let preRouted: { model: ModelWithProvider; reason: string } | null = null;
    // Rows passed over (cannot do it, would lose money, no key), for the alert.
    const skippedFallbacks: string[] = [];
    if (kieOrder && needsAccount && !account) {
      const settings = await loadFallbackSettings();
      const picked = settings.enabled
        ? await pickFallback(model.modelId, kieOrder, settings.map, requiredCredits, skippedFallbacks)
        : null;
      if (picked) {
        account = picked.account;
        preRouted = { model: picked.model, reason: await kieUnavailable(model.providerId) };
        storedParams.route = orderRoute(picked.model, preRouted.reason);
      }
    }
    if (needsAccount && !account) {
      raiseAlert({
        type: 'no-accounts',
        key: String(model.providerId),
        level: 'critical',
        title: `${model.provider.name} ไม่มีคีย์ API ที่ใช้ได้`,
        lines: [
          `ลูกค้าเพิ่งโดนปฏิเสธที่โมเดล ${model.name}`,
          kie
            ? 'คีย์ KIE ถูกปิด ติดลิมิต หรือถูกพัก และไม่มีโมเดลสำรองที่รับงานนี้ได้ — ตรวจที่หน้า KIE.ai'
            : 'คีย์ทุกอันถูกปิด ติดลิมิต หรือถูกพักจากข้อผิดพลาด — ตรวจที่หน้าคลังคีย์ (Pools)',
          ...skippedFallbacks.slice(0, 5).map((s) => `สำรอง ${s}`),
        ],
        path: kie ? '/admin/kie' : '/admin/pools',
      });
      throw new Error('No available API accounts for this provider. Please try again later.');
    }

    // 3. Atomically check & deduct credits + create generation in one transaction.
    // SLOW_DB_TX: a 9.2 s stall once expired a valid order here under Prisma's
    // defaults (rolled back, no charge, but "Generation failed" for nothing).
    const { generation } = await prisma.$transaction(async (tx) => {
      // Atomic conditional update — prevents double-spend race condition
      const updated = await tx.$executeRawUnsafe(
        'UPDATE ai_user_credits SET balance = balance - ?, total_used = total_used + ? WHERE user_id = ? AND balance >= ?',
        requiredCredits, requiredCredits, userId, requiredCredits
      );

      if (updated === 0) {
        const credit = await tx.aiUserCredit.findUnique({ where: { userId } });
        throw new Error(`Insufficient credits. Need ${requiredCredits}, have ${credit?.balance || 0}`);
      }

      const credit = await tx.aiUserCredit.findUnique({ where: { userId } });

      const gen = await tx.aiGeneration.create({
        data: {
          userId,
          modelId: model.id,
          type: request.type,
          status: 'pending',
          prompt: request.prompt,
          negativePrompt: request.negativePrompt,
          params: (Object.keys(storedParams).length > 0
            ? storedParams
            : Prisma.JsonNull) as Prisma.InputJsonValue,
          inputImage: request.inputImage,
          creditsUsed: requiredCredits,
          accountPoolId: account?.id ?? null,
          contentTier: content.tier,
        },
      });

      await tx.aiCreditTransaction.create({
        data: {
          userId,
          type: 'usage',
          amount: -requiredCredits,
          balanceAfter: credit?.balance ?? 0,
          description: `${model.name} - ${request.type} generation`,
          generationId: gen.id,
        },
      });

      return { generation: gen };
    }, SLOW_DB_TX);

    // 5b. GPU-backed providers have no inference API to call — they rent a
    // machine and run the model on it. Queue the job and return immediately;
    // GpuQueue rents, dispatches, and settles the generation asynchronously.
    if (gpuModel) {
      // Imported lazily: GpuQueue imports this class back for refunds, and a
      // static cycle would leave one of the two undefined at module init.
      const { GpuQueue } = await import('./gpu-queue');

      const size = fitFrame(request.params?.width, request.params?.height, model.maxWidth, model.maxHeight);

      await GpuQueue.enqueue({
        generationId: generation.id,
        modelKey: model.modelId,
        // Copied onto the job for the claim: a community machine only ever
        // gets general work with nothing uploaded.
        contentTier: content.tier,
        hasInputMedia,
        payload: {
          prompt: request.prompt + styleSuffix,
          negativePrompt: request.negativePrompt,
          width: size.width,
          height: size.height,
          // The length that was priced above — never re-derived, or the two
          // could disagree.
          duration: gpuDuration,
          fps: request.params?.fps || 24,
          seed: request.params?.seed ?? Math.floor(Math.random() * 2_147_483_647),
          inputImage: request.inputImage,
          extra: storedParams,
          // An override still in admin rollout renders only admins' orders.
          adminRun: options.isAdmin === true,
        },
      });

      // Kick the queue right away so the GPU starts warming while the response
      // is still in flight. Cron remains the reliable driver — this is a
      // latency optimisation, so its failure must not fail the request.
      try {
        after(async () => {
          const { withTickLock } = await import('./gpu-lock');
          await withTickLock(() => GpuQueue.tick()).catch((err) =>
            console.error('[gpu] post-enqueue tick failed:', err)
          );
        });
      } catch {
        // Not in a request scope (script/worker context) — cron will pick it up.
      }

      return {
        id: generation.id,
        status: 'pending',
        creditsUsed: requiredCredits,
      };
    }

    // Only a community-only GPU model goes without an account, and it returned
    // above; this says so to the compiler for everything below.
    if (!account) throw new Error('No available API accounts for this provider. Please try again later.');

    const run: ApiOrderRun = {
      userId,
      generationId: generation.id,
      model,
      // The references as checked above, not as sent — and for KIE the params
      // as priced (tier, length, sanitised music), not as sent.
      request: { ...request, referenceImages: references, params: kie ? storedParams : request.params },
      styleSuffix,
      account,
      requiredCredits,
      maxWaitSeconds: apiLipsync?.maxWaitSeconds ?? kie?.maxWaitSeconds,
      kie: kieOrder ? { order: kieOrder, preRouted } : undefined,
    };

    // A video lip-sync render takes the vendor minutes (Kling: about twelve),
    // longer than a request can be held open behind the proxy — the customer
    // would see a timeout for an order still running and already charged, and
    // order again. Those run after the response and the studio polls the
    // order, as it does a rented-GPU one; ApiOrderSweep settles any that a
    // restart cut off.
    // Every KIE order is an async task (a picture in seconds, a clip in many
    // minutes), so they all run this way.
    if (apiLipsync || options.deferApi || kie) {
      await prisma.aiGeneration.update({
        where: { id: generation.id },
        data: { status: 'processing', startedAt: new Date() },
      });
      let deferred = false;
      try {
        after(() =>
          this.runApiOrder(run).then(
            () => undefined,
            (error) => console.error(`[generation] #${generation.id} failed in the background:`, (error as Error).message)
          )
        );
        deferred = true;
      } catch {
        // Not in a request scope (a script): run it here instead.
      }
      if (deferred) return { id: generation.id, status: 'processing', creditsUsed: requiredCredits };
    }
    return this.runApiOrder(run);
  }

  /**
   * Call the provider for an order already charged, store what it delivers,
   * and refund it when it delivers nothing.
   *
   * The final status is written only while the order is still `processing`:
   * a background run that outlives ApiOrderSweep's patience must not turn an
   * order the sweep already failed and refunded back into a delivered one.
   */
  private static async runApiOrder(run: ApiOrderRun): Promise<GenerationResult> {
    // While this process waits on it, ApiOrderSweep leaves the order alone.
    runningOrders.set(run.generationId, { resumable: false });
    try {
      return await this.executeApiOrder(run);
    } finally {
      runningOrders.delete(run.generationId);
      ApiProgress.clear(run.generationId);
    }
  }

  private static async executeApiOrder(run: ApiOrderRun): Promise<GenerationResult> {
    const { userId, model, request, requiredCredits } = run;
    const generation = { id: run.generationId };
    // The row and key the last call went to: a delivery is credited to them,
    // a crash charged to them. A KIE order may end on a fallback row.
    let served: { model: ModelWithProvider; account: PoolAccount } = {
      model: run.kie?.preRouted?.model ?? model,
      account: run.account,
    };
    // Written on the order when a fallback row ran it (KIE could not).
    let route: Record<string, unknown> | null = null;

    // 6. Execute generation via provider
    try {
      await prisma.aiGeneration.update({
        where: { id: generation.id },
        data: { status: 'processing', startedAt: new Date() },
      });

      // One call, to one row on one key: logged, and a failure that is the
      // key's counted against that key, with rate-limit-aware cooldown, so the
      // pool can rotate or auto-disable it.
      const attempt = async (target: ModelWithProvider, account: PoolAccount, viaFallback: boolean) => {
        served = { model: target, account };
        const result = await this.callProvider(target, account, run, viaFallback);
        await prisma.aiUsageLog.create({
          data: {
            accountPoolId: account.id,
            modelId: target.modelId,
            action: request.type,
            status: result.success ? 'success' : 'error',
            costUsd: result.success ? result.costUsd ?? Number(target.costPerUnit) : 0,
            responseMs: result.processingMs,
            errorMessage: result.error,
            ...(run.kie
              ? { metadata: { generationId: generation.id, route: viaFallback ? 'fallback' : 'kie', kieModel: model.modelId } }
              : {}),
          },
        });
        // A refused prompt or a failed render is the order's, not the key's
        // (ProviderResponse.orderFault): counted, a few of them would disable
        // the one key every KIE model shares.
        if (!result.success && result.orderFault !== true) {
          await AccountPoolManager.recordError(account.id, result.error || 'Generation failed', this.isRateLimitError(result.error));
        }
        if (target.provider.slug === 'kie' && /^KIE 402\b/.test(result.error ?? '')) {
          raiseAlert({
            type: 'kie-balance',
            key: String(account.id),
            level: 'critical',
            title: 'เครดิต KIE.ai หมด — งานโมเดล KIE ไปผู้ให้บริการสำรอง หรือคืนเครดิตถ้าไม่มีสำรอง',
            lines: [
              `ลูกค้าเพิ่งสั่ง ${model.name} แล้ว KIE ตอบ 402`,
              'เติมเครดิตที่ kie.ai แล้วกด "ตรวจคีย์อีกครั้ง" ที่หน้า KIE.ai ในแอดมิน — คีย์จะกลับมารับงานทันที',
            ],
            path: '/admin/kie',
          });
        }
        return result;
      };

      let result: ProviderResponse;
      if (run.kie) {
        // KIE first; its fallback only when KIE never took the order (kie-fallback.ts).
        const kie = run.kie;
        const settings = kie.preRouted ? null : await loadFallbackSettings();
        const skippedFallbacks: string[] = [];
        const outcome = await routeKieOrder<ModelWithProvider>({
          kie: kie.preRouted ? null : () => attempt(model, run.account, false),
          unavailable: kie.preRouted?.reason,
          enabled: kie.preRouted !== null || settings?.enabled === true,
          pick: async () => {
            const picked = kie.preRouted
              ? { model: kie.preRouted.model, account: run.account }
              : await pickFallback(model.modelId, kie.order, settings?.map ?? {}, requiredCredits, skippedFallbacks);
            return picked ? { target: picked.model, run: () => attempt(picked.model, picked.account, true) } : null;
          },
        });
        result = outcome.result;
        if (outcome.via === 'kie' && outcome.skipped === 'none' && skippedFallbacks.length > 0) {
          // KIE refused, and every row it falls back to was passed over: the
          // order is refunded — the admin should see why none could take it.
          raiseAlert({
            type: 'kie-fallback',
            key: `${model.modelId}:none`,
            level: 'warning',
            title: 'KIE.ai รับงานไม่ได้ และไม่มีโมเดลสำรองที่รับได้ — คืนเครดิตลูกค้าแล้ว',
            lines: [
              `${model.name}: ${kieRefusalReason(outcome.result)}`,
              ...skippedFallbacks.slice(0, 5).map((s) => `สำรอง ${s}`),
            ],
            path: '/admin/kie',
          });
        }
        if (outcome.via === 'fallback') {
          route = orderRoute(outcome.target, outcome.reason);
          raiseAlert({
            type: 'kie-fallback',
            key: model.modelId,
            level: 'warning',
            title: 'KIE.ai รับงานไม่ได้ — ระบบสลับไปใช้โมเดลสำรอง',
            lines: [
              `${model.name} → ${outcome.target.name} (${outcome.target.provider.name})`,
              `สาเหตุ: ${outcome.reason}`,
              result.success ? 'ส่งงานให้ลูกค้าแล้ว ในราคาเดิมของ KIE' : 'โมเดลสำรองก็ทำไม่สำเร็จ — คืนเครดิตให้ลูกค้าแล้ว',
            ],
            path: '/admin/kie',
          });
        }
      } else {
        result = await attempt(model, run.account, false);
      }
      return await this.storeResult({
        userId,
        generationId: generation.id,
        params: request.params,
        requiredCredits,
        result,
        served,
        route,
      });
    } catch (error) {
      // Record error and refund
      const message = (error as Error).message;
      await AccountPoolManager.recordError(served.account.id, message, this.isRateLimitError(message));
      await this.refundCredits(userId, requiredCredits, generation.id);

      await prisma.aiGeneration.updateMany({
        where: { id: generation.id, status: 'processing' },
        data: {
          status: 'failed',
          errorMessage: (error as Error).message,
          completedAt: new Date(),
        },
      });

      return {
        id: generation.id,
        status: 'failed',
        creditsUsed: 0,
        error: (error as Error).message,
      };
    }
  }

  /**
   * One provider call for an order: the row it runs on decides the model id,
   * the size and length limits; a fallback row gets the order's params as a
   * studio order on it would carry them (fallbackParams) and its own wait.
   */
  /**
   * Store what the provider answered on an order already charged: the files
   * to R2 and the order completed, or the order failed and refunded. Shared by
   * `runApiOrder` and `resumeApiOrder`.
   */
  private static async storeResult(o: {
    userId: number;
    generationId: number;
    params: GenerationRequest['params'];
    requiredCredits: number;
    result: ProviderResponse;
    /** The row and key that rendered it. */
    served: { model: ModelWithProvider; account: { id: number } };
    /** `params.route` when a fallback row ran the order (orderRoute). */
    route: Record<string, unknown> | null;
  }): Promise<GenerationResult> {
    const { userId, generationId, params, requiredCredits, result, served, route } = o;
    // Where a fallback ran the order, the order says so, and its key is the one that served it.
    const routed = route
      ? { params: { ...(params ?? {}), route } as unknown as Prisma.InputJsonValue, accountPoolId: served.account.id }
      : {};
    // A stem split names its files ("เสียงร้อง", "กลอง" …); R2 copies them under random names.
    const labels =
      result.success && result.resultLabels && result.resultLabels.length === result.resultUrls?.length
        ? result.resultLabels
        : null;
    // A song's words (output-lyrics.ts), kept the same way, only when they line up.
    const lyrics =
      result.success && result.resultLyrics && result.resultLyrics.length === result.resultUrls?.length
        ? result.resultLyrics
        : null;

    // 7. Record result — what the vendor says the order cost when it says
    // (KIE's creditsConsumed), else the row's list price.
    if (result.success) {
      const costUsd = result.costUsd ?? Number(served.model.costPerUnit);
      await AccountPoolManager.recordSuccess(served.account.id, costUsd);

      // Persist provider output to durable R2 storage. Provider URLs expire and
      // base64 results shouldn't live in the DB long-term. persistAssetSafe is a
      // no-op (returns the source unchanged) when R2 isn't configured.
      let finalUrl = result.resultUrl;
      let finalUrls = result.resultUrls;
      if (isStorageConfigured()) {
        const prefix = `generations/${userId}/${generationId}`;
        if (finalUrls && finalUrls.length > 0) {
          finalUrls = await Promise.all(finalUrls.map((u) => persistAssetSafe(u, prefix)));
          finalUrl = finalUrls[0];
        } else if (finalUrl) {
          finalUrl = await persistAssetSafe(finalUrl, prefix);
        }
      }

      const settled = await prisma.aiGeneration.updateMany({
        where: { id: generationId, status: 'processing' },
        data: {
          status: 'completed',
          resultUrl: finalUrl,
          resultUrls: (finalUrls ?? Prisma.JsonNull) as Prisma.InputJsonValue,
          thumbnailUrl: finalUrl, // Use first result as thumbnail
          providerJobId: result.jobId,
          costUsd,
          processingMs: result.processingMs,
          completedAt: new Date(),
          ...routed,
          ...(labels || lyrics
            ? {
                params: {
                  ...(params ?? {}),
                  ...(route ? { route } : {}),
                  ...(labels ? { outputLabels: labels } : {}),
                  ...(lyrics ? { outputLyrics: lyrics } : {}),
                } as unknown as Prisma.InputJsonValue,
              }
            : {}),
        },
      });
      if (settled.count === 0) {
        // ApiOrderSweep already failed and refunded it; the file arrived too late.
        console.warn(`[generation] #${generationId} delivered after it was settled as failed; result dropped`);
        return { id: generationId, status: 'failed', creditsUsed: 0, error: 'settled' };
      }

      // Fix the retention window at the moment the customer received the
      // file, so a later settings change cannot shorten what they were
      // already promised.
      const { RetentionService, daysUntil } = await import('./retention');
      await RetentionService.stampExpiry(generationId);
      // A model that just delivered is proven, whatever we believed before —
      // the row that rendered it: a fallback's delivery proves nothing about KIE's.
      await ModelReadiness.recordSuccess(served.model.id);
      const stamped = await prisma.aiGeneration.findUnique({
        where: { id: generationId },
        select: { expiresAt: true },
      });

      return {
        id: generationId,
        status: 'completed',
        resultUrl: finalUrl,
        resultUrls: finalUrls,
        resultLabels: labels ?? undefined,
        resultLyrics:
          songLyrics({ ...(params ?? {}), ...(labels ? { outputLabels: labels } : {}), ...(lyrics ? { outputLyrics: lyrics } : {}) }, finalUrls) ??
          undefined,
        thumbnailUrl: finalUrl,
        processingMs: result.processingMs,
        creditsUsed: requiredCredits,
        expiresAt: stamped?.expiresAt?.toISOString(),
        daysLeft: daysUntil(stamped?.expiresAt),
      };
    }

    // The failure was counted against its key by the caller; refund the user.
    await this.refundCredits(userId, requiredCredits, generationId);

    await prisma.aiGeneration.updateMany({
      where: { id: generationId, status: 'processing' },
      data: {
        status: 'failed',
        errorMessage: result.error,
        completedAt: new Date(),
        ...routed,
      },
    });

    return {
      id: generationId,
      status: 'failed',
      creditsUsed: 0,
      error: result.error,
    };
  }

  /** Whether this process is still waiting on the order (runApiOrder). */
  static isRunningHere(generationId: number): boolean {
    return runningOrders.has(generationId);
  }

  /**
   * Orders this process is waiting on that a restart would lose: the vendor
   * has not named the job yet, or the vendor's jobs cannot be read back later
   * (only KIE's and fal's can, resumeApiOrder). The deploy waits for these to
   * reach zero before it restarts the app (/api/cron/in-flight).
   */
  static unrecoverableInFlight(): number {
    let count = 0;
    for (const order of runningOrders.values()) if (!order.resumable) count += 1;
    return count;
  }

  /**
   * Collect an order whose wait a deploy or crash cut off. The vendor kept
   * rendering it — and billed us for it — so the job stored when the vendor
   * took the order (onTaskCreated) is read once: the file is stored and the
   * order completed, a failed job refunded, a job still rendering left for
   * the next sweep. Returns what it did.
   *
   * Which vendor to ask is the key's, not the model's: a KIE order a fallback
   * row ran on fal holds fal's job.
   */
  static async resumeApiOrder(generationId: number): Promise<'completed' | 'failed' | 'waiting' | 'skipped'> {
    if (runningOrders.has(generationId)) return 'skipped';
    const order = await prisma.aiGeneration.findUnique({
      where: { id: generationId },
      include: { model: { include: { provider: true } } },
    });
    if (!order || order.status !== 'processing' || !order.providerJobId || !order.accountPoolId) return 'skipped';
    const pool = await prisma.aiAccountPool.findUnique({
      where: { id: order.accountPoolId },
      include: { provider: { select: { slug: true } } },
    });
    if (!pool) return 'skipped';
    const vendor = getProvider(pool.provider.slug as ProviderSlug);
    const apiKey = decrypt(pool.apiKey);
    const started = (order.startedAt ?? order.createdAt).getTime();
    let read: { done: boolean; result?: ProviderResponse };
    if (vendor instanceof KieProvider) read = await vendor.taskStatus(apiKey, order.model.modelId, order.providerJobId, started);
    else if (vendor instanceof FalProvider) read = await vendor.requestStatus(apiKey, order.providerJobId, started);
    else return 'skipped';
    if (!read.done || !read.result) return 'waiting';
    const result = read.result;

    await prisma.aiUsageLog.create({
      data: {
        accountPoolId: pool.id,
        modelId: order.model.modelId,
        action: order.type,
        status: result.success ? 'success' : 'error',
        costUsd: result.success ? result.costUsd ?? Number(order.model.costPerUnit) : 0,
        responseMs: result.processingMs,
        errorMessage: result.error,
        metadata: { generationId, route: pool.provider.slug, model: order.model.modelId, resumed: true },
      },
    });
    const stored = await this.storeResult({
      userId: order.userId,
      generationId,
      params: (order.params ?? undefined) as GenerationRequest['params'],
      requiredCredits: order.creditsUsed,
      result,
      served: { model: order.model, account: { id: pool.id } },
      route: null,
    });
    console.log(`[generation] #${generationId} resumed from ${pool.provider.slug}: ${stored.status}`);
    return stored.status === 'completed' ? 'completed' : 'failed';
  }

  private static async callProvider(
    target: ModelWithProvider,
    account: PoolAccount,
    run: ApiOrderRun,
    viaFallback: boolean
  ): Promise<ProviderResponse> {
    const { request, styleSuffix } = run;
    const references = request.referenceImages ?? [];
    const provider = getProvider(target.provider.slug as ProviderSlug);
    if (!provider) {
      throw new Error(`Provider adapter not found: ${target.provider.slug}`);
    }

    const providerParams = {
      modelId: target.modelId,
      prompt: request.prompt + styleSuffix,
      negativePrompt: request.negativePrompt,
      width: request.params?.width || target.maxWidth || 1024,
      height: request.params?.height || target.maxHeight || 1024,
      steps: request.params?.steps,
      cfgScale: request.params?.cfgScale,
      seed: request.params?.seed,
      duration: request.params?.duration || target.maxDuration || undefined,
      maxDuration: target.maxDuration ?? undefined,
      fps: request.params?.fps,
      aspectRatio: request.params?.aspectRatio,
      // KIE priced one output; its fallback delivers one.
      numOutputs: viaFallback ? 1 : request.params?.numOutputs || 1,
      inputImage: request.inputImage ?? references[0],
      inputImageEnd: request.inputImageEnd,
      referenceImages: references.length ? references : undefined,
      inputAudio: request.inputAudio,
      inputVideo: request.inputVideo,
      apiKey: account.apiKey,
      apiSecret: account.apiSecret,
      apiEndpoint: account.apiEndpoint,
      extraParams: (viaFallback ? fallbackParams(request.params) : request.params) as Record<string, unknown>,
      maxWaitSeconds: viaFallback ? apiVideoLipsyncRule(target.modelId)?.maxWaitSeconds : run.maxWaitSeconds,
      // The vendor's job on the order the moment the vendor takes it (KIE's
      // task id, fal's result URL): a deploy that cuts the wait off then
      // leaves something resumeApiOrder can collect.
      onTaskCreated: RESUMABLE_PROVIDERS.has(target.provider.slug)
        ? async (jobId: string) => {
            await prisma.aiGeneration.updateMany({
              where: { id: run.generationId, status: 'processing' },
              data: { providerJobId: jobId, accountPoolId: account.id },
            });
            const running = runningOrders.get(run.generationId);
            if (running) running.resumable = true;
          }
        : undefined,
      // The vendor's queue and render stages, for the studio's queue and percentage.
      onState: (state: string) => ApiProgress.report(run.generationId, state),
    };

    switch (request.type) {
      case 'image':
        return provider.generateImage(providerParams);
      case 'video':
        return provider.generateVideo(providerParams);
      case 'edit':
        if (!provider.editImage) throw new Error('This model does not support image editing');
        return provider.editImage(providerParams);
      case 'audio':
        if (!provider.generateAudio) throw new Error('This model does not support music generation');
        return provider.generateAudio(providerParams);
      default:
        throw new Error(`Unknown generation type: ${request.type}`);
    }
  }

  /**
   * Refuse an order terms §6 forbids, before anything is charged. Admins hear
   * about it (once an hour per account) with the category, never the words:
   * the alert goes to a Telegram chat, and the customer's prompt stays here.
   */
  /**
   * The order's reference pictures, checked before any credit moves: only as
   * many as the model takes (reference-caps.ts), and only files in our own
   * storage — an adapter fetches them server-side (OpenAI's) or hands them to
   * the vendor, so a stranger's URL must never get that far.
   */
  private static checkReferences(
    model: { modelId: string; category: string; defaultParams: unknown; provider: { slug: string } },
    raw: unknown
  ): string[] {
    if (raw === undefined || raw === null) return [];
    if (!Array.isArray(raw)) throw new OrderRefusedError('ภาพอ้างอิงไม่ถูกต้อง', 'bad-references', 422);
    const refs = [...new Set(raw.filter((u): u is string => typeof u === 'string' && u.trim() !== ''))];
    if (refs.length === 0) return [];
    const cap = referenceCaps({
      providerSlug: model.provider.slug,
      modelId: model.modelId,
      category: model.category,
      defaultParams: model.defaultParams,
    }).images;
    if (cap === 0) throw new OrderRefusedError('โมเดลนี้ไม่รับภาพอ้างอิง เลือกโมเดลอื่น', 'no-references', 422);
    if (refs.length > cap) {
      throw new OrderRefusedError(`โมเดลนี้รับภาพอ้างอิงได้สูงสุด ${cap} ภาพ`, 'too-many-references', 422);
    }
    if (refs.some((u) => keyFromPublicUrl(u) === null)) {
      throw new OrderRefusedError('ภาพอ้างอิงต้องเป็นไฟล์ที่อัปโหลดไว้บนเว็บ อัปโหลดใหม่อีกครั้ง', 'foreign-reference', 422);
    }
    return refs;
  }

  private static refuseBlocked(userId: number, modelName: string, content: ContentAssessment): never {
    const category = content.blocked ?? 'minor-sexual';
    console.warn(`[safety] refused an order: user #${userId}, ${modelName}, ${category} (${content.reasons.join(', ')})`);
    raiseAlert({
      type: 'content-blocked',
      key: String(userId),
      level: 'warning',
      title: `ปฏิเสธคำสั่งที่เข้าข่ายเนื้อหาต้องห้าม — ผู้ใช้ #${userId}`,
      lines: [
        `หมวด: ${BLOCKED_LABEL[category]}`,
        `โมเดล: ${modelName}`,
        'ไม่ได้หักเครดิต · ไม่ได้บันทึกคำสั่งไว้ — ถ้าเกิดซ้ำจากบัญชีเดิม ให้ตรวจบัญชีนั้นที่ XMAN Studio',
      ],
      path: '/admin/generations',
    });
    throw new OrderRefusedError(blockedMessage(category), 'content-blocked', 422);
  }

  /**
   * The seconds a voice-driven order renders and is priced at, read from the
   * uploaded file itself; refused in Thai when it cannot be read or does not
   * fit the model.
   */
  private static async voiceLength(source: string, rule: LengthFromAudio, maxSeconds: number | null): Promise<number> {
    let measured: number | null;
    try {
      const { bytes, ext } = await readAudioSource(source);
      measured = audioDurationSeconds(bytes, ext);
    } catch (error) {
      // Our own bucket did not answer; the file is very likely fine.
      console.warn('[generation] could not read an uploaded voice track:', (error as Error).message);
      throw new OrderRefusedError('อ่านไฟล์เสียงที่อัปโหลดไม่สำเร็จ กรุณาลองใหม่อีกครั้ง', 'voice-fetch-failed', 503);
    }
    const length = voiceRenderSeconds(measured, rule, maxSeconds);
    if (!length.ok) throw new OrderRefusedError(length.message, length.code, 422);
    return length.seconds;
  }

  /**
   * A stored clip's length, picture and file, read from the file itself; a
   * Thai refusal when there is none, it cannot be read, or its headers do not
   * say (the order is then refused, never priced on a guess).
   */
  private static async clipFacts(source: string | undefined, missing: string): Promise<ClipFacts> {
    if (!isAcceptedVideoSource(source)) {
      throw new OrderRefusedError(missing, 'missing-video', 422);
    }
    let opened: Awaited<ReturnType<typeof openVideoSource>>;
    try {
      opened = await openVideoSource(source);
    } catch (error) {
      console.warn('[generation] could not read an uploaded clip:', (error as Error).message);
      throw new OrderRefusedError('อ่านคลิปที่อัปโหลดไม่สำเร็จ กรุณาลองใหม่อีกครั้ง', 'clip-fetch-failed', 503);
    }
    const probe = await probeVideo(opened.source, opened.ext);
    if (!probe) {
      throw new OrderRefusedError(
        'อ่านความยาวหรือขนาดของคลิปไม่ได้ กรุณาบันทึกคลิปเป็น MP4 แล้วอัปโหลดใหม่',
        'clip-unreadable',
        422
      );
    }
    return { ...probe, bytes: opened.bytes, ext: opened.ext };
  }

  /** A stored voice track's length and size, for the API lip-sync rows' checks. */
  private static async voiceFacts(source: string | undefined): Promise<{ seconds: number; bytes: number }> {
    if (!isAcceptedAudioSource(source)) {
      throw new OrderRefusedError('ต้องอัปโหลดไฟล์เสียงที่จะให้พูดก่อน', 'missing-audio', 422);
    }
    let read: Awaited<ReturnType<typeof readAudioSource>>;
    try {
      read = await readAudioSource(source);
    } catch (error) {
      console.warn('[generation] could not read an uploaded voice track:', (error as Error).message);
      throw new OrderRefusedError('อ่านไฟล์เสียงที่อัปโหลดไม่สำเร็จ กรุณาลองใหม่อีกครั้ง', 'voice-fetch-failed', 503);
    }
    const seconds = audioDurationSeconds(read.bytes, read.ext);
    if (seconds === null) {
      throw new OrderRefusedError('อ่านความยาวของไฟล์เสียงไม่ได้ กรุณาใช้ไฟล์ MP3, WAV หรือ M4A', 'voice-unreadable', 422);
    }
    return { seconds, bytes: read.bytes.length };
  }

  /**
   * Detect whether a provider error message indicates rate limiting / quota,
   * so the account pool can apply the longer cooldown.
   */
  private static isRateLimitError(msg?: string): boolean {
    if (!msg) return false;
    return /rate.?limit|429|too many requests|quota/i.test(msg);
  }

  /**
   * Refund credits to user after failed generation.
   * Public because GPU-backed generations settle asynchronously in GpuQueue,
   * long after this class has returned to the caller.
   */
  static async refundCredits(userId: number, amount: number, generationId: number) {
    const userCredit = await prisma.aiUserCredit.findUnique({ where: { userId } });
    if (!userCredit) return;

    // Idempotency — never refund the same generation twice (the failure and
    // exception paths can otherwise both fire).
    const existingRefund = await prisma.aiCreditTransaction.findFirst({
      where: { generationId, type: 'refund' },
    });
    if (existingRefund) return;

    // A callback with SLOW_DB_TX, not the array form: the GPU queue calls this
    // after it has already marked the job failed, and nothing retries it, so a
    // refund lost to a slow moment of the database stays lost.
    await prisma.$transaction(async (tx) => {
      const credit = await tx.aiUserCredit.update({
        where: { userId },
        data: {
          balance: { increment: amount },
          totalUsed: { decrement: amount },
        },
      });
      await tx.aiCreditTransaction.create({
        data: {
          userId,
          type: 'refund',
          amount,
          balanceAfter: credit.balance,
          description: 'Auto-refund: generation failed',
          generationId,
        },
      });
      // Recorded on the generation too, so the gallery can say "คืนเครดิตแล้ว"
      // without joining the transaction log on every read.
      await tx.aiGeneration.update({
        where: { id: generationId },
        data: { creditsRefunded: amount },
      });
    }, SLOW_DB_TX);
  }

  /**
   * Get style prompt suffix
   */
  private static async getStyleSuffix(styleId: number): Promise<string> {
    const style = await prisma.aiStyle.findUnique({ where: { id: styleId } });
    return style?.promptSuffix ? `, ${style.promptSuffix}` : '';
  }

  /**
   * Get user's generation history
   */
  static async getUserHistory(userId: number, page: number = 1, limit: number = 20) {
    const skip = (page - 1) * limit;
    const [generations, total] = await Promise.all([
      prisma.aiGeneration.findMany({
        where: { userId },
        include: {
          model: { include: { provider: { select: { name: true, slug: true, logo: true } } } },
          favorites: { where: { userId } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.aiGeneration.count({ where: { userId } }),
    ]);

    return {
      data: generations.map((g) => ({
        ...g,
        params: g.params ?? null,
        resultUrls: g.resultUrls ?? null,
        isFavorited: g.favorites.length > 0,
      })),
      total,
      pages: Math.ceil(total / limit),
      page,
    };
  }
}
