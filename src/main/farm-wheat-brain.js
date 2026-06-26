/**
 * FarmWheatBrain v1 — нейросеть для фермы пшеницы, 500 000 сценариев
 * 250к = ходьба/навигация к посевам | 250к = работа (сбор/посев/вспашка/костная мука)
 *
 * Архитектура: brain.js NeuralNetwork 12→20→14→7
 * Входной вектор (12 признаков):
 *   0  — dist (0-1, max=20)        1  — crop_stage (0-1, 1=спелый)
 *   2  — has_seeds (0/1)           3  — has_hoe (0/1)
 *   4  — has_bonemeal (0/1)        5  — hunger (0-1)
 *   6  — inv_full (0-1)            7  — farmland_ratio (0-1, доля фармланда вокруг)
 *   8  — mature_ratio (0-1)        9  — empty_farmland_ratio (0-1)
 *   10 — has_food (0/1)            11 — time_day (0-1, 1=день)
 * Выходной вектор (7 действий): walk harvest plant till bonemeal eat idle
 */

const log = require("electron-log");
let brain = null;
try { brain = require("brain.js"); } catch { log.warn("[FarmWheatBrain] brain.js не установлен"); }

const path = require("path");
const fs   = require("fs");

function _getWeightsPath() {
  try { const { app } = require("electron"); return path.join(app.getPath("userData"), "farm-wheat-weights.json"); }
  catch { return path.join(__dirname, "../../farm-wheat-weights.json"); }
}
const WEIGHTS_PATH = _getWeightsPath();

function clamp(v,lo,hi) { return Math.max(lo,Math.min(hi,v)); }
const rnd  = (a,b) => a + Math.random()*(b-a);
const pick = arr  => arr[Math.floor(Math.random()*arr.length)];

// ─── Генератор 500 000 сценариев ─────────────────────────────────────────
function buildSeedData() {
  const data = [];
  function lbl(inp, walk, harvest, plant, till, bonemeal, eat, idle) {
    data.push({
      input:  inp.map(v => clamp(v,0,1)),
      output: [walk, harvest, plant, till, bonemeal, eat, idle].map(v => clamp(v,0,1))
    });
  }

  // ════════════════════════════════════════════════════════════════════
  // КАТЕГОРИЯ 1: ХОДЬБА / НАВИГАЦИЯ — 250 000 сценариев
  // ════════════════════════════════════════════════════════════════════

  // 1a. Цель далеко (> 5 блоков) — есть спелые культуры, идём к ним (60k)
  for (let i=0;i<60000;i++) {
    const dist=rnd(0.25,1.0), stage=rnd(0.7,1.0), seeds=pick([0,1]);
    const mature=rnd(0.3,1.0), empty=rnd(0,0.4);
    const hunger=rnd(0.5,1.0), food=1, hoe=pick([0,1]);
    lbl([dist,stage,seeds,hoe,0,hunger,rnd(0,0.7),rnd(0,0.5),mature,empty,food,rnd(0.5,1)],
      clamp(0.87+dist*0.10,0.82,0.98), 0,0,0,0,0,0.04);
  }

  // 1b. Далеко — пустой фармланд, идём сеять (50k)
  for (let i=0;i<50000;i++) {
    const dist=rnd(0.20,0.90), seeds=1, hoe=pick([0,1]);
    const empty=rnd(0.3,1.0), mature=rnd(0,0.2), hunger=rnd(0.5,1.0);
    lbl([dist,rnd(0,0.1),seeds,hoe,pick([0,1]),hunger,rnd(0,0.6),rnd(0.2,0.8),mature,empty,1,rnd(0.3,1)],
      clamp(0.83+dist*0.12,0.78,0.97), 0,0,0,0,0,0.05);
  }

  // 1c. Далеко — инвентарь не полный, продолжаем работу (40k)
  for (let i=0;i<40000;i++) {
    const dist=rnd(0.15,0.80), seeds=pick([0,1]), hoe=pick([0,1]);
    const hunger=rnd(0.5,1.0), inv=rnd(0,0.65);
    lbl([dist,rnd(0,1),seeds,hoe,pick([0,1]),hunger,inv,rnd(0,0.7),rnd(0,0.7),rnd(0,0.7),1,rnd(0,1)],
      clamp(0.80+dist*0.15,0.72,0.97), 0,0,0,0,0,0.06);
  }

  // 1d. Ищем, инвентарь полон → идём к сундуку (30k)
  for (let i=0;i<30000;i++) {
    const inv=rnd(0.8,1.0), dist=rnd(0.10,0.80);
    lbl([dist,rnd(0,1),rnd(0,1),rnd(0,1),rnd(0,1),rnd(0.5,1),inv,rnd(0,1),rnd(0,1),rnd(0,1),1,rnd(0,1)],
      clamp(0.78+inv*0.18,0.72,0.97), 0,0,0,0,0,0.07);
  }

  // 1e. Средняя дистанция (2-8 блоков), несколько спелых (30k)
  for (let i=0;i<30000;i++) {
    const dist=rnd(0.10,0.40), stage=rnd(0.6,1.0), mature=rnd(0.2,0.7);
    lbl([dist,stage,1,1,pick([0,1]),rnd(0.5,1),rnd(0,0.6),rnd(0.2,0.8),mature,rnd(0,0.5),1,rnd(0.3,1)],
      clamp(0.72+(dist)*0.50,0.55,0.90), 0,0,0,0,0,0.10);
  }

  // 1f. Широкий охват — всё остальное движение (40k)
  for (let i=0;i<40000;i++) {
    const dist=rnd(0.05,1.0), seeds=pick([0,1]), stage=rnd(0,0.5);
    const hunger=rnd(0.4,1.0);
    lbl([dist,stage,seeds,pick([0,1]),pick([0,1]),hunger,rnd(0,0.8),rnd(0,0.7),rnd(0,0.5),rnd(0,0.7),1,rnd(0,1)],
      clamp(0.62+dist*0.32,0.45,0.93), 0,0,0,0,0,0.10);
  }

  // ════════════════════════════════════════════════════════════════════
  // КАТЕГОРИЯ 2: ФЕРМА — СБОР, ПОСЕВ, ВСПАШКА, КОСТНАЯ МУКА — 250 000
  // ════════════════════════════════════════════════════════════════════

  // 2a. Сбор спелой пшеницы (dist близко, stage=1) (70k)
  for (let i=0;i<70000;i++) {
    const dist=rnd(0,0.12), stage=rnd(0.88,1.0), hunger=rnd(0.4,1.0);
    const seeds=pick([0,1]), hoe=pick([0,1]), bm=pick([0,1]);
    const inv=rnd(0,0.75);
    lbl([dist,stage,seeds,hoe,bm,hunger,inv,rnd(0.2,0.8),rnd(0.3,1.0),rnd(0,0.4),1,rnd(0.3,1)],
      0, clamp(0.88+stage*0.10,0.80,0.98), 0,0,0,0,0.04);
  }

  // 2b. Посев семян на пустом фармланде (70k)
  for (let i=0;i<70000;i++) {
    const dist=rnd(0,0.10), seeds=1, stage=rnd(0,0.05);
    const empty=rnd(0.3,1.0), hunger=rnd(0.5,1.0);
    lbl([dist,stage,seeds,1,pick([0,1]),hunger,rnd(0,0.7),rnd(0.3,0.9),rnd(0,0.2),empty,1,rnd(0.3,1)],
      0,0, clamp(0.88+(1-dist)*0.10,0.82,0.98), 0,0,0,0.04);
  }

  // 2c. Вспашка земли (dist близко, есть мотыга, нет фармланда) (30k)
  for (let i=0;i<30000;i++) {
    const dist=rnd(0,0.12), hoe=1, farmland=rnd(0,0.25);
    const hunger=rnd(0.5,1.0), seeds=pick([0,1]);
    lbl([dist,rnd(0,0.1),seeds,hoe,pick([0,1]),hunger,rnd(0,0.7),farmland,rnd(0,0.3),rnd(0.3,0.8),1,rnd(0.3,1)],
      0,0,0, clamp(0.85+(1-farmland)*0.12,0.78,0.97), 0,0,0.04);
  }

  // 2d. Костная мука (есть bm, культура растёт но не спелая) (40k)
  for (let i=0;i<40000;i++) {
    const dist=rnd(0,0.10), bm=1, stage=rnd(0.10,0.82);
    const hunger=rnd(0.5,1.0), seeds=pick([0,1]);
    lbl([dist,stage,seeds,pick([0,1]),bm,hunger,rnd(0,0.7),rnd(0.2,0.8),rnd(0,0.5),rnd(0,0.3),1,rnd(0.3,1)],
      0,0,0,0, clamp(0.82+(0.82-stage)*0.18,0.72,0.97), 0,0.05);
  }

  // 2e. Еда (голодный, далеко от культур) (25k)
  for (let i=0;i<25000;i++) {
    const hunger=rnd(0,0.38), dist=rnd(0.2,1.0), food=1;
    lbl([dist,rnd(0,1),pick([0,1]),pick([0,1]),pick([0,1]),hunger,rnd(0,0.7),rnd(0,1),rnd(0,1),rnd(0,1),food,rnd(0,1)],
      0,0,0,0,0, clamp(0.80+(0.38-hunger)*1.5,0.65,0.97), 0);
  }

  // 2f. Голодный + рядом культуры — ждём (idle) (15k)
  for (let i=0;i<15000;i++) {
    const hunger=rnd(0,0.50), dist=rnd(0,0.08), stage=rnd(0,0.70), food=0;
    lbl([dist,stage,0,1,0,hunger,rnd(0,0.8),rnd(0.2,0.8),rnd(0,0.4),rnd(0,0.5),food,rnd(0,1)],
      0,0,0,0,0,0, clamp(0.65+(0.50-hunger)*0.6,0.50,0.90));
  }

  return data;
}

// ─── Класс FarmWheatBrain ──────────────────────────────────────────────────
class FarmWheatBrain {
  constructor() {
    this.net   = brain ? new brain.NeuralNetwork({ hiddenLayers: [20,14], activation: 'sigmoid' }) : null;
    this.ready = false;
    this._onProgress = null;
    this._onReady    = null;
    this._onlineTrainCount = 0;
    this._init();
  }

  _init() {
    if (!this.net) { this.ready = true; return; }
    try {
      if (fs.existsSync(WEIGHTS_PATH)) {
        const w = JSON.parse(fs.readFileSync(WEIGHTS_PATH, "utf8"));
        this.net.fromJSON(w);
        log.info("[FarmWheatBrain] ✅ Веса загружены");
        this.ready = true;
        return;
      }
    } catch (e) { log.warn("[FarmWheatBrain] Веса не загружены:", e.message); }
    this.ready = false;
    setImmediate(() => this._trainAsync());
  }

  async _trainAsync() {
    const prog = (pct, msg) => {
      log.info(`[FarmWheatBrain] ${pct}% — ${msg}`);
      try { if (typeof this._onProgress === 'function') this._onProgress(pct, msg); } catch {}
    };
    const yieldLoop = () => new Promise(r => setImmediate(r));
    try {
      prog(3, '📚 Генерируем сценарии (ходьба+ферма пшеницы)...');
      await yieldLoop();
      const all = buildSeedData();
      prog(18, `✂️ Выбираем 10 000 из ${all.length.toLocaleString()}...`);
      for (let i=all.length-1;i>0;i--) {
        const j=Math.floor(Math.random()*(i+1));
        [all[i],all[j]]=[all[j],all[i]];
      }
      const data = all.slice(0, Math.min(10000, all.length));
      prog(22, `🌾 Обучаем нейросеть фермы пшеницы (${data.length.toLocaleString()} сцен.)...`);
      let iterDone=0; const TOTAL=300;
      await this.net.trainAsync(data, {
        iterations: TOTAL, errorThresh: 0.008, logPeriod: 30,
        log: (s) => { iterDone+=30; prog(Math.min(22+Math.round((iterDone/TOTAL)*70),92), `⚡ Итерация ${iterDone}/${TOTAL}`); }
      });
      prog(95, '💾 Сохраняем веса...');
      try { fs.writeFileSync(WEIGHTS_PATH, JSON.stringify(this.net.toJSON()), "utf8"); } catch {}
      prog(100, '✅ Ферма-пшеница: обучение завершено!');
      this.ready = true;
      try { if (typeof this._onReady === 'function') this._onReady(); } catch {}
    } catch (e) {
      log.error("[FarmWheatBrain] Ошибка:", e.message);
      this.ready = true;
      try { if (typeof this._onReady === 'function') this._onReady(); } catch {}
    }
  }

  // Принять решение на основе состояния бота
  decide(features) {
    const ACTIONS = ["walk","harvest","plant","till","bonemeal","eat","idle"];
    if (this.net && this.ready) {
      try {
        const out = this.net.run(features);
        const scored = ACTIONS.map((a,i) => ({action:a, score:out[i]||0}));
        scored.sort((a,b) => b.score-a.score);
        return { action: scored[0].action, confidence: scored[0].score };
      } catch {}
    }
    return this._heuristic(features);
  }

  _heuristic(f) {
    const [dist, stage, seeds, hoe, bm, hunger, inv, farmland, mature, empty, food, daylight] = f;
    if (hunger < 0.3 && food) return { action: "eat", confidence: 0.85 };
    if (dist < 0.12 && stage > 0.88) return { action: "harvest", confidence: 0.90 };
    if (dist < 0.12 && seeds && empty > 0.3 && stage < 0.05) return { action: "plant", confidence: 0.88 };
    if (dist < 0.12 && bm && stage > 0.05 && stage < 0.85) return { action: "bonemeal", confidence: 0.80 };
    if (dist < 0.12 && hoe && farmland < 0.2) return { action: "till", confidence: 0.78 };
    return { action: "walk", confidence: 0.80 };
  }

  recordExperience(features, action, wasGood) {
    if (!this.net || !features) return;
    try {
      const ACTIONS = ["walk","harvest","plant","till","bonemeal","eat","idle"];
      const cur = this.net.run(features);
      const tgt = [...cur];
      const idx = ACTIONS.indexOf(action);
      if (idx >= 0) tgt[idx] = clamp(cur[idx] + (wasGood ? 0.08 : -0.05), 0, 1);
      this.net.train([{input:features,output:tgt}], {iterations:3,errorThresh:0.05});
      this._onlineTrainCount++;
    } catch {}
  }
}

module.exports = { FarmWheatBrain };
