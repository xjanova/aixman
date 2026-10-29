/**
 * Which stored karaoke files go when their song does (services/retention.ts).
 *
 * A song's timing is `karaoke/<userId>/<id>.json`, its minus-one
 * `karaoke/<userId>/<id>-minus-<ms>.mp3` (karaoke-job.ts; a timing made again
 * leaves the older minus-ones under the same id). The id is an HMAC of the
 * song and its sung lines, so it cannot be worked back from the song: the doc
 * itself says which song it was timed on (`songUrl`). Pure.
 */

const OBJECT = /(?:^|\/)karaoke\/(\d+)\/([0-9a-f]{40})(\.json|-minus-\d+\.mp3)$/;

/** A karaoke file's owner and timing id, and whether it is the timing itself; null for anything else. */
export function karaokeObject(key: string): { userId: number; id: string; doc: boolean } | null {
  const m = OBJECT.exec(key);
  return m ? { userId: Number(m[1]), id: m[2], doc: m[3] === '.json' } : null;
}

/**
 * The karaoke files to delete among `keys`: every file of each timing whose
 * song is going (`doomedSongs`) and that no story project still uses
 * (`keptSongs`). `songOf` maps a timing's key to its song's key; a timing it
 * has no entry for (it could not be read) is left alone.
 */
export function expiredKaraokeKeys(
  keys: readonly string[],
  songOf: ReadonlyMap<string, string>,
  doomedSongs: ReadonlySet<string>,
  keptSongs: ReadonlySet<string>
): string[] {
  const going = new Set<string>();
  for (const key of keys) {
    const o = karaokeObject(key);
    const song = o?.doc ? songOf.get(key) : undefined;
    if (o && song && doomedSongs.has(song) && !keptSongs.has(song)) going.add(`${o.userId}/${o.id}`);
  }
  return keys.filter((key) => {
    const o = karaokeObject(key);
    return o !== null && going.has(`${o.userId}/${o.id}`);
  });
}
