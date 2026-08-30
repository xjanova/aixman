import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUserId, isAdmin } from '@/lib/auth';
import { GenerationService } from '@/lib/services/generation';
import { keyFromPublicUrl } from '@/lib/storage/r2';
import type { GenerationRequest } from '@/types';

const MAX_PROMPT_LENGTH = 10000;
const MAX_NUM_OUTPUTS = 4;
const VALID_TYPES = ['image', 'video', 'edit'];

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
      styleId: body.styleId,
    };

    // Lip-sync inputs are handed to a third party to fetch — fal downloads
    // `audio_url` itself, and a rented worker curls the URL into its input dir.
    // Accepting an arbitrary URL here would let a caller aim our providers at
    // any host they like on our account, so only URLs we minted in
    // /api/uploads are allowed through. keyFromPublicUrl answers null for
    // anything outside our own bucket, which is exactly the test we need.
    for (const field of ['inputAudio', 'inputVideo'] as const) {
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
    // rejected exactly as before.
    if (!genRequest.prompt?.trim() && !genRequest.inputAudio) {
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

    // Cap numOutputs
    if (genRequest.params?.numOutputs && genRequest.params.numOutputs > MAX_NUM_OUTPUTS) {
      genRequest.params.numOutputs = MAX_NUM_OUTPUTS;
    }

    // Admins may run models still in 'tuning' — that is how a self-hosted model
    // gets proven and promoted out of it.
    const result = await GenerationService.generate(userId, genRequest, {
      isAdmin: await isAdmin(),
    });

    return NextResponse.json(result);
  } catch (error) {
    const message = (error as Error).message;

    // Only expose known user-facing error messages
    if (message.includes('Insufficient credits')) {
      return NextResponse.json({ error: message }, { status: 402 });
    }
    if (message.includes('not found') || message.includes('inactive')) {
      return NextResponse.json({ error: 'Model not available' }, { status: 404 });
    }
    if (message.includes('unavailable') || message.includes('No available API accounts')) {
      return NextResponse.json({ error: 'Service temporarily unavailable. Please try again later.' }, { status: 503 });
    }
    // Already user-facing Thai copy from ModelReadiness — pass it through rather
    // than flattening it into a generic failure.
    if (message.includes('กำลังปรับแต่ง')) {
      return NextResponse.json({ error: message }, { status: 409 });
    }

    console.error('Generation error:', error);
    return NextResponse.json({ error: 'Generation failed. Please try again.' }, { status: 500 });
  }
}
