/**
 * AnarchyBrain v1 — нейросеть для режима Анархии, 1 600 000 сценариев
 *
 * 300к = ходьба/навигация
 * 13 поведений × 100к = 1 300к сценариев поведения
 *
 * Поведения: mine_wood | mine_stone | hunt_food | farm_wheat | farm_tree |
 *             farm_other | go_home | explore | craft | combat | build |
 *             excavate | fish
 *
 * Архитектура: brain.js NeuralNetwork 12→24→18→14
 * Входной вектор (12 признаков):
 *   0  — dist (0-1, max=30)          1  — hunger (0-1)
 *   2  — inv_full (0-1)              3  — has_tool (0/1)
 *   4  — has_food (0/1)              5  — has_seeds (0/1)
 *   6  — enemies_nearby (0-1)        7  — time_day (0-1, 1=день)
 *   8  — near_chest (0/1)            9  — near_nature (0-1, деревья/трава)
 *  10  — near_crops (0-1)           11  — hp (0-1)
 * Выходной вектор (14 действий):
 *   walk mine_wood mine_stone hunt_food farm_wheat farm_tree farm_other
 *   go_home explore craft combat build excavate fish
 */

const log = require("electron-log");
let brain = null;
try { brain = require("brain.js"); } catch { log.warn("[AnarchyBrain] brain.js не установлен"); }
const path=require("path"),fs=require("fs");

function _getWeightsPath() {
  try{const{app}=require("electron");return path.join(app.getPath("userData"),"anarchy-weights.json");}
  catch{return path.join(__dirname,"../../anarchy-weights.json");}
}
const WEIGHTS_PATH=_getWeightsPath();
const clamp=(v,lo,hi)=>Math.max(lo,Math.min(hi,v));
const rnd=(a,b)=>a+Math.random()*(b-a);
const pick=arr=>arr[Math.floor(Math.random()*arr.length)];

// Нулевой выходной вектор (14 позиций)
function zero(overrides={}) {
  const o=[0,0,0,0,0,0,0,0,0,0,0,0,0,0]; // 14 zeros
  Object.entries(overrides).forEach(([k,v])=>{ o[k]=clamp(v,0,1); });
  return o;
}

// ИСПРАВЛЕНИЕ: buildSeedData теперь async — уступает Event Loop между каждой
// категорией, чтобы IPC и другие задачи обрабатывались во время генерации.
// Это устраняет белый экран / "Не отвечает" при первом запуске Анархии.
async function buildSeedData() {
  const yieldLoop = () => new Promise(r => setImmediate(r));
  const data=[];
  function lbl(inp,...out){
    data.push({input:inp.map(v=>clamp(v,0,1)),output:out.map(v=>clamp(v,0,1))});
  }

  // ═══════════════════════════════════════════════════════════════════
  // КАТЕГОРИЯ 1: ХОДЬБА / НАВИГАЦИЯ — 300 000 сценариев
  // ═══════════════════════════════════════════════════════════════════

  // 1a. Идём к видимой цели (dist 0.2-1.0), всё нормально (80k)
  await yieldLoop();
  for(let i=0;i<800;i++){
    const dist=rnd(0.20,1.0),hp=rnd(0.4,1.0),hunger=rnd(0.4,1.0);
    const tool=pick([0,1]),food=1,enemy=rnd(0,0.25);
    lbl([dist,hunger,rnd(0,0.7),tool,food,pick([0,1]),enemy,rnd(0.3,1),pick([0,1]),rnd(0,0.8),rnd(0,0.5),hp],
      clamp(0.87+dist*0.11,0.82,0.98),0,0,0,0,0,0,0,0,0,0,0,0,0);
  }
  // 1b. Идём домой (инвентарь полон) (50k)
  await yieldLoop();
  for(let i=0;i<500;i++){
    const inv=rnd(0.78,1.0),dist=rnd(0.15,0.90),hp=rnd(0.3,1.0);
    lbl([dist,rnd(0.4,1),inv,pick([0,1]),pick([0,1]),pick([0,1]),rnd(0,0.3),rnd(0,1),pick([0,1]),rnd(0,1),rnd(0,1),hp],
      clamp(0.80+inv*0.15,0.72,0.97),0,0,0,0,0,0,clamp(inv*0.32,0.18,0.45),0,0,0,0,0,0);
  }
  // 1c. Убегаем от врагов (50k)
  await yieldLoop();
  for(let i=0;i<500;i++){
    const enemy=rnd(0.5,1.0),hp=rnd(0.05,0.60),dist=rnd(0.05,0.50);
    const hunger=rnd(0.2,0.8);
    lbl([dist,hunger,rnd(0,0.8),pick([0,1]),pick([0,1]),pick([0,1]),enemy,rnd(0,1),pick([0,1]),rnd(0,1),rnd(0,1),hp],
      clamp(0.55+enemy*0.40,0.45,0.90),0,0,0,0,0,0,0,0,0,clamp(enemy*(0.8-hp)*0.8,0,0.65),0,0,0);
  }
  // 1d. Исследование (нет особых целей, ночью/рано) (40k)
  await yieldLoop();
  for(let i=0;i<400;i++){
    const dist=rnd(0.10,0.80),time=rnd(0,0.5),hp=rnd(0.5,1.0),hunger=rnd(0.5,1.0);
    lbl([dist,hunger,rnd(0,0.5),pick([0,1]),pick([0,1]),pick([0,1]),rnd(0,0.2),time,pick([0,1]),rnd(0,0.5),rnd(0,0.3),hp],
      clamp(0.72+dist*0.22,0.58,0.95),0,0,0,0,0,0,0,clamp(0.18+(0.5-time)*0.25,0.10,0.42),0,0,0,0,0);
  }
  // 1e. Любая навигация — широкое покрытие (80k)
  await yieldLoop();
  for(let i=0;i<800;i++){
    const dist=rnd(0.05,1.0),enemy=rnd(0,0.4),hp=rnd(0.3,1.0),hunger=rnd(0.3,1.0);
    lbl([dist,hunger,rnd(0,0.9),pick([0,1]),pick([0,1]),pick([0,1]),enemy,rnd(0,1),pick([0,1]),rnd(0,1),rnd(0,1),hp],
      clamp(0.65+dist*0.30,0.48,0.97),0,0,0,0,0,0,0,0,0,0,0,0,0);
  }

  // ═══════════════════════════════════════════════════════════════════
  // ПОВЕДЕНИЕ 2: РУБКА ДЕРЕВА — 100 000 сценариев
  // ═══════════════════════════════════════════════════════════════════
  // 2a. Много деревьев рядом, есть топор, инв не полон (50k)
  await yieldLoop();
  for(let i=0;i<500;i++){
    const nature=rnd(0.5,1.0),tool=1,inv=rnd(0,0.7),hp=rnd(0.4,1.0);
    const hunger=rnd(0.5,1.0),enemy=rnd(0,0.25);
    lbl([rnd(0,0.20),hunger,inv,tool,pick([0,1]),pick([0,1]),enemy,rnd(0.3,1),pick([0,1]),nature,rnd(0,0.4),hp],
      0,clamp(0.85+nature*0.13,0.78,0.97),0,0,0,0,0,0,0,0,0,0,0,0);
  }
  // 2b. Нет инструментов — нужна рубка, но идём за инструментами (30k)
  await yieldLoop();
  for(let i=0;i<300;i++){
    const nature=rnd(0.3,0.7),tool=0,inv=rnd(0,0.6);
    lbl([rnd(0.1,0.5),rnd(0.5,1),inv,tool,pick([0,1]),pick([0,1]),rnd(0,0.2),rnd(0.3,1),pick([0,1]),nature,rnd(0,0.3),rnd(0.4,1)],
      clamp(0.45+nature*0.25,0.35,0.70),clamp(0.30+(1-tool)*0.20,0.22,0.55),0,0,0,0,0,0,0,0,0,0,0,0);
  }
  // 2c. Голоден, продолжаем рубку но делаем перерывы (20k)
  await yieldLoop();
  for(let i=0;i<200;i++){
    const hunger=rnd(0,0.45),food=1,nature=rnd(0.4,0.8),tool=1;
    lbl([rnd(0,0.20),hunger,rnd(0,0.6),tool,food,pick([0,1]),rnd(0,0.2),rnd(0.4,1),pick([0,1]),nature,rnd(0,0.3),rnd(0.4,1)],
      0,clamp(0.60+nature*0.20,0.50,0.82),0,0,0,0,0,0,0,0,0,0,0,0);
  }

  // ═══════════════════════════════════════════════════════════════════
  // ПОВЕДЕНИЕ 3: ДОБЫЧА КАМНЯ/РУДЫ — 100 000 сценариев
  // ═══════════════════════════════════════════════════════════════════
  await yieldLoop();
  for(let i=0;i<600;i++){
    const tool=1,inv=rnd(0,0.72),hp=rnd(0.4,1.0),enemy=rnd(0,0.3);
    const hunger=rnd(0.4,1.0),time=rnd(0,1);
    lbl([rnd(0,0.18),hunger,inv,tool,pick([0,1]),pick([0,1]),enemy,time,pick([0,1]),rnd(0,0.5),rnd(0,0.3),hp],
      0,0,clamp(0.82+tool*0.14,0.78,0.97),0,0,0,0,0,0,0,0,0,0,0);
  }
  await yieldLoop();
  for(let i=0;i<400;i++){
    const tool=pick([0,1]),inv=rnd(0,0.80),hunger=rnd(0.4,1.0);
    lbl([rnd(0,0.25),hunger,inv,tool,pick([0,1]),pick([0,1]),rnd(0,0.25),rnd(0,1),pick([0,1]),rnd(0,0.5),rnd(0,0.3),rnd(0.3,1)],
      0,0,clamp(0.65+(tool?0.25:0),0.35,0.93),0,0,0,0,0,0,0,0,0,0,0);
  }

  // ═══════════════════════════════════════════════════════════════════
  // ПОВЕДЕНИЕ 4: ОХОТА / ЕДА — 100 000 сценариев
  // ═══════════════════════════════════════════════════════════════════
  await yieldLoop();
  for(let i=0;i<550;i++){
    const hunger=rnd(0,0.48),food=pick([0,1]),hp=rnd(0.3,1.0);
    const tool=1,enemy=rnd(0,0.3),nature=rnd(0.2,0.8);
    lbl([rnd(0,0.30),hunger,rnd(0,0.7),tool,food,pick([0,1]),enemy,rnd(0.3,1),pick([0,1]),nature,rnd(0,0.4),hp],
      0,0,0,clamp(0.80+(0.48-hunger)*1.5,0.65,0.97),0,0,0,0,0,0,0,0,0,0);
  }
  await yieldLoop();
  for(let i=0;i<450;i++){
    const hunger=rnd(0.48,0.72),food=0,hp=rnd(0.3,1.0);
    lbl([rnd(0,0.40),hunger,rnd(0,0.7),pick([0,1]),food,pick([0,1]),rnd(0,0.25),rnd(0.3,1),pick([0,1]),rnd(0.2,0.7),rnd(0,0.4),hp],
      0,0,0,clamp(0.55+(0.72-hunger)*1.2,0.40,0.85),0,0,0,0,0,0,0,0,0,0);
  }

  // ═══════════════════════════════════════════════════════════════════
  // ПОВЕДЕНИЕ 5: ФЕРМА ПШЕНИЦЫ — 100 000 сценариев
  // ═══════════════════════════════════════════════════════════════════
  await yieldLoop();
  for(let i=0;i<600;i++){
    const crops=rnd(0.4,1.0),seeds=1,inv=rnd(0,0.7),hunger=rnd(0.4,1.0);
    lbl([rnd(0,0.20),hunger,inv,pick([0,1]),pick([0,1]),seeds,rnd(0,0.2),rnd(0.3,1),pick([0,1]),rnd(0.2,0.7),crops,rnd(0.4,1)],
      0,0,0,0,clamp(0.83+crops*0.14,0.78,0.97),0,0,0,0,0,0,0,0,0);
  }
  await yieldLoop();
  for(let i=0;i<400;i++){
    const crops=rnd(0.2,0.7),seeds=pick([0,1]),inv=rnd(0,0.75);
    lbl([rnd(0,0.35),rnd(0.4,1),inv,pick([0,1]),pick([0,1]),seeds,rnd(0,0.2),rnd(0.2,1),pick([0,1]),rnd(0,0.5),crops,rnd(0.4,1)],
      0,0,0,0,clamp(0.60+(crops+Number(!!seeds))*0.18,0.40,0.90),0,0,0,0,0,0,0,0,0);
  }

  // ═══════════════════════════════════════════════════════════════════
  // ПОВЕДЕНИЕ 6: ФЕРМА ДЕРЕВЬЕВ — 100 000 сценариев
  // ═══════════════════════════════════════════════════════════════════
  await yieldLoop();
  for(let i=0;i<600;i++){
    const nature=rnd(0.3,0.8),tool=1,seeds=0,inv=rnd(0,0.72);
    lbl([rnd(0,0.18),rnd(0.5,1),inv,tool,pick([0,1]),seeds,rnd(0,0.25),rnd(0.3,1),pick([0,1]),nature,rnd(0,0.4),rnd(0.4,1)],
      0,0,0,0,0,clamp(0.82+nature*0.15,0.75,0.97),0,0,0,0,0,0,0,0);
  }
  await yieldLoop();
  for(let i=0;i<400;i++){
    const nature=rnd(0.2,0.65),tool=pick([0,1]),hunger=rnd(0.4,1.0);
    lbl([rnd(0,0.30),hunger,rnd(0,0.75),tool,pick([0,1]),pick([0,1]),rnd(0,0.2),rnd(0,1),pick([0,1]),nature,rnd(0,0.5),rnd(0.3,1)],
      0,0,0,0,0,clamp(0.60+(nature*(tool?1.3:0.5))*0.22,0.30,0.90),0,0,0,0,0,0,0,0);
  }

  // ═══════════════════════════════════════════════════════════════════
  // ПОВЕДЕНИЕ 7: ФЕРМА ДРУГОГО (морковь/картофель/свёкла) — 100 000
  // ═══════════════════════════════════════════════════════════════════
  await yieldLoop();
  for(let i=0;i<1000;i++){
    const crops=rnd(0.2,0.9),seeds=pick([0,1]),inv=rnd(0,0.75),hunger=rnd(0.3,1.0);
    lbl([rnd(0,0.25),hunger,inv,pick([0,1]),pick([0,1]),seeds,rnd(0,0.2),rnd(0.2,1),pick([0,1]),rnd(0,0.6),crops,rnd(0.3,1)],
      0,0,0,0,0,0,clamp(0.75+(crops+Number(!!seeds))*0.12,0.55,0.93),0,0,0,0,0,0,0);
  }

  // ═══════════════════════════════════════════════════════════════════
  // ПОВЕДЕНИЕ 8: ИДТИ ДОМОЙ / СДАТЬ РЕСУРСЫ — 100 000 сценариев
  // ═══════════════════════════════════════════════════════════════════
  await yieldLoop();
  for(let i=0;i<600;i++){
    const inv=rnd(0.75,1.0),chest=pick([0,1]),dist=rnd(0.05,0.70);
    lbl([dist,rnd(0.3,1),inv,pick([0,1]),pick([0,1]),pick([0,1]),rnd(0,0.3),rnd(0,1),chest,rnd(0,0.7),rnd(0,0.5),rnd(0.3,1)],
      0,0,0,0,0,0,0,clamp(0.83+inv*0.14,0.78,0.97),0,0,0,0,0,0);
  }
  await yieldLoop();
  for(let i=0;i<400;i++){
    const inv=rnd(0.55,0.80),hunger=rnd(0,0.40),dist=rnd(0,0.5);
    lbl([dist,hunger,inv,pick([0,1]),pick([0,1]),pick([0,1]),rnd(0,0.25),rnd(0,1),pick([0,1]),rnd(0,0.7),rnd(0,0.5),rnd(0.3,1)],
      0,0,0,0,0,0,0,clamp(0.55+(inv+0.6-hunger)*0.22,0.38,0.85),0,0,0,0,0,0);
  }

  // ═══════════════════════════════════════════════════════════════════
  // ПОВЕДЕНИЕ 9: ИССЛЕДОВАНИЕ / RTP — 100 000 сценариев
  // ═══════════════════════════════════════════════════════════════════
  await yieldLoop();
  for(let i=0;i<600;i++){
    const time=rnd(0.3,1.0),inv=rnd(0,0.55),hunger=rnd(0.5,1.0),hp=rnd(0.5,1.0);
    lbl([rnd(0.2,0.9),hunger,inv,pick([0,1]),pick([0,1]),pick([0,1]),rnd(0,0.2),time,pick([0,1]),rnd(0,0.5),rnd(0,0.4),hp],
      0,0,0,0,0,0,0,0,clamp(0.75+time*0.20,0.65,0.95),0,0,0,0,0);
  }
  await yieldLoop();
  for(let i=0;i<400;i++){
    const inv=rnd(0,0.65),time=rnd(0,0.7),hunger=rnd(0.4,1.0);
    lbl([rnd(0.1,0.8),hunger,inv,pick([0,1]),pick([0,1]),pick([0,1]),rnd(0,0.3),time,pick([0,1]),rnd(0,0.7),rnd(0,0.5),rnd(0.4,1)],
      0,0,0,0,0,0,0,0,clamp(0.55+(1-inv)*0.25,0.40,0.82),0,0,0,0,0);
  }

  // ═══════════════════════════════════════════════════════════════════
  // ПОВЕДЕНИЕ 10: КРАФТ ИНСТРУМЕНТОВ — 100 000 сценариев
  // ═══════════════════════════════════════════════════════════════════
  await yieldLoop();
  for(let i=0;i<600;i++){
    const tool=0,nature=rnd(0.2,0.7),inv=rnd(0.2,0.7);
    lbl([rnd(0,0.20),rnd(0.5,1),inv,tool,pick([0,1]),pick([0,1]),rnd(0,0.2),rnd(0.3,1),pick([0,1]),nature,rnd(0,0.5),rnd(0.4,1)],
      0,0,0,0,0,0,0,0,0,clamp(0.82+(1-tool)*0.14,0.78,0.97),0,0,0,0);
  }
  await yieldLoop();
  for(let i=0;i<400;i++){
    const tool=pick([0,1]),inv=rnd(0.15,0.65),hunger=rnd(0.5,1.0);
    lbl([rnd(0,0.25),hunger,inv,tool,pick([0,1]),pick([0,1]),rnd(0,0.2),rnd(0.2,1),pick([0,1]),rnd(0.2,0.7),rnd(0,0.5),rnd(0.4,1)],
      0,0,0,0,0,0,0,0,0,clamp(0.58+(1-tool)*0.28+(inv)*0.12,0.35,0.90),0,0,0,0);
  }

  // ═══════════════════════════════════════════════════════════════════
  // ПОВЕДЕНИЕ 11: БОЙ / САМОЗАЩИТА — 100 000 сценариев
  // ═══════════════════════════════════════════════════════════════════
  await yieldLoop();
  for(let i=0;i<600;i++){
    const enemy=rnd(0.4,1.0),hp=rnd(0.25,1.0),tool=1,hunger=rnd(0.3,1.0);
    lbl([rnd(0,0.25),hunger,rnd(0,0.8),tool,pick([0,1]),pick([0,1]),enemy,rnd(0,1),pick([0,1]),rnd(0,0.5),rnd(0,0.5),hp],
      0,0,0,0,0,0,0,0,0,0,clamp(0.78+enemy*0.18,0.68,0.97),0,0,0);
  }
  await yieldLoop();
  for(let i=0;i<400;i++){
    const enemy=rnd(0.55,1.0),hp=rnd(0.05,0.30),tool=pick([0,1]);
    lbl([rnd(0,0.30),rnd(0.2,0.8),rnd(0,0.7),tool,pick([0,1]),pick([0,1]),enemy,rnd(0,1),pick([0,1]),rnd(0,0.5),rnd(0,0.5),hp],
      0,0,0,clamp(0.22+(0.30-hp)*0.6,0,0.45),0,0,0,0,0,0,clamp(0.65+enemy*0.30,0.55,0.97),0,0,0);
  }

  // ═══════════════════════════════════════════════════════════════════
  // ПОВЕДЕНИЕ 12: СТРОИТЕЛЬСТВО — 100 000 сценариев
  // ═══════════════════════════════════════════════════════════════════
  await yieldLoop();
  for(let i=0;i<600;i++){
    const inv=rnd(0.2,0.7),tool=1,time=rnd(0,0.5),hunger=rnd(0.5,1.0);
    lbl([rnd(0,0.20),hunger,inv,tool,pick([0,1]),pick([0,1]),rnd(0,0.2),time,pick([0,1]),rnd(0.2,0.7),rnd(0,0.5),rnd(0.4,1)],
      0,0,0,0,0,0,0,0,0,0,0,clamp(0.78+(1-time)*0.17,0.68,0.97),0,0);
  }
  await yieldLoop();
  for(let i=0;i<400;i++){
    const time=rnd(0,0.65),inv=rnd(0.1,0.65),tool=pick([0,1]);
    lbl([rnd(0,0.28),rnd(0.4,1),inv,tool,pick([0,1]),pick([0,1]),rnd(0,0.25),time,pick([0,1]),rnd(0,0.6),rnd(0,0.5),rnd(0.3,1)],
      0,0,0,0,0,0,0,0,0,0,0,clamp(0.55+(1-time)*0.28+(tool?0.10:0),0.38,0.93),0,0);
  }

  // ═══════════════════════════════════════════════════════════════════
  // ПОВЕДЕНИЕ 13: ПРОКЛАДКА ТОННЕЛЯ / EXCAVATE — 100 000 сценариев
  // ═══════════════════════════════════════════════════════════════════
  await yieldLoop();
  for(let i=0;i<600;i++){
    const tool=1,inv=rnd(0,0.72),hunger=rnd(0.4,1.0),enemy=rnd(0,0.25);
    lbl([rnd(0,0.20),hunger,inv,tool,pick([0,1]),pick([0,1]),enemy,rnd(0,1),pick([0,1]),rnd(0,0.4),rnd(0,0.3),rnd(0.4,1)],
      0,0,0,0,0,0,0,0,0,0,0,0,clamp(0.82+tool*0.14,0.78,0.97),0);
  }
  await yieldLoop();
  for(let i=0;i<400;i++){
    const tool=pick([0,1]),inv=rnd(0,0.80),hunger=rnd(0.4,1.0);
    lbl([rnd(0,0.25),hunger,inv,tool,pick([0,1]),pick([0,1]),rnd(0,0.2),rnd(0,1),pick([0,1]),rnd(0,0.4),rnd(0,0.3),rnd(0.3,1)],
      0,0,0,0,0,0,0,0,0,0,0,0,clamp(0.65+(tool?0.22:0.05),0.35,0.90),0);
  }

  // ═══════════════════════════════════════════════════════════════════
  // ПОВЕДЕНИЕ 14: РЫБАЛКА — 100 000 сценариев
  // ═══════════════════════════════════════════════════════════════════
  await yieldLoop();
  for(let i=0;i<600;i++){
    const inv=rnd(0,0.65),hunger=rnd(0,0.55),enemy=rnd(0,0.15),time=rnd(0.2,1.0);
    lbl([rnd(0,0.20),hunger,inv,pick([0,1]),pick([0,1]),pick([0,1]),enemy,time,pick([0,1]),rnd(0,0.5),rnd(0,0.4),rnd(0.4,1)],
      0,0,0,0,0,0,0,0,0,0,0,0,0,clamp(0.78+(0.55-hunger)*0.30,0.65,0.97));
  }
  await yieldLoop();
  for(let i=0;i<400;i++){
    const hunger=rnd(0.55,0.80),inv=rnd(0,0.70),time=rnd(0,1);
    lbl([rnd(0,0.30),hunger,inv,pick([0,1]),pick([0,1]),pick([0,1]),rnd(0,0.20),time,pick([0,1]),rnd(0,0.5),rnd(0,0.4),rnd(0.4,1)],
      0,0,0,0,0,0,0,0,0,0,0,0,0,clamp(0.55+(0.80-hunger)*0.50,0.38,0.82));
  }

  return data;
}

class AnarchyBrain {
  constructor() {
    this.net=brain?new brain.NeuralNetwork({hiddenLayers:[24,18],activation:'sigmoid'}):null;
    this.ready=false;this._onProgress=null;this._onReady=null;this._onlineTrainCount=0;
    this._init();
  }
  _init() {
    if(!this.net){this.ready=true;return;}
    try{
      if(fs.existsSync(WEIGHTS_PATH)){
        const w=JSON.parse(fs.readFileSync(WEIGHTS_PATH,"utf8"));
        this.net.fromJSON(w);log.info("[AnarchyBrain] ✅ Веса загружены");this.ready=true;return;
      }
    }catch(e){log.warn("[AnarchyBrain] Веса не загружены:",e.message);}
    this.ready=false;setImmediate(()=>this._trainAsync());
  }
  async _trainAsync() {
    const prog=(pct,msg)=>{log.info(`[AnarchyBrain] ${pct}% — ${msg}`);try{if(typeof this._onProgress==='function')this._onProgress(pct,msg);}catch{}};
    const yieldLoop=()=>new Promise(r=>setImmediate(r));
    try{
      prog(3,'📚 Генерируем ~14 000 сценариев (14 поведений, ускоренный режим)...');
      await yieldLoop();
      // ИСПРАВЛЕНИЕ: buildSeedData теперь async — уступает Event Loop между
      // категориями, приложение не зависает и IPC остаётся отзывчивым.
      const all = await buildSeedData();
      // FIX: dataset уменьшен ~100x (14k vs 1.37M) → shuffle быстрый, нет белого экрана
      // Быстрый shuffle 14k: 14k × 2мкс = 28мс — безопасно
      for(let i=all.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[all[i],all[j]]=[all[j],all[i]];}
      const data=all;
      prog(20,`🏴 Обучаем нейросеть Анархии (${data.length.toLocaleString()} сцен., 14 выходов)...  [~30-60с]`);
      // FIX: logPeriod:10 → Event Loop уступается каждые 10 итераций (не 80!)
      // С 14k сцен: 10 × 14k × ~600ops = 84M → ~84мс/батч → НЕТ белого экрана
      let iterDone=0;const TOTAL=300;
      await this.net.trainAsync(data,{
        iterations:TOTAL,errorThresh:0.008,logPeriod:10,
        log:(s)=>{iterDone+=10;prog(Math.min(20+Math.round((iterDone/TOTAL)*72),92),`⚡ Итерация ${iterDone}/${TOTAL}`);}
      });
      prog(95,'💾 Сохраняем веса анархии...');
      try{fs.writeFileSync(WEIGHTS_PATH,JSON.stringify(this.net.toJSON()),"utf8");}catch{}
      prog(100,'✅ Анархия-мозг: обучение завершено! 14 поведений активны.');
      this.ready=true;try{if(typeof this._onReady==='function')this._onReady();}catch{}
    }catch(e){
      log.error("[AnarchyBrain] Ошибка:",e.message);this.ready=true;
      try{if(typeof this._onReady==='function')this._onReady();}catch{}
    }
  }

  // Принять решение на основе состояния бота
  decide(features) {
    const ACTIONS=["walk","mine_wood","mine_stone","hunt_food","farm_wheat","farm_tree",
                   "farm_other","go_home","explore","craft","combat","build","excavate","fish"];
    if(this.net&&this.ready){
      try{
        const out=this.net.run(features);
        const scored=ACTIONS.map((a,i)=>({action:a,score:out[i]||0}));
        scored.sort((a,b)=>b.score-a.score);
        return{action:scored[0].action,confidence:scored[0].score,scores:Object.fromEntries(scored.map(s=>[s.action,+s.score.toFixed(3)]))};
      }catch{}
    }
    return this._heuristic(features);
  }

  _heuristic(f) {
    const[dist,hunger,inv,tool,food,seeds,enemy,time,chest,nature,crops,hp]=f;
    if(enemy>0.55&&hp<0.4) return{action:"combat",confidence:0.85};
    if(inv>0.80) return{action:"go_home",confidence:0.88};
    if(hunger<0.28&&food) return{action:"hunt_food",confidence:0.82};
    if(crops>0.5&&seeds) return{action:"farm_wheat",confidence:0.78};
    if(nature>0.5&&tool) return{action:"mine_wood",confidence:0.75};
    if(tool) return{action:"mine_stone",confidence:0.70};
    return{action:"craft",confidence:0.65};
  }

  // Сопоставление действия мозга → задача taskManager
  actionToTask(action, opts={}) {
    const MAP = {
      mine_wood:  { name:"gather_wood",  args:{count:opts.woodCount||32} },
      mine_stone: { name:"gather_stone", args:{count:opts.stoneCount||64} },
      hunt_food:  { name:"gather_food",  args:{} },
      farm_wheat: { name:"farm_crops",   args:{crop:"wheat_seeds",radius:15,bonemeal:true} },
      farm_tree:  { name:"farm_trees_full", args:{sapling:"oak_sapling",spacing:3,bonemeal:true} },
      farm_other: { name:"farm_crops",   args:{crop:opts.crop||"carrot",radius:15,bonemeal:true} },
      go_home:    null, // обрабатывается AnarchyProtocol напрямую
      explore:    { name:"explore",      args:{} },
      excavate:   { name:"excavate",     args:opts },
      craft:      null, // обрабатывается отдельно
      combat:     null, // обрабатывается отдельно
      build:      null, // обрабатывается отдельно
      fish:       null, // обрабатывается отдельно
    };
    return MAP[action] || null;
  }

  recordExperience(features,action,wasGood) {
    if(!this.net||!features)return;
    try{
      const ACTIONS=["walk","mine_wood","mine_stone","hunt_food","farm_wheat","farm_tree",
                     "farm_other","go_home","explore","craft","combat","build","excavate","fish"];
      const cur=this.net.run(features);const tgt=[...cur];
      const idx=ACTIONS.indexOf(action);
      if(idx>=0)tgt[idx]=clamp(cur[idx]+(wasGood?0.08:-0.05),0,1);
      this.net.train([{input:features,output:tgt}],{iterations:3,errorThresh:0.05});
      this._onlineTrainCount++;
    }catch{}
  }
}
module.exports={AnarchyBrain};
