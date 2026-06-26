/**
 * PvpBrain v6 — нейросеть PVP, 1 000 000 сценариев (5 категорий: ходьба/еда/pvp/криты/зелья)
 *
 * Архитектура: brain.js NeuralNetwork 12→24→18→12→7
 * Входной вектор (12 признаков):
 *   0  — dist (0-1, max=10)       1  — botHp (0-1)
 *   2  — tgtHp (0-1)              3  — hpDiff (0-1, 0.5=равны)
 *   4  — hunger (0-1)             5  — hasSword (0/1)
 *   6  — hasFood (0/1)            7  — hasHeal (0/1)
 *   8  — hasBuff (0/1)            9  — attackCd (0-1)
 *   10 — allies (0-1, max=5)      11 — enemies (0-1, max=5)
 * Выходной вектор (7 действий): attack retreat eat throwHeal throwPotion throwPerk strafe
 */

const log = require("electron-log");

let brain = null;
try { brain = require("brain.js"); }
catch { log.warn("[PvpBrain] brain.js не установлен — эвристика"); }

const path = require("path");
const fs   = require("fs");
// FIX: app.getPath('userData') resolves to a writable directory outside the asar archive.
// __dirname inside a packaged asar is read-only — weights could never be saved/loaded.
function _getWeightsPath() {
  try {
    const { app } = require("electron");
    return path.join(app.getPath("userData"), "pvp-weights.json");
  } catch {
    return path.join(__dirname, "../../pvp-weights.json");
  }
}
const WEIGHTS_PATH = _getWeightsPath();

const SWORD_NAMES = ["wooden_sword","stone_sword","iron_sword","golden_sword","diamond_sword","netherite_sword","mace"];
const AXE_NAMES   = ["wooden_axe","stone_axe","iron_axe","golden_axe","diamond_axe","netherite_axe"];
const HEAL_NAMES  = ["healing","instant_health","regeneration"];
const BUFF_NAMES  = ["strength","speed","resistance","absorption"];
const FOOD_NAMES  = ["apple","golden_apple","enchanted_golden_apple","bread","cooked_beef","cooked_porkchop","cooked_chicken","cooked_mutton","cooked_rabbit","carrot","baked_potato","golden_carrot","mushroom_stew","cooked_salmon","cooked_cod"];

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function getBotFeatures(bot, target, teammates = []) {
  if (!bot?.entity || !target?.position) return null;
  const dist     = bot.entity.position.distanceTo(target.position);
  const heldItem = bot.heldItem;
  const items    = bot.inventory.items();
  const hasSword = heldItem ? (SWORD_NAMES.some(n => heldItem.name.includes(n)) || AXE_NAMES.some(n => heldItem.name.includes(n))) : false;
  const hasFood  = items.some(i => FOOD_NAMES.includes(i.name));
  const hasHeal  = items.some(i => HEAL_NAMES.some(k => i.name.toLowerCase().includes(k)));
  const hasBuff  = items.some(i => BUFF_NAMES.some(k => i.name.toLowerCase().includes(k)));
  const attackCd = heldItem ? clamp((Date.now() - (bot._lastAttackTime || 0)) / 620, 0, 1) : 1;
  const allies   = Object.values(bot.entities || {}).filter(e => e.position && e !== bot.entity && teammates.includes(e.username)).length;
  const enemies  = Object.values(bot.entities || {}).filter(e =>
    e.position && e !== bot.entity && !teammates.includes(e.username) &&
    (e.type === "player" || e.type === "mob") &&
    e.position.distanceTo(bot.entity.position) < 10
  ).length;
  return [
    clamp(dist / 10, 0, 1), clamp(bot.health / 20, 0, 1),
    clamp((target.health || 20) / 20, 0, 1),
    clamp((bot.health - (target.health || 20)) / 20 + 0.5, 0, 1),
    clamp((bot.food || 20) / 20, 0, 1),
    hasSword ? 1 : 0, hasFood ? 1 : 0, hasHeal ? 1 : 0, hasBuff ? 1 : 0,
    attackCd, clamp(allies / 5, 0, 1), clamp(enemies / 5, 0, 1),
  ];
}

// ─── Генератор обучающих данных (~10000 сценариев) ────────────────────────
function buildSeedData() {
  const data = [];
  function clamp(v,lo,hi){ return Math.max(lo,Math.min(hi,v)); }
  const rnd  = (a,b) => a + Math.random()*(b-a);
  const pick = arr  => arr[Math.floor(Math.random()*arr.length)];
  function s(inp, out) {
    const [dist,botHp,tgtHp,hunger,sword,food,heal,buff,cd,ally,enemy] = inp;
    const hpDiff = clamp((botHp-tgtHp)/2+0.5,0,1);
    data.push({
      input:  [clamp(dist,0,1),clamp(botHp,0,1),clamp(tgtHp,0,1),hpDiff,
               clamp(hunger,0,1),sword?1:0,food?1:0,heal?1:0,buff?1:0,
               clamp(cd,0,1),clamp(ally,0,1),clamp(enemy,0,1)],
      output: out.map(v=>clamp(v,0,1))
    });
  }
  function label(inp,atk,ret,eat,heal,pot,perk,str) {
    data.push({ input: inp.map(v=>clamp(v,0,1)), output:[atk,ret,eat,heal,pot,perk,str].map(v=>clamp(v,0,1)) });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // КАТЕГОРИЯ 1: ХОДЬБА / ДВИЖЕНИЕ — 300 000 сценариев (~30%)
  // Обучает бота двигаться к цели, патрулировать, спринтовать, стрейфить.
  // Основной принцип: strafe=1 когда далеко, атака=0 пока CD не готов.
  // ═══════════════════════════════════════════════════════════════════════════

  // 1a. Преследование дальней цели (0.30-1.0): максимальный спринт
  for (let i = 0; i < 80000; i++) {
    const dist = rnd(0.30,1.0), bHp=rnd(0.3,1.0), tHp=rnd(0.2,1.0);
    const hunger=rnd(0.5,1.0), cd=rnd(0,1), sword=pick([0,1]);
    const hpDiff=clamp((bHp-tHp)/2+0.5,0,1);
    const str = clamp(0.88+dist*0.10,0.82,1.0);
    const atk = (dist<0.38 && cd>0.88 && sword) ? clamp(cd*0.72,0.5,0.85) : 0;
    label([dist,bHp,tHp,hpDiff,hunger,sword,0,0,0,cd,rnd(0,0.4),rnd(0,0.3)],atk,0,0,0,0,0,str);
  }

  // 1b. Средняя дистанция (0.20-0.35): CD смотрит, страфим пока ждём
  for (let i = 0; i < 60000; i++) {
    const dist=rnd(0.20,0.35), bHp=rnd(0.3,1.0), tHp=rnd(0.2,1.0);
    const hunger=rnd(0.5,1.0), cd=rnd(0,1);
    const hpDiff=clamp((bHp-tHp)/2+0.5,0,1);
    const cdReady = cd>0.82;
    const str = !cdReady ? clamp(0.55+(0.82-cd)*0.55,0.35,0.88) : 0.18;
    const atk = cdReady ? clamp(cd*0.88,0.60,0.97) : 0;
    label([dist,bHp,tHp,hpDiff,hunger,1,0,0,0,cd,rnd(0,0.4),rnd(0,0.25)],atk,0,0,0,0,0,str);
  }

  // 1c. W-tap: отпускаем W после удара, страфим, потом снова жмём
  for (let i = 0; i < 60000; i++) {
    const dist=rnd(0.05,0.28), bHp=rnd(0.3,1.0), tHp=rnd(0.1,1.0);
    const hunger=rnd(0.5,1.0), cd=rnd(0.75,1.0);
    const hpDiff=clamp((bHp-tHp)/2+0.5,0,1);
    const atk = clamp(cd*0.92,0.70,0.98);
    const str = cd<0.85 ? 0.28 : 0.05;
    label([dist,bHp,tHp,hpDiff,hunger,1,0,0,0,cd,rnd(0,0.5),0.1],atk,0,0,0,0,0,str);
    // С союзником — ещё агрессивнее
    label([dist,bHp,tHp,hpDiff,hunger,1,0,0,0,cd,rnd(0.3,0.8),0.1],clamp(atk*1.1,0,1),0,0,0,0,0,0.02);
  }

  // 1d. Стрейф вокруг цели: CD не готов — кружим, не стоим
  for (let i = 0; i < 60000; i++) {
    const dist=rnd(0.08,0.30), bHp=rnd(0.3,1.0), tHp=rnd(0.1,1.0);
    const hunger=rnd(0.5,1.0), cd=rnd(0,0.70);
    const hpDiff=clamp((bHp-tHp)/2+0.5,0,1);
    const str = clamp(0.60+(0.70-cd)*0.55,0.35,0.92);
    const atk = cd>0.55 ? cd*0.32 : 0;
    label([dist,bHp,tHp,hpDiff,hunger,1,0,0,0,cd,rnd(0,0.4),rnd(0,0.3)],atk,0,0,0,0,0,str);
  }

  // 1e. Отступление-движение (бот убегает): сохраняем дистанцию
  for (let i = 0; i < 40000; i++) {
    const dist=rnd(0.05,0.50), bHp=rnd(0.08,0.35), tHp=rnd(0.2,1.0);
    const hunger=rnd(0.3,0.8), cd=rnd(0,1);
    const hpDiff=clamp((bHp-tHp)/2+0.5,0,1);
    const ret = clamp(0.55+(0.35-bHp)*2.0+dist*0.3,0.35,0.95);
    const str = clamp(0.30-ret*0.15,0.05,0.45);
    label([dist,bHp,tHp,hpDiff,hunger,1,0,0,0,cd,0,rnd(0.2,0.6)],0,ret,0,0,0,0,str);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // КАТЕГОРИЯ 2: ЕДА / ГОЛОД / ВОССТАНОВЛЕНИЕ — 200 000 сценариев (~20%)
  // Когда и как есть, золотые яблоки, баланс голода и HP.
  // ═══════════════════════════════════════════════════════════════════════════

  // 2a. Голодный + нормальное HP (>40%) + враг далеко: спокойно едим
  for (let i = 0; i < 40000; i++) {
    const dist=rnd(0.4,1.0), bHp=rnd(0.4,1.0), tHp=rnd(0.2,1.0);
    const hunger=rnd(0,0.55), food=1;
    const hpDiff=clamp((bHp-tHp)/2+0.5,0,1);
    const eat = clamp(0.85+hunger*0.1-dist*0.05,0.70,0.97);
    label([dist,bHp,tHp,hpDiff,hunger,1,food,0,0,0.5,0,0.1],0,0,eat,0,0,0,0.05);
  }

  // 2b. Голодный + враг близко (3-6 блоков): бьём, не едим
  for (let i = 0; i < 30000; i++) {
    const dist=rnd(0.03,0.35), bHp=rnd(0.4,1.0), tHp=rnd(0.2,1.0);
    const hunger=rnd(0,0.55), cd=rnd(0.6,1.0);
    const hpDiff=clamp((bHp-tHp)/2+0.5,0,1);
    const atk = clamp(cd*0.88,0.55,0.97);
    label([dist,bHp,tHp,hpDiff,hunger,1,1,0,0,cd,0,0.1],atk,0,0,0,0,0,0.05);
  }

  // 2c. Низкое HP + голод: сначала еда, потом гапл
  for (let i = 0; i < 35000; i++) {
    const dist=rnd(0.1,0.6), bHp=rnd(0.15,0.40), tHp=rnd(0.2,1.0);
    const hunger=rnd(0,0.45), hasHl=pick([0,1]);
    const hpDiff=clamp((bHp-tHp)/2+0.5,0,1);
    const eat  = clamp(0.72+(0.40-bHp)*1.5,0.45,0.90);
    const heal = hasHl && bHp<0.25 ? clamp(0.65+(0.25-bHp)*2,0.5,0.90) : 0;
    const ret  = heal ? clamp(0.35+(0.25-bHp)*2,0.15,0.65) : 0;
    label([dist,bHp,tHp,hpDiff,hunger,1,1,hasHl,0,0.5,0,0.1],0,ret,eat,heal,0,0,0);
  }

  // 2d. Высокое HP + высокий голод: не едим сейчас (враг рядом)
  for (let i = 0; i < 25000; i++) {
    const dist=rnd(0.05,0.35), bHp=rnd(0.6,1.0), tHp=rnd(0.2,1.0);
    const hunger=rnd(0.7,1.0), cd=rnd(0.6,1.0);
    const hpDiff=clamp((bHp-tHp)/2+0.5,0,1);
    const atk = clamp(cd*0.90,0.60,0.97);
    label([dist,bHp,tHp,hpDiff,hunger,1,1,0,0,cd,0,0.1],atk,0,0,0,0,0,0.05);
  }

  // 2e. Вне боя (нет цели): регенерация при hp<90% + hunger<16
  for (let i = 0; i < 40000; i++) {
    const bHp=rnd(0.3,0.90), hunger=rnd(0,0.65), food=1;
    const hpDiff=0.5;
    const eat = clamp(0.80+(0.90-bHp)*0.5+(0.65-hunger)*0.4,0.55,0.97);
    label([1.0,bHp,0.5,hpDiff,hunger,1,food,0,0,0.5,0,0],0,0,eat,0,0,0,0);
  }

  // 2f. Золотые яблоки — экстренный режим HP≤10
  for (let i = 0; i < 30000; i++) {
    const dist=rnd(0,0.60), bHp=rnd(0.01,0.22), tHp=rnd(0.1,1.0);
    const hunger=rnd(0,0.7), hasHl=1;
    const hpDiff=clamp((bHp-tHp)/2+0.5,0,1);
    const urgency = clamp((0.22-bHp)/0.22,0,1);
    const heal = clamp(0.78+urgency*0.20,0.70,0.98);
    const ret  = clamp(urgency*0.55+0.10,0.15,0.80);
    label([dist,bHp,tHp,hpDiff,hunger,1,1,hasHl,0,0.5,0,0.1],0,ret,0,heal,0,0,0);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // КАТЕГОРИЯ 3: PVP / АТАКА / БОЙ — 250 000 сценариев (~25%)
  // Полное покрытие боевых ситуаций: ближний бой, финиш, несколько врагов.
  // ═══════════════════════════════════════════════════════════════════════════

  // 3a. Ближний бой (0-3 блока) — CD готов
  for (let i = 0; i < 80000; i++) {
    const dist=rnd(0.02,0.30), bHp=rnd(0.20,1.0), tHp=rnd(0.05,1.0);
    const hunger=rnd(0.5,1.0), cd=rnd(0.72,1.0);
    const hpDiff=clamp((bHp-tHp)/2+0.5,0,1);
    const finish = tHp<0.12;
    const atk = finish ? 1.0 : clamp(cd*(0.87+(0.30-dist)*0.35+(bHp-0.20)*0.20),0.62,0.98);
    const str = finish ? 0 : clamp(0.08+(1-cd)*0.20,0.03,0.32);
    label([dist,bHp,tHp,hpDiff,hunger,1,0,0,0,cd,rnd(0,0.4),rnd(0,0.2)],atk,0,0,0,0,0,str);
  }

  // 3b. Добивание (tHp<15%) — максимальная агрессия
  for (let i = 0; i < 50000; i++) {
    const dist=rnd(0,0.40), bHp=rnd(0.15,1.0), tHp=rnd(0.01,0.15);
    const hunger=rnd(0.4,1.0), cd=rnd(0.60,1.0);
    const hpDiff=clamp((bHp-tHp)/2+0.5,0,1);
    const atk = 1.0;
    const str = dist>0.30 ? clamp(0.85+dist*0.12,0.75,0.98) : clamp(0.06+(0.40-dist)*0.15,0.02,0.28);
    label([dist,bHp,tHp,hpDiff,hunger,1,0,0,0,cd,rnd(0,0.4),rnd(0,0.15)],atk,0,0,0,0,0,str);
  }

  // 3c. Несколько врагов (enemy>0.4): осторожнее
  for (let i = 0; i < 50000; i++) {
    const dist=rnd(0,0.80), bHp=rnd(0.15,1.0), tHp=rnd(0.1,1.0);
    const hunger=rnd(0.3,1.0), cd=rnd(0,1), ally=rnd(0,0.5), enemy=rnd(0.4,1.0);
    const hasHl=pick([0,1]), hasFd=pick([0,1]);
    const hpDiff=clamp((bHp-tHp)/2+0.5,0,1);
    const pressure=clamp(enemy*(1-bHp*2),0,1);
    let atk=0,ret=0,eat=0,heal=0,str=0;
    if (bHp<0.10)                        { ret=0.92; heal=hasHl?0.88:0; }
    else if (enemy>0.65&&bHp<0.35)       { ret=clamp(0.45+pressure*0.40,0.30,0.90); eat=hasFd&&hunger<0.4?0.35:0; }
    else if (dist<0.28&&cd>0.72&&enemy<0.55) { atk=clamp(cd*0.85,0.58,0.96); str=0.10; }
    else if (dist>0.30)                  { str=clamp(0.68+dist*0.20,0.62,0.95); }
    else                                 { str=0.52; atk=cd>0.62?cd*0.38:0; }
    if (ally>0.45) { atk=clamp(atk*1.18,0,1); }
    label([dist,bHp,tHp,hpDiff,hunger,1,hasFd,hasHl,0,cd,ally,enemy],atk,ret,eat,heal,0,0,str);
  }

  // 3d. Полное случайное покрытие PVP
  for (let i = 0; i < 70000; i++) {
    const dist=rnd(0,1), bHp=rnd(0,1), tHp=rnd(0,1), hunger=rnd(0,1);
    const sword=pick([0,1]), food=pick([0,1]), hasHl=pick([0,1]);
    const hasBf=pick([0,1]), cd=rnd(0,1), ally=rnd(0,0.6), enemy=rnd(0,0.6);
    const hpDiff=clamp((bHp-tHp)/2+0.5,0,1);
    let atk=0,ret=0,eat=0,heal=0,pot=0,perk=0,str=0;
    if (bHp<0.08)                           { ret=0.90; heal=hasHl?0.92:0; }
    else if (bHp<0.22&&hasHl)              { heal=clamp(0.72+(0.22-bHp)*2.5,0.6,0.92); ret=0.32; }
    else if (bHp<0.40&&food&&hunger<0.45)  { eat=clamp(0.60+(0.40-bHp)*1.5,0.45,0.85); }
    else if (dist<0.28&&cd>0.78&&sword)    { atk=clamp(cd*0.88+(1-dist)*0.10,0.58,0.98); str=0.10; }
    else if (dist>0.38)                    { str=clamp(0.72+dist*0.18,0.68,0.97); }
    else                                   { str=clamp((1-cd)*0.65+0.22,0.28,0.82); atk=cd>0.65?cd*0.52:0; }
    if (hasBf&&bHp>0.62&&!heal)            { perk=0.52; }
    if (ally>0.30) { atk=clamp(atk*1.20,0,1); ret*=0.60; }
    if (enemy>0.48&&bHp<0.50) { ret=clamp(ret+enemy*0.20,0,0.95); }
    label([dist,bHp,tHp,hpDiff,hunger,sword,food,hasHl,hasBf,cd,ally,enemy],atk,ret,eat,heal,pot,perk,str);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // КАТЕГОРИЯ 4: КРИТИЧЕСКИЕ УДАРЫ — 150 000 сценариев (~15%)
  // Точный тайминг прыжка, прицел на тело, фаза восхождения vs пика.
  // ═══════════════════════════════════════════════════════════════════════════

  // 4a. Пик прыжка (jumpPhase>0.55): бьём, смотрим вниз на тело
  for (let i = 0; i < 60000; i++) {
    const dist=rnd(0.05,0.28), bHp=rnd(0.25,1.0), tHp=rnd(0.05,1.0);
    const hunger=rnd(0.5,1.0), cd=rnd(0.82,1.0), jumpPhase=rnd(0.55,1.0);
    const hpDiff=clamp((bHp-tHp)/2+0.5,0,1);
    const pitchScore=clamp(0.65+jumpPhase*0.35,0.50,1.0);
    const atk=clamp(cd*pitchScore*0.95,0.75,1.0);
    const str=tHp<0.12?0:0.03;
    label([dist,bHp,tHp,hpDiff,hunger,1,0,0,jumpPhase,cd,0,0],atk,0,0,0,0,0,str);
  }

  // 4b. Восходящая фаза (jumpPhase 0.25-0.55): ещё рано — страфим
  for (let i = 0; i < 35000; i++) {
    const dist=rnd(0.05,0.30), bHp=rnd(0.25,1.0), tHp=rnd(0.05,1.0);
    const hunger=rnd(0.5,1.0), cd=rnd(0.80,1.0), jumpPhase=rnd(0.25,0.55);
    const hpDiff=clamp((bHp-tHp)/2+0.5,0,1);
    const str=clamp(0.30+(0.55-jumpPhase)*1.15,0.18,0.65);
    label([dist,bHp,tHp,hpDiff,hunger,1,0,0,jumpPhase,cd,0,0],0,0,0,0,0,0,str);
  }

  // 4c. На земле (jumpPhase<0.25): ждём отрыва, небольшой страф
  for (let i = 0; i < 30000; i++) {
    const dist=rnd(0.05,0.30), bHp=rnd(0.25,1.0), tHp=rnd(0.1,1.0);
    const hunger=rnd(0.5,1.0), cd=rnd(0.80,1.0), jumpPhase=rnd(0,0.25);
    const hpDiff=clamp((bHp-tHp)/2+0.5,0,1);
    label([dist,bHp,tHp,hpDiff,hunger,1,0,0,jumpPhase,cd,0,0],0,0,0,0,0,0,0.12);
  }

  // 4d. Крит-цикл: 1 крит + 1 обычный, дистанция 1-2 блока
  for (let i = 0; i < 25000; i++) {
    const dist=rnd(0.08,0.22), bHp=rnd(0.25,1.0), tHp=rnd(0.05,1.0);
    const hunger=rnd(0.5,1.0), cd=rnd(0.85,1.0);
    const hpDiff=clamp((bHp-tHp)/2+0.5,0,1);
    const finish=tHp<0.15;
    const atk=finish?1.0:clamp(cd*(0.88+(0.22-dist)*0.6),0.72,0.98);
    const str=clamp(0.12+(1-cd)*0.22,0.04,0.32);
    label([dist,bHp,tHp,hpDiff,hunger,1,0,0,0,cd,0,0.1],atk,0,0,0,0,0,str);
    label([dist,bHp,tHp,hpDiff,hunger,1,0,0,1,cd,0,0.1],clamp(atk+0.05,0,1),0,0,0,0,0.38,str);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // КАТЕГОРИЯ 5: ЗЕЛЬЯ / ПОТИОНЫ — 100 000 сценариев (~10%)
  // Хил-зелья, бафы, дебафы — точный тайминг, экономия ресурсов.
  // ═══════════════════════════════════════════════════════════════════════════

  // 5a. Хил-зелье в кризис (HP<20%): приоритет над атакой
  for (let i = 0; i < 25000; i++) {
    const dist=rnd(0.05,0.60), bHp=rnd(0.03,0.22), tHp=rnd(0.1,1.0);
    const hunger=rnd(0.2,1.0), cd=rnd(0,1), hasHl=1;
    const hpDiff=clamp((bHp-tHp)/2+0.5,0,1);
    const urgency=clamp((0.22-bHp)/0.22,0,1);
    const heal=clamp(0.72+urgency*0.25,0.65,0.98);
    const ret=clamp(urgency*0.42+0.08,0.10,0.65);
    const atk=!heal&&tHp<0.08?0.80:0;
    label([dist,bHp,tHp,hpDiff,hunger,1,0,hasHl,0,cd,0,0.1],atk,ret,0,heal,0,0,0);
  }

  // 5b. Бафы перед боем (далеко + CD не готов + хорошее HP)
  for (let i = 0; i < 25000; i++) {
    const dist=rnd(0.25,1.0), bHp=rnd(0.60,1.0), tHp=rnd(0.20,1.0);
    const hunger=rnd(0.70,1.0), cd=rnd(0,0.80), hasBf=1;
    const hpDiff=clamp((bHp-tHp)/2+0.5,0,1);
    const perk=dist>0.30&&cd<0.75?clamp(0.68+(0.75-cd)*0.32,0.48,0.95):0;
    const str=dist>0.35?clamp(0.73+(1-dist)*0.20,0.62,0.90):0;
    const atk=dist<0.28&&cd>0.85?0.70:0;
    label([dist,bHp,tHp,hpDiff,hunger,1,0,0,hasBf,cd,0,0.1],atk,0,0,0,0,perk,str);
  }

  // 5c. Дебаф-зелья на врага (dist<6 + враг здоров)
  for (let i = 0; i < 25000; i++) {
    const dist=rnd(0.08,0.45), bHp=rnd(0.35,1.0), tHp=rnd(0.28,1.0);
    const hunger=rnd(0.5,1.0), cd=rnd(0,1);
    const hpDiff=clamp((bHp-tHp)/2+0.5,0,1);
    const shouldDebuff=bHp>0.45&&tHp>0.28&&dist<0.40;
    const pot=shouldDebuff?clamp(0.58+(bHp-0.45)*0.50+(0.40-dist)*0.50,0.38,0.90):0;
    const atk=dist<0.25&&cd>0.85&&!pot?0.80:(pot?0.28:0);
    label([dist,bHp,tHp,hpDiff,hunger,1,0,0,0,cd,0,0.15],atk,0,0,0,pot,0,0.10);
  }

  // 5d. Timing: когда CD готов — атакуем, не тратим зелье
  for (let i = 0; i < 25000; i++) {
    const dist=rnd(0.05,0.30), bHp=rnd(0.35,1.0), tHp=rnd(0.20,0.90);
    const hunger=rnd(0.5,1.0), cd=rnd(0,1), hasBf=pick([0,1]);
    const hpDiff=clamp((bHp-tHp)/2+0.5,0,1);
    const readyToAtk=cd>0.88&&dist<0.22;
    const atk=readyToAtk?clamp(cd*0.90,0.70,0.98):0;
    const perk=!readyToAtk&&hasBf&&bHp>0.55?clamp(0.50+(1-cd)*0.30,0.35,0.85):0;
    const pot=!readyToAtk&&!perk&&dist<0.30?0.35:0;
    label([dist,bHp,tHp,hpDiff,hunger,1,0,0,hasBf,cd,0,0.1],atk,0,0,0,pot,perk,0.10);
  }

  return data;
}

// ─── Глобальный флаг принудительного переобучения ─────────────────────────
// Устанавливается из IPC-обработчика (index.js) при нажатии "Обновить память"
let _forceRetrain = false;
function setForceRetrain() { _forceRetrain = true; log.info("[PvpBrain] 🔄 forceRetrain=true"); }

// ─── Класс PvpBrain ───────────────────────────────────────────────────────
class PvpBrain {
  constructor() {
    this.net = null;
    this.ready = false;
    this._onProgress = null; // (pct, msg) => void
    this._onReady = null;    // () => void
    this._onlineTrainCount = 0; // счётчик онлайн-итераций (для лога в UI)
    this._initNet();
  }

  // ── Инициализация: если веса есть — грузим мгновенно, иначе обучаем async
  _initNet() {
    if (!brain) { this.net = null; return; }
    this.net = new brain.NeuralNetwork({
      hiddenLayers: [24, 18, 12],
      activation:   "sigmoid",
      learningRate: 0.05,
      momentum:     0.1,
    });

    // Загружаем веса — мгновенно, если нет флага forceRetrain
    if (!_forceRetrain) {
      try {
        if (fs.existsSync(WEIGHTS_PATH)) {
          const w = JSON.parse(fs.readFileSync(WEIGHTS_PATH, "utf8"));
          this.net.fromJSON(w);
          log.info("[PvpBrain] ✅ Веса загружены мгновенно");
          this.ready = true;
          return;
        }
      } catch (e) {
        log.warn("[PvpBrain] Веса не загружены:", e.message);
      }
    } else {
      _forceRetrain = false; // сбрасываем флаг — будем обучать
      log.info("[PvpBrain] forceRetrain — пропускаем кэш, обучаем заново");
      // Удаляем старый файл весов чтобы не загрузился при следующем запуске
      try { if (fs.existsSync(WEIGHTS_PATH)) fs.unlinkSync(WEIGHTS_PATH); } catch {}
    }

    // Первый запуск или после reset — обучаем АСИНХРОННО (UI не зависает!)
    this.ready = false;
    log.info("[PvpBrain] Запускаем асинхронное обучение...");
    setImmediate(() => this._trainAsync());
  }

  async _trainAsync() {
    const prog = (pct, msg) => {
      log.info(`[PvpBrain] ${pct}% — ${msg}`);
      try { if (typeof this._onProgress === 'function') this._onProgress(pct, msg); } catch {}
    };
    const done = () => {
      try { if (typeof this._onReady === 'function') this._onReady(); } catch {}
    };

    try {
      prog(2, '🔄 Запускаем Worker Thread для обучения (не блокирует UI)...');

      // FIX v2: ВЕСЬ пайплайн выполняется в Worker Thread:
      //   1. buildSeedData() — 1 000 000 сценариев (ранее блокировало Event Loop 10-20 сек)
      //   2. shuffle + select 200 000
      //   3. net.train() синхронно (OK — Worker = отдельный поток, main не блокируется)
      // Worker возвращает только ВЕСА (~50KB, ~1081 чисел), НЕ 1M объектов данных.
      // Это исключает блокировку при deserialize большого postMessage.
      const brainPath = require.resolve('brain.js');
      const buildFn   = buildSeedData.toString();

      const workerSrc = `
const { parentPort, workerData } = require('worker_threads');
const brain = require(workerData.brainPath);

${buildFn}

function clamp(v,lo,hi){ return Math.max(lo,Math.min(hi,v)); }

parentPort.postMessage({ type: 'progress', pct: 5,  msg: '📚 Генерируем 1 000 000 сценариев...' });
const all = buildSeedData();

parentPort.postMessage({ type: 'progress', pct: 18, msg: '✂️ Выбираем 200 000 из ' + all.length + '...' });
const n = Math.min(200000, all.length);
for (let i = all.length - 1; i > 0; i--) {
  const j = Math.floor(Math.random() * (i + 1));
  [all[i], all[j]] = [all[j], all[i]];
}
const data = all.slice(0, n);

parentPort.postMessage({ type: 'progress', pct: 22, msg: '🧠 Начинаем обучение (' + n + ' сцен.)...' });
const net = new brain.NeuralNetwork({ hiddenLayers: [24, 18, 12], activation: 'sigmoid', learningRate: 0.05, momentum: 0.1 });

let iterDone = 0;
const TOTAL = 600;
net.train(data, {
  iterations:  TOTAL,
  errorThresh: 0.005,
  logPeriod:   60,
  log: (s) => {
    iterDone += 60;
    const pct = Math.round(22 + (iterDone / TOTAL) * 70);
    parentPort.postMessage({ type: 'progress', pct: Math.min(pct, 92), msg: '⚡ Итерация ' + iterDone + '/' + TOTAL + ' — ' + s });
  }
});

parentPort.postMessage({ type: 'progress', pct: 95, msg: '💾 Передаём веса в main thread...' });
parentPort.postMessage({ type: 'done', weights: net.toJSON() });
`;

      const weights = await new Promise((resolve, reject) => {
        const { Worker } = require('worker_threads');
        const w = new Worker(workerSrc, { eval: true, workerData: { brainPath } });
        w.on('message', msg => {
          if (msg.type === 'progress') prog(msg.pct, msg.msg);
          else if (msg.type === 'done')  resolve(msg.weights);
        });
        w.on('error', reject);
        w.on('exit', code => { if (code !== 0) reject(new Error('Worker exited с кодом: ' + code)); });
      });

      prog(96, '🔗 Применяем веса в нейросеть (мгновенно)...');
      this.net.fromJSON(weights); // быстро: ~1081 числа, не 1M объектов

      prog(98, '💾 Сохраняем веса на диск...');
      try {
        fs.writeFileSync(WEIGHTS_PATH, JSON.stringify(this.net.toJSON()), 'utf8');
        log.info('[PvpBrain] ✅ Веса сохранены. Следующий запуск будет мгновенным.');
      } catch (e) { log.warn('[PvpBrain] Не сохранить веса:', e.message); }

      prog(100, '✅ Обучение завершено! PVP готов.');
      this.ready = true;
      done();
    } catch (e) {
      log.error('[PvpBrain] Ошибка обучения:', e.message);
      prog(100, '⚠️ Ошибка — режим эвристики');
      this.ready = true;
      done();
    }
  }
  decide(bot, target, teammates = [], extra = {}) {
    const features = getBotFeatures(bot, target, teammates);
    if (!features) return { action: "attack", confidence: 0.5, features };

    const ACTIONS = ["attack","retreat","eat","throwHeal","throwPotion","throwPerk","strafe"];

    // Нейросеть
    if (this.net) {
      try {
        const out = this.net.run(features);
        const scores = ACTIONS.map((a, i) => ({ action: a, score: out[i] || 0 }));
        scores.sort((a, b) => b.score - a.score);
        const best = scores[0];
        return { action: best.action, confidence: best.score, features };
      } catch (e) {
        log.debug("[PvpBrain] run error:", e.message);
      }
    }

    // Эвристика (фоллбэк)
    return this._heuristic(features, bot, target, extra);
  }

  _heuristic(f, bot, target, extra = {}) {
    const [dist, botHp, tgtHp, hpDiff, hunger, sword, food, heal, buff, cd, ally, enemy] = f;
    const ACTIONS = ["attack","retreat","eat","throwHeal","throwPotion","throwPerk","strafe"];

    if (botHp < 0.1) return { action: heal ? "throwHeal" : (food ? "eat" : "retreat"), confidence: 0.9, features: f };
    if (botHp < 0.25 && heal) return { action: "throwHeal", confidence: 0.8, features: f };
    if (botHp < 0.4 && food && hunger < 0.7) return { action: "eat", confidence: 0.75, features: f };
    if (dist < 0.35 && cd > 0.75 && sword) return { action: "attack", confidence: cd * 0.9, features: f };
    if (dist > 0.35) return { action: "strafe", confidence: 0.8, features: f };
    if (cd < 0.5) return { action: "strafe", confidence: 0.85, features: f };
    return { action: "attack", confidence: 0.5, features: f };
  }

  recordExperience(features, actionMap, wasGood) {
    if (!this.net || !features) return;
    // Онлайн-обучение: усиливаем/ослабляем действие
    try {
      const ACTIONS = ["attack","retreat","eat","throwHeal","throwPotion","throwPerk","strafe"];
      const current = this.net.run(features);
      const target  = [...current];
      ACTIONS.forEach((a, i) => {
        if (actionMap[a]) target[i] = clamp(current[i] + (wasGood ? 0.08 : -0.05), 0, 1);
      });
      this.net.train([{ input: features, output: target }], { iterations: 3, errorThresh: 0.05 });
      this._onlineTrainCount++;
      // Каждые 50 онлайн-итераций — шлём запись в лог
      if (this._onlineTrainCount % 50 === 0 && typeof this._onLogTrainCount === 'function') {
        this._onLogTrainCount(this._onlineTrainCount);
      }
    } catch {}
  }
}

module.exports = { PvpBrain, setForceRetrain };
