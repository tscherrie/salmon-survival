import { lang, t } from "./i18n.js";

// The brood. A salmon is one of about two thousand eggs laid in the same gravel, and of
// those only a handful come home. So the game is not one fish but the brood: the player
// swims one of the siblings, and when it dies the next one takes over -- while the others
// go on dying unseen, stage by stage, as they do in a real river. Early on there are
// hundreds; out at sea only a few are left, and every death counts. If the last one dies,
// the brood is gone and a new one begins in the gravel.
//
// It also keeps the account of each life for the life card: how old the fish got, how far
// it swam, what it ate, the fights it won, its leaps, the hunters it got away from.

export const BROOD_SIZE = 2000;
// Of the siblings alive at the start of a stage, how many live to see the next one --
// roughly as in a Norwegian river (from 2000 eggs a few dozen smolts, a handful home) --
// and never fewer than a few, so the late stages stay possible.
const SURVIVE = { fry: 0.6, fingerling: 0.35, yearling: 0.55, parr: 0.5, smolt: 0.4, postsmolt: 0.45, grilse: 0.55, sea: 0.7, spawner: 0.75 };
const FLOOR = { smolt: 12, postsmolt: 8, grilse: 6, sea: 5, spawner: 4 };
// A rough age in months at the start and end of each stage (the eggs lie in the gravel
// all winter; parr take two years or so in the river, the fish two or three at sea).
const AGE = { alevin: [0, 1], fry: [1, 3], fingerling: [3, 9], yearling: [9, 15], parr: [15, 30], smolt: [30, 36], postsmolt: [36, 42], grilse: [42, 54], sea: [54, 72], spawner: [72, 78] };

const pick = (e) => e[lang] ?? e.en ?? e.de;
const fmt = (n) => new Intl.NumberFormat(lang === "de" ? "de-DE" : lang === "bg" ? "bg-BG" : lang === "zh" ? "zh-CN" : lang === "ja" ? "ja-JP" : "en-GB").format(n);
const fill = (s, vars) => s.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? "");

export const WORDS = {
  salmon: { de: "Lachs Nr. {n}", en: "Salmon no. {n}", zh: "{n} 号鲑鱼", ja: "サケ {n} 号", bg: "Сьомга № {n}" },
  takeover: { de: "Eines deiner Geschwister schwimmt weiter.", en: "One of your siblings swims on.", zh: "你的一个兄弟姐妹接着游下去。", ja: "きょうだいの一匹が泳ぎ続ける。", bg: "Един от братята и сестрите ти плува нататък." },
  close: { de: "Schließen", en: "Close", zh: "关闭", ja: "閉じる", bg: "Затвори" },
  kicker: { de: "Ein Lachsleben", en: "A salmon's life", zh: "一条鲑鱼的一生", ja: "サケの一生", bg: "Един живот на сьомга" },
  broodLine: { de: "{left} von {size} Geschwistern", en: "{left} of {size} siblings", zh: "{size} 个兄弟姐妹还剩 {left}", ja: "きょうだい {size} 匹中 残り {left}", bg: "{left} от {size} братя и сестри" },
  firstTip: {
    de: "<b>Du bist einer von {size}.</b> So viele Eier liegen im Kies – nur eine Handvoll kommt je heim. Stirbst du, schwimmt eines deiner Geschwister weiter. Wie viele noch leben, steht oben links bei deinen Werten.",
    en: "<b>You are one of {size}.</b> That many eggs lie in the gravel – only a handful ever come home. If you die, one of your siblings swims on. How many are still alive is shown with your stats at the top left.",
    zh: "<b>你是 {size} 个中的一个。</b>砾石里有这么多鱼卵——只有寥寥几条能回到家乡。你死了，就由一个兄弟姐妹接着游。还有多少活着，左上角的状态里有显示。",
    ja: "<b>きみは {size} 匹のうちの一匹。</b>砂利の中にはそれだけの卵がある――ふるさとに帰れるのはほんのわずか。きみが死んだら、きょうだいの一匹が泳ぎ続ける。あと何匹生きているかは、左上のステータスに出ている。",
    bg: "<b>Ти си една от {size}.</b> Толкова яйца лежат в чакъла – само шепа се връщат у дома. Ако умреш, някой от братята и сестрите ти плува нататък. Колко още са живи, пише горе вляво при показателите ти.",
  },
  siblings: { de: "{left} von {size} Geschwistern", en: "{left} of {size} siblings", zh: "{size} 个兄弟姐妹还剩 {left}", ja: "{size} 匹のきょうだいのうち残り {left}", bg: "{left} от {size} братя и сестри" },
  left: { de: "Von {size} Geschwistern leben noch {left}.", en: "Of {size} siblings, {left} are still alive.", zh: "{size} 个兄弟姐妹中，还有 {left} 个活着。", ja: "{size} 匹のきょうだいのうち、まだ {left} 匹が生きている。", bg: "От {size} братя и сестри живи са още {left}." },
  next: { de: "Weiter als Nr. {next}", en: "Go on as no. {next}", zh: "以 {next} 号继续", ja: "{next} 号として続ける", bg: "Продължи като № {next}" },
  lostTitle: { de: "Die Brut ist erloschen", en: "The brood is gone", zh: "这一窝全军覆没", ja: "きょうだいは全滅した", bg: "Цялото поколение загина" },
  lostLine: { de: "Keiner der {size} Geschwister hat überlebt. Im Kies der Quelle beginnt eine neue Brut.", en: "None of the {size} siblings survived. In the gravel of the spring a new brood begins.", zh: "{size} 个兄弟姐妹无一幸存。在源头的砾石中，新的一窝开始了。", ja: "{size} 匹のきょうだいは一匹も生き残らなかった。源流の砂利で、新しいきょうだいが始まる。", bg: "Никой от {size} братя и сестри не оцеля. В чакъла на извора започва ново поколение." },
  newBrood: { de: "Neue Brut", en: "New brood", zh: "新的一窝", ja: "新しいきょうだい", bg: "Ново поколение" },
  homeTitle: { de: "Heimgekehrt!", en: "Home!", zh: "回家了！", ja: "ふるさとへ！", bg: "У дома!" },
  homeLine: { de: "Nach Hause geschafft – einer von {size}.", en: "Made it home – one of {size}.", zh: "回到了家乡——{size} 个中的一个。", ja: "ふるさとにたどり着いた。{size} 匹のうちの一匹だ。", bg: "Стигна до дома – една от {size}." },
  goOn: { de: "Weiter", en: "Go on", zh: "继续", ja: "続ける", bg: "Продължи" },
  share: { de: "Teilen", en: "Share", zh: "分享", ja: "シェア", bg: "Сподели" },
  save: { de: "Bild speichern", en: "Save image", zh: "保存图片", ja: "画像を保存", bg: "Запази картинка" },
  copied: { de: "Text kopiert", en: "Text copied", zh: "文字已复制", ja: "テキストをコピーしました", bg: "Текстът е копиран" },
  stage: { de: "Stadium", en: "Stage", zh: "阶段", ja: "段階", bg: "Етап" },
  age: { de: "Alter", en: "Age", zh: "年龄", ja: "年齢", bg: "Възраст" },
  distance: { de: "Strecke", en: "Swum", zh: "游过的路程", ja: "泳いだ距離", bg: "Изплувано" },
  eaten: { de: "Gefressen", en: "Eaten", zh: "吃下", ja: "食べた数", bg: "Изядени" },
  fights: { de: "Kämpfe gewonnen", en: "Fights won", zh: "打赢的仗", ja: "勝った戦い", bg: "Спечелени битки" },
  leaps: { de: "Sprünge", en: "Leaps", zh: "跳跃", ja: "ジャンプ", bg: "Скокове" },
  escapes: { de: "Jägern entkommen", en: "Hunters escaped", zh: "逃过的捕食者", ja: "逃れた敵", bg: "Избягали хищници" },
  months: { de: "{m} Monate", en: "{m} months", zh: "{m} 个月", ja: "{m} か月", bg: "{m} месеца" },
  month1: { de: "1 Monat", en: "1 month", zh: "1 个月", ja: "1 か月", bg: "1 месец" },
  years: { de: "{y} J. {m} Mon.", en: "{y} yr {m} mo", zh: "{y} 年 {m} 个月", ja: "{y} 年 {m} か月", bg: "{y} г. {m} мес." },
  deathShare: {
    de: "Mein Lachs lebte {age}, schwamm {dist} und fraß {eaten} Happen – dann: {cause}. Von {size} Geschwistern leben noch {left}.",
    en: "My salmon lived {age}, swam {dist} and ate {eaten} morsels – then: {cause}. Of {size} siblings, {left} are still alive.",
    zh: "我的鲑鱼活了 {age}，游了 {dist}，吃了 {eaten} 口——然后：{cause}。{size} 个兄弟姐妹中还有 {left} 个活着。",
    ja: "わたしのサケは {age} 生き、{dist} 泳ぎ、{eaten} 口食べた。そして――{cause}。{size} 匹のきょうだいのうち、残りは {left} 匹。",
    bg: "Моята сьомга живя {age}, изплува {dist} и изяде {eaten} хапки – после: {cause}. От {size} братя и сестри живи са още {left}.",
  },
  homeShare: {
    de: "Mein Lachs hat es nach Hause geschafft – einer von {size} Geschwistern. {age} alt, {dist} geschwommen.",
    en: "My salmon made it home – one of {size} siblings. {age} old, {dist} swum.",
    zh: "我的鲑鱼回到了家乡——{size} 个兄弟姐妹中的一个。活了 {age}，游了 {dist}。",
    ja: "わたしのサケがふるさとにたどり着いた。{size} 匹のきょうだいのうちの一匹だ。{age}、{dist} 泳いだ。",
    bg: "Моята сьомга стигна до дома – една от {size} братя и сестри. На {age}, изплувала {dist}.",
  },
  lostShare: {
    de: "In Salmon Survival ist meine ganze Brut erloschen – alle {size} Geschwister. Zuletzt: {cause}.",
    en: "In Salmon Survival my whole brood is gone – all {size} siblings. The last: {cause}.",
    zh: "在《鲑鱼求生》里，我的一整窝都没了——全部 {size} 个兄弟姐妹。最后一个：{cause}。",
    ja: "Salmon Survival で、わたしのきょうだいは全滅した。{size} 匹すべて。最後は――{cause}。",
    bg: "В Salmon Survival цялото ми поколение загина – всички {size} братя и сестри. Последната: {cause}.",
  },
};
export const REGION_WORDS = {
  brook: { de: "Bach", en: "brook", zh: "溪流", ja: "上流の沢", bg: "поток" },
  upper: { de: "Oberlauf", en: "upper river", zh: "上游", ja: "上流", bg: "горно течение" },
  middle: { de: "Mittellauf", en: "middle river", zh: "中游", ja: "中流", bg: "средно течение" },
  lower: { de: "Unterlauf", en: "lower river", zh: "下游", ja: "下流", bg: "долно течение" },
  estuary: { de: "Mündung", en: "river mouth", zh: "河口", ja: "河口", bg: "устие" },
  sea: { de: "Meer", en: "the sea", zh: "大海", ja: "海", bg: "море" },
};
export const word = (key, vars = {}) => fill(pick(WORDS[key]), vars);

const freshLife = () => ({ distance: 0, eaten: 0, fights: 0, leaps: 0, escapes: 0 });

export function createBrood(saved = null, random = Math.random) {
  const newNumber = () => 1 + Math.floor(random() * BROOD_SIZE);
  let state = saved && Number.isFinite(saved.left) ? { ...saved, life: { ...freshLife(), ...(saved.life ?? {}) } } : null;
  if (state && !Number.isFinite(state.base)) state.base = state.left;
  function fresh() {
    state = { size: BROOD_SIZE, left: BROOD_SIZE, base: BROOD_SIZE, number: newNumber(), lost: 0, stage: 0, life: freshLife() };
  }
  if (!state) fresh();

  const api = {
    get left() {
      return state.left;
    },
    get size() {
      return state.size;
    },
    get number() {
      return state.number;
    },
    get life() {
      return state.life;
    },
    state: () => state,
    // While the fish grows through a stage its siblings go on dying, unseen: the count falls
    // with its growth toward what lives to see the next stage. Returns whether it changed.
    update(stageIndex, progress, stages) {
      const next = stages[stageIndex + 1];
      if (!next || stageIndex < state.stage) return false;
      const keep = SURVIVE[next.id] ?? 1;
      const floor = FLOOR[next.id] ?? 1;
      const p = Math.max(0, Math.min(1, progress));
      const target = Math.max(floor, Math.round(state.base * (1 - (1 - keep) * p)));
      if (target >= state.left) return false;
      state.left = Math.max(1, target);
      return true;
    },
    // A new stage reached: the siblings that did not live to see it are gone.
    reached(stageIndex, stages) {
      for (let i = state.stage + 1; i <= stageIndex; i++) {
        const id = stages[i].id;
        const keep = SURVIVE[id] ?? 1;
        const left = Math.round(state.base * keep);
        state.left = Math.max(1, Math.min(state.left, Math.max(FLOOR[id] ?? 1, left)));
        state.base = state.left;
      }
      state.stage = Math.max(state.stage, stageIndex);
    },
    // The account of the life, as it is lived.
    moved(distance) {
      state.life.distance += distance;
    },
    ate() {
      state.life.eaten++;
    },
    won() {
      state.life.fights++;
    },
    leapt() {
      state.life.leaps++;
    },
    escaped() {
      state.life.escapes++;
    },
    // This fish is dead. Returns what the card shows: its life, and who comes next -- or
    // that none is left.
    died() {
      const life = { ...state.life, number: state.number };
      state.left = Math.max(0, state.left - 1);
      state.base = Math.max(0, state.base - 1);
      state.lost++;
      const gone = state.left <= 0;
      if (!gone) {
        state.number = newNumber();
        state.life = freshLife();
      }
      return { life, gone, next: state.number, left: state.left, size: state.size };
    },
    // A new brood in the gravel (after spawning, or when the last sibling has died).
    renew() {
      fresh();
    },
  };
  return api;
}

// Age, as the card says it.
export function ageText(stageId, progress) {
  const [a, b] = AGE[stageId] ?? [0, 1];
  const months = Math.max(1, Math.round(a + (b - a) * Math.max(0, Math.min(1, progress))));
  if (months < 12) return months === 1 ? word("month1") : word("months", { m: months });
  return word("years", { y: Math.floor(months / 12), m: months % 12 });
}
export function distanceText(units) {
  const metres = units / 10;
  return metres >= 1000 ? `${fmt(Math.round(metres / 100) / 10)} km` : `${fmt(Math.round(metres))} m`;
}
export { fmt as formatNumber, t };
