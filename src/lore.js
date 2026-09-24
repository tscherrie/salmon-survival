import { lang } from "./i18n.js";

// Now and then a few lines about the salmon's life, told at the foot of the screen where the
// tips appear: what the stage it is in means, what the place it has come to is, what the
// hour and the season bring, who the hunter about is -- and, between those, a fact about
// salmon. Each is told once (remembered across visits); the general facts start over when
// they have all been told. Switched off and on with the button on the pause screen (or I).
//
// The texts carry all the languages themselves (de, en, zh, ja, bg): they are prose, not
// labels, and live better here together than scattered through the translation tables.

const STORAGE = "salmon-survival-lore";
const SEEN = "salmon-survival-lore-seen";

export const LORE_KICKERS = {
  life: { de: "Lachsleben", en: "A salmon's life", zh: "鲑鱼的一生", ja: "サケの一生", bg: "Животът на сьомгата" },
  // (The facts come without a heading, told like the rest rather than as a quiz.)
  fact: { de: "", en: "", zh: "", ja: "", bg: "" },
};

// What each stage of life is, told when it begins, and more about it later on.
const STAGES = {
  alevin: [
    {
      de: "Den Winter über lagst du als Ei im Kies. Jetzt bist du geschlüpft – aber noch zu schwach zum Jagen: Der Dottersack am Bauch nährt dich ein paar Wochen lang. Bleib im Dunkeln zwischen den Steinen.",
      en: "All winter you lay in the gravel as an egg. Now you have hatched – but you are too weak to hunt: the yolk sac under your belly feeds you for a few weeks. Stay in the dark between the stones.",
      zh: "整个冬天，你都作为一颗卵躺在砾石里。现在你孵化了——但还太弱，无法捕食：腹下的卵黄囊会喂养你几个星期。待在石缝间的黑暗里吧。",
      ja: "冬のあいだ、あなたは卵として砂利の中にいた。いま孵化したが、まだ狩りをする力はない。お腹の卵黄のうが数週間あなたを養ってくれる。石のすきまの暗がりにいよう。",
      bg: "Цялата зима лежа в чакъла като хайверно зърно. Сега се излюпи – но още си твърде слаба, за да ловуваш: жълтъчното мехурче под корема те храни няколко седмици. Стой в тъмното между камъните.",
    },
    {
      de: "Frisch geschlüpfte Lachse meiden das Licht: Zwischen den Kieseln sind sie vor Räubern und der Strömung sicher.",
      en: "Newly hatched salmon shun the light: among the pebbles they are safe from hunters and from the current.",
      zh: "刚孵化的鲑鱼躲避光线：在卵石之间，它们既能躲开捕食者，也能避开水流。",
      ja: "孵化したばかりのサケは光を避ける。小石のあいだなら、敵からも流れからも守られる。",
      bg: "Току-що излюпените сьомги избягват светлината: между камъчетата са защитени от хищници и от течението.",
    },
  ],
  fry: [
    {
      de: "Der Dottersack ist aufgebraucht – du steigst aus dem Kies ins offene Wasser und musst selbst fressen. Die ersten Wochen sind die gefährlichsten: Von hundert Brütlingen überleben nur wenige den ersten Sommer.",
      en: "The yolk sac is used up – you rise out of the gravel into open water and must feed yourself. The first weeks are the most dangerous: of a hundred fry, only a few live through their first summer.",
      zh: "卵黄囊用完了——你从砾石中升入开阔的水里，必须自己觅食。最初几周最危险：一百条鱼苗中，只有少数能活过第一个夏天。",
      ja: "卵黄はもう使い切った。砂利から開けた水へ出て、自分で食べなければならない。最初の数週間がいちばん危険だ。百匹の稚魚のうち、最初の夏を越えられるのはほんのわずか。",
      bg: "Жълтъчното мехурче се изчерпа – излизаш от чакъла в открита вода и трябва сама да се храниш. Първите седмици са най-опасни: от сто малки само няколко преживяват първото си лято.",
    },
    {
      de: "Schon Brütlinge verteidigen ein kleines Revier – eine Handbreit Kies, auf dem sie vorbeitreibendes Futter abfangen.",
      en: "Even fry defend a little territory – a hand's breadth of gravel where they catch the food drifting by.",
      zh: "就连鱼苗也会守卫一小块领地——一掌宽的砾石，它们在那里截住漂过的食物。",
      ja: "稚魚でさえ小さななわばりを守る。手のひらほどの砂利の上で、流れてくる餌を待ちかまえるのだ。",
      bg: "Дори малките защитават мъничка територия – длан чакъл, където ловят храната, която течението носи.",
    },
  ],
  fingerling: [
    {
      de: "Dein erster Sommer. An deinen Seiten sind dunkle Flecken erschienen, die Jugendflecken: Über gesprenkeltem Kies machen sie dich fast unsichtbar.",
      en: "Your first summer. Dark marks have appeared along your sides, the parr marks: over dappled gravel they make you nearly invisible.",
      zh: "你的第一个夏天。你的体侧出现了深色斑块，也就是幼鲑斑：在斑驳的砾石上，它们让你几乎隐形。",
      ja: "はじめての夏。体の横に黒っぽい斑点、パーマークが現れた。まだらな砂利の上では、ほとんど見えなくなる。",
      bg: "Първото ти лято. По хълбоците ти се появиха тъмни петна – младежките петна: над шарения чакъл те правят почти невидима.",
    },
  ],
  yearling: [
    {
      de: "Du hast deinen ersten Winter überstanden. Im kalten Wasser fressen junge Lachse kaum und verkriechen sich tagsüber in den Lücken zwischen den Steinen; erst in der Dunkelheit kommen sie hervor.",
      en: "You have come through your first winter. In cold water young salmon hardly feed and creep into the gaps between the stones by day; only in the dark do they come out.",
      zh: "你熬过了第一个冬天。在冰冷的水里，幼鲑几乎不进食，白天钻进石头之间的缝隙，只有天黑后才出来。",
      ja: "最初の冬を越えた。冷たい水の中では、若いサケはほとんど食べず、昼は石のすきまにもぐりこむ。暗くなってようやく出てくる。",
      bg: "Преживя първата си зима. В студената вода младите сьомги почти не ядат и денем се крият в процепите между камъните; излизат едва в тъмното.",
    },
  ],
  parr: [
    {
      de: "Als Parr bleibst du zwei, drei, im hohen Norden bis zu fünf Jahre im Fluss. Du wächst, verteidigst deinen Platz in der Strömung – und wartest auf den Frühling, der dich zum Meer ruft.",
      en: "As a parr you stay in the river for two or three years, in the far north up to five. You grow, hold your place in the current – and wait for the spring that calls you to the sea.",
      zh: "作为幼鲑，你会在河里待两三年，在遥远的北方甚至长达五年。你成长着，守住你在水流中的位置——等待召唤你奔向大海的春天。",
      ja: "パーとして、あなたは二、三年、北の果てでは五年も川で過ごす。成長し、流れの中の自分の場所を守り、海へ呼ぶ春を待つ。",
      bg: "Като пар оставаш в реката две-три години, в далечния север до пет. Растеш, пазиш мястото си в течението – и чакаш пролетта, която ще те повика към морето.",
    },
    {
      de: "Manche männlichen Parr werden schon im Fluss geschlechtsreif. Beim Laichen der Großen schleichen sie sich dazwischen – und werden tatsächlich Väter.",
      en: "Some male parr become mature while still in the river. When the big ones spawn they sneak in between them – and really do become fathers.",
      zh: "有些雄性幼鲑还在河里时就性成熟了。大鲑鱼产卵时，它们会偷偷溜进去——而且真的会成为父亲。",
      ja: "オスのパーの中には、川にいるうちに成熟するものがいる。大きなサケの産卵にこっそり割りこみ、本当に父親になるのだ。",
      bg: "Някои мъжки пар узряват още в реката. Когато големите хвърлят хайвер, те се промъкват между тях – и наистина стават бащи.",
    },
  ],
  smolt: [
    {
      de: "Du wirst zum Smolt: Die Jugendflecken verblassen, du wirst silbern und schlank, und deine Kiemen stellen sich aufs Salzwasser um. Mit dem Frühjahrshochwasser zieht es dich flussab ins Meer.",
      en: "You are becoming a smolt: the parr marks fade, you turn silver and slim, and your gills get ready for salt water. With the spring flood you are drawn downstream to the sea.",
      zh: "你正在变成银化鲑：幼鲑斑褪去，你变得银亮修长，鳃也在为咸水做准备。随着春汛，你被引向下游，奔向大海。",
      ja: "スモルトになる。パーマークが薄れ、銀色でほっそりした体になり、えらは海水に備える。春の増水とともに、下流の海へと引き寄せられる。",
      bg: "Превръщаш се в смолт: младежките петна избледняват, ставаш сребриста и стройна, а хрилете ти се готвят за солена вода. С пролетното пълноводие те тегли надолу към морето.",
    },
    {
      de: "Smolts wandern meist nachts und im Schwarm. Anfangs lassen sie sich oft rückwärts treiben, den Kopf gegen die Strömung.",
      en: "Smolts travel mostly by night and in shoals. At first they often let themselves drift backwards, head into the current.",
      zh: "银化鲑大多在夜间成群迁徙。起初它们常常倒着顺流漂下，头朝着水流。",
      ja: "スモルトはたいてい夜に群れで下る。はじめは、頭を流れに向けたまま後ろ向きに流されていくことが多い。",
      bg: "Смолтовете пътуват предимно нощем и на ята. Отначало често се оставят да ги носи назад, с глава срещу течението.",
    },
  ],
  postsmolt: [
    {
      de: "Salzwasser! Die ersten Monate im Meer entscheiden über dein Leben: Viele Postsmolts werden gefressen, bevor sie die reichen Jagdgründe im Norden erreichen.",
      en: "Salt water! Your first months at sea decide your life: many post-smolts are eaten before they reach the rich hunting grounds in the north.",
      zh: "咸水！在海里的最初几个月决定你的命运：许多幼海鲑还没到达北方丰饶的觅食场，就被吃掉了。",
      ja: "海水だ！海での最初の数か月が一生を決める。多くのポストスモルトは、北の豊かな餌場にたどり着く前に食べられてしまう。",
      bg: "Солена вода! Първите месеци в морето решават живота ти: много пост-смолтове биват изядени, преди да стигнат богатите ловни полета на север.",
    },
  ],
  grilse: [
    {
      de: "Ein Grilse ist ein Lachs, der schon nach einem einzigen Winter im Meer heimkehrt – kleiner als die anderen, aber früher zurück.",
      en: "A grilse is a salmon that comes home after a single winter at sea – smaller than the others, but back sooner.",
      zh: "“一冬鲑”是指只在海里度过一个冬天就回乡的鲑鱼——比别的小，却回来得更早。",
      ja: "グリルスとは、海でひと冬を過ごしただけで帰ってくるサケのこと。ほかより小さいが、早く戻ってくる。",
      bg: "Грилз се нарича сьомга, която се връща у дома само след една зима в морето – по-малка от другите, но по-рано.",
    },
  ],
  sea: [
    {
      de: "Norwegische Lachse ziehen im Meer bis vor die Färöer und nach Grönland. Zwei, drei Winter jagen sie dort – und können über zwanzig Kilo schwer werden.",
      en: "Norwegian salmon roam the sea as far as the Faroes and Greenland. They hunt there for two or three winters – and can grow to more than twenty kilos.",
      zh: "挪威的鲑鱼在海中一路游到法罗群岛和格陵兰。它们在那里捕猎两三个冬天——体重能超过二十公斤。",
      ja: "ノルウェーのサケは、フェロー諸島やグリーンランドの沖まで海を旅する。そこで二、三度の冬を狩りで過ごし、二十キロを超えることもある。",
      bg: "Норвежките сьомги стигат в морето чак до Фарьорските острови и Гренландия. Там ловуват две-три зими – и могат да надхвърлят двайсет килограма.",
    },
  ],
  spawner: [
    {
      de: "Der Ruf der Heimat. Am Geruch findest du deinen Fluss wieder – du hast ihn dir als Smolt eingeprägt. Von jetzt an frisst du nichts mehr und lebst von deinen Reserven.",
      en: "The call of home. You find your river again by its smell – you learned it by heart as a smolt. From now on you eat nothing and live on your reserves.",
      zh: "故乡的召唤。你靠气味重新找到你的河——那是你还是银化鲑时就牢记的。从现在起你不再进食，靠储备活下去。",
      ja: "故郷が呼んでいる。においで自分の川がわかる。スモルトのときに覚えこんだのだ。これからは何も食べず、蓄えだけで生きる。",
      bg: "Зовът на дома. Намираш реката си по мириса – запомни го наизуст като смолт. Отсега нататък не ядеш нищо и живееш от запасите си.",
    },
    {
      de: "Im Laichkleid werden Lachse bronzen bis rötlich, und den Männchen wächst ein Haken am Unterkiefer, der Laichhaken.",
      en: "In their spawning dress salmon turn bronze to reddish, and the males grow a hook on the lower jaw, the kype.",
      zh: "换上婚姻色后，鲑鱼会变成青铜色乃至微红，雄鱼的下颌还会长出钩状的“婚钩”。",
      ja: "婚姻色になると、サケは銅色から赤みがかった色に変わり、オスの下あごには鼻曲がりと呼ばれるかぎが伸びる。",
      bg: "В брачната си премяна сьомгите стават бронзови до червеникави, а на мъжките им израства кука на долната челюст.",
    },
    {
      de: "Anders als die meisten Pazifiklachse sterben Atlantische Lachse nicht zwingend nach dem Laichen: Manche ziehen zurück ins Meer und kommen ein zweites Mal.",
      en: "Unlike most Pacific salmon, Atlantic salmon do not all die after spawning: some go back to sea and return a second time.",
      zh: "与大多数太平洋鲑鱼不同，大西洋鲑产卵后不一定死去：有些会回到海里，再回来第二次。",
      ja: "太平洋のサケの多くと違い、大西洋サケは産卵後に必ず死ぬわけではない。海へ戻り、もう一度帰ってくるものもいる。",
      bg: "За разлика от повечето тихоокеански сьомги, атлантическите не умират задължително след хвърлянето на хайвера: някои се връщат в морето и идват втори път.",
    },
  ],
};

// Facts about salmon in general, for the quiet stretches.
const FACTS = [
  {
    id: "salar",
    de: "Der wissenschaftliche Name des Atlantischen Lachses, <i>Salmo salar</i>, wird oft als „der Springer“ gedeutet.",
    en: "The Atlantic salmon's scientific name, <i>Salmo salar</i>, is often read as “the leaper”.",
    zh: "大西洋鲑的学名 <i>Salmo salar</i> 常被解释为“跳跃者”。",
    ja: "大西洋サケの学名 <i>Salmo salar</i> は、しばしば「跳ぶもの」と解釈される。",
    bg: "Научното име на атлантическата сьомга, <i>Salmo salar</i>, често се тълкува като „скачачът“.",
  },
  {
    id: "leap",
    de: "Lachse springen über drei Meter hoch – an einem Wasserfall nutzen sie die aufsteigende Welle unter dem Fall als Sprungbrett.",
    en: "Salmon can leap more than three metres high – at a waterfall they use the upwelling wave below the fall as a springboard.",
    zh: "鲑鱼能跃起三米多高——在瀑布下，它们借助落水处涌起的浪头作为跳板。",
    ja: "サケは三メートル以上も跳べる。滝では、落ちる水の下で盛り上がる波を踏み台にするのだ。",
    bg: "Сьомгите скачат над три метра високо – при водопад използват надигащата се вълна под него като трамплин.",
  },
  {
    id: "eggs",
    de: "Ein Lachsweibchen legt rund 1500 Eier pro Kilo Körpergewicht. Von Tausenden kehren oft nur eine Handvoll als erwachsene Lachse zurück.",
    en: "A female salmon lays about 1,500 eggs per kilo of body weight. Of those thousands, often only a handful come back as grown salmon.",
    zh: "雌鲑每公斤体重大约产 1500 颗卵。成千上万颗卵中，往往只有寥寥几条能长成成鱼归来。",
    ja: "メスのサケは体重一キロあたり約1500個の卵を産む。何千もの卵のうち、成魚として戻ってくるのはほんのひと握りだ。",
    bg: "Женската сьомга снася около 1500 яйца на килограм телесно тегло. От хилядите често само шепа се връщат като възрастни сьомги.",
  },
  {
    id: "scales",
    de: "An den Schuppen eines Lachses kann man wie an Baumringen ablesen, wie viele Jahre er im Fluss und wie viele Winter er im Meer war.",
    en: "A salmon's scales can be read like tree rings: how many years it spent in the river and how many winters at sea.",
    zh: "鲑鱼的鳞片可以像树的年轮一样解读：它在河里待了几年，在海里过了几个冬天。",
    ja: "サケのうろこは木の年輪のように読める。川で何年、海で何度の冬を過ごしたかがわかるのだ。",
    bg: "Люспите на сьомгата се четат като годишни пръстени на дърво: колко години е прекарала в реката и колко зими в морето.",
  },
  {
    id: "pink",
    de: "Das rosa Fleisch der Lachse kommt aus ihrem Futter: Krill und Garnelen enthalten den Farbstoff Astaxanthin.",
    en: "Salmon's pink flesh comes from what they eat: krill and shrimps contain the pigment astaxanthin.",
    zh: "鲑鱼粉红色的肉来自它们的食物：磷虾和小虾含有虾青素这种色素。",
    ja: "サケの身がピンク色なのは食べ物のせいだ。オキアミやエビにはアスタキサンチンという色素が含まれている。",
    bg: "Розовото месо на сьомгата идва от храната ѝ: крилът и скаридите съдържат пигмента астаксантин.",
  },
  {
    id: "muscle",
    de: "Für lange Strecken schwimmen Lachse mit roter Muskulatur; für Spurts und Sprünge schalten sie die weiße zu – stark, aber schnell erschöpft.",
    en: "For long distances salmon swim with their red muscle; for dashes and leaps they call on the white – strong, but quickly spent.",
    zh: "长途游动时，鲑鱼使用红肌；冲刺和跳跃时，它们调动白肌——力量大，却很快耗尽。",
    ja: "長い距離を泳ぐときは赤い筋肉を使い、ダッシュやジャンプでは白い筋肉を加える。力強いが、すぐに疲れてしまう。",
    bg: "За дълги разстояния сьомгите плуват с червената си мускулатура; за спринтове и скокове включват бялата – силна, но бързо изтощаваща се.",
  },
  {
    id: "lateral",
    de: "Mit dem Seitenlinienorgan spüren Fische feinste Wasserbewegungen – den Schlag eines nahenden Räubers, auch im Dunkeln.",
    en: "With their lateral line fish feel the finest movements in the water – the stroke of an approaching hunter, even in the dark.",
    zh: "鱼靠侧线感知水中最细微的波动——哪怕在黑暗中，也能察觉逼近的捕食者摆尾。",
    ja: "魚は側線で水のごくわずかな動きを感じ取る。暗闇でも、近づく敵のひと掻きがわかるのだ。",
    bg: "Със страничната си линия рибите усещат и най-леките движения на водата – удара на приближаващ хищник, дори в тъмното.",
  },
  {
    id: "magnet",
    de: "Auf dem offenen Meer orientieren sich Lachse wohl am Magnetfeld der Erde – erst an der Küste übernimmt die Nase.",
    en: "On the open sea salmon seem to find their way by the Earth's magnetic field – only at the coast does the nose take over.",
    zh: "在茫茫大海上，鲑鱼似乎靠地球磁场辨别方向——到了海岸，才由嗅觉接手。",
    ja: "外洋では、サケはどうやら地球の磁場で道を知るらしい。海岸まで来ると、鼻がその役目を引き継ぐ。",
    bg: "В открито море сьомгите явно се ориентират по магнитното поле на Земята – едва край брега поема носът.",
  },
  {
    id: "adipose",
    de: "Zwischen Rücken- und Schwanzflosse sitzt beim Lachs eine kleine Fettflosse – ganz ohne Flossenstrahlen.",
    en: "Between the dorsal fin and the tail, salmon have a small adipose fin – with no fin rays at all.",
    zh: "在背鳍和尾鳍之间，鲑鱼长着一片小小的脂鳍——完全没有鳍条。",
    ja: "サケの背びれと尾びれのあいだには、小さなあぶらびれがある。ひれすじがまったくないひれだ。",
    bg: "Между гръбната и опашната перка сьомгата има малка мастна перка – съвсем без лъчи.",
  },
  {
    id: "forest",
    de: "Lachse tragen Nährstoffe aus dem Meer weit den Fluss hinauf. Was von ihnen nach dem Laichen bleibt, düngt Wasser und Ufer – bis in die Bäume.",
    en: "Salmon carry nutrients from the sea far up the river. What is left of them after spawning feeds the water and the banks – right up into the trees.",
    zh: "鲑鱼把海洋的养分带到河流上游。它们产卵后留下的一切滋养着河水和河岸——一直到树木。",
    ja: "サケは海の栄養を川の上流まで運ぶ。産卵のあとに残ったものが水と岸を肥やし、木々にまで届く。",
    bg: "Сьомгите пренасят хранителни вещества от морето далеч нагоре по реката. Каквото остане от тях след хвърлянето на хайвера, тори водата и бреговете – чак до дърветата.",
  },
  {
    id: "rivers",
    de: "Norwegen hat mehrere hundert Lachsflüsse – mehr als irgendein anderes Land in Europa.",
    en: "Norway has several hundred salmon rivers – more than any other country in Europe.",
    zh: "挪威有几百条鲑鱼河——比欧洲任何其他国家都多。",
    ja: "ノルウェーには数百のサケの川がある。ヨーロッパのどの国よりも多い。",
    bg: "Норвегия има няколкостотин реки със сьомга – повече от която и да е друга страна в Европа.",
  },
  {
    id: "salt",
    de: "Im Fluss muss ein Lachs Salz festhalten, im Meer Salz loswerden. Seine Kiemen können beides – nach einer Umstellung von einigen Wochen.",
    en: "In the river a salmon has to hold on to salt; at sea it has to get rid of it. Its gills can do both – after a few weeks of changing over.",
    zh: "在河里，鲑鱼必须留住盐分；在海里，又必须排出盐分。它的鳃两样都能做到——只是需要几周来转换。",
    ja: "川ではサケは塩分を保たなければならず、海では塩分を捨てなければならない。えらはそのどちらもできる。数週間かけて切り替えればだが。",
    bg: "В реката сьомгата трябва да задържа солта, в морето – да се отървава от нея. Хрилете ѝ могат и двете – след няколко седмици преустройство.",
  },
  {
    id: "temperature",
    de: "Lachse mögen es kühl: Über etwa 20 °C wird es für sie anstrengend, denn warmes Wasser hält weniger Sauerstoff.",
    en: "Salmon like it cool: above about 20 °C life gets hard for them, because warm water holds less oxygen.",
    zh: "鲑鱼喜欢凉爽：水温超过约 20 °C 就会吃力，因为温水里的氧气更少。",
    ja: "サケは冷たい水が好きだ。およそ20℃を超えるとつらくなる。温かい水は酸素が少ないからだ。",
    bg: "Сьомгите обичат хладното: над около 20 °C им става тежко, защото топлата вода съдържа по-малко кислород.",
  },
];

// The places, when the fish comes to them.
const PLACES = [
  {
    match: /^mussels$/,
    de: "Flussperlmuscheln können weit über hundert Jahre alt werden – und ohne Lachse und Forellen, an deren Kiemen ihre Larven heranwachsen, gäbe es sie nicht.",
    en: "Freshwater pearl mussels can live well over a hundred years – and without salmon and trout, on whose gills their larvae grow up, there would be none.",
    zh: "淡水珍珠贻贝能活一百多年——而没有鲑鱼和鳟鱼，它们的幼体就无处在鳃上成长，贻贝也就不复存在。",
    ja: "カワシンジュガイは百年以上も生きる。そして、幼生が育つえらを貸してくれるサケやマスがいなければ、この貝も存在しない。",
    bg: "Сладководните перлени миди могат да живеят много над сто години – а без сьомгите и пъстървите, по чиито хриле растат ларвите им, нямаше да ги има.",
  },
  {
    match: /^king-pool$/,
    de: "Manche Bachforellen werden alt und riesig und fressen dann fast nur noch Fisch – auch junge Lachse.",
    en: "Some brown trout grow old and huge and then eat almost nothing but fish – young salmon included.",
    zh: "有些褐鳟会长得又老又大，之后几乎只吃鱼——包括幼小的鲑鱼。",
    ja: "ブラウントラウトの中には年をとって巨大になり、ほとんど魚ばかり食べるものがいる。若いサケも例外ではない。",
    bg: "Някои пъстърви остаряват и стават огромни, и тогава ядат почти само риба – включително млади сьомги.",
  },
  {
    match: /^farm$/,
    de: "Fast jeder Atlantische Lachs, der heute gegessen wird, stammt aus einer Zucht. Entkommene Zuchtlachse und Lachsläuse aus den Gehegen machen den wilden Lachsen zu schaffen.",
    en: "Almost every Atlantic salmon eaten today comes from a farm. Escaped farm salmon and sea lice from the pens are a hard burden on the wild ones.",
    zh: "如今被人吃掉的大西洋鲑几乎都来自养殖场。逃逸的养殖鲑和网箱里的海虱，给野生鲑鱼带来了沉重的负担。",
    ja: "いま食べられている大西洋サケは、ほとんどすべてが養殖ものだ。いけすから逃げたサケや、そこで増えるサケジラミが、野生のサケを苦しめている。",
    bg: "Почти всяка атлантическа сьомга, която се яде днес, идва от ферма. Избягалите фермерски сьомги и морските въшки от клетките тежат на дивите.",
  },
  {
    match: /^counter$/,
    de: "An Zählstationen filmt eine Kamera jeden Fisch, der durch den engen Durchlass schwimmt – so weiß man, wie viele Lachse heimkehren.",
    en: "At counting stations a camera films every fish that swims through the narrow slot – that is how people know how many salmon come home.",
    zh: "在计数站，摄像机会拍下每一条穿过窄口的鱼——人们就是这样知道有多少鲑鱼回乡。",
    ja: "計数所では、狭い通り道を泳ぐ魚をカメラが一匹残らず撮影する。こうして、何匹のサケが帰ってきたかがわかる。",
    bg: "На преброителните станции камера заснема всяка риба, минала през тесния проход – така хората знаят колко сьомги се връщат.",
  },
  {
    match: /^mill$/,
    de: "Mühlen und Wehre haben früher vielen Flüssen ihre Lachse genommen. Heute baut man Fischtreppen – oder reißt alte Wehre wieder ab.",
    en: "Mills and weirs once took the salmon from many rivers. Today people build fish passes – or tear old weirs down again.",
    zh: "过去，磨坊和堰坝让许多河流失去了鲑鱼。如今人们修建鱼道——或者把旧堰拆掉。",
    ja: "かつて水車小屋や堰が、多くの川からサケを奪った。いまは魚道をつくったり、古い堰を取り壊したりしている。",
    bg: "Мелниците и праговете някога отнеха сьомгите на много реки. Днес хората строят рибни проходи – или събарят старите прагове.",
  },
  {
    match: /^wreck$/,
    de: "Ein Wrack wird mit der Zeit zum Riff: Algen und Muscheln besiedeln es, und Dorsche suchen in ihm Schutz.",
    en: "In time a wreck becomes a reef: weed and mussels settle on it, and cod shelter inside.",
    zh: "沉船久而久之会变成礁石：海藻和贻贝在上面安家，鳕鱼躲在里面避险。",
    ja: "沈没船はやがて礁になる。海藻や貝が住みつき、タラがその中に身を隠す。",
    bg: "С времето корабокрушението става риф: водорасли и миди го заселват, а трески се крият вътре.",
  },
  {
    match: /^beaver/,
    de: "Biber waren in Skandinavien fast verschwunden und sind zurück. Ihre Teiche sind Kinderstuben voller Futter – ihre Dämme können Lachsen aber auch den Weg versperren.",
    en: "Beavers had all but vanished from Scandinavia and are back. Their ponds are nurseries full of food – but their dams can also bar the way for salmon.",
    zh: "河狸曾在斯堪的纳维亚几乎绝迹，如今又回来了。它们的池塘是食物丰富的育幼场——但它们的水坝也可能挡住鲑鱼的路。",
    ja: "ビーバーはスカンジナビアからほとんど姿を消していたが、戻ってきた。その池は餌の多い育ち場だが、ダムがサケの行く手をふさぐこともある。",
    bg: "Бобрите почти бяха изчезнали от Скандинавия и се върнаха. Езерата им са детски градини, пълни с храна – но бентовете им могат и да препречат пътя на сьомгите.",
  },
  {
    match: /^cave-spring$/,
    de: "Aus einer Quelle strömt Grundwasser – das ganze Jahr über fast gleich kühl, im Winter sogar wärmer als der Fluss.",
    en: "Groundwater flows out of a spring – almost equally cool all year round, and in winter even warmer than the river.",
    zh: "泉眼里涌出的是地下水——一年到头几乎同样清凉，冬天甚至比河水还暖。",
    ja: "泉からわき出るのは地下水だ。一年中ほとんど同じ冷たさで、冬には川より暖かいことさえある。",
    bg: "От извора блика подпочвена вода – почти еднакво хладна през цялата година, а през зимата дори по-топла от реката.",
  },
  {
    match: /^cold-spring$/,
    de: "In heißen Sommern drängen sich Lachse an kühlen Quellen – manchmal Dutzende auf engstem Raum.",
    en: "In hot summers salmon crowd round cool springs – sometimes dozens of them in a tiny space.",
    zh: "在炎热的夏天，鲑鱼会挤在清凉的泉眼旁——有时几十条挤在一小片地方。",
    ja: "暑い夏には、サケは冷たい湧き水のまわりに集まる。ときには何十匹も、ごく狭い場所に。",
    bg: "В горещите лета сьомгите се струпват около хладните извори – понякога десетки на съвсем малко място.",
  },
  {
    match: /^logjam$/,
    de: "Totholz ist Gold für einen Fluss: Es gräbt Gumpen, schafft Strömungsschatten und Verstecke für junge Fische.",
    en: "Dead wood is gold for a river: it scours out pools and makes slack water and hiding places for young fish.",
    zh: "枯木是河流的宝贝：它冲刷出深潭，造出缓流区，为幼鱼提供藏身之所。",
    ja: "倒木は川にとって宝だ。淵を掘り、流れのよどみと若い魚の隠れ家をつくる。",
    bg: "Мъртвата дървесина е злато за реката: издълбава вирове, създава затишия и скривалища за младите риби.",
  },
  {
    match: /^undercut/,
    de: "Unterspülte Ufer mit ihren Wurzeln sind die liebsten Verstecke großer Forellen und Lachse.",
    en: "Undercut banks with their roots are the favourite hiding places of big trout and salmon.",
    zh: "被冲空的河岸和盘根错节的树根，是大鳟鱼和鲑鱼最爱的藏身处。",
    ja: "根がむき出しになったえぐれた岸は、大きなマスやサケのお気に入りの隠れ家だ。",
    bg: "Подкопаните брегове с корените си са любимите скривалища на големите пъстърви и сьомги.",
  },
  {
    match: /^island/,
    de: "Um eine Insel teilt sich die Strömung: meist ein schneller, flacher Arm und ein ruhiger, tiefer – zwei Welten dicht nebeneinander.",
    en: "Round an island the current splits: usually a fast, shallow arm and a calm, deep one – two worlds side by side.",
    zh: "水流在岛边分开：通常一条湍急而浅，一条平静而深——两个世界比邻而居。",
    ja: "島のまわりで流れは二つに分かれる。たいてい、速くて浅い流れと、静かで深い流れ。すぐ隣り合う二つの世界だ。",
    bg: "Около остров течението се разделя: обикновено бърз, плитък ръкав и спокоен, дълбок – два свята един до друг.",
  },
  {
    match: /^grotto/,
    de: "Hinter einem Wasserfall ist es erstaunlich still: Der Vorhang hält Licht, Lärm und Räuber fern.",
    en: "Behind a waterfall it is surprisingly still: the curtain keeps out light, noise and hunters.",
    zh: "瀑布后面出奇地安静：水帘挡住了光、喧嚣和捕食者。",
    ja: "滝の裏側は驚くほど静かだ。水のカーテンが光も音も敵も遠ざける。",
    bg: "Зад водопада е изненадващо тихо: завесата спира светлината, шума и хищниците.",
  },
];

// The stretches of the river.
const REGIONS = {
  brook: {
    de: "Oben im Bach ist das Wasser kalt, klar und reich an Sauerstoff: die Kinderstube der Lachse.",
    en: "Up in the brook the water is cold, clear and rich in oxygen: the salmon's nursery.",
    zh: "上游溪流的水冰冷、清澈、富含氧气：这是鲑鱼的育儿所。",
    ja: "上流の沢の水は冷たく澄んで、酸素に富む。サケのゆりかごだ。",
    bg: "Горе в потока водата е студена, бистра и богата на кислород: детската стая на сьомгите.",
  },
  estuary: {
    de: "In der Mündung mischt sich Süß- mit Salzwasser. Hier stellt sich dein Körper um: Deine Kiemen pumpen jetzt Salz hinaus statt hinein.",
    en: "In the estuary fresh water mixes with salt. Here your body changes over: your gills now pump salt out instead of in.",
    zh: "在河口，淡水与咸水交汇。你的身体在这里转换：你的鳃现在把盐分往外排，而不是往里吸。",
    ja: "河口では真水と海水がまじり合う。ここで体が切り替わる。えらはいま、塩分を取りこむのではなく外へ送り出す。",
    bg: "В устието сладката вода се смесва със солената. Тук тялото ти се преустройва: хрилете вече изпомпват солта навън, а не навътре.",
  },
  sea: {
    de: "Im Meer wächst ein Lachs so schnell wie nie im Fluss: Krill, Sandaale und Heringe gibt es hier im Überfluss.",
    en: "At sea a salmon grows faster than it ever could in the river: krill, sand eels and herring are here in plenty.",
    zh: "在海里，鲑鱼长得比在河里快得多：这里磷虾、玉筋鱼和鲱鱼多得是。",
    ja: "海ではサケは川にいたころとは比べものにならないほど速く育つ。オキアミもイカナゴもニシンも、ここにはたっぷりある。",
    bg: "В морето сьомгата расте по-бързо, отколкото някога в реката: тук крил, пясъчни змиорки и херинга има в изобилие.",
  },
};

// The hour and the season.
const TIMES = {
  dusk: {
    de: "In der Dämmerung schlüpfen viele Insekten aus dem Wasser – Lachse und Forellen steigen dann nach ihnen: der Abendsprung.",
    en: "At dusk many insects hatch out of the water – salmon and trout rise to them: the evening rise.",
    zh: "黄昏时，许多昆虫从水里羽化——鲑鱼和鳟鱼便浮上来追食：这就是“黄昏上浮”。",
    ja: "夕暮れには多くの虫が水から羽化する。サケやマスはそれを追って水面に浮かび上がる。イブニングライズだ。",
    bg: "По здрач много насекоми излизат от водата – сьомгите и пъстървите се издигат след тях: вечерният кълвеж.",
  },
  night: {
    de: "Nachts wagen sich junge Lachse aus ihren Verstecken: Reiher und Eisvögel jagen mit den Augen – im Dunkeln sehen sie dich nicht.",
    en: "At night young salmon venture out of hiding: herons and kingfishers hunt by sight – in the dark they cannot see you.",
    zh: "夜里，幼鲑敢从藏身处出来：苍鹭和翠鸟靠眼睛捕猎——黑暗中它们看不见你。",
    ja: "夜になると、若いサケは隠れ家から出てくる。サギやカワセミは目で狩りをするので、暗闇ではあなたが見えない。",
    bg: "Нощем младите сьомги излизат от скривалищата си: чаплите и земеродните рибарчета ловуват с очи – в тъмното не те виждат.",
  },
};
const SEASONS = {
  spring: {
    de: "Im Frühling steigen Schmelzwasser und Temperatur – für die Smolts das Zeichen, ins Meer aufzubrechen.",
    en: "In spring the meltwater and the temperature rise – for the smolts, the sign to set off for the sea.",
    zh: "春天，融雪水和水温一起上升——对银化鲑来说，这是出发奔向大海的信号。",
    ja: "春には雪解け水と水温が上がる。スモルトにとって、海へ旅立つ合図だ。",
    bg: "През пролетта топящият се сняг и температурата се покачват – за смолтовете това е знакът да тръгнат към морето.",
  },
  summer: {
    de: "Im Sommer wachsen junge Lachse am schnellsten – solange das Wasser nicht zu warm wird.",
    en: "In summer young salmon grow fastest – as long as the water does not get too warm.",
    zh: "夏天，幼鲑长得最快——只要水不太热。",
    ja: "夏は若いサケがいちばん速く育つ。水が温かくなりすぎなければだが。",
    bg: "През лятото младите сьомги растат най-бързо – стига водата да не стане твърде топла.",
  },
  autumn: {
    de: "Im Herbst laichen die Lachse: Das Weibchen schlägt mit dem Schwanz eine Grube in den Kies, legt die Eier hinein und deckt sie wieder zu.",
    en: "In autumn the salmon spawn: the female beats a hollow into the gravel with her tail, lays her eggs in it and covers them up again.",
    zh: "秋天是鲑鱼产卵的季节：雌鱼用尾巴在砾石上拍出一个坑，把卵产在里面，再重新盖好。",
    ja: "秋はサケの産卵期。メスは尾で砂利に穴を掘り、卵を産み、また砂利をかぶせる。",
    bg: "През есента сьомгите хвърлят хайвер: женската изкопава с опашка яма в чакъла, снася яйцата в нея и отново ги заравя.",
  },
  winter: {
    de: "Im Winter lebt der Fluss langsam: Im eiskalten Wasser brauchen Fische wenig Kraft – und finden wenig Futter.",
    en: "In winter the river lives slowly: in the icy water fish need little strength – and find little food.",
    zh: "冬天，河流的节奏变慢：在冰冷的水里，鱼只需很少的力气——也找不到多少食物。",
    ja: "冬、川はゆっくりと生きる。凍えるような水の中で、魚はあまり力を使わず、餌もあまり見つからない。",
    bg: "През зимата реката живее бавно: в ледената вода рибите се нуждаят от малко сили – и намират малко храна.",
  },
};

// The hunters, when one is about.
const HUNTERS = {
  trout: {
    de: "Bachforellen sind nahe Verwandte der Lachse – und fressen trotzdem gern deren Brut.",
    en: "Brown trout are close relatives of salmon – and still happily eat their young.",
    zh: "褐鳟是鲑鱼的近亲——却照样爱吃鲑鱼的幼苗。",
    ja: "ブラウントラウトはサケの近い親戚だ。それでも平気でサケの子を食べる。",
    bg: "Пъстървите са близки роднини на сьомгите – и въпреки това с удоволствие ядат малките им.",
  },
  bullhead: {
    de: "Die Groppe lauert perfekt getarnt zwischen den Steinen am Grund und schnappt nach Eiern und Brütlingen.",
    en: "The bullhead lies in wait between the stones on the bottom, perfectly camouflaged, snapping at eggs and fry.",
    zh: "杜父鱼完美地伪装在河底石头间，伺机吞食鱼卵和鱼苗。",
    ja: "カジカは川底の石のあいだに見事に隠れて待ちぶせし、卵や稚魚にかみつく。",
    bg: "Главочът дебне съвършено маскиран между камъните на дъното и хапе яйца и малки рибки.",
  },
  kingfisher: {
    de: "Der Eisvogel späht von einem Ast über dem Wasser und stürzt sich kopfüber hinein – schneller, als ein kleiner Fisch reagieren kann.",
    en: "The kingfisher watches from a branch above the water and plunges in head first – faster than a small fish can react.",
    zh: "翠鸟站在水面上方的枝头窥视，然后一头扎进水里——比小鱼的反应还快。",
    ja: "カワセミは水の上の枝から見張り、頭から水に飛びこむ。小さな魚が反応するより速く。",
    bg: "Земеродното рибарче наблюдава от клон над водата и се хвърля с главата напред – по-бързо, отколкото малка рибка може да реагира.",
  },
  merganser: {
    de: "Gänsesäger jagen tauchend, oft in Gruppen, und treiben kleine Fische zusammen. Ihr Schnabel hat Hornzähne wie eine Säge.",
    en: "Goosanders hunt underwater, often in groups, herding small fish together. Their bills have horny teeth like a saw.",
    zh: "秋沙鸭潜水捕猎，常常成群结队，把小鱼赶到一起。它们的喙上长着锯齿般的角质齿。",
    ja: "カワアイサは潜って狩りをし、しばしば群れで小魚を追いこむ。くちばしにはのこぎりのような歯がある。",
    bg: "Големите нирци ловуват под вода, често на групи, и сгъстяват малките рибки. Човките им имат рогови зъбчета като трион.",
  },
  heron: {
    de: "Der Graureiher steht reglos im Flachen und stößt blitzschnell zu. Im tiefen Wasser bist du vor ihm sicher.",
    en: "The grey heron stands motionless in the shallows and strikes like lightning. In deep water you are safe from it.",
    zh: "苍鹭一动不动地站在浅水里，闪电般出击。在深水里，你就不怕它。",
    ja: "アオサギは浅瀬でじっと立ち、稲妻のように突く。深いところにいれば安全だ。",
    bg: "Сивата чапла стои неподвижно в плитчините и удря светкавично. В дълбоката вода си в безопасност от нея.",
  },
  perch: {
    de: "Flussbarsche jagen oft im Trupp und treiben kleine Fische vor sich her.",
    en: "Perch often hunt in packs, driving small fish before them.",
    zh: "河鲈常常成群捕猎，把小鱼赶在前面。",
    ja: "パーチはしばしば群れで狩りをし、小魚を追い立てる。",
    bg: "Костурите често ловуват на глутници и гонят малките рибки пред себе си.",
  },
  pike: {
    de: "Der Hecht lauert reglos im Kraut und schießt dann aus dem Stand hervor – einer der schnellsten Starts unter den Fischen.",
    en: "The pike lies motionless among the weed and then shoots out from a standstill – one of the fastest starts of any fish.",
    zh: "白斑狗鱼一动不动地潜伏在水草中，然后从静止中猛然冲出——是鱼类中起步最快的之一。",
    ja: "パイクは水草の中でじっと待ち、止まった状態から一気に飛び出す。魚の中でも屈指の瞬発力だ。",
    bg: "Щуката дебне неподвижно във водораслите и после изстрелва от място – едно от най-бързите тръгвания сред рибите.",
  },
  otter: {
    de: "Ein Otter frisst jeden Tag etwa ein Siebtel seines eigenen Gewichts – vor allem Fisch.",
    en: "An otter eats about a seventh of its own weight every day – fish above all.",
    zh: "一只水獭每天大约要吃掉相当于自身体重七分之一的食物——主要是鱼。",
    ja: "カワウソは毎日、自分の体重のおよそ七分の一を食べる。おもに魚だ。",
    bg: "Видрата изяжда всеки ден около една седма от собственото си тегло – преди всичко риба.",
  },
  bear: {
    de: "Braunbären fangen Lachse am Wasserfall – manchmal mitten im Sprung, direkt aus der Luft.",
    en: "Brown bears catch salmon at waterfalls – sometimes in mid-leap, straight out of the air.",
    zh: "棕熊在瀑布边捕鲑鱼——有时正好在鲑鱼跃起时，直接从空中叼住。",
    ja: "ヒグマは滝でサケを捕る。ときにはジャンプの最中、空中でそのまま。",
    bg: "Кафявите мечки ловят сьомги при водопадите – понякога насред скока, направо от въздуха.",
  },
  cod: {
    de: "An der Küste lauern Dorsche auf die jungen Lachse, die gerade aus dem Fluss ins Meer kommen.",
    en: "Along the coast cod lie in wait for the young salmon just coming out of the river into the sea.",
    zh: "在沿海，鳕鱼埋伏着，等待刚从河里游进大海的幼鲑。",
    ja: "沿岸では、タラが川から海へ出てきたばかりの若いサケを待ちぶせている。",
    bg: "Край брега трески дебнат младите сьомги, които тъкмо излизат от реката в морето.",
  },
  seal: {
    de: "Seehunde warten gern an Flussmündungen – dort kommen die heimkehrenden Lachse vorbei.",
    en: "Seals like to wait at river mouths – that is where the salmon coming home pass by.",
    zh: "海豹喜欢守在河口——归乡的鲑鱼都要从那里经过。",
    ja: "アザラシは河口で待つのが好きだ。帰ってくるサケがそこを通るからだ。",
    bg: "Тюлените обичат да чакат в устията на реките – оттам минават завръщащите се сьомги.",
  },
};

const pick = (e) => e[lang] ?? e.en ?? e.de;
const choose = (list, random) => list[Math.floor(random() * list.length)];

export function createLore({ hud, random = Math.random }) {
  let on = true;
  try {
    on = localStorage.getItem(STORAGE) !== "0";
  } catch {}
  let seen = new Set();
  try {
    seen = new Set(JSON.parse(localStorage.getItem(SEEN) || "[]"));
  } catch {}
  const keep = () => {
    try {
      localStorage.setItem(SEEN, JSON.stringify([...seen]));
    } catch {}
  };
  // What has come up and is waiting to be told: { id, text, kicker, until }.
  const queue = [];
  let clock = 0;
  // Nothing in the first minute and more of a swim, so the controls and first tips come
  // first; the moment's own things half a minute apart at least, the general facts only
  // after a longer quiet.
  let next = 100;
  let told = -1e9;
  let last = { stage: null, place: null, region: null, season: null, time: null, hunters: new Set() };
  let stageSince = 0;

  function offer(id, entry, kicker, wait = 0, keepFor = 90) {
    if (seen.has(id) || queue.some((q) => q.id === id)) return;
    queue.push({ id, entry, kicker, at: clock + wait, until: clock + wait + keepFor });
  }

  function tell(id, entry, kicker) {
    const text = pick(entry);
    // Longer lines stay up longer.
    const seconds = Math.min(16, Math.max(8, text.length / (lang === "zh" || lang === "ja" ? 9 : 18)));
    if (!hud.lore(text, pick(LORE_KICKERS[kicker]), seconds)) return false;
    seen.add(id);
    keep();
    return true;
  }

  const api = {
    // (For looking into it.)
    state: () => ({ clock, next, queue: queue.map((q) => q.id), seen: [...seen] }),
    get on() {
      return on;
    },
    set on(value) {
      on = !!value;
      try {
        localStorage.setItem(STORAGE, on ? "1" : "0");
      } catch {}
      if (!on) hud.lore(null);
    },
    // Each step of the game: { stage (id), place (id), regions (weights), season, hour,
    // night, hatch, hunters (the kinds about), quiet (nothing else on screen) }.
    update(dt, ctx) {
      clock += dt;
      // What the moment brings, noticed even while switched off (so turning it on does not
      // dump a backlog).
      if (ctx.stage !== last.stage) {
        last.stage = ctx.stage;
        stageSince = clock;
        const story = STAGES[ctx.stage];
        // After the new stage's banner has gone.
        if (story) offer(`stage:${ctx.stage}:0`, story[0], "life", 9, 240);
      }
      if (ctx.place !== last.place) {
        last.place = ctx.place;
        const p = ctx.place && PLACES.find((q) => q.match.test(ctx.place));
        if (p) offer(`place:${p.match.source}`, p, "fact", 6, 60);
      }
      const region = ctx.regions.sea > 0.6 ? "sea" : ctx.regions.estuary > 0.5 ? "estuary" : ctx.regions.brook > 0.6 ? "brook" : null;
      if (region !== last.region) {
        last.region = region;
        if (region && REGIONS[region]) offer(`region:${region}`, REGIONS[region], "fact", 8, 120);
      }
      if (ctx.season !== last.season) {
        last.season = ctx.season;
        if (SEASONS[ctx.season]) offer(`season:${ctx.season}`, SEASONS[ctx.season], "fact", 20, 240);
      }
      const time = ctx.hatch > 0.4 ? "dusk" : ctx.night > 0.7 ? "night" : null;
      if (time !== last.time) {
        last.time = time;
        if (time) offer(`time:${time}`, TIMES[time], "fact", 5, 60);
      }
      for (const kind of ctx.hunters)
        if (!last.hunters.has(kind) && HUNTERS[kind]) offer(`hunter:${kind}`, HUNTERS[kind], "fact", 5, 25);
      last.hunters = new Set(ctx.hunters);
      for (let i = queue.length - 1; i >= 0; i--) if (clock > queue[i].until) queue.splice(i, 1);
      if (!on || !ctx.quiet || clock < 75) return;
      // The moment's own first, half a minute after the last; otherwise, after a longer
      // quiet, more about this stage or a fact about salmon.
      const due = clock - told > 35 && queue.find((q) => q.at <= clock);
      if (due) {
        queue.splice(queue.indexOf(due), 1);
        if (tell(due.id, due.entry, due.kicker)) {
          told = clock;
          next = Math.max(next, clock + 60 + random() * 30);
        }
        return;
      }
      if (clock < next || clock - stageSince < 30) return;
      const story = STAGES[ctx.stage] ?? [];
      const more = story.map((entry, i) => ({ id: `stage:${ctx.stage}:${i}`, entry, kicker: "life" })).filter((q) => !seen.has(q.id));
      let facts = FACTS.filter((f) => !seen.has(`fact:${f.id}`));
      if (!facts.length) {
        for (const f of FACTS) seen.delete(`fact:${f.id}`);
        facts = FACTS;
      }
      const item = more.length && random() < 0.5 ? more[0] : (() => {
        const f = choose(facts, random);
        return { id: `fact:${f.id}`, entry: f, kicker: "fact" };
      })();
      if (tell(item.id, item.entry, item.kicker)) {
        told = clock;
        next = clock + 80 + random() * 50;
      } else next = clock + 5;
    },
  };
  return api;
}
