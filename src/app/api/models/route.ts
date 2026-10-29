import { NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { LLM_CATEGORY } from '@/lib/llm/pricing';
import { isAdmin } from '@/lib/auth';
import { ModelReadiness, TUNING_MSG } from '@/lib/services/model-readiness';
import { accountBlock, type AccountBlock } from '@/lib/services/account-pool';
import { getCatalogEntry, isCommunityOnlyModel, visibleVideoOptions } from '@/lib/gpu/catalog';
import { getGpuConfig } from '@/lib/gpu/config';
import { GpuBalance } from '@/lib/services/gpu-balance';
import { isStorageConfigured } from '@/lib/storage/r2';
import { isInHouse, publicDefaultParams, publicModelDescription, publicModelId, publicModelName, publicProvider } from '@/lib/public-provider';
import { communityListing, NO_MACHINE_LISTING_MSG } from '@/lib/gpu/community-dispatch';
import { communityMachineAvailable } from '@/lib/gpu/community-availability';
import { getAllStoredWorkflows, visibleQualityModes } from '@/lib/gpu/workflow-overrides';
import { apiVideoLipsyncRule, type ClipRule, type LipsyncBilling, type VoiceRule } from '@/lib/lipsync-rules';
import { referenceCaps } from '@/lib/reference-caps';
import { modelPreview } from '@/lib/model-samples';
import { getKieEntry, kiePriceTable, type KieEntry } from '@/lib/providers/kie-catalog';
import { kieQuote, readKiePriceTable, type KiePriceTable } from '@/lib/providers/kie-pricing';
import { fallbackRefsFor, whyNotFallback } from '@/lib/providers/kie-fallback';
import { sunoStudioOptions } from '@/lib/providers/kie-suno';
import { loadFallbackSettings } from '@/lib/services/kie-route';
import { pick, requestLocale, type Locale, type Msg } from '@/lib/i18n/locale';
import { qualityModeText, tierDescription, tierLabel, voiceLabel } from '@/lib/i18n/model-text';
import { stemOptions } from '@/lib/i18n/suno-text';

/**
 * Public model list for the studio and the mobile app.
 *
 * Fields are listed explicitly. This used to spread the whole row, which sent
 * `costPerUnit` (our cost price), `readinessNote` (raw failure text) and
 * `failureStreak` to anyone — the route has no auth.
 *
 * Every model also carries whether it can be ordered *right now* and, if not,
 * a customer-safe reason, so the studio can grey it out instead of letting a
 * customer type a prompt for a model whose provider is not connected, whose
 * keys are all failing, or whose rental is switched off — or, for a model only
 * GPUxMINE home PCs run, when no such PC may take an order right now.
 */

export const dynamic = 'force-dynamic';

type Availability = 'ok' | 'not-connected' | 'busy' | 'maintenance' | 'no-machine';

const UNAVAILABLE_TEXT: Record<Exclude<Availability, 'ok'>, Msg> = {
  'not-connected': { th: 'ยังไม่เปิดให้บริการ', en: 'Not open yet' },
  busy: { th: 'มีผู้ใช้งานหนาแน่น ลองใหม่ในอีกสักครู่', en: 'Very busy right now — try again in a moment' },
  maintenance: { th: 'ปิดปรับปรุงชั่วคราว', en: 'Closed for maintenance' },
  'no-machine': NO_MACHINE_LISTING_MSG,
};

/**
 * Music controls for a rented-GPU audio model.
 *
 * Derived from the catalogue rather than stored on the row: the same facts
 * already decide how the job is built, and a second copy in the database would
 * drift the moment a template changes.
 */
/**
 * A model that re-dubs an uploaded clip: what the clip may be and — on an API
 * row — the voice beside it and how the order is billed, from the same rules
 * GenerationService checks the stored files against. A rented model prices by
 * its voice instead (`lengthFromAudio`), so it has no billing here.
 */
function videoLipsyncOptions(
  modelKey: string,
  inHouse: boolean
): { clip: ClipRule; voice: VoiceRule | null; billing: LipsyncBilling | null } | null {
  if (inHouse) {
    const clip = getCatalogEntry(modelKey)?.sourceVideo;
    return clip ? { clip, voice: null, billing: null } : null;
  }
  const rule = apiVideoLipsyncRule(modelKey);
  return rule ? { clip: rule.clip, voice: rule.voice, billing: rule.billing } : null;
}

function musicOptions(modelKey: string): {
  lyrics: boolean;
  sourceSong: boolean;
  maxDuration: number | null;
  autoLength: boolean;
  maxSourceSeconds: number | null;
  controls: boolean;
} | null {
  const entry = getCatalogEntry(modelKey);
  if (!entry || entry.outputKind !== 'audio') return null;
  return {
    lyrics: true,
    sourceSong: entry.needs?.audio === true,
    maxDuration: entry.limits?.maxDuration ?? null,
    // The model picks the length: the studio hides its length control and the
    // price stops depending on one.
    autoLength: entry.music?.autoLength === true,
    // What a cover may start from — a different number from what it may sing,
    // and bounded by the upload cap rather than by the model.
    maxSourceSeconds: entry.music?.maxSourceSeconds ?? entry.limits?.maxDuration ?? null,
    // Whether the voice / genre / arrangement chips do anything here.
    controls: entry.music?.controls === true,
  };
}

function qualityOptions(
  modelKey: string,
  stored: Parameters<typeof visibleQualityModes>[1],
  admin: boolean,
  locale: Locale
): { id: string; label: string; description: string; creditsMultiplier: number; isDefault: boolean; adminOnly: boolean }[] | null {
  const modes = visibleQualityModes(getCatalogEntry(modelKey), stored, admin);
  if (modes.length === 0) return null;
  return modes.map((m) => ({
    id: m.id,
    ...qualityModeText(modelKey, m, locale),
    creditsMultiplier: m.creditsMultiplier,
    isDefault: m.isDefault === true,
    // Lets the studio mark a mode only an admin can see as a test.
    adminOnly: m.adminOnly === true,
  }));
}

/** A Suno tool's music panel, its stem picker in the visitor's language. */
function sunoMusicOptions(tool: Parameters<typeof sunoStudioOptions>[0], locale: Locale) {
  const options = sunoStudioOptions(tool);
  return { ...options, suno: { ...options.suno, stems: stemOptions(options.suno.stems, locale) } };
}

/**
 * What the studio draws for a KIE.ai row, from its catalogue entry and the
 * credits table its sync wrote: tiers as the quality or resolution chips the
 * studio already has, the clip's frames, the music panel, the voice rule.
 */
function kieOptions(entry: KieEntry, table: KiePriceTable, locale: Locale) {
  const tiers = table.tiers;
  const base = kieQuote(table, {});
  return {
    video:
      entry.category === 'video' && !entry.subcategory.startsWith('lipsync')
        ? {
            firstFrame: entry.firstFrame === true,
            lastFrame: entry.lastFrame === true,
            resolutions:
              table.tierParam === 'resolution'
                ? tiers.map((t) => ({ id: t.id, label: tierLabel(t.label, locale), aspects: [...STUDIO_ASPECTS], isDefault: t.isDefault === true }))
                : undefined,
          }
        : null,
    quality:
      table.tierParam === 'quality' && tiers.length > 1
        ? tiers.map((t) => ({
            id: t.id,
            label: tierLabel(t.label, locale),
            // Suno's versions and splits say what each is; other tiers are their label.
            description: tierDescription(entry.tiers.find((x) => x.id === t.id)?.description ?? '', locale),
            // Display only: the studio prices KIE rows from `priceTable`.
            creditsMultiplier: Math.round((kieQuote(table, { tier: t.id }) / base) * 100) / 100,
            isDefault: t.isDefault === true,
            adminOnly: false,
          }))
        : null,
    // A Suno tool draws its own mode of the music tab (kie-suno.ts).
    music: entry.suno
      ? sunoMusicOptions(entry.suno, locale)
      : entry.music
      ? { lyrics: true, sourceSong: false, maxDuration: null, autoLength: true, maxSourceSeconds: null, controls: true }
      : null,
    lengthFromAudio: entry.lengthFromAudio ?? null,
    // The speech tab's voice picker and character limit.
    speech: entry.speech
      ? {
          voices: entry.speech.voices.map((v) => ({ ...v, label: voiceLabel(v.id, v.label, locale) })),
          maxChars: entry.speech.maxChars,
          style: entry.speech.style === true,
          tags: entry.speech.tags === true,
        }
      : null,
    // A clip the order works on (upscale, motion reference): the rule GenerationService
    // checks the stored file against, so the studio can say first.
    clipInput: entry.sourceClip ? { clip: entry.sourceClip, needsImage: entry.needsImage === true } : null,
  };
}

/** Every shape the studio offers; a KIE entry maps each to its nearest own. */
const STUDIO_ASPECTS = ['1:1', '16:9', '9:16', '4:3', '3:2', '3:4', '2:3'] as const;

/** From the provider's keys: can any of them take a request right now? */
function fromAccounts(blocks: (AccountBlock | null)[]): Availability {
  if (blocks.some((b) => b === null)) return 'ok';
  if (blocks.length === 0 || blocks.every((b) => b === 'inactive')) return 'not-connected';
  // Cooldowns lift within minutes; errors and quotas need someone to act.
  if (blocks.includes('cooldown')) return 'busy';
  return 'maintenance';
}

export async function GET(request: Request) {
  // Names, descriptions, labels and reasons in the visitor's language (cookie, else X-Locale, else Thai).
  const locale = requestLocale(request);
  const now = new Date();
  const [models, admin, accounts, gpuCfg, workflows] = await Promise.all([
    prisma.aiModel.findMany({
      // Language models are sold through /api/v1, not in the studio.
      where: { isActive: true, category: { not: LLM_CATEGORY } },
      include: { provider: { select: { id: true, name: true, slug: true, logo: true, isActive: true } } },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    }),
    isAdmin(),
    prisma.aiAccountPool.findMany({
      select: {
        providerId: true,
        isActive: true,
        cooldownUntil: true,
        dailyQuota: true,
        usageToday: true,
        monthlyQuota: true,
        usageThisMonth: true,
        consecutiveErrors: true,
      },
    }),
    getGpuConfig(),
    // Quality-mode prices and visibility an admin set on /admin/workflows. A
    // failed read shows the catalogue's own modes rather than no model list.
    getAllStoredWorkflows().catch(() => new Map()),
  ]);

  // Vendor balance too low to rent (gpu-balance.ts): a model with no machine
  // running cannot render anything, so it is shown as closed rather than taking
  // an order that would only be refunded. A stored reading — no vendor call here.
  const pausedModels = new Set<string>();
  if (gpuCfg.enabled && (await GpuBalance.read(gpuCfg)).state === 'insufficient') {
    const live = await prisma.aiGpuWorker.findMany({
      where: { status: { in: ['provisioning', 'warming', 'ready', 'busy'] } },
      select: { modelKey: true },
    });
    const running = new Set(live.map((w) => w.modelKey));
    for (const m of models) {
      // Nothing is rented for a community-only model, so no vendor balance pauses it (GpuBalance.pausesModel).
      if (isInHouse(m.provider.slug) && !isCommunityOnlyModel(m.modelId) && !running.has(m.modelId)) pausedModels.add(m.modelId);
    }
  }

  const byProvider = new Map<number, Availability>();
  const availability = (provider: { id: number; slug: string; isActive: boolean }): Availability => {
    const cached = byProvider.get(provider.id);
    if (cached) return cached;
    let result: Availability;
    if (!provider.isActive) {
      result = 'not-connected';
    } else if (isInHouse(provider.slug) && (!gpuCfg.enabled || !isStorageConfigured())) {
      // Rental switched off or nowhere to keep renders — the order path
      // refuses these, so the studio must not offer them.
      result = 'maintenance';
    } else {
      result = fromAccounts(accounts.filter((a) => a.providerId === provider.id).map((a) => accountBlock(a, now)));
    }
    byProvider.set(provider.id, result);
    return result;
  };

  // A community-only model (sdxl-community) is served by GPUxMINE home PCs: it
  // rents nothing and calls no vendor's API, so neither the rental switch nor
  // the SimplePod row's keys say whether it can take an order — the provider
  // row being on, somewhere to keep the render and a home PC that may serve
  // it do, exactly what GenerationService checks before charging. One query
  // per such model; a read that fails leaves the decision to the order path.
  const communityOnly = models.filter((m) => isInHouse(m.provider.slug) && isCommunityOnlyModel(m.modelId));
  const machineFor = new Map(
    await Promise.all(
      communityOnly.map(async (m) => [m.modelId, await communityMachineAvailable(m.modelId).catch(() => true)] as const)
    )
  );
  // A KIE model whose keys cannot take an order now is still sold when its
  // fallback can (kie-fallback.ts): GenerationService routes the order there
  // before charging, at the KIE price. A failed read leaves KIE's own state.
  const kieFallback = models.some((m) => m.provider.slug === 'kie') ? await loadFallbackSettings().catch(() => null) : null;
  const byRef = new Map(models.map((m) => [`${m.provider.slug}:${m.modelId}`, m]));
  const fallbackServes = (kieKey: string): boolean =>
    kieFallback?.enabled === true &&
    fallbackRefsFor(kieKey, kieFallback.map).some((ref) => {
      const row = byRef.get(ref);
      if (!row) return false;
      const why = whyNotFallback(
        { kieKey, references: 0, firstFrame: false, lastFrame: false, seconds: null, clip: null, voice: null },
        {
          providerSlug: row.provider.slug,
          providerActive: row.provider.isActive,
          modelId: row.modelId,
          category: row.category,
          subcategory: row.subcategory,
          isActive: row.isActive,
          readiness: row.readiness,
          maxDuration: row.maxDuration,
          costPerUnit: Number(row.costPerUnit),
          defaultParams: row.defaultParams,
        }
      );
      return why === null && availability(row.provider) === 'ok';
    });

  const communityAvailability = (m: { modelId: string; provider: { isActive: boolean } }): Availability =>
    communityListing({
      providerActive: m.provider.isActive,
      storageConfigured: isStorageConfigured(),
      machineAvailable: machineFor.get(m.modelId) ?? true,
    });

  return NextResponse.json({
    models: models.map((m) => {
      const inHouse = isInHouse(m.provider.slug);
      const kieEntry = m.provider.slug === 'kie' ? getKieEntry(m.modelId) : undefined;
      const kieTable = kieEntry ? readKiePriceTable(m.defaultParams) ?? kiePriceTable(kieEntry) : null;
      const kie = kieEntry && kieTable ? kieOptions(kieEntry, kieTable, locale) : null;
      const own = pausedModels.has(m.modelId)
        ? 'maintenance'
        : inHouse && isCommunityOnlyModel(m.modelId)
          ? communityAvailability(m)
          : availability(m.provider);
      // KIE switched off on Providers is refused before any routing: only an active KIE hands over to its fallback.
      const avail: Availability = own !== 'ok' && m.provider.isActive && kieEntry && fallbackServes(m.modelId) ? 'ok' : own;
      const readinessOk = ModelReadiness.canOrder(m.readiness, admin);
      const status = avail !== 'ok' ? 'unavailable' : m.readiness === 'tuning' ? 'tuning' : readinessOk ? 'ready' : 'unavailable';
      const reasonMsg =
        avail !== 'ok'
          ? UNAVAILABLE_TEXT[avail]
          : m.readiness === 'tuning'
            ? TUNING_MSG
            : readinessOk
              ? null
              : UNAVAILABLE_TEXT.maintenance;
      const reason = reasonMsg ? pick(reasonMsg, locale) : null;
      return {
        id: m.id,
        // Customers never see which vendor serves a model (public-provider.ts).
        modelId: publicModelId(m.modelId),
        name: publicModelName(m.modelId, m.name, locale),
        description: publicModelDescription(m.modelId, m.description, locale),
        category: m.category,
        subcategory: m.subcategory,
        thumbnail: m.thumbnail,
        // The picker's picture: the admin's thumbnail, else the family's bundled
        // sample (model-samples.ts), with the credit its licence requires.
        // Null = the studio draws its category art.
        preview: modelPreview(m.modelId, m.thumbnail),
        isFeatured: m.isFeatured,
        creditsPerUnit: m.creditsPerUnit,
        unitType: m.unitType,
        maxWidth: m.maxWidth,
        maxHeight: m.maxHeight,
        maxDuration: m.maxDuration,
        supportedParams: m.supportedParams,
        defaultParams: publicDefaultParams(m.defaultParams),
        sortOrder: m.sortOrder,
        readiness: m.readiness,
        provider: publicProvider(m.provider),
        // What the studio used to read off the provider's slug: an order that
        // finishes in the background (poll up to 35 min), and a model that
        // reads Latin prompts only (warn before a Thai one).
        asyncApi: m.provider.slug === 'kie',
        latinPromptOnly: m.provider.slug === 'pollinations',
        // What GenerationService will charge, so the studio shows the same
        // number: an in-house job renders one output and may price by length.
        maxOutputs: inHouse || kie ? 1 : null,
        durationCurve: inHouse ? getCatalogEntry(m.modelId)?.pricing.durationCurve ?? null : null,
        // First/last frame and resolution presets the studio may offer. Null for
        // models that have none, so older clients see nothing new. Admin-only
        // presets reach admins only.
        video: inHouse ? visibleVideoOptions(getCatalogEntry(m.modelId), admin) : kie ? kie.video : null,
        // What the music tab needs to draw itself: whether the model sings the
        // customer's words, and whether it starts from a song they upload.
        // Null for anything that is not a rented-GPU audio model.
        music: inHouse ? musicOptions(m.modelId) : kie ? kie.music : null,
        // A model whose render is as long as the uploaded voice: the studio
        // rounds the voice's length with the same rule GenerationService
        // applies (voice-length.ts) and prices that, instead of a length
        // control. Null for every other model.
        lengthFromAudio: inHouse ? getCatalogEntry(m.modelId)?.lengthFromAudio ?? null : kie ? kie.lengthFromAudio : null,
        // A model that re-dubs a clip: its rules, so the studio can say before
        // the order whether the clip fits and what it costs. Null otherwise.
        videoLipsync: videoLipsyncOptions(m.modelId, inHouse),
        // How many reference pictures an order may carry, and whether a clip
        // opens / ends on a given frame (reference-caps.ts). 0 = none.
        references: referenceCaps({ providerSlug: m.provider.slug, modelId: m.modelId, category: m.category, defaultParams: m.defaultParams }),
        // Quality modes the studio may offer (Qwen-Image เร็ว / คุณภาพสูง), each
        // with the multiplier GenerationService prices it at. Null when the
        // model has none; admin-only modes reach admins only.
        quality: inHouse ? qualityOptions(m.modelId, workflows.get(m.modelId) ?? null, admin, locale) : kie ? kie.quality : null,
        // A KIE.ai row's credits by tier, length and pictures (kie-pricing.ts),
        // the table GenerationService charges from. Credits only — never the
        // vendor's price. Null for every other model.
        priceTable: kieTable,
        // Text-to-speech voices and limit (KIE speech rows), else null.
        speech: kie ? kie.speech : null,
        // A clip to upscale or copy the motion of (KIE video tools), else null.
        clipInput: kie ? kie.clipInput : null,
        // 'tuning' stays orderable for admins — running it is how it gets
        // proven. 'unavailable' is not orderable by anyone: it would fail.
        status,
        canOrder: avail === 'ok' && readinessOk,
        unavailableReason: avail === 'ok' && readinessOk ? null : reason,
        // Kept for older app builds, which read this name.
        tuningMessage: avail === 'ok' && readinessOk ? null : reason,
      };
    }),
  });
}
