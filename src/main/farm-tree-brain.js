/**
 * FarmTreeBrain v1 — нейросеть для фермы деревьев, 500 000 сценариев
 * 250к = ходьба/навигация | 250к = работа (рубка/посадка/костная мука)
 *
 * Архитектура: brain.js NeuralNetwork 12→20→14→7
 * Входной вектор (12 признаков):
 *   0  — dist (0-1, max=20)        1  — tree_grown (0-1, 1=выросло)
 *   2  — has_sapling (0/1)         3  — has_axe (0/1)
 *   4  — has_bonemeal (0/1)        5  — hunger (0-1)
 *   6  — inv_full (0-1)            7  — log_above (0-1, есть ствол выше)
 *   8  — sapling_nearby (0-1)      9  — empty_spot_nearby (0-1)
 *   10 — has_food (0/1)            11 — dirt_below (0/1)
 * Выходной вектор (7): walk chop plant_sapling bonemeal eat idle deposit
 */

const log = require("electron-log");
let brain = null;
try { brain = require("brain.js"); } catch { log.warn("[FarmTreeBrain] brain.js не установлен"); }
const path=require("path"), fs=require("fs");

function _getWeightsPath() {
  try { const {app}=require("electron"); return path.join(app.getPath("userData"),"farm-tree-weights.json"); }
  catch { return path.join(__dirname,"../../farm-tree-weights.json"); }
}
const WEIGHTS_PATH = _getWeightsPath();
const clamp=(v,lo,hi)=>Math.max(lo,Math.min(hi,v));
const rnd=(a,b)=>a+Math.random()*(b-a);
const pick=arr=>arr[Math.floor(Math.random()*arr.length)];

function buildSeedData() {
  const data=[];
  function lbl(inp,walk,chop,plant,bm,eat,idle,deposit) {
    data.push({input:inp.map(v=>clamp(v,0,1)),output:[walk,chop,plant,bm,eat,idle,deposit].map(v=>clamp(v,0,1))});
  }

  // ═══════════════════════════════════════════════════════════════════
  // КАТЕГОРИЯ 1: ХОДЬБА — 250 000 сценариев
  // ═══════════════════════════════════════════════════════════════════

  // 1a. Дерево выросло — идём рубить (70k)
  for(let i=0;i<70000;i++){
    const dist=rnd(0.20,1.0),grown=rnd(0.7,1.0),axe=pick([0,1]);
    lbl([dist,grown,pick([0,1]),axe,pick([0,1]),rnd(0.5,1),rnd(0,0.7),rnd(0.3,1.0),rnd(0,0.5),rnd(0,0.5),1,1],
      clamp(0.85+dist*0.12,0.80,0.98),0,0,0,0,0.04,0);
  }
  // 1b. Пустое место, есть саженец — идём сажать (50k)
  for(let i=0;i<50000;i++){
    const dist=rnd(0.15,0.90),sap=1,empty=rnd(0.3,1.0);
    lbl([dist,rnd(0,0.15),sap,pick([0,1]),pick([0,1]),rnd(0.5,1),rnd(0,0.65),0,rnd(0,0.3),empty,1,1],
      clamp(0.82+dist*0.14,0.77,0.97),0,0,0,0,0.05,0);
  }
  // 1c. Рубим ствол (есть блок дерева выше, dist немного) (40k)
  for(let i=0;i<40000;i++){
    const dist=rnd(0.05,0.30),logAbove=rnd(0.5,1.0),axe=1;
    lbl([dist,rnd(0.5,1),pick([0,1]),axe,pick([0,1]),rnd(0.5,1),rnd(0,0.7),logAbove,rnd(0,0.4),rnd(0,0.4),1,1],
      clamp(0.60+dist*0.80,0.45,0.90),clamp(0.25+(logAbove-0.5)*0.30,0.15,0.45),0,0,0,0.08,0);
  }
  // 1d. Инвентарь полон — идём к сундуку (40k)
  for(let i=0;i<40000;i++){
    const inv=rnd(0.8,1.0),dist=rnd(0.10,0.85);
    lbl([dist,rnd(0,1),rnd(0,1),rnd(0,1),rnd(0,1),rnd(0.4,1),inv,rnd(0,1),rnd(0,1),rnd(0,1),1,rnd(0,1)],
      clamp(0.75+inv*0.20,0.70,0.97),0,0,0,0,0.06,clamp(inv*0.25,0.10,0.35));
  }
  // 1e. Общая навигация (50k)
  for(let i=0;i<50000;i++){
    const dist=rnd(0.05,1.0),hunger=rnd(0.4,1.0);
    lbl([dist,rnd(0,1),pick([0,1]),pick([0,1]),pick([0,1]),hunger,rnd(0,0.8),rnd(0,1),rnd(0,1),rnd(0,1),1,rnd(0,1)],
      clamp(0.70+dist*0.25,0.55,0.97),0,0,0,0,0.08,0);
  }

  // ═══════════════════════════════════════════════════════════════════
  // КАТЕГОРИЯ 2: РАБОТА — 250 000 сценариев
  // ═══════════════════════════════════════════════════════════════════

  // 2a. Рубка дерева (близко, выросло, есть топор) (80k)
  for(let i=0;i<80000;i++){
    const dist=rnd(0,0.12),grown=rnd(0.80,1.0),axe=1,logAbove=rnd(0.5,1.0);
    lbl([dist,grown,pick([0,1]),axe,pick([0,1]),rnd(0.5,1),rnd(0,0.70),logAbove,rnd(0,0.4),rnd(0,0.3),1,1],
      0,clamp(0.87+grown*0.11,0.82,0.98),0,0,0,0.04,0);
  }
  // 2b. Посадка саженца (близко, пустое место, есть саженец) (70k)
  for(let i=0;i<70000;i++){
    const dist=rnd(0,0.10),sap=1,grown=rnd(0,0.08),empty=rnd(0.4,1.0),dirt=1;
    lbl([dist,grown,sap,pick([0,1]),pick([0,1]),rnd(0.5,1),rnd(0,0.70),0,rnd(0,0.2),empty,1,dirt],
      0,0,clamp(0.87+(1-dist)*0.10,0.82,0.97),0,0,0.04,0);
  }
  // 2c. Костная мука (есть bm, саженец посажен, не вырос) (40k)
  for(let i=0;i<40000;i++){
    const dist=rnd(0,0.10),bm=1,grown=rnd(0.05,0.60),sap=rnd(0.3,0.9);
    lbl([dist,grown,pick([0,1]),pick([0,1]),bm,rnd(0.5,1),rnd(0,0.70),0,sap,rnd(0,0.3),1,1],
      0,0,0,clamp(0.82+(0.60-grown)*0.20,0.72,0.97),0,0.05,0);
  }
  // 2d. Рубка ствола выше (прыжки при необходимости) (25k)
  for(let i=0;i<25000;i++){
    const logAbove=rnd(0.7,1.0),axe=1,dist=rnd(0,0.10);
    lbl([dist,1,pick([0,1]),axe,pick([0,1]),rnd(0.5,1),rnd(0,0.65),logAbove,rnd(0,0.4),rnd(0,0.3),1,1],
      0,clamp(0.90+logAbove*0.08,0.85,0.98),0,0,0,0.03,0);
  }
  // 2e. Еда (голодный, далеко от деревьев) (20k)
  for(let i=0;i<20000;i++){
    const hunger=rnd(0,0.35),dist=rnd(0.2,1.0),food=1;
    lbl([dist,rnd(0,1),rnd(0,1),rnd(0,1),rnd(0,1),hunger,rnd(0,0.7),rnd(0,1),rnd(0,1),rnd(0,1),food,rnd(0,1)],
      0,0,0,0,clamp(0.80+(0.35-hunger)*1.8,0.65,0.97),0,0);
  }
  // 2f. Сдача в сундук (близко, инвентарь полон) (15k)
  for(let i=0;i<15000;i++){
    const inv=rnd(0.80,1.0),dist=rnd(0,0.12);
    lbl([dist,rnd(0,1),rnd(0,1),rnd(0,1),rnd(0,1),rnd(0.4,1),inv,rnd(0,1),rnd(0,1),rnd(0,1),1,rnd(0,1)],
      0,0,0,0,0,0.05,clamp(0.85+inv*0.13,0.80,0.97));
  }

  return data;
}

class FarmTreeBrain {
  constructor() {
    this.net = brain ? new brain.NeuralNetwork({hiddenLayers:[20,14],activation:'sigmoid'}) : null;
    this.ready=false; this._onProgress=null; this._onReady=null; this._onlineTrainCount=0;
    this._init();
  }
  _init() {
    if(!this.net){this.ready=true;return;}
    try {
      if(fs.existsSync(WEIGHTS_PATH)){
        const w=JSON.parse(fs.readFileSync(WEIGHTS_PATH,"utf8"));
        this.net.fromJSON(w); log.info("[FarmTreeBrain] ✅ Веса загружены"); this.ready=true; return;
      }
    } catch(e){log.warn("[FarmTreeBrain] Веса не загружены:",e.message);}
    this.ready=false; setImmediate(()=>this._trainAsync());
  }
  async _trainAsync() {
    const prog=(pct,msg)=>{log.info(`[FarmTreeBrain] ${pct}% — ${msg}`);try{if(typeof this._onProgress==='function')this._onProgress(pct,msg);}catch{}};
    const yieldLoop=()=>new Promise(r=>setImmediate(r));
    try {
      prog(3,'📚 Генерируем 500 000 сценариев (ходьба+ферма деревьев)...');
      await yieldLoop();
      const all=buildSeedData();
      prog(18,`✂️ Выбираем 200 000 из ${all.length.toLocaleString()}...`);
      for(let i=all.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[all[i],all[j]]=[all[j],all[i]];}
      const data=all.slice(0,Math.min(200000,all.length));
      prog(22,`🌲 Обучаем нейросеть фермы деревьев (${data.length.toLocaleString()} сцен.)...`);
      let iterDone=0;const TOTAL=600;
      await this.net.trainAsync(data,{
        iterations:TOTAL,errorThresh:0.005,logPeriod:60,
        log:(s)=>{iterDone+=60;prog(Math.min(22+Math.round((iterDone/TOTAL)*70),92),`⚡ Итерация ${iterDone}/${TOTAL}`);}
      });
      prog(95,'💾 Сохраняем веса...');
      try{fs.writeFileSync(WEIGHTS_PATH,JSON.stringify(this.net.toJSON()),"utf8");}catch{}
      prog(100,'✅ Ферма-дерево: обучение завершено!');
      this.ready=true; try{if(typeof this._onReady==='function')this._onReady();}catch{}
    } catch(e) {
      log.error("[FarmTreeBrain] Ошибка:",e.message); this.ready=true;
      try{if(typeof this._onReady==='function')this._onReady();}catch{}
    }
  }
  decide(features) {
    const ACTIONS=["walk","chop","plant_sapling","bonemeal","eat","idle","deposit"];
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
    const[dist,grown,sap,axe,bm,hunger,inv,logAbove,sapNear,emptyNear,food,dirt]=f;
    if(hunger<0.3&&food) return{action:"eat",confidence:0.85};
    if(inv>0.85) return{action:"deposit",confidence:0.82};
    if(dist<0.12&&grown>0.8&&axe) return{action:"chop",confidence:0.90};
    if(dist<0.12&&sap&&emptyNear>0.3) return{action:"plant_sapling",confidence:0.88};
    if(dist<0.12&&bm&&grown>0.05&&grown<0.65) return{action:"bonemeal",confidence:0.80};
    return{action:"walk",confidence:0.80};
  }
  recordExperience(features,action,wasGood) {
    if(!this.net||!features)return;
    try{
      const ACTIONS=["walk","chop","plant_sapling","bonemeal","eat","idle","deposit"];
      const cur=this.net.run(features);const tgt=[...cur];
      const idx=ACTIONS.indexOf(action);
      if(idx>=0)tgt[idx]=clamp(cur[idx]+(wasGood?0.08:-0.05),0,1);
      this.net.train([{input:features,output:tgt}],{iterations:3,errorThresh:0.05});
      this._onlineTrainCount++;
    }catch{}
  }
}
module.exports={FarmTreeBrain};
