/**
 * MinerBrain v1 — нейросеть для шахтёра, 500 000 сценариев
 * 250к = ходьба/навигация в шахте | 250к = работа (добыча/факелы/выход)
 *
 * Архитектура: brain.js NeuralNetwork 12→20→14→7
 * Входной вектор (12 признаков):
 *   0  — dist (0-1, max=20)        1  — ore_visible (0-1, видна руда рядом)
 *   2  — has_pickaxe (0/1)         3  — has_torch (0/1)
 *   4  — has_shovel (0/1)          5  — hunger (0-1)
 *   6  — inv_full (0-1)            7  — depth (0-1, 1=глубоко под землей)
 *   8  — light_level (0-1)         9  — danger (0-1, враги рядом)
 *   10 — has_food (0/1)            11 — tunnel_clear (0/1)
 * Выходной вектор (7): walk mine place_torch eat retreat deposit idle
 */

const log = require("electron-log");
let brain = null;
try { brain = require("brain.js"); } catch { log.warn("[MinerBrain] brain.js не установлен"); }
const path=require("path"),fs=require("fs");

function _getWeightsPath() {
  try{const{app}=require("electron");return path.join(app.getPath("userData"),"miner-weights.json");}
  catch{return path.join(__dirname,"../../miner-weights.json");}
}
const WEIGHTS_PATH=_getWeightsPath();
const clamp=(v,lo,hi)=>Math.max(lo,Math.min(hi,v));
const rnd=(a,b)=>a+Math.random()*(b-a);
const pick=arr=>arr[Math.floor(Math.random()*arr.length)];

// ИСПРАВЛЕНИЕ: buildSeedData теперь async — уступает Event Loop между категориями.
// Устраняет зависание / "Не отвечает" при первом запуске Шахтёра (нет кэша весов).
async function buildSeedData() {
  const yieldLoop = () => new Promise(r => setImmediate(r));
  const data=[];
  function lbl(inp,walk,mine,torch,eat,retreat,deposit,idle) {
    data.push({input:inp.map(v=>clamp(v,0,1)),output:[walk,mine,torch,eat,retreat,deposit,idle].map(v=>clamp(v,0,1))});
  }

  // ════════════════════════════════════════════════════════════════════
  // КАТЕГОРИЯ 1: ХОДЬБА / НАВИГАЦИЯ — 250 000 сценариев
  // ════════════════════════════════════════════════════════════════════

  // 1a. Идём к обнаруженной руде (dist 0.15-1.0, ore_visible) (70k)
  await yieldLoop();
  for(let i=0;i<1400;i++){
    const dist=rnd(0.15,1.0),ore=rnd(0.5,1.0),pick_=1;
    const danger=rnd(0,0.3),light=rnd(0.3,1.0);
    lbl([dist,ore,pick_,pick([0,1]),pick([0,1]),rnd(0.5,1),rnd(0,0.7),rnd(0,1),light,danger,1,pick([0,1])],
      clamp(0.85+dist*0.12,0.80,0.98),0,0,0,0,0,0.04);
  }
  // 1b. Прокладываем тоннель (нет руды, идём вглубь) (55k)
  await yieldLoop();
  for(let i=0;i<1100;i++){
    const dist=rnd(0.10,0.80),depth=rnd(0.3,1.0),pick_=1,light=rnd(0.4,1.0);
    lbl([dist,rnd(0,0.2),pick_,pick([0,1]),pick([0,1]),rnd(0.5,1),rnd(0,0.65),depth,light,rnd(0,0.2),1,pick([0,1])],
      clamp(0.82+depth*0.14,0.75,0.97),0,0,0,0,0,0.06);
  }
  // 1c. Возврат с полным инвентарём (45k)
  await yieldLoop();
  for(let i=0;i<900;i++){
    const inv=rnd(0.78,1.0),dist=rnd(0.15,0.90);
    lbl([dist,rnd(0,0.5),rnd(0,1),rnd(0,1),rnd(0,1),rnd(0.4,1),inv,rnd(0,1),rnd(0.2,1),rnd(0,0.4),1,rnd(0,1)],
      clamp(0.78+inv*0.18,0.72,0.97),0,0,0,0,clamp(inv*0.22,0.12,0.38),0.05);
  }
  // 1d. Уклонение от опасности (враги, убегаем) (30k)
  await yieldLoop();
  for(let i=0;i<600;i++){
    const danger=rnd(0.5,1.0),hp=rnd(0.1,0.7),dist=rnd(0,0.5);
    lbl([dist,rnd(0,0.5),rnd(0,1),rnd(0,1),rnd(0,1),rnd(0.3,0.8),rnd(0,0.8),rnd(0,1),rnd(0,0.5),danger,1,rnd(0,1)],
      0,0,0,0,clamp(0.75+danger*0.22,0.65,0.97),0,0.05);
  }
  // 1e. Общая навигация в шахте (50k)
  await yieldLoop();
  for(let i=0;i<1000;i++){
    const dist=rnd(0.05,1.0),pick_=pick([0,1]);
    lbl([dist,rnd(0,1),pick_,pick([0,1]),pick([0,1]),rnd(0.4,1),rnd(0,0.8),rnd(0,1),rnd(0,1),rnd(0,0.5),1,rnd(0,1)],
      clamp(0.68+dist*0.28,0.50,0.97),0,0,0,0,0,0.08);
  }

  // ════════════════════════════════════════════════════════════════════
  // КАТЕГОРИЯ 2: ДОБЫЧА / РАБОТА — 250 000 сценариев
  // ════════════════════════════════════════════════════════════════════

  // 2a. Добыча руды (dist близко, ore_visible, есть кирка) (90k)
  await yieldLoop();
  for(let i=0;i<1800;i++){
    const dist=rnd(0,0.12),ore=rnd(0.7,1.0),pick_=1,danger=rnd(0,0.35),light=rnd(0.2,1.0);
    lbl([dist,ore,pick_,pick([0,1]),pick([0,1]),rnd(0.5,1),rnd(0,0.75),rnd(0,1),light,danger,1,pick([0,1])],
      0,clamp(0.88+ore*0.10,0.82,0.98),0,0,0,0,0.03);
  }
  // 2b. Добыча камня (нет руды, прокопка тоннеля) (50k)
  await yieldLoop();
  for(let i=0;i<1000;i++){
    const dist=rnd(0,0.12),ore=rnd(0,0.25),pick_=1,light=rnd(0.3,1.0);
    lbl([dist,ore,pick_,pick([0,1]),pick([0,1]),rnd(0.5,1),rnd(0,0.70),rnd(0.3,1.0),light,rnd(0,0.2),1,1],
      0,clamp(0.78+(0.25-ore)*0.50,0.65,0.95),0,0,0,0,0.06);
  }
  // 2c. Установка факелов (темно, есть факел, инв не полный) (35k)
  await yieldLoop();
  for(let i=0;i<700;i++){
    const light=rnd(0,0.35),torch=1,dist=rnd(0,0.10),danger=rnd(0,0.4);
    lbl([dist,rnd(0,0.5),rnd(0,1),torch,rnd(0,1),rnd(0.5,1),rnd(0,0.70),rnd(0.2,1.0),light,danger,1,1],
      0,0,clamp(0.82+(0.35-light)*1.5,0.68,0.97),0,0,0,0.05);
  }
  // 2d. Еда (голодный, без опасности) (35k)
  await yieldLoop();
  for(let i=0;i<700;i++){
    const hunger=rnd(0,0.38),danger=rnd(0,0.3),food=1;
    lbl([rnd(0,0.5),rnd(0,0.5),rnd(0,1),rnd(0,1),rnd(0,1),hunger,rnd(0,0.7),rnd(0,1),rnd(0.3,1),danger,food,rnd(0,1)],
      0,0,0,clamp(0.82+(0.38-hunger)*1.8,0.68,0.97),0,0,0);
  }
  // 2e. Отступление при опасности (враги рядом, hp низкий) (25k)
  await yieldLoop();
  for(let i=0;i<500;i++){
    const danger=rnd(0.55,1.0),hp=rnd(0.05,0.45);
    lbl([rnd(0,0.3),rnd(0,0.5),rnd(0,1),rnd(0,1),rnd(0,1),rnd(0.2,0.6),rnd(0,0.8),rnd(0,1),rnd(0,0.5),danger,1,rnd(0,1)],
      0,0,0,0,clamp(0.78+danger*0.20,0.65,0.97),0,0.04);
  }
  // 2f. Сдача ресурсов (инвентарь почти полон) (15k)
  await yieldLoop();
  for(let i=0;i<300;i++){
    const inv=rnd(0.82,1.0),dist=rnd(0,0.10);
    lbl([dist,rnd(0,0.4),rnd(0,1),rnd(0,1),rnd(0,1),rnd(0.4,1),inv,rnd(0,1),rnd(0.2,1),rnd(0,0.3),1,rnd(0,1)],
      0,0,0,0,0,clamp(0.85+inv*0.13,0.80,0.97),0.04);
  }

  return data;
}

class MinerBrain {
  constructor() {
    this.net=brain?new brain.NeuralNetwork({hiddenLayers:[20,14],activation:'sigmoid'}):null;
    this.ready=false;this._onProgress=null;this._onReady=null;this._onlineTrainCount=0;
    this._init();
  }
  _init() {
    if(!this.net){this.ready=true;return;}
    try{
      if(fs.existsSync(WEIGHTS_PATH)){
        const w=JSON.parse(fs.readFileSync(WEIGHTS_PATH,"utf8"));
        this.net.fromJSON(w);log.info("[MinerBrain] ✅ Веса загружены");this.ready=true;return;
      }
    }catch(e){log.warn("[MinerBrain] Веса не загружены:",e.message);}
    this.ready=false;setImmediate(()=>this._trainAsync());
  }
  async _trainAsync() {
    const prog=(pct,msg)=>{log.info(`[MinerBrain] ${pct}% — ${msg}`);try{if(typeof this._onProgress==='function')this._onProgress(pct,msg);}catch{}};
    const yieldLoop=()=>new Promise(r=>setImmediate(r));
    try{
      prog(3,'📚 Генерируем ~10 000 сценариев (шахтёр, ускоренный режим)...');
      // ИСПРАВЛЕНИЕ: теперь async — не блокирует Event Loop
      const all=await buildSeedData();
      prog(18,`✅ Сгенерировано ${all.length.toLocaleString()} сценариев — начинаем обучение...`);
      // FIX: dataset уменьшен ~50x (10k vs 500k) → shuffle 10k = 10мс, нет белого экрана
      for(let i=all.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[all[i],all[j]]=[all[j],all[i]];}
      const data=all;
      prog(22,`⛏ Обучаем нейросеть шахтёра (${data.length.toLocaleString()} сцен.)...`);
      let iterDone=0;const TOTAL=300;
      // FIX: logPeriod:10 → Event Loop уступается каждые 10 итераций
      // С 10k сцен: 10 × 10k × ~600ops = 60M → ~60мс/батч → НЕТ белого экрана
      await this.net.trainAsync(data,{
        iterations:TOTAL,errorThresh:0.008,logPeriod:10,
        log:(s)=>{iterDone+=10;prog(Math.min(22+Math.round((iterDone/TOTAL)*70),92),`⚡ Итерация ${iterDone}/${TOTAL}`);}
      });
      prog(95,'💾 Сохраняем веса...');
      try{fs.writeFileSync(WEIGHTS_PATH,JSON.stringify(this.net.toJSON()),"utf8");}catch{}
      prog(100,'✅ Шахтёр: обучение завершено!');
      this.ready=true;try{if(typeof this._onReady==='function')this._onReady();}catch{}
    }catch(e){
      log.error("[MinerBrain] Ошибка:",e.message);this.ready=true;
      try{if(typeof this._onReady==='function')this._onReady();}catch{}
    }
  }
  decide(features) {
    const ACTIONS=["walk","mine","place_torch","eat","retreat","deposit","idle"];
    if(this.net&&this.ready){
      try{
        const out=this.net.run(features);
        const scored=ACTIONS.map((a,i)=>({action:a,score:out[i]||0}));
        scored.sort((a,b)=>b.score-a.score);
        return{action:scored[0].action,confidence:scored[0].score};
      }catch{}
    }
    return this._heuristic(features);
  }
  _heuristic(f) {
    const[dist,ore,pickaxe,torch,shovel,hunger,inv,depth,light,danger,food,clear]=f;
    if(danger>0.55) return{action:"retreat",confidence:0.88};
    if(hunger<0.3&&food) return{action:"eat",confidence:0.85};
    if(inv>0.85) return{action:"deposit",confidence:0.82};
    if(dist<0.12&&ore>0.6&&pickaxe) return{action:"mine",confidence:0.90};
    if(dist<0.12&&light<0.25&&torch) return{action:"place_torch",confidence:0.82};
    if(dist<0.12&&pickaxe) return{action:"mine",confidence:0.75};
    return{action:"walk",confidence:0.80};
  }
  recordExperience(features,action,wasGood) {
    if(!this.net||!features)return;
    try{
      const ACTIONS=["walk","mine","place_torch","eat","retreat","deposit","idle"];
      const cur=this.net.run(features);const tgt=[...cur];
      const idx=ACTIONS.indexOf(action);
      if(idx>=0)tgt[idx]=clamp(cur[idx]+(wasGood?0.08:-0.05),0,1);
      this.net.train([{input:features,output:tgt}],{iterations:3,errorThresh:0.05});
      this._onlineTrainCount++;
    }catch{}
  }
}
module.exports={MinerBrain};
