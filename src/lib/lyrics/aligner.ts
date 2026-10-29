import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { demucsPython } from '@/lib/story/vocals';

/**
 * The Thai lyric aligner on this host's CPU: every letter of the lyrics given
 * the moment it is sung, from the separated vocal. karaoke.ts turns the
 * letters into words and lines.
 *
 * Model: airesearch/wav2vec2-large-xlsr-53-th (CC-BY-SA-4.0, commercial use
 * with attribution) — the Thai CTC model WhisperX aligns Thai with. Its
 * vocabulary is Thai letters, `|` between words and `[PAD]` as the CTC blank.
 * Run int8 (dynamic quantisation of the Linear layers): half the time and
 * memory, letter times within 0.02 s of fp32 on a real song.
 *
 * Where it lives (both overridable):
 * - Python: `LYRICS_ALIGN_PYTHON`, else the Demucs venv (torch 2.5.1+cpu,
 *   torchaudio 2.5.1) with `transformers<5` added.
 * - Weights: `LYRICS_ALIGN_MODEL`, else ~/models/wav2vec2-large-xlsr-53-th,
 *   converted once to `model.safetensors` — transformers refuses the repo's
 *   `pytorch_model.bin` on torch < 2.6 (CVE-2025-32434).
 */

/**
 * Runs with `python -I` from a temp dir that also holds the song. Arguments:
 * 16 kHz mono vocal, the lines (JSON array of `alignTarget().align`), the
 * output path, threads, the model dir. Writes {ok, chars, voiced, seconds}.
 *
 * - Emissions in 15 s windows with 2 s of context each side (each window
 *   normalised like the model's training clips); only the middle is kept.
 * - A free "star" token (log-prob 0) before, between and after the lines
 *   takes whatever is sung that the lyrics do not say, and the silences.
 * - `voiced`: where the vocal sounds (20 ms RMS above the song's own loud
 *   level − 28 dB), so a held note keeps its word lit.
 */
export const ALIGN_PY = String.raw`import json, math, sys, time
import numpy as np
import soundfile as sf
import torch
import torchaudio
from transformers import Wav2Vec2CTCTokenizer, Wav2Vec2ForCTC

wav_path, lines_path, out_path, threads, model_dir = sys.argv[1:6]
torch.set_num_threads(max(1, int(threads)))
started = time.time()

tok = Wav2Vec2CTCTokenizer.from_pretrained(model_dir)
model = Wav2Vec2ForCTC.from_pretrained(model_dir)
model.eval()
model = torch.quantization.quantize_dynamic(model, {torch.nn.Linear}, dtype=torch.qint8, inplace=True)
vocab = tok.get_vocab()
blank = tok.pad_token_id if tok.pad_token_id is not None else 0
delim = vocab.get(tok.word_delimiter_token or "|")

audio, rate = sf.read(wav_path, dtype="float32", always_2d=True)
if rate != 16000:
    raise SystemExit(f"expected 16 kHz, got {rate}")
x = audio.mean(1)
n = len(x)

HOP, CTX, STRIDE, FIELD = 16000 * 15, 16000 * 2, 320, 400
emis, times = [], []
with torch.inference_mode():
    for w in range(0, n, HOP):
        a, b = max(0, w - CTX), min(n, w + HOP + CTX)
        seg = x[a:b]
        if len(seg) < FIELD:
            break
        seg = (seg - seg.mean()) / math.sqrt(seg.var() + 1e-7)
        logits = model(torch.from_numpy(np.ascontiguousarray(seg))[None]).logits[0].float()
        lp = torch.log_softmax(logits, -1)
        centre = (a + np.arange(lp.shape[0]) * STRIDE + FIELD / 2) / 16000.0
        keep = (centre >= w / 16000.0) & (centre < min(n, w + HOP) / 16000.0)
        idx = np.nonzero(keep)[0]
        if len(idx):
            emis.append(lp[idx[0]: idx[-1] + 1])
            times.append(centre[idx[0]: idx[-1] + 1])
if not emis:
    raise SystemExit("no audio")
emission = torch.cat(emis)
frame_t = np.concatenate(times)
T = emission.shape[0]

hop = 320
frames = max(1, n // hop)
rms = np.sqrt(np.mean(x[: frames * hop].reshape(frames, hop) ** 2, axis=1) + 1e-12)
db = 20 * np.log10(rms)
loud = np.percentile(db, 90)
on = db > max(loud - 28.0, -55.0)
voiced, s = [], None
for i, v in enumerate(on):
    t = i * hop / 16000.0
    if v and s is None:
        s = t
    elif not v and s is not None:
        voiced.append([s, t])
        s = None
if s is not None:
    voiced.append([s, frames * hop / 16000.0])
merged = []
for seg in voiced:
    if merged and seg[0] - merged[-1][1] < 0.15:
        merged[-1][1] = seg[1]
    else:
        merged.append(seg)
voiced = [[round(a, 2), round(b, 2)] for a, b in merged if b - a >= 0.08]

lines = json.load(open(lines_path, encoding="utf-8"))
star = emission.shape[1]
emission = torch.cat([emission, torch.zeros(T, 1)], 1)
tokens, owners = [star], [None]
for li, line in enumerate(lines):
    for ci, ch in enumerate(line):
        if ch == " ":
            if delim is not None and owners[-1] is not None:
                tokens.append(delim)
                owners.append(None)
            continue
        k = vocab.get(ch)
        if k is None or k == blank:
            continue
        tokens.append(k)
        owners.append((li, ci))
    if owners[-1] is None and tokens[-1] == delim:
        tokens.pop()
        owners.pop()
    tokens.append(star)
    owners.append(None)

result = [[None] * len(line) for line in lines]
need = len(tokens) + sum(1 for i in range(1, len(tokens)) if tokens[i] == tokens[i - 1])
if need <= T:
    aligned, scores = torchaudio.functional.forced_align(emission[None], torch.tensor([tokens], dtype=torch.int32), blank=blank)
    spans = torchaudio.functional.merge_tokens(aligned[0], scores[0].exp(), blank=blank)
    if len(spans) == len(tokens):
        for span, owner in zip(spans, owners):
            if owner is None:
                continue
            li, ci = owner
            start = float(frame_t[span.start]) - 0.01
            end = float(frame_t[min(span.end, T) - 1]) + 0.01
            result[li][ci] = [round(start, 3), round(end, 3), round(float(span.score), 3)]

json.dump(
    {"ok": need <= T, "chars": result, "voiced": voiced, "seconds": round(n / 16000.0, 2)},
    open(out_path, "w", encoding="utf-8"),
)
print(f"ok {time.time() - started:.1f}")
`;

export function alignerPython(): string | null {
  const own = process.env.LYRICS_ALIGN_PYTHON;
  if (own) return existsSync(own) ? own : null;
  return demucsPython();
}

/** The model directory, or null when its converted weights are not there. */
export function alignerModelDir(): string | null {
  const dir = process.env.LYRICS_ALIGN_MODEL || path.join(homedir(), 'models', 'wav2vec2-large-xlsr-53-th');
  return existsSync(path.join(dir, 'model.safetensors')) && existsSync(path.join(dir, 'vocab.json')) ? dir : null;
}

export function alignerThreads(): number {
  const n = Number(process.env.LYRICS_ALIGN_THREADS ?? process.env.DEMUCS_THREADS);
  return Number.isInteger(n) && n > 0 ? n : 8;
}
