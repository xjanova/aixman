# Showcase video pack — prompts to generate, then drop in

> ## สถานะปัจจุบัน (2026-08-10)
>
> **ใช้งานอยู่ 6 คลิป** — `dancer`, `city`, `creature`, `anime`, `portrait`,
> `product` (Kling 2.5, 720p, 5 วิ) โหลดมาบีบแล้ววางใน `public/showcase/`
> เรียบร้อย
>
> **hero ตัดสินใจใช้ภาพนิ่ง** — คลิป hero ที่เจนมาออกโทนส้มอำพัน ชนกับหัวข้อ
> gradient ฟ้า→ม่วงที่ทับอยู่และกับทั้งหน้าเว็บ เลยกลับไปใช้ภาพนิ่ง 2K
> เกลียวแสงฟ้า/ม่วง (คมกว่าด้วย 3024×1296 เทียบกับ 1472×624)
> ไฟล์ `hero-reel.mp4` ลบออกจาก repo แล้ว แต่คลิปยังอยู่ในคลังผลงานถาวร
> ถ้าอยากได้ hero ที่ขยับ ให้เจนใหม่โดยใส่ `hero-reel.jpg` เป็น `keyframes.start`
>
> **หมายเหตุสำคัญ:** 7 คลิปนี้เจนแบบ text-to-video ล้วน **ไม่ได้ใช้ภาพนิ่งเป็น start frame**
> ผลคือคลิปเป็นคนละภาพกับภาพนิ่งที่เจนไว้ตอนแรก จึงเปลี่ยนวิธี — ตอนนี้ **ภาพนิ่ง
> (poster) คือเฟรมแรกของคลิปเอง** ดึงออกมาจากคลิปโดยตรง ภาพกับวิดีโอเลยตรงกัน 100%
> และ label บนเว็บแก้เป็น **Kling 2.5** ตามที่ใช้จริงแล้ว (เดิมเขียนว่า Seedance 2.0)
>
> **ยังเหลือ 4 คลิป** (ไม่บังคับ): `temple`, `food`, `coast`, `macro` —
> ตอนนี้ไทล์พวกนี้เป็นภาพนิ่ง 2K ติดป้าย IMAGE ซึ่งถูกต้องตามจริงอยู่แล้ว
>
> ถ้าจะเจนเพิ่ม/เจนใหม่ **ต้องใส่ start frame ให้ตรงกับภาพนิ่ง** ไม่งั้นต้องดึง
> เฟรมแรกมาทำ poster ใหม่ทุกครั้ง ไม่งั้นตอน crossfade ภาพจะกระโดด

หน้าแรกใช้ภาพนิ่งจริงอยู่แล้ว (อยู่ใน `public/showcase/`) และ **จะเล่นวิดีโอทันทีเมื่อมีไฟล์ `.mp4`
ชื่อตรงกันวางอยู่ข้าง ๆ ภาพนั้น** — ไม่ต้องแก้โค้ดเลย ถ้ายังไม่มีไฟล์ หน้าเว็บจะแสดงภาพนิ่งเฉย ๆ
(ตรวจแล้วว่า mp4 ที่ไม่มีไฟล์คืน 404 แล้ววิดีโอถูกซ่อนไว้ที่ `opacity: 0` — ภาพนิ่งโชว์ปกติ ไม่มีกรอบดำ)

## กฎเดียวที่ต้องทำให้ถูก

1. เจนโดยใช้ **ภาพนิ่งใบเดิมเป็น start frame** (`keyframes.start`) — ภาพพวกนี้อยู่ในบัญชีคุณอยู่แล้ว
   จากรอบที่เพิ่งเจนไป เลือกจากไลบรารีได้เลย ไม่ต้องอัปโหลดใหม่
   → ทำแบบนี้แล้ววิดีโอจะเริ่มจากเฟรมเดียวกับภาพนิ่งเป๊ะ ตอนเว็บ crossfade จะเนียนสนิท
2. เซฟชื่อไฟล์ให้ตรงตามตาราง ไว้ที่ `public/showcase/`
3. อัตราส่วนต้องตรงกับภาพนิ่ง ไม่งั้นจะโดน crop

**โมเดลแนะนำ:** Seedance 2.0 (`bytedance-seedance-pro-2.0`) — รองรับ start frame, สั่งมุมกล้องได้,
และมีอัตราส่วนครบทุกแบบที่เราใช้ (21:9, 16:9, 4:3, 1:1, 3:4, 9:16)
ถ้าจะประหยัดเวลา ใช้ Seedance 2.0 Mini/Fast ที่ 720p ก็พอสำหรับไทล์เล็ก ๆ

**ความยาว:** 5 วินาทีพอ — มันวนลูปอยู่แล้ว ยิ่งสั้นยิ่งไฟล์เล็ก หน้าเว็บยิ่งไว

---

## ลำดับความสำคัญ

ทำ 5 อันนี้ก่อนก็เห็นผลชัดที่สุดแล้ว (อันที่ติดป้าย “VIDEO” บนเว็บ):

| # | ไฟล์ที่ต้องได้ | สัดส่วน | ใช้ตรงไหน |
|---|---|---|---|
| 1 | `hero-reel.mp4` | 21:9 | พื้นหลังหัวเว็บ — สำคัญที่สุด |
| 2 | `dancer.mp4` | 4:3 | การ์ดโหมด “ไอเดียเป็นวิดีโอ” |
| 3 | `city.mp4` | 16:9 | กำแพงผลงาน |
| 4 | `creature.mp4` | 16:9 | กำแพงผลงาน |
| 5 | `anime.mp4` | 9:16 | กำแพงผลงาน |

ที่เหลือเป็นของแถม ทำทีหลังได้

---

## 1. `hero-reel.mp4` — 21:9, 5s, 1080p
**Start frame:** `hero-reel.jpg` (คนยืนหน้าเกลียวแสง)
**Camera motion:** `pushIn` (ช้ามาก)

```
The colossal helix of woven light slowly rotates and breathes, individual luminous
filaments drifting, unravelling and re-braiding along its length. The warm amber core
pulses gently. Low mist drifts right to left across the mirror-still salt flat, and the
reflection ripples faintly. The lone figure stays almost perfectly still, coat stirring
in a slow wind. Extremely slow, almost imperceptible push in. Cinematic, weighty,
meditative. No cuts, no camera shake, no new subjects entering frame.
```

> ให้มัน “นิ่งแต่มีชีวิต” — พื้นหลัง hero ที่ขยับแรงจะแย่งความสนใจจากหัวข้อและปุ่ม

---

## 2. `dancer.mp4` — 4:3, 5s, 1080p
**Start frame:** `dancer.jpg`
**Camera motion:** `orbitLeft` (นิดเดียว)

```
The dancer completes the leap in graceful slow motion as trailing arcs of cyan and violet
light continue to draw the path of the movement through the air, braiding and fading like
ribbon. Fabric billows and settles. The light trails linger then dissolve into particles.
Slight orbit to the left. Black studio, hard rim light, atmospheric haze. Single continuous
shot, no cuts.
```

---

## 3. `city.mp4` — 16:9, 5s, 1080p
**Start frame:** `city.jpg`
**Camera motion:** `pushIn`

```
Rain falls steadily through the megacity canyon, streaking the neon reflections on the wet
street. The vast holographic ribbon of light arcing between the towers flows and shimmers
along its length. Silhouetted pedestrians drift slowly across the far end of the street,
umbrellas bobbing. Distant window lights flicker. Slow push in down the centre of the
street. Anamorphic flares breathe. Single continuous shot, no cuts, no readable text.
```

---

## 4. `creature.mp4` — 16:9, 5s, 1080p
**Start frame:** `creature.jpg`
**Camera motion:** `orbitRight`

```
The bioluminescent forest guardian breathes slowly, the cyan filaments running through its
root-woven body pulsing softly with each breath. It turns its antlered head a few degrees
toward camera, amber eyes catching the light. Mist drifts across its legs, spores float
upward through the violet moonbeams. Slow orbit to the right. Photoreal CG, single
continuous shot, no cuts.
```

---

## 5. `anime.mp4` — 9:16, 5s, 1080p
**Start frame:** `anime.jpg`
**Camera motion:** `craneUp`

```
Ribbons of glowing cyan thread spiral upward from the hero's raised hand into the violet
cloudscape, coiling and branching. Their coat and hair whip in the wind. Lanterns drift
past. The clouds churn slowly behind them. Gentle crane up. Theatrical anime look,
cel-shaded character on a painted background, film grain. Single continuous shot, no cuts.
```

---

## ของแถม (ทำทีหลังได้)

| ไฟล์ | สัดส่วน | Start frame | Camera | Prompt |
|---|---|---|---|---|
| `portrait.mp4` | 9:16 | `portrait.jpg` | `static` | `She breathes and blinks once, eyes staying on camera. The fibre-optic filaments woven through her hair glow and travel with light, brightening and dimming in slow waves. A single strand of hair shifts. Nothing else moves. Extremely subtle, beauty-campaign restraint. No cuts.` |
| `product.mp4` | 1:1 | `product.jpg` | `orbitLeft` | `The ribbon of liquid cyan light flows continuously around the obsidian perfume bottle, wrapping and trailing off into darkness. Specular highlights travel across the facets as the bottle slowly rotates. Ground mist drifts. Commercial product film, immaculate, no cuts.` |
| `temple.mp4` | 3:4 | `temple.jpg` | `craneUp` | `Thousands of candle-lanterns drift steadily upward between the temple columns, their glow shifting from warm gold to cyan as they rise. Incense smoke curls through the violet moonlight from the doorway. The gilded naga stays still. Slow crane up following the lanterns. Reverent, no cuts.` |
| `food.mp4` | 1:1 | `food.jpg` | `pushIn` | `Steam rises from the bowl of boat noodles in thick volumetric ribbons. The chopsticks lift the noodles higher, broth dripping in slow motion. Chilli oil shimmers on the surface. Slow push in. Appetising food-commercial look, no cuts.` |
| `coast.mp4` | 3:4 | `coast.jpg` | `pullOut` | `Turquoise surf washes up and retreats across the black volcanic sand, feathered foam channels braiding and dissolving into new patterns with each wave. Seen from straight above. Slow pull out revealing more coastline. Serene, no cuts.` |
| `macro.mp4` | 4:3 | `macro.jpg` | `focusChange` | `A dew droplet on the spiderweb strand swells, trembles and finally falls; the silk springs and vibrates. The tiny inverted landscape refracted inside each remaining droplet shifts. Focus travels gently along the strand. Extreme macro, no cuts.` |

---

## หลังโหลดไฟล์มาแล้ว

วางไว้ที่ `public/showcase/` แค่นั้น — รีเฟรชแล้วเห็นเลย

ถ้าไฟล์ใหญ่เกิน (เกิน ~4 MB ต่อคลิป) บีบก่อนค่อย commit จะดีกว่า เพราะทั้งหมดนี้จะติดไปกับ repo:

```bash
ffmpeg -i in.mp4 -c:v libx264 -crf 26 -preset slow -an -movflags +faststart -pix_fmt yuv420p out.mp4
```

`-an` ตัดเสียงทิ้ง (วิดีโอบนหน้าเว็บเล่นแบบ mute อยู่แล้ว เสียงมีแต่กินพื้นที่)
`-movflags +faststart` ทำให้เริ่มเล่นได้ก่อนโหลดจบ

**ถ้าเปลี่ยนใจไม่ทำวิดีโอบางตัว** — ลบ `video:` ของรายการนั้นออกจาก `src/lib/showcase.ts`
เว็บจะไม่ไปเรียกไฟล์นั้นอีก และควรแก้ `mode` จาก `"video"` เป็น `"image"` ด้วย
ป้าย “VIDEO” บนไทล์จะได้ไม่โกหก
