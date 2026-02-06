// JavaScript Document

(() => {
  const HEX = { READY:"#ffcc00", WORK:"#ff00c0", REST:"#00e6e9", DONE:"#00ff72" };
  const hexToRgb = (hex) => {
    const h = hex.replace("#","");
    return [parseInt(h.slice(0,2),16), parseInt(h.slice(2,4),16), parseInt(h.slice(4,6),16)];
  };

  // ✅ 固定 key（不要带版本号），刷新/关闭后仍保留
  const LS_CFG = "pelvic_flow_cfg";
  const LS_STATS = "pelvic_flow_stats";

  // ✅ 旧版本 key 迁移（如果你之前用 v16/v15 之类，这里可以继续加）
  const OLD_KEYS = {
    cfg: ["pelvic_flow_cfg_v16","pelvic_flow_cfg_v15","pelvic_flow_cfg_v14"],
    stats: ["pelvic_flow_stats_v16","pelvic_flow_stats_v15","pelvic_flow_stats_v14"]
  };

  const defaultCfg = { work: 5, rest: 5, cycles: 5 };
  const defaultStats = { groupsTotal: 0, groupsStreak: 0 };

  function loadJson(key, fallback){
    try{
      const raw = localStorage.getItem(key);
      if(!raw) return fallback === null ? null : { ...fallback };
      const obj = JSON.parse(raw);
      if(typeof obj !== "object" || obj === null) return fallback === null ? null : { ...fallback };
      return fallback === null ? obj : { ...fallback, ...obj };
    }catch{
      return fallback === null ? null : { ...fallback };
    }
  }
  function saveJson(key, obj){
    try{ localStorage.setItem(key, JSON.stringify(obj)); }catch{}
  }

  // ✅ 迁移逻辑：新 key 没有数据，就从旧 key 找一份迁移过来
  function migrateIfNeeded(){
    let cfg = loadJson(LS_CFG, null);
    if(!cfg){
      for(const k of OLD_KEYS.cfg){
        const old = loadJson(k, null);
        if(old){ cfg = { ...defaultCfg, ...old }; saveJson(LS_CFG, cfg); break; }
      }
      if(!cfg){ cfg = { ...defaultCfg }; saveJson(LS_CFG, cfg); }
    } else {
      cfg = { ...defaultCfg, ...cfg };
      saveJson(LS_CFG, cfg);
    }

    let stats = loadJson(LS_STATS, null);
    if(!stats){
      for(const k of OLD_KEYS.stats){
        const old = loadJson(k, null);
        if(old){ stats = { ...defaultStats, ...old }; saveJson(LS_STATS, stats); break; }
      }
      if(!stats){ stats = { ...defaultStats }; saveJson(LS_STATS, stats); }
    } else {
      stats = { ...defaultStats, ...stats };
      saveJson(LS_STATS, stats);
    }
    return { cfg, stats };
  }

  let { cfg, stats } = migrateIfNeeded();

  const cvs = document.getElementById("cvs");
  const ctx = cvs.getContext("2d", { alpha:true });
  const fx = document.getElementById("fx");
  const fxCtx = fx.getContext("2d", { alpha:true });

  const phaseTitle = document.getElementById("phaseTitle");
  const phaseSub = document.getElementById("phaseSub");
  const cycleInfo = document.getElementById("cycleInfo");
  const bigNum = document.getElementById("bigNum");
  const readyBadge = document.getElementById("readyBadge");
  const groupPill = document.getElementById("groupPill");
  const streakPill = document.getElementById("streakPill");

  const startBtn = document.getElementById("startBtn");
  const startText = document.getElementById("startText");
  const endBtn = document.getElementById("endBtn");

  const openSettings = document.getElementById("openSettings");
  const modalMask = document.getElementById("modalMask");
  const saveSettingsBtn = document.getElementById("saveSettings");
  const resetStatsBtn = document.getElementById("resetStatsBtn");

  const workRange = document.getElementById("workRange");
  const restRange = document.getElementById("restRange");
  const cyclesRange = document.getElementById("cyclesRange");
  const workVal = document.getElementById("workVal");
  const restVal = document.getElementById("restVal");
  const cyclesVal = document.getElementById("cyclesVal");

  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const lerp=(a,b,t)=>a+(b-a)*t;
  const easeSine=(t)=>0.5 - 0.5*Math.cos(Math.PI*clamp(t,0,1));
  const easeOutCubic=(t)=>1 - Math.pow(1-clamp(t,0,1), 3);

  const PHASE = { IDLE:"IDLE", READY:"READY", CONTRACT:"CONTRACT", RELAX:"RELAX", DONE:"DONE" };
  let phase = PHASE.IDLE;

  let cycle = 0;
  let totalCycles = cfg.cycles;
  let phaseTime = 0;

  const READY_DUR = 1.6;
  const CONTRACT_SNAP = 0.20;

  let sessionActive = false;
  let sessionValid = false;
  let sessionCounted = false;

  function renderStats(){
    groupPill.textContent = `累计完成：${stats.groupsTotal} 组`;
    streakPill.textContent = `连续完成：${stats.groupsStreak} 组`;
  }
  renderStats();

  function persistStats(){ saveJson(LS_STATS, stats); }
  function persistCfg(){ saveJson(LS_CFG, cfg); }

  // ✅ 页面刷新/关闭前强制落盘（防止极端情况下没写入）
  window.addEventListener("beforeunload", () => {
    persistCfg();
    persistStats();
  });

  function phaseColor(p){
    if(p===PHASE.READY) return hexToRgb(HEX.READY);
    if(p===PHASE.CONTRACT) return hexToRgb(HEX.WORK);
    if(p===PHASE.RELAX) return hexToRgb(HEX.REST);
    if(p===PHASE.DONE) return hexToRgb(HEX.DONE);
    return [200,210,255];
  }

  function resize(){
    const dpr = Math.max(1, window.devicePixelRatio||1);
    const rect = cvs.getBoundingClientRect();
    cvs.width = Math.floor(rect.width*dpr);
    cvs.height= Math.floor(rect.height*dpr);
    ctx.setTransform(dpr,0,0,dpr,0,0);

    fx.width = Math.floor(window.innerWidth * dpr);
    fx.height = Math.floor(window.innerHeight * dpr);
    fxCtx.setTransform(dpr,0,0,dpr,0,0);
  }

  function getTextSafeHoleR(){
    const fs = parseFloat(getComputedStyle(bigNum).fontSize) || 86;
    return fs * 0.52 + 10;
  }

  function drawOuterRing(cx,cy,R,baseThick,progressThick,pct,rgb,forceFull=false){
    ctx.save();
    ctx.translate(cx,cy);
    ctx.lineCap="round";

    ctx.lineWidth = baseThick;
    ctx.strokeStyle = "rgba(255,255,255,.10)";
    ctx.beginPath(); ctx.arc(0,0,R, 0, Math.PI*2); ctx.stroke();

    const [r,g,b]=rgb;
    const start = -Math.PI/2;
    const p = forceFull ? 1 : clamp(pct,0,1);
    const end = start + Math.PI*2*p;

    ctx.lineWidth = progressThick;
    ctx.strokeStyle = `rgba(${r},${g},${b},0.98)`;
    ctx.shadowColor = `rgba(${r},${g},${b},0.28)`;
    ctx.shadowBlur = 12;
    ctx.beginPath(); ctx.arc(0,0,R, start, end, false); ctx.stroke();

    if(!forceFull){
      const dx = Math.cos(end)*R;
      const dy = Math.sin(end)*R;
      ctx.shadowBlur = 20;
      ctx.fillStyle = "rgba(255,255,255,0.98)";
      ctx.beginPath(); ctx.arc(dx,dy, progressThick*0.46, 0, Math.PI*2); ctx.fill();
    }
    ctx.restore();
  }

  function bezierPoint(p0,c1,c2,p1,t){
    const u = 1-t;
    const tt = t*t, uu = u*u;
    const uuu = uu*u;
    const ttt = tt*t;
    return {
      x: uuu*p0.x + 3*uu*t*c1.x + 3*u*tt*c2.x + ttt*p1.x,
      y: uuu*p0.y + 3*uu*t*c1.y + 3*u*tt*c2.y + ttt*p1.y
    };
  }

  function drawSpiral(cx,cy,holeR,outerR,rgb,twist,spin,tightness){
    ctx.save();
    ctx.translate(cx,cy);

    const fog = ctx.createRadialGradient(0,0,0, 0,0, outerR);
    fog.addColorStop(0, "rgba(0,0,0,0)");
    fog.addColorStop(0.55, "rgba(255,255,255,0.06)");
    fog.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle=fog;
    ctx.beginPath(); ctx.arc(0,0,outerR,0,Math.PI*2); ctx.fill();

    ctx.rotate(spin);
    ctx.rotate(twist);

    const [r,g,b]=rgb;

    const petals = 34;
    const spiral = lerp(0.30, 0.55, tightness);

    const r0 = holeR;
    const r1 = outerR * lerp(0.84, 0.78, tightness);

    const bend1 = lerp(0.12, 0.22, tightness);
    const bend2 = lerp(0.06, 0.14, tightness);

    for(let i=0;i<petals;i++){
      const a = (i/petals)*Math.PI*2;
      const a2 = a + spiral;

      const p0 = { x: Math.cos(a)*r0, y: Math.sin(a)*r0 };

      const c1r = r0 + (r1-r0)*0.58;
      const c2r = r1 - lerp(54, 38, tightness);

      const c1 = {
        x: Math.cos(a + bend1) * c1r,
        y: Math.sin(a + bend1) * c1r
      };
      const c2 = {
        x: Math.cos(a2 + bend2) * c2r,
        y: Math.sin(a2 + bend2) * c2r
      };

      const p1 = { x: Math.cos(a2)*r1, y: Math.sin(a2)*r1 };

      const steps = 14;
      let prev = bezierPoint(p0,c1,c2,p1,0);

      for(let s=1;s<=steps;s++){
        const t = s/steps;
        const pt = bezierPoint(p0,c1,c2,p1,t);

        const alpha = lerp(0.96, 0.10, t);
        const lw = lerp(3.8, 0.95, t);

        ctx.lineWidth = lw;
        ctx.shadowColor = `rgba(${r},${g},${b},${lerp(0.42,0.02,t)})`;
        ctx.shadowBlur = lerp(14, 0, t);
        ctx.strokeStyle = `rgba(${r},${g},${b},${alpha})`;

        ctx.beginPath();
        ctx.moveTo(prev.x, prev.y);
        ctx.lineTo(pt.x, pt.y);
        ctx.stroke();
        prev = pt;
      }
    }

    ctx.shadowBlur = 0;
    ctx.fillStyle = "rgba(0,0,0,0.93)";
    ctx.beginPath(); ctx.arc(0,0,r0*0.985,0,Math.PI*2); ctx.fill();

    ctx.strokeStyle = `rgba(${r},${g},${b},0.98)`;
    ctx.lineWidth = 3.4;
    ctx.shadowColor = `rgba(${r},${g},${b},0.55)`;
    ctx.shadowBlur = 22;
    ctx.beginPath(); ctx.arc(0,0,r0*0.985,0,Math.PI*2); ctx.stroke();

    ctx.restore();
  }

  function drawCenterCheck(cx,cy,scale=1){
    ctx.save();
    ctx.translate(cx,cy);
    ctx.scale(scale, scale);
    ctx.shadowColor = "rgba(0,255,114,0.65)";
    ctx.shadowBlur = 34;
    ctx.strokeStyle = "rgba(0,255,114,0.98)";
    ctx.lineWidth = 12;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(-44, 0);
    ctx.lineTo(-12, 32);
    ctx.lineTo(54, -34);
    ctx.stroke();
    ctx.restore();
  }

  let celebrating = false, celebrateT = 0, confetti = [];
  function spawnConfettiFullScreen(){
    celebrating = true; celebrateT = 0; confetti = [];
    const W = window.innerWidth, H = window.innerHeight;
    const colors = [[0,230,233],[0,255,114],[255,0,192],[255,204,0],[109,40,217],[255,138,0]];
    const originX = W/2, originY = H*0.72;
    const count = 560;
    for(let i=0;i<count;i++){
      const c = colors[i % colors.length];
      const angle = (-Math.PI/2) + (Math.random()*1.35 - 0.675);
      const speed = 8 + Math.random()*14;
      confetti.push({
        x: originX, y: originY,
        vx: Math.cos(angle)*speed*(0.7+Math.random()*0.7),
        vy: Math.sin(angle)*speed*(0.7+Math.random()*0.7),
        g: 0.22 + Math.random()*0.18,
        w: 6 + Math.random()*12,
        h: 3 + Math.random()*7,
        rot: Math.random()*Math.PI*2,
        vr: (Math.random()*2-1)*0.28,
        life: 1.0,
        col: c,
        shape: Math.random()<0.58 ? "rect" : "tri"
      });
    }
  }
  function drawFx(){
    const W = window.innerWidth, H = window.innerHeight;
    fxCtx.clearRect(0,0,W,H);
    if(!celebrating) return;
    fxCtx.save();
    for(const p of confetti){
      const a = clamp(p.life,0,1);
      fxCtx.globalAlpha = a;
      fxCtx.save();
      fxCtx.translate(p.x, p.y);
      fxCtx.rotate(p.rot);
      fxCtx.fillStyle = `rgba(${p.col[0]},${p.col[1]},${p.col[2]},0.95)`;
      if(p.shape==="rect"){
        fxCtx.fillRect(-p.w/2, -p.h/2, p.w, p.h);
      }else{
        fxCtx.beginPath();
        fxCtx.moveTo(0, -p.h/2);
        fxCtx.lineTo(p.w/2, p.h/2);
        fxCtx.lineTo(-p.w/2, p.h/2);
        fxCtx.closePath();
        fxCtx.fill();
      }
      fxCtx.restore();
    }
    fxCtx.restore();
  }

  const vis = { holeR: 0, twist: 0, spin: 0, ringPct: 0, rgb:[200,210,255], wholeScale: 1, tight: 0 };

  const breathWave = (tSec, period=4.0) => 0.5 - 0.5*Math.cos(2*Math.PI*(tSec/period));
  const phaseDuration = (p) => {
    if(p===PHASE.READY) return READY_DUR;
    if(p===PHASE.CONTRACT) return Math.max(3, cfg.work);
    if(p===PHASE.RELAX) return Math.max(3, cfg.rest);
    return 0;
  };

  function updateCycleInfo(){
    if(phase===PHASE.IDLE){ cycleInfo.textContent = `第 0 / ${cfg.cycles} 次`; return; }
    if(phase===PHASE.DONE){ cycleInfo.textContent = `第 ${cfg.cycles} / ${cfg.cycles} 次`; return; }
    cycleInfo.textContent = `第 ${cycle} / ${totalCycles} 次（剩余 ${Math.max(0,totalCycles-cycle)} 次）`;
  }

  function setCenter(mode){
    if(mode==="ready"){ bigNum.style.display="none"; readyBadge.style.display="block"; }
    else if(mode==="big"){ readyBadge.style.display="none"; bigNum.style.display="block"; }
    else { readyBadge.style.display="none"; bigNum.style.display="none"; }
  }

  function setPhase(p){
    phase = p;
    phaseTime = 0;
    vis.ringPct = 0;

    if(p===PHASE.IDLE){
      phaseTitle.textContent="准备";
      phaseSub.textContent="点击开始训练";
      startText.textContent="开始训练";
      startBtn.style.display="";
      endBtn.style.display="none";
      openSettings.classList.remove("hidden");
      setCenter("ready");
      celebrating = false; confetti = [];
      fxCtx.clearRect(0,0,window.innerWidth,window.innerHeight);
    }
    if(p===PHASE.READY){
      phaseTitle.textContent="准备";
      phaseSub.textContent="呼气—吸气，放松进入状态";
      startBtn.style.display="none";
      endBtn.style.display="";
      openSettings.classList.add("hidden");
      setCenter("ready");
      celebrating = false; confetti = [];
      fxCtx.clearRect(0,0,window.innerWidth,window.innerHeight);
    }
    if(p===PHASE.CONTRACT){
      phaseTitle.textContent="收缩";
      phaseSub.textContent="憋气收缩，向上提肌肉";
      setCenter("big");
    }
    if(p===PHASE.RELAX){
      phaseTitle.textContent="放松";
      phaseSub.textContent="瞬间释放 → 再舒缓呼吸";
      setCenter("big");
    }
    if(p===PHASE.DONE){
      phaseTitle.textContent="完成";
      phaseSub.textContent="";
      startText.textContent="再来一次";
      startBtn.style.display="";
      endBtn.style.display="none";
      openSettings.classList.remove("hidden");
      setCenter("hide");
      spawnConfettiFullScreen();

      // ✅ 完成一整组（cycles 次收缩+放松都跑完）才计入一次
      if(sessionActive && sessionValid && !sessionCounted){
        sessionCounted = true;
        stats.groupsTotal += 1;
        stats.groupsStreak += 1;
        persistStats();
        renderStats();
      }
    }

    updateCycleInfo();
  }

  function nextPhase(){
    if(phase===PHASE.READY){ cycle = 1; updateCycleInfo(); return setPhase(PHASE.CONTRACT); }
    if(phase===PHASE.CONTRACT){ return setPhase(PHASE.RELAX); }
    if(phase===PHASE.RELAX){
      if(cycle >= totalCycles) return setPhase(PHASE.DONE);
      cycle += 1; updateCycleInfo(); return setPhase(PHASE.CONTRACT);
    }
  }

  let lastTs = performance.now();

  function update(dt){
    const w = cvs.getBoundingClientRect().width;
    const h = cvs.getBoundingClientRect().height;
    const cx = w/2, cy = h/2;

    const outerR = Math.min(w,h)*0.515;
    const baseHole = Math.min(w,h)*0.205;

    const hole100 = baseHole * 1.06;
    const safeHole = getTextSafeHoleR();

    const dur = phaseDuration(phase);
    const pct = (dur>0) ? clamp(phaseTime/dur, 0, 1) : 0;
    const ringTarget = (phase===PHASE.IDLE) ? 0 : pct;

    const nowSec = performance.now()/1000;
    const bw = breathWave(nowSec, 4.0);
    const rgbTarget = phaseColor(phase);

    if(phase===PHASE.IDLE || phase===PHASE.READY){
      const op = lerp(0.40, 0.96, bw);
      readyBadge.style.opacity = op.toFixed(3);
      readyBadge.style.transform = `translateY(${lerp(2,-2,bw).toFixed(2)}px)`;
    }

    let spinSpeed = 0.10, spinDir = 1;
    if(phase===PHASE.IDLE){ spinDir = 1; spinSpeed = 0.06 + 0.06*bw; }
    else if(phase===PHASE.READY){ spinDir = 1; spinSpeed = 0.08 + 0.06*bw; }
    else if(phase===PHASE.CONTRACT){ spinDir = 1; spinSpeed = 0.15; }
    else if(phase===PHASE.RELAX){ spinDir = -1; spinSpeed = 0.13; }
    else if(phase===PHASE.DONE){ spinDir = 1; spinSpeed = 0.07 + 0.04*bw; }
    vis.spin += dt * spinSpeed * spinDir;

    const twistAmp = (Math.PI/180)*12.0;

    let holeTarget = hole100;
    let twistTarget = 0;
    let wholeScaleTarget = 1.0;
    let tightTarget = 0.10;

    if(phase===PHASE.IDLE){
      holeTarget = lerp(hole100*1.02, hole100*0.96, bw);
      twistTarget = lerp(-twistAmp*0.05, twistAmp*0.05, bw);
      wholeScaleTarget = lerp(1.015, 0.99, bw);
      vis.ringPct = 0;
      tightTarget = 0.10;
    }

    if(phase===PHASE.READY){
      const t = easeSine(pct);
      holeTarget = lerp(hole100*1.01, hole100*0.95, t);
      twistTarget = -twistAmp*0.06*Math.sin(Math.PI*pct);
      wholeScaleTarget = lerp(1.012, 0.995, bw);
      vis.ringPct = lerp(vis.ringPct, ringTarget, 0.22);
      tightTarget = 0.25;
    }

    if(phase===PHASE.CONTRACT){
      const timeLeft = dur - phaseTime;
      const progress = clamp(phaseTime / dur, 0, 1);

      const targetHole = Math.max(safeHole, hole100 * 0.52);

      const snapT = clamp(phaseTime / CONTRACT_SNAP, 0, 1);
      const snapped = easeOutCubic(snapT);
      const snapHole = lerp(hole100, targetHole, snapped);

      const t2 = clamp((phaseTime - CONTRACT_SNAP)/0.18, 0, 1);

      const lateBoost = easeOutCubic(clamp((progress - 0.55)/0.45, 0, 1));
      const last1 = easeOutCubic(clamp((1.0 - timeLeft)/1.0, 0, 1));

      const osc1 = Math.sin(nowSec * 2 * Math.PI * 2.2);
      const osc2 = Math.sin(nowSec * 2 * Math.PI * 6.0);
      const osc = (osc1*0.60 + osc2*0.40);

      const amp10 = targetHole * 0.10;
      let oscHole = targetHole + amp10 * osc;

      const micro = Math.sin(nowSec * 2 * Math.PI * (16 + 10*last1));
      oscHole += targetHole * (0.010 + 0.010*lateBoost) * last1 * micro;

      oscHole = clamp(oscHole, targetHole*0.89, targetHole*1.11);
      holeTarget = lerp(snapHole, oscHole, t2);

      twistTarget =
        -twistAmp * (0.28 + 0.14*lateBoost) +
        (-twistAmp * (0.05 + 0.08*lateBoost + 0.22*last1) * osc2) +
        (-twistAmp * 0.12 * last1 * micro);

      wholeScaleTarget = 0.998 - 0.010*lateBoost;

      bigNum.textContent = String(Math.max(1, Math.ceil(timeLeft)));
      vis.ringPct = lerp(vis.ringPct, ringTarget, 0.26);

      const snapInfluence = clamp(phaseTime / CONTRACT_SNAP, 0, 1);
      tightTarget = lerp(0.55, 1.0, easeOutCubic(snapInfluence)) * (0.92 + 0.08*lateBoost);
    }

    if(phase===PHASE.RELAX){
      const POP_DUR = 0.18;
      const popT = clamp(phaseTime / POP_DUR, 0, 1);
      const popped = easeOutCubic(popT);

      const targetHole = Math.max(getTextSafeHoleR(), hole100 * 0.52);
      const released = lerp(targetHole, hole100, popped);

      const breathe = 0.5 - 0.5*Math.cos(2*Math.PI*(nowSec/3.4));
      const breatheAmp = hole100 * 0.07;
      holeTarget = released + (breathe - 0.5) * 2 * breatheAmp;

      twistTarget = +twistAmp * 0.10 * Math.sin(nowSec*2*Math.PI*0.45);
      wholeScaleTarget = 1.0 - 0.012*(0.5 - 0.5*Math.cos(2*Math.PI*(nowSec/3.6)));

      bigNum.textContent = String(Math.max(1, Math.ceil(dur - phaseTime)));
      vis.ringPct = lerp(vis.ringPct, ringTarget, 0.22);

      tightTarget = lerp(0.75, 0.18, popped);
    }

    if(phase===PHASE.DONE){
      holeTarget = lerp(hole100*1.02, hole100*0.96, bw);
      twistTarget = 0;
      wholeScaleTarget = lerp(1.01, 0.99, bw);
      vis.ringPct = lerp(vis.ringPct, 1, 0.20);
      tightTarget = 0.20;
    }

    vis.holeR = lerp(vis.holeR || hole100, holeTarget, (phase===PHASE.CONTRACT ? 0.34 : 0.16));
    vis.twist = lerp(vis.twist || 0, twistTarget, (phase===PHASE.CONTRACT ? 0.30 : 0.14));
    vis.wholeScale = lerp(vis.wholeScale || 1, wholeScaleTarget, 0.12);
    vis.tight = lerp(vis.tight || 0, tightTarget, 0.16);

    vis.rgb = [
      Math.round(lerp(vis.rgb[0]||rgbTarget[0], rgbTarget[0], 0.30)),
      Math.round(lerp(vis.rgb[1]||rgbTarget[1], rgbTarget[1], 0.30)),
      Math.round(lerp(vis.rgb[2]||rgbTarget[2], rgbTarget[2], 0.30)),
    ];

    ctx.clearRect(0,0,w,h);

    const ringR = outerR*0.82;
    drawOuterRing(cx,cy, ringR, 5, 7, vis.ringPct, vis.rgb, (phase===PHASE.DONE));

    ctx.save();
    ctx.translate(cx,cy);
    ctx.scale(vis.wholeScale, vis.wholeScale);
    ctx.translate(-cx,-cy);

    drawSpiral(cx,cy, vis.holeR, outerR, vis.rgb, vis.twist, vis.spin, vis.tight);

    ctx.restore();

    if(phase===PHASE.DONE){
      drawCenterCheck(cx, cy, 1.0);
    }

    if(celebrating){
      celebrateT += dt;
      for(const p of confetti){
        p.vy += p.g;
        p.x += p.vx;
        p.y += p.vy;
        p.rot += p.vr;
        p.life -= 0.006 + dt*0.18;
      }
      confetti = confetti.filter(p => p.life > 0 && p.y < window.innerHeight + 220);
      drawFx();
      if(celebrateT > 4.0 && confetti.length === 0){
        celebrating = false;
        fxCtx.clearRect(0,0,window.innerWidth,window.innerHeight);
      }
    } else {
      fxCtx.clearRect(0,0,window.innerWidth,window.innerHeight);
    }

    if(dur>0 && phase!==PHASE.IDLE && phase!==PHASE.DONE){
      phaseTime += dt;
      if(phaseTime >= dur){
        phaseTime = dur;
        nextPhase();
      }
    }
  }

  function tick(ts){
    const dt = Math.min(0.033, (ts - lastTs)/1000);
    lastTs = ts;
    update(dt);
    requestAnimationFrame(tick);
  }

  function startTraining(){
    totalCycles = cfg.cycles;
    cycle = 0;
    sessionActive = true;
    sessionValid = true;
    sessionCounted = false;
    setPhase(PHASE.READY);
  }
  function endTrainingEarly(){
    if(sessionActive && !sessionCounted){
      sessionValid = false;
      stats.groupsStreak = 0;
      persistStats();
      renderStats();
    }
    sessionActive = false;
    sessionCounted = false;
    setPhase(PHASE.IDLE);
  }

  startBtn.addEventListener("click", ()=>{
    if(phase===PHASE.IDLE || phase===PHASE.DONE) startTraining();
  });
  endBtn.addEventListener("click", endTrainingEarly);

  function openModal(){ if(phase!==PHASE.IDLE && phase!==PHASE.DONE) return; modalMask.classList.add("show"); }
  function closeModal(){ modalMask.classList.remove("show"); }
  openSettings.addEventListener("click", openModal);
  modalMask.addEventListener("click", (e)=>{ if(e.target===modalMask) closeModal(); });

  function bindRange(rangeEl, valueEl){
    const update=()=>valueEl.textContent=rangeEl.value;
    rangeEl.addEventListener("input", update);
    update();
  }
  workRange.value = cfg.work;
  restRange.value = cfg.rest;
  cyclesRange.value = cfg.cycles;
  bindRange(workRange, workVal);
  bindRange(restRange, restVal);
  bindRange(cyclesRange, cyclesVal);

  saveSettingsBtn.addEventListener("click", ()=>{
    cfg = { work:+workRange.value, rest:+restRange.value, cycles:+cyclesRange.value };
    persistCfg();
    closeModal();
    totalCycles = cfg.cycles;
    cycleInfo.textContent = `第 0 / ${cfg.cycles} 次`;
  });

  // ✅ 新增：清空统计按钮
  resetStatsBtn.addEventListener("click", () => {
    if(phase!==PHASE.IDLE && phase!==PHASE.DONE) return; // 保险：训练中不允许清空
    const ok = window.confirm("确认清空训练统计吗？\n清空后，统计数据将无法恢复");
    if(!ok) return;
    stats = { groupsTotal: 0, groupsStreak: 0 };
    persistStats();
    renderStats();
    // 同时重置本次会话标记（避免状态边缘）
    sessionActive = false;
    sessionValid = false;
    sessionCounted = false;
    setPhase(PHASE.IDLE);
    closeModal();
  });

  function init(){
    resize();
    window.addEventListener("resize", resize);
    setPhase(PHASE.IDLE);
    requestAnimationFrame(tick);
  }
  init();
})();