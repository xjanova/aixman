import prisma from '@/lib/db';
import { continuityContext, episodeLedger } from './shooting';

export async function previousEpisodeContext(project: { seriesId: number | null; episodeNumber: number | null; userId: number; mode: string }): Promise<string> {
  if (!project.seriesId || !project.episodeNumber || project.mode !== 'film') return '';
  const earlier = await prisma.aiStoryProject.findMany({
    where: { seriesId: project.seriesId, userId: project.userId, episodeNumber: { lt: project.episodeNumber }, shots: { some: {} } },
    orderBy: { episodeNumber: 'desc' }, take: 3,
    include: { characters: true, scenes: true, shots: { orderBy: { shotNumber: 'asc' } } },
  });
  return continuityContext(earlier.reverse().map((p, k) => episodeLedger(p, k === earlier.length - 1 ? 5000 : 1800)));
}
