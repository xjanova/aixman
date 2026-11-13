/**
 * Example stories (เรื่องตัวอย่าง) a new series may start from — pure data, so
 * the page and the tests read the same list.
 *
 * A template fills the new-series form: the format, genre, look, how many
 * episodes and how long, a title, a cast by name, and the whole plot as the
 * premise (who is who, the main conflict, how it ends — what the head writer
 * splits into episodes). Everything stays editable, and nothing is stored
 * about which template a series came from.
 *
 * Writing one:
 * - Both languages are written out. The Thai premise must hold Thai and the
 *   English one must not: the series' language is read off the premise
 *   (seriesLanguage).
 * - Cast descriptions are English and purely visual, like the ones AI adds
 *   (bibleMessages) — they are what the character's picture is drawn from.
 * - A period look (LOOKS wuxia / palace / xianxia / siam) names its era on
 *   every shot. A time-travel plot therefore says the story plays in that era
 *   from its first second, and today is only heard in what the lead says.
 * - Plots are our own. Never retell a published novel, film or series.
 */

import type { Locale, Msg } from '@/lib/i18n/locale';
import { SERIES_FORMATS, type SeriesFormat } from './series';

export interface SeriesTemplate {
  key: string;
  /** The chip on the form. */
  label: Msg;
  /** One line that says what the story is. */
  pitch: Msg;
  format: SeriesFormat;
  /** A SERIES_GENRES key. */
  genre: string;
  /** A LOOKS key (cinematic.ts). */
  look: string;
  episodeCount: number;
  /** A film length (EPISODE_LENGTHS). */
  episodeSeconds: number;
  title: Msg;
  premise: Msg;
  cast: { name: Msg; description: string }[];
}

const plot = (...paragraphs: string[]) => paragraphs.join('\n\n');

export const SERIES_TEMPLATES: SeriesTemplate[] = [
  {
    key: 'wuxia',
    label: { th: '⚔️ กำลังภายใน', en: '⚔️ Wuxia' },
    pitch: { th: 'ศิษย์คนสุดท้ายของสำนักที่ถูกล้างบาง ออกตามล่าคนทรยศ', en: 'The last disciple of a slaughtered sect hunts the traitor' },
    format: 'series',
    genre: 'wuxia',
    look: 'wuxia',
    episodeCount: 8,
    episodeSeconds: 180,
    title: { th: 'กระบี่เดียวดายใต้เงาจันทร์', en: 'A Lone Sword Under the Moon' },
    premise: {
      th: plot(
        'ยุทธภพจีนโบราณ สำนักกระบี่เมฆขาวถูกล้างบางในคืนเดียว หลินเฟิง ศิษย์คนเล็กวัยยี่สิบห้า รอดมาได้เพราะอาจารย์ผลักเขาลงหน้าผา พร้อมยัดคัมภีร์กระบี่ครึ่งเล่มไว้ในมือ คำสุดท้ายของอาจารย์คือ "คนทรยศอยู่ในหมู่พวกเรา"',
        'สามปีต่อมา หลินเฟิงกลับสู่ยุทธภพในฐานะมือกระบี่ไร้ชื่อ เขาช่วยซูชิงเหยา หมอหญิงพเนจรที่ถูกตามล่า แล้วพบว่านางคือบุตรสาวของเจ้าสำนักคู่อาฆาต และเป็นผู้ถือคัมภีร์อีกครึ่งเล่ม ทั้งสองจำใจร่วมทาง ตามรอยเบาะแสไปทีละสำนัก จากความระแวงกลายเป็นความไว้ใจ และกลายเป็นความรัก',
        'ยิ่งสืบ ทุกเบาะแสยิ่งชี้ไปที่เสิ่นม่อ ศิษย์พี่ใหญ่ที่หลินเฟิงเคารพเหมือนพี่ชาย บัดนี้เป็นประมุขพันธมิตรฝ่ายธรรมะที่ทั้งยุทธภพยกย่อง เสิ่นม่อต้องการคัมภีร์ครบทั้งสองครึ่งเพื่อครองยุทธภพ และเขาเองคือคนที่เปิดประตูสำนักในคืนนั้น',
        'ตอนจบ: หลินเฟิงกับซูชิงเหยารวมคัมภีร์ทั้งสองครึ่ง จึงเข้าใจว่าเคล็ดวิชาสุดท้ายไม่ใช่ท่าสังหาร แต่คือการวางกระบี่ บนยอดเขาในคืนจันทร์เต็มดวง หลินเฟิงเอาชนะเสิ่นม่อต่อหน้าทั้งยุทธภพ เปิดโปงความจริง แล้วเลือกไม่ฆ่า ปล่อยให้ยุทธภพเป็นผู้ตัดสิน ก่อนจากไปกับซูชิงเหยาเพื่อตั้งสำนักขึ้นใหม่'
      ),
      en: plot(
        'Ancient China, the jianghu. The White Cloud Sword Sect is wiped out in a single night. Lin Feng, its youngest disciple at twenty-five, survives only because his master pushes him off a cliff with half of the sect\'s sword manual in his hand. The master\'s last words: "The traitor is one of us."',
        'Three years later Lin Feng returns as a nameless swordsman. He saves Su Qingyao, a wandering healer on the run, and learns she is the daughter of a rival sect\'s leader — and carries the other half of the manual. Forced to travel together, they follow the trail from sect to sect; suspicion turns into trust, and trust into love.',
        'Every clue points to Shen Mo, the eldest disciple Lin Feng loved like a brother, now the admired head of the righteous alliance. Shen Mo wants both halves of the manual to rule the jianghu — and he is the one who opened the sect\'s gates that night.',
        'The ending: Lin Feng and Su Qingyao join the two halves and understand that the final technique is not a killing stroke but laying the sword down. On a mountain peak under a full moon, before the whole jianghu, Lin Feng defeats Shen Mo, exposes the truth and chooses not to kill him, leaving the jianghu to judge. He and Su Qingyao leave to rebuild the sect.'
      ),
    },
    cast: [
      {
        name: { th: 'หลินเฟิง', en: 'Lin Feng' },
        description: 'Chinese man in his mid 20s, lean and athletic, sharp determined eyes, long black hair in a high topknot, plain dark blue hanfu with leather bracers, a worn straight sword on his back',
      },
      {
        name: { th: 'ซูชิงเหยา', en: 'Su Qingyao' },
        description: 'Chinese woman in her early 20s, delicate calm face, long black hair with a silver hairpin, white and pale green layered hanfu, a medicine pouch at her waist',
      },
      {
        name: { th: 'เสิ่นม่อ', en: 'Shen Mo' },
        description: 'Chinese man in his late 40s, dignified face with a cold composed smile, neat short beard, greying hair under a jade crown, black and gold brocade robe',
      },
    ],
  },
  {
    key: 'palace',
    label: { th: '👑 ย้อนยุควังหลัง', en: '👑 Palace intrigue' },
    pitch: { th: 'นางกำนัลห้องเครื่องไต่เต้าในวังหลัง เพื่อล้างมลทินให้ตระกูล', en: "A kitchen maid climbs the inner palace to clear her family's name" },
    format: 'short',
    genre: 'period',
    look: 'palace',
    episodeCount: 12,
    episodeSeconds: 60,
    title: { th: 'ดอกเหมยกลางวังหลัง', en: 'Plum Blossom in the Inner Palace' },
    premise: {
      th: plot(
        'ราชสำนักจีนโบราณ ตระกูลเสิ่นซึ่งเป็นหมอหลวงถูกใส่ร้ายว่าวางยาพิษองค์รัชทายาท ทั้งตระกูลถูกประหาร เหลือเพียงเสิ่นหรูอี้ บุตรสาวคนเล็กที่แม่นมพาหนีไปได้',
        'สิบปีต่อมา หรูอี้ปลอมชื่อเข้าวังเป็นนางกำนัลชั้นต่ำสุดในห้องเครื่อง เป้าหมายเดียวคือหาบันทึกยาที่จะล้างมลทินให้ตระกูล นางมีจมูกและลิ้นที่แยกสมุนไพรได้ทุกชนิด วันหนึ่งนางจับได้ว่าน้ำแกงที่กำลังจะถวายมียาพิษ และช่วยชีวิตองค์ชายเจ็ด หลี่เฉิงอวี้ องค์ชายไร้อำนาจที่แสร้งทำตัวเหลวไหลเพื่อเอาตัวรอด',
        'ทั้งสองจับมือกันอย่างลับ ๆ หรูอี้ไต่ขึ้นทีละขั้น จากห้องเครื่อง สู่ตำหนักพระสนม จนเป็นนางในคนสนิทของไทเฮา ทุกขั้นต้องแลกด้วยกับดัก การใส่ร้าย และการหักหน้าคนที่เคยเหยียบย่ำนางต่อหน้าผู้คน ยิ่งขึ้นสูงยิ่งเห็นชัดว่าผู้อยู่เบื้องหลังคดีตระกูลเสิ่นคือพระสนมเอกเว่ย ผู้กุมวังหลังและหมายให้โอรสของตนขึ้นครองบัลลังก์',
        'ตอนจบ: ในงานเลี้ยงวันพระราชสมภพ พระสนมเอกเว่ยวางยาฮ่องเต้ด้วยวิธีเดิม หรูอี้ชิมพระกระยาหารต่อหน้าทั้งราชสำนัก เปิดโปงยาพิษพร้อมบันทึกยาเล่มที่หายไป ตระกูลเสิ่นได้รับการล้างมลทิน หลี่เฉิงอวี้ได้เป็นรัชทายาท เขาขอให้นางอยู่เคียงข้าง แต่หรูอี้ขอออกจากวังไปเปิดโรงหมอของตระกูล เขาจึงวางป้ายหยกไว้ในมือนาง แล้วบอกว่าประตูวังจะเปิดรอนางเสมอ'
      ),
      en: plot(
        'Ancient China, the imperial court. The Shen family, physicians to the throne, are framed for poisoning the crown prince and executed. Only the youngest daughter, Shen Ruyi, escapes, carried off by her nurse.',
        "Ten years later Ruyi enters the palace under a false name as the lowest maid in the imperial kitchen. She wants one thing: the medicine ledger that will clear her family's name. Her nose and tongue can tell any herb apart. One day she catches poison in a soup on its way to the table and saves the Seventh Prince, Li Chengyu — a prince with no power who plays the fool to stay alive.",
        "The two become secret allies. Ruyi climbs step by step: from the kitchen to a consort's residence, then to the Empress Dowager's side. Every step costs her a trap, a false accusation and a public reversal that shames someone who once stepped on her. The higher she climbs, the clearer it is that the hand behind her family's case is Noble Consort Wei, who rules the inner palace and means to put her own son on the throne.",
        "The ending: at the Emperor's birthday banquet Noble Consort Wei poisons him the same way. Ruyi tastes the dish in front of the whole court, exposes the poison and produces the missing ledger. The Shen family's name is cleared and Li Chengyu becomes crown prince. He asks her to stay beside him; Ruyi asks to leave the palace and reopen her family's clinic. He lays his jade token in her hand and tells her the palace gates will always open for her."
      ),
    },
    cast: [
      {
        name: { th: 'เสิ่นหรูอี้', en: 'Shen Ruyi' },
        description: "Chinese woman in her early 20s, oval face, bright intelligent eyes, black hair in a simple maid's bun with a wooden hairpin, plain pale pink palace maid hanfu with an apron",
      },
      {
        name: { th: 'หลี่เฉิงอวี้', en: 'Li Chengyu' },
        description: 'Chinese man in his late 20s, tall, handsome reserved face, long black hair half tied with a silver crown, dark navy silk robe with silver dragon embroidery',
      },
      {
        name: { th: 'พระสนมเอกเว่ย', en: 'Noble Consort Wei' },
        description: 'Chinese woman in her mid 30s, striking beauty with a cold gaze, elaborate updo with gold phoenix hairpins and tassels, crimson and gold embroidered court robe, long gold nail guards',
      },
    ],
  },
  {
    key: 'transmigration',
    label: { th: '⏳ ทะลุมิติย้อนเวลา', en: '⏳ Time travel' },
    pitch: { th: 'ศัลยแพทย์สาวยุคปัจจุบันตื่นมาเป็นพระชายาที่ถูกทอดทิ้งในจีนโบราณ', en: "A modern surgeon wakes up as a prince's cast-off wife in ancient China" },
    format: 'short',
    genre: 'timetravel',
    look: 'palace',
    episodeCount: 10,
    episodeSeconds: 60,
    title: { th: 'หมอหญิงข้ามพันปี', en: 'The Surgeon Across a Thousand Years' },
    premise: {
      th: plot(
        'เจียงหว่าน ศัลยแพทย์ฉุกเฉินวัยยี่สิบแปด หมดสติคาห้องผ่าตัดหลังอยู่เวรสามวันติด ลืมตาอีกทีนางอยู่ในจีนโบราณ ในร่างของพระชายาเอกแห่งจวนอ๋อง หญิงที่เพิ่งถูกวางยาและถูกทิ้งให้ตายในเรือนเย็นท้ายจวน ทั้งเรื่องเกิดในยุคโบราณ เปิดเรื่องตอนที่นางลืมตาขึ้นที่นั่นทันที ชีวิตยุคปัจจุบันเล่าผ่านคำพูดและความคิดของนางเท่านั้น สามีของร่างนี้คือท่านอ๋องเย่หาน แม่ทัพผู้เย็นชาที่เกลียดนาง เพราะเชื่อว่านางใช้เล่ห์กลแย่งตำแหน่งมาจากหญิงที่เขารัก',
        'หว่านไม่มีความทรงจำของเจ้าของร่าง มีเพียงความรู้แพทย์สมัยใหม่กับปากที่ไม่ยอมใคร นางเย็บแผล ต้มเครื่องมือฆ่าเชื้อ ทำยาจากของในครัว ช่วยคนในจวนจนทุกคนเปลี่ยนท่าที แล้วคืนหนึ่งเย่หานถูกลอบยิงด้วยลูกธนูอาบยาพิษ นางผ่าตัดช่วยชีวิตเขาด้วยเข็มเย็บผ้ากับมือเปล่า เขาเริ่มสงสัยว่าหญิงตรงหน้าไม่ใช่คนเดิม',
        'พระชายารองหลิ่วเหมยเอ๋อร์ ผู้วางยาเจ้าของร่างเดิม พยายามกำจัดนางอีกหลายครั้ง แต่ถูกตลบหลังทุกครั้ง เมื่อโรคระบาดลามเข้าเมืองหลวง หว่านตั้งโรงหมอ แยกผู้ป่วย และหยุดโรคได้ จนชื่อ "หมอเทวดา" ดังไปถึงวังหลวง เย่หานตกหลุมรักนางเข้าจริง ๆ ขณะที่หว่านพบว่าจี้หยกประจำตัวของเจ้าของร่างคือทางกลับบ้าน และจะเปิดได้เพียงครั้งเดียวในคืนจันทรุปราคา',
        'ตอนจบ: คืนจันทรุปราคา เหมยเอ๋อร์ร่วมมือกับศัตรูของเย่หานก่อกบฏ หว่านต้องเลือกระหว่างก้าวกลับสู่โลกเดิม กับอยู่ผ่าตัดช่วยชีวิตเย่หานที่รับดาบแทนนาง นางเลือกอยู่ จี้หยกแตกสลาย เช้าวันใหม่เขาลืมตาขึ้น และเรียกนางด้วยชื่อจริงเป็นครั้งแรกว่า "เจียงหว่าน"'
      ),
      en: plot(
        "Jiang Wan, a 28-year-old emergency surgeon, collapses in the operating room after three days on call. She opens her eyes in ancient China, in the body of a prince's wife who has just been poisoned and left to die in the cold courtyard at the back of his mansion. The whole story plays in the ancient era: it opens the moment she wakes there, and her modern life is only heard in what she says and thinks. The husband of this body is Prince Ye Han, a cold general who hates her, sure she schemed her way into the place of the woman he loved.",
        "Wan has none of the body's memories — only modern medicine and a tongue that yields to no one. She stitches wounds, boils her tools, makes medicine from what is in the kitchen and wins the household over one servant at a time. Then one night Ye Han is struck by a poisoned arrow, and she operates on him with a sewing needle and her bare hands. He begins to suspect that the woman in front of him is not the one he married.",
        'The second wife, Liu Mei\'er — the one who poisoned the body\'s first owner — tries to get rid of her again and again, and every attempt turns back on her. When a plague reaches the capital, Wan opens a clinic, separates the sick and stops it; the name "the miracle doctor" reaches the palace. Ye Han falls in love with her for real, just as Wan learns that the jade pendant this body wore is her way home, and that it opens once, on the night of a lunar eclipse.',
        "The ending: on the night of the eclipse Mei'er joins Ye Han's enemies in a coup. Wan must choose between stepping through to her own world and staying to operate on Ye Han, who has taken a blade meant for her. She stays. The jade shatters. In the morning he opens his eyes and, for the first time, calls her by her real name: Jiang Wan."
      ),
    },
    cast: [
      {
        name: { th: 'เจียงหว่าน', en: 'Jiang Wan' },
        description: 'Chinese woman in her late 20s, soft oval face, clear confident eyes, long black hair in a simple low bun with one jade hairpin, light blue and white hanfu with the sleeves tied back',
      },
      {
        name: { th: 'เย่หาน', en: 'Ye Han' },
        description: 'Chinese man around 30, tall and broad-shouldered, stern handsome face with a thin scar over the left eyebrow, long black hair in a high ponytail with a black metal crown, black robe with dark armour plates',
      },
      {
        name: { th: 'หลิ่วเหมยเอ๋อร์', en: "Liu Mei'er" },
        description: 'Chinese woman in her mid 20s, sweet doll-like face with sly eyes, ornate updo with pink flower pins and dangling pearls, peach and rose embroidered silk hanfu',
      },
    ],
  },
  {
    key: 'rebirth',
    label: { th: '🔁 เกิดใหม่ล้างแค้น', en: '🔁 Reborn for revenge' },
    pitch: { th: 'คุณหนูที่ถูกน้องสาวกับคู่หมั้นหักหลังจนตาย ย้อนกลับไปสามปีก่อน', en: 'Betrayed to death by her sister and her betrothed, she wakes three years earlier' },
    format: 'short',
    genre: 'revenge',
    look: 'palace',
    episodeCount: 10,
    episodeSeconds: 60,
    title: { th: 'ชาตินี้ข้าไม่ยอม', en: 'Not in This Life' },
    premise: {
      th: plot(
        'จีนโบราณ เวินหนิงซวง คุณหนูใหญ่จวนเสนาบดี มอบทั้งหัวใจและสมบัติของตระกูลฝั่งแม่ให้คู่หมั้น องค์ชายสามจ้าวหมิงเซวียน จนเขาได้ขึ้นเป็นรัชทายาท แต่ในวันอภิเษก เขากลับแต่งกับเวินหรูเยว่ น้องสาวต่างมารดาของนาง ตระกูลฝั่งแม่ถูกใส่ร้ายว่าเป็นกบฏ และหนิงซวงถูกบังคับให้ดื่มสุราพิษ สิ่งสุดท้ายที่นางได้ยินคือเสียงกระซิบของน้องสาว "ทุกอย่างของพี่ ควรเป็นของข้ามาตั้งแต่แรก"',
        'นางลืมตาขึ้นอีกครั้งในห้องนอนของตัวเองเมื่อสามปีก่อน เช้าวันที่กำลังจะหมั้นกับองค์ชายสาม ความทรงจำชาติก่อนยังอยู่ครบ ทุกวัน ทุกคำพูด ทุกแผนร้าย',
        'ชาตินี้นางถอนหมั้นกลางพิธีต่อหน้าแขกทั้งเมือง แล้วใช้สิ่งที่รู้ล่วงหน้าตลบหลังทุกกับดัก น้องสาวที่แสร้งอ่อนหวานถูกเปิดโปงทีละเรื่อง แม่เลี้ยงเสียอำนาจในจวน องค์ชายสามเสียคนหนุนหลังไปทีละคน หนิงซวงเลือกจับมือกับแม่ทัพฮั่วอวิ๋นถิง ชายที่ชาติก่อนตายในสนามรบเพราะแผนขององค์ชายสาม และเป็นคนเดียวที่ฝังศพให้นาง แต่อนาคตเริ่มไม่เดินตามที่นางจำได้ เพราะศัตรูก็เปลี่ยนแผนเช่นกัน',
        'ตอนจบ: องค์ชายสามก่อกบฏเร็วกว่าชาติก่อนหนึ่งปี หนิงซวงไม่มีความทรงจำให้พึ่งอีกต่อไป นางใช้ไหวพริบของตัวเองล่อให้เขาเผยตราทัพปลอมกลางท้องพระโรง หรูเยว่ถูกยื่นสุราจอกเดียวกับที่เคยยื่นให้พี่สาว ตระกูลฝั่งแม่รอดพ้น และหนิงซวงเดินออกจากวังเคียงข้างฮั่วอวิ๋นถิง โดยไม่หันกลับไปมอง'
      ),
      en: plot(
        'Ancient China. Wen Ningshuang, eldest daughter of the chancellor\'s house, gives her heart and her mother\'s family fortune to her betrothed, the Third Prince Zhao Mingxuan, until he is named crown prince. On the wedding day he marries her half-sister Wen Ruyue instead, her mother\'s family is framed for treason, and Ningshuang is made to drink poisoned wine. The last thing she hears is her sister\'s whisper: "Everything you had should have been mine from the start."',
        'She opens her eyes in her own bedroom three years earlier, on the morning of her betrothal to the Third Prince, with every day, every word and every scheme of her last life still in her memory.',
        'This time she breaks the engagement in the middle of the ceremony, in front of the whole city, and uses what she knows to turn every trap around. Her sweet-faced sister is exposed one lie at a time, her stepmother loses her hold on the household, and the Third Prince loses his backers one by one. Ningshuang allies with General Huo Yunting — the man who died on the battlefield in her last life because of the prince\'s plot, and the only one who buried her. But the future stops following what she remembers, because her enemies change their plans too.',
        "The ending: the Third Prince rebels a year earlier than he did before, and Ningshuang has no memory left to lean on. With her own wit she lures him into showing a forged army seal in the throne hall. Ruyue is handed the same cup of wine she once held out to her sister. Her mother's family is saved, and Ningshuang walks out of the palace beside Huo Yunting without looking back."
      ),
    },
    cast: [
      {
        name: { th: 'เวินหนิงซวง', en: 'Wen Ningshuang' },
        description: 'Chinese woman around 20, graceful composed face with sharp knowing eyes, long black hair half up with a white jade hairpin, ivory and pale lilac embroidered hanfu',
      },
      {
        name: { th: 'เวินหรูเยว่', en: 'Wen Ruyue' },
        description: 'Chinese woman around 19, innocent-looking sweet face, teary doe eyes, hair in twin loops with pink ribbons and small gold pins, soft pink layered hanfu',
      },
      {
        name: { th: 'จ้าวหมิงเซวียน', en: 'Zhao Mingxuan' },
        description: 'Chinese man in his mid 20s, refined handsome face with a warm false smile, hair up in a gold crown, white and gold brocade robe, a folding fan in his hand',
      },
      {
        name: { th: 'ฮั่วอวิ๋นถิง', en: 'Huo Yunting' },
        description: "Chinese man in his late 20s, tall with a soldier's build, tanned stern face, black hair tied high with a red cord, dark red and black robe with leather armour",
      },
    ],
  },
  {
    key: 'xianxia',
    label: { th: '☁️ เทพเซียน', en: '☁️ Xianxia' },
    pitch: { th: 'เซียนกระบี่กับศิษย์สาวผู้เป็นกระบี่ของเขากลับชาติมาเกิด', en: 'A sword immortal and the disciple who is his sword reborn' },
    format: 'series',
    genre: 'xianxia',
    look: 'xianxia',
    episodeCount: 8,
    episodeSeconds: 180,
    title: { th: 'ผนึกรักเหนือเมฆา', en: 'Sealed Above the Clouds' },
    premise: {
      th: plot(
        'สามภพ มนุษย์ เซียน และมาร พันปีก่อน เซียนกระบี่จิ่งเหอใช้กระบี่คู่กายผนึกหุบเหวมารไว้ได้ แต่กระบี่แตกสลาย จิตวิญญาณกระบี่ร่วงหล่นลงสู่โลกมนุษย์ และเวียนเกิดเป็นเด็กสาวธรรมดาชาติแล้วชาติเล่า',
        'ปัจจุบัน ลั่วชิงหลี ลูกสาวช่างทำโคมวัยยี่สิบ ร่าเริง ดื้อ และไม่เคยรู้ว่าตราดอกบัวแดงกลางหน้าผากของตนคืออะไร ถูกสำนักเซียนชิงซวีรับขึ้นเขาเหนือทะเลเมฆ ทั้งที่ฝึกวิชาอะไรก็ล้มเหลว จิ่งเหอ เซียนผู้เย็นชาที่ไม่รับศิษย์มาพันปี กลับรับนางไว้เอง เพราะเขารู้ตั้งแต่แรกเห็นว่านางคือกระบี่ของเขา และรู้ด้วยว่าผนึกหุบเหวมารกำลังร้าว ทางเดียวที่จะผนึกใหม่ได้คือหลอมนางกลับเป็นกระบี่ ซึ่งหมายถึงนางต้องตาย',
        'ยิ่งสอนนาง เขายิ่งทำไม่ลง กฎสวรรค์ห้ามเซียนมีใจผูกพัน ทั้งสองจึงซ่อนทุกอย่างไว้หลังคำว่าอาจารย์กับศิษย์ จนเผ่ามารบุกชิงตัวนาง ความจริงถูกเปิดเผยต่อหน้าทั้งสำนัก ชิงหลีรู้ว่าตนถูกเลี้ยงไว้เพื่อสังเวย จึงหนีลงโลกมนุษย์ด้วยใจที่แตกสลาย จิ่งเหอทิ้งสำนักลงมาตามหา และทั้งคู่ค้นพบว่าผู้ที่แอบทำลายผนึกมาตลอดคือเจ้าสำนักซวีหมิง ผู้ต้องการพลังจากหุบเหวเพื่อก้าวขึ้นเป็นเทพ',
        'ตอนจบ: หุบเหวมารเปิดออกเหนือทะเลเมฆ ชิงหลีตัดสินใจกลับเป็นกระบี่ด้วยความเต็มใจ เพื่อปกป้องโลกมนุษย์ที่นางรัก แต่จิ่งเหอไม่ยอมจับกระบี่เล่มนั้น เขาใช้ตบะพันปีของตนทั้งหมดผนึกหุบเหวแทน แล้วร่วงลงเป็นมนุษย์ธรรมดา ฉากสุดท้าย ร้านโคมเล็ก ๆ ในเมืองมนุษย์ ชายผมสีดอกเลาจุดโคมดวงแรกของค่ำคืน ข้างกายเขาคือชิงหลี ที่ตราดอกบัวกลางหน้าผากจางหายไปแล้ว'
      ),
      en: plot(
        'Three realms: mortals, immortals and demons. A thousand years ago the sword immortal Jing He sealed the Demon Abyss with his own sword. The sword shattered; its spirit fell to the mortal world and was reborn, life after life, as an ordinary girl.',
        'Today Luo Qingli, a lantern maker\'s daughter of twenty — cheerful, stubborn, with a red lotus mark between her brows she has never understood — is taken up to the Qingxu immortal sect above the sea of clouds, though she fails at every art she is taught. Jing He, the coldest immortal of the sect, who has taken no disciple in a thousand years, takes her himself. He knew at first sight that she is his sword. He also knows the seal on the Abyss is cracking, and that the only way to renew it is to forge her back into a blade — which means her death.',
        "The more he teaches her, the less he can do it. Heaven's law forbids an immortal's heart to be bound, so both hide everything behind the words master and disciple — until the demon clan comes to seize her and the truth comes out before the whole sect. Qingli learns she was raised to be sacrificed and flees to the mortal world, heartbroken. Jing He leaves the sect to find her, and together they discover that the one who has been breaking the seal all along is the sect leader, Xu Ming, who wants the Abyss's power to become a god.",
        'The ending: the Abyss opens above the sea of clouds. Qingli chooses, of her own will, to become the sword again to protect the mortal world she loves. Jing He refuses to wield it. He spends all of his thousand years of cultivation to seal the Abyss himself and falls as an ordinary mortal. The last scene: a small lantern shop in a mortal town; a man with grey in his hair lights the first lantern of the evening, and beside him is Qingli, the lotus mark gone from her brow.'
      ),
    },
    cast: [
      {
        name: { th: 'ลั่วชิงหลี', en: 'Luo Qingli' },
        description: 'Chinese woman around 20, lively bright face, long black hair with two thin braids and a pale blue ribbon, simple white and sky-blue disciple robe, a small red lotus mark between her brows',
      },
      {
        name: { th: 'จิ่งเหอ', en: 'Jing He' },
        description: 'Chinese man who looks about 30, serene cold handsome face, very long black hair with a white jade crown, flowing white robe with silver cloud embroidery, a slender sword',
      },
      {
        name: { th: 'ซวีหมิง', en: 'Xu Ming' },
        description: 'Chinese man who looks about 50, kindly dignified face, long grey beard, grey hair in a topknot with a wooden pin, grey and white layered Taoist robe, a horsetail whisk in his hand',
      },
    ],
  },
  {
    key: 'siam',
    label: { th: '🛶 ย้อนเวลากรุงเก่า', en: '🛶 Back to old Siam' },
    pitch: { th: 'เชฟสาวยุคใหม่ตื่นมาบนเรือนแพริมน้ำสมัยกรุงเก่า', en: 'A modern chef wakes up on a floating house in old Siam' },
    format: 'short',
    genre: 'timetravel',
    look: 'siam',
    episodeCount: 10,
    episodeSeconds: 60,
    title: { th: 'รสรักข้ามภพ', en: 'A Taste Across Time' },
    premise: {
      th: plot(
        'ริน เชฟสาววัยยี่สิบหกที่กำลังจะเสียร้านอาหารไทยของยาย พลัดตกแม่น้ำเจ้าพระยาในคืนลอยกระทง ลืมตาอีกทีนางอยู่บนเรือนแพริมน้ำสมัยกรุงเก่า ในร่างของหญิงสาวชื่อรินเหมือนกัน ลูกสาวแม่ค้าขนมที่ติดหนี้นายอากรจนเรือนกำลังจะถูกยึด และตัวนางกำลังจะถูกขายลงเป็นทาส ทั้งเรื่องเกิดในสมัยกรุงเก่า เปิดเรื่องตอนที่นางลืมตาขึ้นที่นั่นทันที ชีวิตยุคปัจจุบันเล่าผ่านคำพูดและความคิดของนางเท่านั้น',
        'รินไม่มีอะไรติดตัวนอกจากฝีมือทำอาหารกับสูตรของยาย นางพลิกแผงขนมเล็ก ๆ ด้วยของกินที่ไม่มีใครในตลาดน้ำเคยลิ้มรส จนคนต่อแถวยาวถึงท่าเรือ และไปสะดุดตาขุนไกร ขุนนางหนุ่มผู้ตรงเป็นไม้บรรทัด ซึ่งกำลังสืบเรื่องการโกงอากรในตลาด เขาสงสัยนางตั้งแต่แรกพบ เพราะนางพูดจาแปลกหู รู้เรื่องที่ชาวบ้านไม่ควรรู้ และไม่เคยก้มหน้าให้ใคร',
        'ฝีมือของรินดังไปถึงในวัง นางถูกเรียกเข้าไปช่วยงานห้องเครื่อง และต้องเจอกับคุณท้าวอิน หัวหน้าห้องเครื่องผู้ไม่ยอมให้แม่ค้าตลาดมาหักหน้า กับดักมาไม่ขาดสาย ทั้งเกลือที่ถูกสลับ สำรับที่ถูกใส่ยา และข้อหาเป็นไส้ศึก ขุนไกรกลายเป็นคนเดียวที่ยืนข้างนาง ความสงสัยค่อย ๆ กลายเป็นความรัก ทั้งที่รินรู้ว่าคืนลอยกระทงปีหน้า สายน้ำจะพานางกลับบ้าน',
        'ตอนจบ: ในงานเลี้ยงรับราชทูต คุณท้าวอินกับนายอากรวางแผนใส่ยาในสำรับเพื่อโยนความผิดให้ริน นางจับได้จากกลิ่น และทำสำรับใหม่ทั้งหมดต่อหน้าทุกคนจนแผนแตก หนี้ของแม่ถูกล้าง คืนลอยกระทง รินยืนที่ท่าน้ำพร้อมกระทงในมือ ขุนไกรไม่รั้งนางไว้ เขาเพียงบอกว่าจะจำรสมือของนางไปทั้งชีวิต นางปล่อยกระทงให้ลอยไปลำพัง แล้วหันกลับมาหาเขา'
      ),
      en: plot(
        "Rin, a 26-year-old chef about to lose her grandmother's Thai restaurant, falls into the Chao Phraya river on Loy Krathong night. She wakes on a floating house in old Siam, in the Ayutthaya era, in the body of another Rin: the daughter of a sweets seller so deep in debt to the tax farmer that their house is about to be seized and the girl sold into bondage. The whole story plays in old Siam: it opens the moment she wakes there, and her modern life is only heard in what she says and thinks.",
        "Rin has nothing but her cooking and her grandmother's recipes. She turns the little sweets stall around with dishes nobody at the floating market has ever tasted, until the queue reaches the pier — and catches the eye of Khun Krai, a young official as straight as a ruler who is looking into tax fraud at the market. He suspects her from the start: she talks strangely, knows things a villager should not, and lowers her head to no one.",
        "Word of her cooking reaches the palace. She is called in to help in the royal kitchen and runs into Lady In, the head of the kitchen, who will not be shown up by a market girl. The traps come one after another: swapped salt, a tampered tray, a charge of spying. Khun Krai becomes the only one who stands by her, and suspicion slowly turns into love — though Rin knows that on next year's Loy Krathong night the river will take her home.",
        "The ending: at a banquet for foreign envoys, Lady In and the tax farmer plan to drug the trays and blame Rin. She catches it by smell and remakes every dish in front of everyone until the plot falls apart. Her mother's debt is cleared. On Loy Krathong night Rin stands at the pier with a krathong in her hands. Khun Krai does not hold her back; he only says he will remember the taste of her cooking all his life. She lets the krathong float away alone, and turns back to him."
      ),
    },
    cast: [
      {
        name: { th: 'ริน', en: 'Rin' },
        description: 'Thai woman in her mid 20s, warm lively face, bright eyes, long black hair in a loose low bun with a jasmine flower, cream sabai shoulder cloth over a wrapped chest cloth, dark green pha nung wrap skirt, bare feet',
      },
      {
        name: { th: 'ขุนไกร', en: 'Khun Krai' },
        description: 'Thai man in his late 20s, upright handsome face, serious eyes, short neat black hair, white long-sleeved round-neck shirt, deep indigo chong kraben, patterned waist sash, a sword at his hip',
      },
      {
        name: { th: 'คุณท้าวอิน', en: 'Lady In' },
        description: 'Thai woman in her 50s, stern proud face, short traditional haircut streaked with grey, gold brocade sabai, dark red pha nung, heavy gold necklace and bracelets',
      },
    ],
  },
];

/** What a template puts in the new-series form, in one language. */
export interface TemplateForm {
  format: SeriesFormat;
  title: string;
  premise: string;
  genre: string;
  look: string;
  aspect: string;
  episodeCount: number;
  episodeSeconds: number;
  cast: { name: string; description: string }[];
}

/** The form a template fills, or null when no template has that key. */
export function templateForm(key: string, locale: Locale): TemplateForm | null {
  const tpl = SERIES_TEMPLATES.find((x) => x.key === key);
  if (!tpl) return null;
  return {
    format: tpl.format,
    title: tpl.title[locale],
    premise: tpl.premise[locale],
    genre: tpl.genre,
    look: tpl.look,
    aspect: SERIES_FORMATS[tpl.format].aspect,
    episodeCount: tpl.episodeCount,
    episodeSeconds: tpl.episodeSeconds,
    cast: tpl.cast.map((c) => ({ name: c.name[locale], description: c.description })),
  };
}
