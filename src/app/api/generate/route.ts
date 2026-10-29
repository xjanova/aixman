import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUserId, isAdmin } from '@/lib/auth';
import { GenerationService } from '@/lib/services/generation';
import { generationErrorResponse } from '@/lib/services/generation-errors';
import { publicErrorMessage } from '@/lib/public-provider';
import { keyFromPublicUrl } from '@/lib/storage/r2';
import type { GenerationRequest } from '@/types';

const MAX_PROMPT_LENGTH = 10000;
const MAX_NUM_OUTPUTS = 4;
const VALID_TYPES = ['image', 'video', 'edit', 'audio', 'model3d'];
/** ACE-Step reads a few verses and a chorus; this is several songs' worth. */
const MAX_LYRICS_LENGTH = 3000;

export async function POST(request: NextRequest) {
  const userId = await getCurrentUserId();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json();

    const genRequest: GenerationRequest = {
      modelId: body.modelId,
      type: body.type || 'image',
      // Normalised rather than passed through: a lip-sync request legitimately
      // arrives without one, and the service concatenates a style suffix onto
      // this value — `undefined + ''` would store the literal "undefined" as
      // the customer's prompt.
      prompt: typeof body.prompt === 'string' ? body.prompt : '',
      negativePrompt: body.negativePrompt,
      params: body.params,
      inputImage: body.inputImage,
      inputAudio: body.inputAudio,
      inputVideo: body.inputVideo,
      inputImageEnd: body.inputImageEnd,
      // Checked by GenerationService.checkReferences before any credit moves:
      // a list, no more than the model takes, and only our own uploads.
      referenceImages: body.referenceImages,
      styleId: body.styleId,
    };

    // Lip-sync inputs are handed to a third party to fetch — fal downloads
    // `audio_url` itself, and a rented worker curls the URL into its input dir.
    // Accepting an arbitrary URL here would let a caller aim our providers at
    // any host they like on our account, so only URLs we minted in
    // /api/uploads are allowed through. keyFromPublicUrl answers null for
    // anything outside our own bucket, which is exactly the test we need.
    // A last frame is read by our own server for the rented worker, so the same
    // rule applies to it.
    for (const field of ['inputAudio', 'inputVideo', 'inputImageEnd'] as const) {
      const value = genRequest[field];
      if (value !== undefined && (typeof value !== 'string' || !keyFromPublicUrl(value))) {
        return NextResponse.json(
          { error: 'ไฟล์ที่แนบไม่ถูกต้อง กรุณาอัปโหลดใหม่' },
          { status: 400 }
        );
      }
    }

    // A voice track is itself the instruction: re-dubbing a clip has nothing to
    // describe, and LatentSync's schema has no prompt field to put one in. Every
    // other route still requires a prompt, so an empty text-to-image request is
    // rejected exactly as before. A clip is its own instruction too: an upscale
    // has nothing to describe, and a motion copy's prompt is optional.
    if (!genRequest.prompt?.trim() && !genRequest.inputAudio && !genRequest.inputVideo) {
      return NextResponse.json({ error: 'Prompt is required' }, { status: 400 });
    }

    if (genRequest.prompt.length > MAX_PROMPT_LENGTH) {
      return NextResponse.json({ error: `Prompt must be under ${MAX_PROMPT_LENGTH} characters` }, { status: 400 });
    }

    if (!genRequest.modelId) {
      return NextResponse.json({ error: 'Model ID is required' }, { status: 400 });
    }

    if (!VALID_TYPES.includes(genRequest.type)) {
      return NextResponse.json({ error: 'Invalid generation type' }, { status: 400 });
    }

    const lyrics = genRequest.params?.lyrics;
    if (lyrics !== undefined && (typeof lyrics !== 'string' || lyrics.length > MAX_LYRICS_LENGTH)) {
      return NextResponse.json({ error: `เนื้อเพลงยาวได้ไม่เกิน ${MAX_LYRICS_LENGTH} ตัวอักษร` }, { status: 400 });
    }

    // Cap numOutputs
    if (genRequest.params?.numOutputs && genRequest.params.numOutputs > MAX_NUM_OUTPUTS) {
      genRequest.params.numOutputs = MAX_NUM_OUTPUTS;
    }

    // Admins may run models still in 'tuning' — that is how a self-hosted model
    // gets proven and promoted out of it.
    const result = await GenerationService.generate(userId, genRequest, {
      isAdmin: await isAdmin(),
    });

    // A vendor's failure text names the vendor; customers get it without.
    return NextResponse.json(result.error ? { ...result, error: publicErrorMessage(result.error) } : result);
  } catch (error) {
    const known = generationErrorResponse(error);
    if (known) return NextResponse.json(known.body, { status: known.status });

    console.error('Generation error:', error);
    return NextResponse.json({ error: 'Generation failed. Please try again.' }, { status: 500 });
  }
}
