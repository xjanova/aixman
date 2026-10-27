import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUserId, isAdmin } from '@/lib/auth';
import prisma from '@/lib/db';
import { rateLimit } from '@/lib/rate-limit';
import { chooseModel, imageModels, orderAssetPicture, pictureSettings } from '@/lib/story/keyframes';
import { ASSET_KINDS, assetPictures, isAssetKind } from '@/lib/story/library';
import { StoryError, loadOwnedProject } from '@/lib/story/service';
import { assetInput, serializeProject, storyErrorReply, text } from '@/lib/story/http';

/**
 * POST /api/story/[id]/assets — the project's reference library.
 *   {action:'add', kind, name, description, pictures?}
 *   {action:'update', assetId, name?, description?, pictures?}
 *   {action:'delete', assetId}   shots and scenes simply stop naming it
 *   {action:'picture', assetId, note?}   an AI picture from its description
 *     (and its pictures, when the picture model takes references) — a studio
 *     order, charged and refunded like one; the page polls.
 */

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const PICTURES_PER_HOUR = 60;

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: 'กรุณาเข้าสู่ระบบ' }, { status: 401 });
  const id = Number((await params).id);
  const admin = await isAdmin();
  try {
    const project = await loadOwnedProject(userId, id);
    if (!project) return NextResponse.json({ error: 'ไม่พบโปรเจกต์' }, { status: 404 });
    const body = ((await request.json().catch(() => null)) ?? {}) as Record<string, unknown>;
    const assetId = Number(body.assetId);
    const asset = project.characters.find((c) => c.id === assetId);

    switch (body.action) {
      case 'add': {
        const input = assetInput(body, userId);
        if (!input.kind) throw new StoryError('เลือกประเภทก่อน');
        const kind = input.kind;
        const count = project.characters.filter((c) => (isAssetKind(c.kind) ? c.kind : 'character') === kind).length;
        if (count >= ASSET_KINDS[kind].max) throw new StoryError(`${ASSET_KINDS[kind].label}ได้สูงสุด ${ASSET_KINDS[kind].max} รายการ`);
        const [main, ...extra] = input.pictures ?? [];
        await prisma.aiStoryCharacter.create({
          data: {
            projectId: project.id,
            kind,
            name: input.name || `${ASSET_KINDS[kind].label} ${count + 1}`,
            description: input.description ?? '',
            referenceUrl: main ?? null,
            images: extra,
            origin: 'uploaded',
            sortOrder: project.characters.length,
          },
        });
        break;
      }
      case 'update': {
        if (!asset) throw new StoryError('ไม่พบรายการนี้ในคลัง', 404);
        const input = assetInput(body, userId, assetPictures(asset));
        const data: Record<string, unknown> = {};
        if (input.name) data.name = input.name;
        if (input.description !== undefined) data.description = input.description;
        if (input.pictures) {
          const [main, ...extra] = input.pictures;
          data.referenceUrl = main ?? null;
          data.images = extra;
        }
        // A character keeps being a character: shots name it as cast.
        if (input.kind && input.kind !== asset.kind) throw new StoryError('เปลี่ยนประเภทไม่ได้ ลบแล้วเพิ่มใหม่แทน');
        await prisma.aiStoryCharacter.updateMany({ where: { id: asset.id, projectId: project.id }, data });
        break;
      }
      case 'delete': {
        if (!asset) throw new StoryError('ไม่พบรายการนี้ในคลัง', 404);
        // A picture on the way is paid for; it lands on this row.
        if (asset.imageStatus === 'rendering') throw new StoryError('AI กำลังวาดภาพรายการนี้อยู่ ลบได้เมื่อเสร็จแล้ว', 409);
        await prisma.aiStoryCharacter.deleteMany({ where: { id: asset.id, projectId: project.id } });
        break;
      }
      case 'picture': {
        if (!asset) throw new StoryError('ไม่พบรายการนี้ในคลัง', 404);
        if (!admin) {
          const limit = rateLimit(`story-picture:${userId}`, PICTURES_PER_HOUR, 60 * 60_000);
          if (!limit.ok) throw new StoryError(`ให้ AI วาดภาพครบ ${PICTURES_PER_HOUR} ครั้งในชั่วโมงนี้แล้ว ลองใหม่ภายหลัง`, 429);
        }
        const model = chooseModel(await imageModels(admin), pictureSettings(project.scriptJson).pictureModelId, false);
        if (!model) throw new StoryError('ยังไม่มีโมเดลภาพเปิดให้ใช้ตอนนี้', 409);
        await orderAssetPicture(userId, admin, project, asset.id, model, text(body.note, 300));
        break;
      }
      default:
        throw new StoryError('คำสั่งไม่ถูกต้อง');
    }
    const fresh = (await loadOwnedProject(userId, id))!;
    return NextResponse.json(await serializeProject(fresh, admin));
  } catch (error) {
    return storyErrorReply(error, 'assets');
  }
}
