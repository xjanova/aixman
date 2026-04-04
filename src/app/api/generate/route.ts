import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUserId } from '@/lib/auth';
import { GenerationService } from '@/lib/services/generation';
import type { GenerationRequest } from '@/types';

const MAX_PROMPT_LENGTH = 10000;
const MAX_NUM_OUTPUTS = 4;

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
      prompt: body.prompt,
      negativePrompt: body.negativePrompt,
      params: body.params,
      inputImage: body.inputImage,
      styleId: body.styleId,
    };

    if (!genRequest.prompt?.trim()) {
      return NextResponse.json({ error: 'Prompt is required' }, { status: 400 });
    }

    if (genRequest.prompt.length > MAX_PROMPT_LENGTH) {
      return NextResponse.json({ error: `Prompt must be under ${MAX_PROMPT_LENGTH} characters` }, { status: 400 });
    }

    if (!genRequest.modelId) {
      return NextResponse.json({ error: 'Model ID is required' }, { status: 400 });
    }

    // Cap numOutputs
    if (genRequest.params?.numOutputs && genRequest.params.numOutputs > MAX_NUM_OUTPUTS) {
      genRequest.params.numOutputs = MAX_NUM_OUTPUTS;
    }

    const result = await GenerationService.generate(userId, genRequest);

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

    console.error('Generation error:', error);
    return NextResponse.json({ error: 'Generation failed. Please try again.' }, { status: 500 });
  }
}
