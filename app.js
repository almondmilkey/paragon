 
(() => {
"use strict";
/* ---------- constants ---------- */
const CATS = [
  ["bakery","Bread & bakery"],["dairy","Dairy & cheese"],["meat","Meat & fish"],["produce","Fruit & veg"],
  ["pantry","Pantry"],["snacks","Snacks & sweets"],["drinks","Drinks"],["alcohol","Alcohol & tobacco"],["household","Household"],
  ["hygiene","Hygiene & cosmetics"],["clothes","Clothes"],["transport","Transport"],["eating_out","Eating out"],
  ["health","Health"],["leisure","Leisure & subscriptions"],["housing","Rent & utilities"],
  ["child_care","Child care"],["pet_care","Pet care"],["telecommunications","Telecommunications"],
  ["insurance_financial","Insurance & financial services"],["education","Education"],
  ["arts_culture","Arts & culture"],["sports_fitness","Sports & fitness"],["specialized_equipment","Specialized equipment"],["other","Other"]];
const CAT = Object.fromEntries(CATS);
const CURRENCIES = ["EUR","PLN","USD","GBP","CHF"];
const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const MONTHS_LONG = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const LS_R = "paragon.receipts.v1", LS_P = "paragon.profile.v1";
 
/* ---------- state ---------- */
const S = {
  view: "home", month: null, openCat: null, q: "",
  real: [], loaded: false, currency: "EUR", aliases: {},
  user: null, draft: null, scanCtl: null, used: null, limit: null
};
 
/* ---------- helpers ---------- */
const $ = s => document.querySelector(s);
const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const pad = n => String(n).padStart(2,"0");
const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; };
const mkOf = iso => (iso || "").slice(0,7);
const mkLabel = (mk, long) => { const [y,m] = mk.split("-"); return `${(long?MONTHS_LONG:MONTHS)[+m-1]} ${y}`; };
const mkShort = mk => MONTHS[+mk.slice(5)-1];
const addMonths = (mk, n) => { let [y,m] = mk.split("-").map(Number); m += n; while(m>12){m-=12;y++} while(m<1){m+=12;y--} return `${y}-${pad(m)}`; };
const num = v => { if (typeof v === "number") return isFinite(v) ? v : 0; const n = parseFloat(String(v ?? "").replace(/\s/g,"").replace(",", ".")); return isFinite(n) ? n : 0; };
const r2 = n => Math.round(n*100)/100;
const sum = a => a.reduce((s,x)=>s+x,0);
const mean = a => a.length ? sum(a)/a.length : null;
const sd = a => { if (a.length < 2) return null; const m = mean(a); return Math.sqrt(sum(a.map(x=>(x-m)**2))/(a.length-1)); };
const key = s => String(s||"").trim().toLowerCase();
let fmtCache = {};
const money = (v, dec=2) => { const k = S.currency+dec; if(!fmtCache[k]) fmtCache[k] = new Intl.NumberFormat("en-IE",{style:"currency",currency:S.currency,minimumFractionDigits:dec,maximumFractionDigits:dec}); return fmtCache[k].format(v||0); };
const pct = (v, dec=1) => (v>0?"+":"") + (v*100).toFixed(dec) + "%";
const chgClass = v => Math.abs(v) < 0.005 ? "flat" : v > 0 ? "up" : "down";
const fmtDate = iso => { if(!iso) return ""; const [y,m,d] = iso.split("-"); return `${+d} ${MONTHS[+m-1]} ${y}`; };
const rid = () => (crypto.randomUUID ? crypto.randomUUID() : "10000000-1000-4000-8000-100000000000".replace(/[018]/g, c => (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)));
const receiptTotal = r => r2(sum((r.items||[]).map(i => num(i.price))));
function toast(msg){ const t = document.createElement("div"); t.className="toast"; t.textContent=msg; $("#toastRoot").replaceChildren(t); setTimeout(()=>t.remove(), 2600); }
 
/* ---------- example data (deterministic) ---------- */
function makeDemo(){
  let seed = 7; const rnd = () => (seed = (seed*16807) % 2147483647) / 2147483647;
  const P = [
    ["bread","SAUERTEIGBROT 500G","bakery","pcs",2.49,[1,1],.7],["bread rolls","BROETCHEN 6ST","bakery","pcs",1.29,[1,2],.35],
    ["milk","H-MILCH 3,5% 1L","dairy","pcs",1.09,[1,3],.7],["cheese","GOUDA SCHEIBEN 200G","dairy","pcs",2.29,[1,2],.5],
    ["butter","DEUTSCHE BUTTER 250G","dairy","pcs",2.19,[1,1],.35],["eggs","FREILAND EIER 10ST","dairy","pcs",3.09,[1,1],.4],
    ["yoghurt","NATURJOGHURT 500G","dairy","pcs",.99,[1,2],.4],["chicken breast","HAEHNCHENBRUST","meat","kg",9.9,[.4,.9],.35],
    ["sausages","BRATWURST 400G","meat","pcs",3.49,[1,1],.25],["bananas","BANANEN","produce","kg",1.59,[.8,1.4],.55],
    ["apples","AEPFEL ELSTAR","produce","kg",2.49,[1,1.6],.4],["tomatoes","RISPENTOMATEN","produce","kg",3.29,[.4,1],.45],
    ["potatoes","KARTOFFELN 2KG","produce","pcs",2.79,[1,1],.25],["pasta","SPAGHETTI 500G","pantry","pcs",1.19,[1,2],.3],
    ["olive oil","OLIVENOEL 0,75L","pantry","pcs",8.49,[1,1],.09],["coffee","KAFFEE BOHNEN 500G","pantry","pcs",7.49,[1,1],.18],
    ["chocolate","ZARTBITTER 100G","snacks","pcs",1.49,[1,2],.3],["sparkling water","MINERALW. 1,5L","drinks","pcs",.55,[2,6],.4],
    ["toilet paper","TOILETTENPAPIER 8R","household","pcs",3.95,[1,1],.12],["toothpaste","ZAHNCREME 75ML","hygiene","pcs",2.45,[1,1],.1],
    ["shampoo","SHAMPOO 300ML","hygiene","pcs",3.75,[1,1],.08]];
  const stores = [["Lidl",.99],["Aldi Nord",.98],["REWE",1.03],["Edeka",1.04]];
  const drift = {coffee:.012, butter:-.006, "olive oil":.009, cheese:.006, eggs:.005, chocolate:.01};
  const out = []; const now = new Date(); const curMk = mkOf(todayISO());
  for (let k = 7; k >= 0; k--){
    const mk = addMonths(curMk, -k); const [y,m] = mk.split("-").map(Number);
    const days = new Date(y, m, 0).getDate(); const lastDay = k===0 ? now.getDate() : days;
    const trips = k===0 ? 2 : 6 + Math.floor(rnd()*3);
    for (let t = 0; t < trips; t++){
      const d = Math.max(1, Math.min(lastDay, Math.round((t+.5)*lastDay/trips)));
      const [store, mult] = stores[Math.floor(rnd()*stores.length)];
      const items = [];
      P.forEach(([prod,name,cat,unit,base,[q0,q1],p]) => {
        if (rnd() > p) return;
        const months = 7-k; const g = .006 + (drift[prod]||0);
        let unitPrice = base*mult*Math.pow(1+g, months)*(1+(rnd()-.5)*.03);
        if (rnd() < .05) unitPrice *= .85; // promotion
        unitPrice = r2(unitPrice);
        const qty = unit === "kg" ? r2(q0 + rnd()*(q1-q0)) : Math.round(q0 + rnd()*(q1-q0));
        items.push({name, product:prod, category:cat, qty, unit, unitPrice, price:r2(qty*unitPrice)});
      });
      if (items.length) out.push({id:`demo-${mk}-${t}`, date:`${mk}-${pad(d)}`, store, items, source:"scan", demo:true});
    }
    const man = (day, store, product, cat, price) => { if (k===0 && day>now.getDate()) return; out.push({id:`demo-${mk}-${product}`, date:`${mk}-${pad(day)}`, store, source:"manual", demo:true, items:[{name:product, product, category:cat, qty:1, unit:"pcs", unitPrice:price, price}]}); };
    man(1, "Landlord", "rent", "housing", 900);
    man(3, "Monthly transit pass", "transit pass", "transport", 63);
    man(15, "Vattenfall", "electricity & heating", "housing", r2(92 + rnd()*22));
    for (let e = 0; e < 2 + Math.floor(rnd()*3); e++) man(5+e*6, ["Café Liebling","Pho Hanoi","Pizzeria Due"][e%3], "restaurant", "eating_out", r2(14 + rnd()*30));
    if (rnd() < .4) man(20, "Uniqlo", "clothing", "clothes", r2(29 + rnd()*60));
  }
  return out.sort((a,b)=>a.date.localeCompare(b.date));
}
const DEMO = makeDemo();
const receipts = () => S.real.length ? S.real : (S.loaded ? DEMO : []);
const isDemo = () => S.loaded && S.real.length === 0;
 
/* ---------- analysis ---------- */
function analyze(list){
  const months = {}, products = {};
  for (const r of list){
    const mk = mkOf(r.date); if (!mk) continue;
    const M = months[mk] ||= {total:0, cats:{}, prods:{}, count:0, minDay:31};
    M.count++; M.minDay = Math.min(M.minDay, +String(r.date).slice(8,10) || 1);
    for (const it of r.items || []){
      const price = num(it.price); const cat = CAT[it.category] ? it.category : "other";
      M.total += price; M.cats[cat] = (M.cats[cat]||0) + price;
      const pk = key(it.product || it.name); if (!pk) continue;
      M.prods[pk] = (M.prods[pk]||0) + price;
      const P = products[pk] ||= {key:pk, label:it.product || it.name, category:cat, buys:[], total:0};
      P.total += price;
      const qty = num(it.qty) || 1; const up = num(it.unitPrice) || (qty ? price/qty : price);
      P.buys.push({date:r.date, mk, price, qty, unit:it.unit||"pcs", unitPrice:up, store:r.store||""});
    }
  }
  const mks = Object.keys(months).sort();
  const curMk = mkOf(todayISO());
  // leave out the running month, and a first month that was only partly tracked
  const complete = mks.filter(m => m < curMk && !(m === mks[0] && months[m].minDay > 5)).map(m => months[m].total);
  const stats = {avg: mean(complete), sd: sd(complete), n: complete.length};
  for (const P of Object.values(products)){
    P.buys.sort((a,b)=>a.date.localeCompare(b.date));
    const ups = P.buys.map(b=>b.unitPrice);
    P.avgUnit = mean(ups); P.minUnit = Math.min(...ups); P.maxUnit = Math.max(...ups); P.sdUnit = sd(ups);
    P.unit = P.buys[P.buys.length-1].unit;
    const byM = {}; P.buys.forEach(b => (byM[b.mk] ||= []).push(b.unitPrice));
    P.monthly = Object.fromEntries(Object.entries(byM).map(([m,a])=>[m, mean(a)]));
    P.monthsBought = Object.keys(byM).length;
    const pm = Object.keys(byM).sort();
    P.firstMk = pm[0]; P.lastMk = pm[pm.length-1];
    P.change = pm.length > 1 ? P.monthly[P.lastMk]/P.monthly[P.firstMk] - 1 : null;
    P.lastUnit = ups[ups.length-1];
    P.lastVsAvg = P.avgUnit ? P.lastUnit/P.avgUnit - 1 : 0;
    const st = {}; P.buys.forEach(b => { if (b.store) (st[b.store] ||= []).push(b.unitPrice); });
    const sts = Object.entries(st).map(([s,a])=>[s, mean(a), a.length]).sort((a,b)=>a[1]-b[1]);
    P.stores = sts;
    P.share = mks.length ? P.monthsBought / mks.length : 0;
    P.perMonth = P.buys.length / Math.max(1, mks.length);
  }
  const staples = Object.values(products).filter(P => P.category !== "housing" && mks.length >= 2 && P.monthsBought >= 2 && P.share >= .5)
    .sort((a,b)=> b.share - a.share || b.total - a.total);
  return {months, mks, stats, products, staples, curMk};
}
 
/* spend-weighted personal price index: each product against its own starting price */
const NO_INDEX = new Set(["housing","eating_out","clothes","leisure","health","transport"]);
function priceIndex(A, filterCat){
  const elig = Object.values(A.products).filter(P => P.monthsBought >= 2 && !NO_INDEX.has(P.category) && (!filterCat || P.category === filterCat));
  elig.forEach(P => { const ms = Object.keys(P.monthly).sort().slice(0,2); P.base = mean(ms.map(m=>P.monthly[m])); });
  const pts = []; let lastV = 100;
  A.mks.forEach(mk => {
    let w = 0, s = 0;
    for (const P of elig){ const b = P.monthly[mk]; if (b && P.base){ w += P.total; s += P.total * (b/P.base); } }
    if (w) lastV = 100 * s / w;
    pts.push({mk, v:lastV});
  });
  if (pts.length){ const f = 100 / pts[0].v; pts.forEach(p => p.v *= f); }
  return {pts, count: elig.length};
}
 
/* ---------- charts ---------- */
function niceMax(v){ if (v <= 0) return 1; const p = Math.pow(10, Math.floor(Math.log10(v))); const n = v/p; return (n<=1?1:n<=2?2:n<=2.5?2.5:n<=5?5:10)*p; }
function barChart(A, sel){
  const mks = A.mks.slice(-12); if (!mks.length) return "";
  const W=340,H=160,L=40,B=20,T=10,R=6; const vals = mks.map(m=>A.months[m].total);
  const max = niceMax(Math.max(...vals, A.stats.avg||0)); const y = v => T + (H-T-B)*(1 - v/max);
  const bw = (W-L-R)/mks.length; let g = "";
  [0,.5,1].forEach(f => { const yy = y(max*f); g += `<line class="grid" x1="${L}" x2="${W-R}" y1="${yy}" y2="${yy}"/><text x="${L-6}" y="${yy+3}" text-anchor="end">${esc(money(max*f,0))}</text>`; });
  mks.forEach((m,i) => { const x = L + i*bw + bw*.18, h = (H-T-B) - (y(vals[i])-T);
    g += `<rect class="bar${m===sel?" sel":""}" x="${x}" y="${y(vals[i])}" width="${bw*.64}" height="${Math.max(0,h)}" rx="2"/>`;
    g += `<text x="${x+bw*.32}" y="${H-6}" text-anchor="middle">${mkShort(m)}</text>`; });
  if (A.stats.avg) g += `<line class="avg" x1="${L}" x2="${W-R}" y1="${y(A.stats.avg)}" y2="${y(A.stats.avg)}"/>`;
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Monthly spending, last ${mks.length} months">${g}</svg>`;
}
function lineChart(pts, opts={}){
  if (pts.length < 2) return "";
  const W=340,H=170,L=40,B=20,T=14,R=40; const vs = pts.map(p=>p.v);
  let lo = Math.min(...vs, opts.base ?? Infinity), hi = Math.max(...vs, opts.base ?? -Infinity);
  const padv = (hi-lo)*.15 || Math.abs(hi)*.02 || 1; lo -= padv; hi += padv;
  const x = i => L + i*(W-L-R)/(pts.length-1), y = v => T + (H-T-B)*(1-(v-lo)/(hi-lo));
  const f = opts.fmt || (v => v.toFixed(1));
  let g = "";
  [lo+padv, (lo+hi)/2, hi-padv].forEach(v => { g += `<line class="grid" x1="${L}" x2="${W-R}" y1="${y(v)}" y2="${y(v)}"/><text x="${L-6}" y="${y(v)+3}" text-anchor="end">${esc(f(v))}</text>`; });
  if (opts.base != null) g += `<line class="base" x1="${L}" x2="${W-R}" y1="${y(opts.base)}" y2="${y(opts.base)}"/>`;
  const d = pts.map((p,i)=>`${i?"L":"M"}${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join("");
  g += `<path class="area" d="${d}L${x(pts.length-1)},${H-B}L${L},${H-B}Z"/><path class="line" d="${d}"/>`;
  const step = Math.ceil(pts.length/7);
  pts.forEach((p,i) => { if (i%step===0 || i===pts.length-1) g += `<text x="${x(i)}" y="${H-5}" text-anchor="middle">${esc(p.label || mkShort(p.mk))}</text>`; });
  const li = pts.length-1; g += `<circle class="dot" cx="${x(li)}" cy="${y(pts[li].v)}" r="3.5"/><text class="end" x="${x(li)+6}" y="${y(pts[li].v)+3}">${esc(f(pts[li].v))}</text>`;
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(opts.label||"Trend")}">${g}</svg>`;
}
 
/* ---------- views ---------- */
function render(){
  const list = receipts(); const A = analyze(list);
  if (!S.month || (!A.months[S.month] && S.month !== A.curMk)) S.month = A.months[A.curMk] ? A.curMk : (A.mks[A.mks.length-1] || A.curMk);
  document.querySelectorAll("[data-nav]").forEach(b => b.setAttribute("aria-current", b.dataset.nav===S.view ? "page" : "false"));
  $("#banner").innerHTML = isDemo()
    ? `<div class="banner"><span>●</span><span><b>Example data.</b> You're looking at 8 made-up months so you can see how MijnParagon works. Scan or add your first receipt and only your own data will show.</span></div>` : "";
  if (!S.loaded){ $("#view").innerHTML = `<div class="empty">Loading your receipts…</div>`; return; }
  const v = {home:viewHome, products:viewProducts, inflation:viewInflation, history:viewHistory}[S.view] || viewHome;
  $("#view").innerHTML = v(A, list);
  const qi = $("#q"); if (qi && S._focusQ){ qi.focus(); qi.setSelectionRange(qi.value.length, qi.value.length); }
}
 
function viewHome(A){
  const mk = S.month, M = A.months[mk] || {total:0, cats:{}, prods:{}, count:0};
  const idx = A.mks.indexOf(mk);
  const allM = A.mks.includes(A.curMk) ? A.mks : [...A.mks, A.curMk];
  const pos = allM.indexOf(mk);
  const {avg, sd: s, n} = A.stats;
  let vs = "";
  if (avg){ const d = M.total/avg - 1; const partial = mk === A.curMk;
    vs = `<span class="pill ${d>0?"up":"down"}">${pct(d,0)} vs. your monthly average${partial?" · month in progress":""}</span>`; }
  const cats = Object.entries(M.cats).sort((a,b)=>b[1]-a[1]); const top = cats[0]?.[1] || 1;
  const rowsHtml = cats.map(([c,v]) => {
    const open = S.openCat === c;
    let sub = "";
    if (open){ const items = {}; const list = receipts().filter(r=>mkOf(r.date)===mk);
      list.forEach(r => (r.items||[]).forEach(it => { if ((CAT[it.category]?it.category:"other")===c){ const k = key(it.product||it.name); items[k] = items[k] || {l:it.product||it.name, v:0, n:0}; items[k].v += num(it.price); items[k].n++; } }));
      sub = `<div class="sub">${Object.values(items).sort((a,b)=>b.v-a.v).map(i=>`<div><span>${esc(i.l)}${i.n>1?` <span class="muted">×${i.n}</span>`:""}</span><span class="num">${money(i.v)}</span></div>`).join("")}</div>`; }
    return `<button class="row" data-cat="${c}" aria-expanded="${open}"><span class="chev-r">›</span><span class="name">${esc(CAT[c])}</span><span class="amt">${money(v)}</span><span class="meter"><i style="width:${(v/top*100).toFixed(1)}%"></i></span></button>${sub}`;
  }).join("");
  const prods = Object.entries(M.prods).sort((a,b)=>b[1]-a[1]).slice(0,5);
  return `
  <div class="section">
    <div class="monthbar"><button class="chev" data-month="-1" ${pos<=0?"disabled":""} aria-label="Previous month">‹</button><span class="m">${mkLabel(mk,true)}</span><button class="chev" data-month="1" ${pos>=allM.length-1?"disabled":""} aria-label="Next month">›</button></div>
    <div class="hero"><span class="label">Spent this month</span><span class="big num">${money(M.total)}</span>${vs}<span class="small muted">${M.count} receipt${M.count===1?"":"s"}</span></div>
  </div>
  <div class="stats">
    <div class="stat"><span class="label">Monthly avg</span><span class="v num">${avg?money(avg,0):"—"}</span></div>
    <div class="stat"><span class="label">Std deviation</span><span class="v num">${s?"± "+money(s,0):"—"}</span></div>
    <div class="stat"><span class="label">Typical range</span><span class="v num" style="font-size:.95rem;white-space:normal;line-height:1.25">${avg&&s?`${money(Math.max(0,avg-s),0)}–<br>${money(avg+s,0)}`:"—"}</span></div>
  </div>
  <p class="small muted stats-note">${n?`Based on ${n} complete month${n===1?"":"s"}. The current month, and a first month you only partly tracked, are left out.`:"Averages appear once you have a complete month of receipts."}</p>
  <div class="section">${barChart(A, mk)}<span class="small muted">Bars: monthly totals. Dashed line: your average.</span></div>
  <div class="section">
    <div class="section-head"><h2>Spending per category</h2></div>
    ${cats.length ? `<div class="ledger">${rowsHtml}</div>` : `<div class="empty">No expenses in ${mkLabel(mk,true)} yet.</div>`}
  </div>
  ${prods.length ? `<div class="section"><div class="section-head"><h2>Top products</h2><button class="linkbtn" data-nav="products">All products</button></div>
    <table class="mini"><tbody>${prods.map(([k,v])=>`<tr><td style="text-transform:capitalize">${esc(A.products[k]?.label||k)}</td><td>${money(v)}</td></tr>`).join("")}</table></div>`:""}`;
}
 
function productRow(P){
  const ch = P.change;
  return `<button class="prod" data-prod="${esc(P.key)}">
    <span class="pn">${esc(P.label)}</span><span class="pr">${money(P.avgUnit)}<span class="muted small">/${P.unit==="kg"?"kg":P.unit==="l"?"l":"pc"}</span></span>
    <span class="meta">${esc(CAT[P.category])} · ${P.buys.length}× in ${P.monthsBought} mo</span>
    <span class="chg ${ch==null?"flat":chgClass(ch)}">${ch==null?"one month":pct(ch)+" since "+mkShort(P.firstMk)}</span></button>`;
}
function viewProducts(A){
  const all = Object.values(A.products).filter(P=>P.category!=="housing").sort((a,b)=>b.total-a.total);
  const q = key(S.q); const filtered = q ? all.filter(P => P.key.includes(q) || key(CAT[P.category]).includes(q)) : all;
  const stapleKeys = new Set(A.staples.map(P=>P.key));
  return `
  <div class="section"><h1>Products</h1><span class="muted small">Tap a product to see its price history, where it's cheapest and how often you buy it.</span></div>
  ${A.staples.length && !q ? `<div class="section"><div class="section-head"><h2>Your staples</h2><span class="small muted">bought in ≥ half of your months</span></div>
    <div class="ledger">${A.staples.slice(0,12).map(productRow).join("")}</div></div>`:""}
  <div class="section"><div class="section-head"><h2>${q?"Results":"Everything else"}</h2></div>
    <input class="search" id="q" type="search" placeholder="Search products or categories" value="${esc(S.q)}" aria-label="Search products">
    ${(q?filtered:filtered.filter(P=>!stapleKeys.has(P.key))).map(productRow).join("") || `<div class="empty">No products match.</div>`}</div>`;
}
 
function viewInflation(A){
  const I = priceIndex(A);
  if (A.mks.length < 2 || I.count === 0) return `<div class="section"><h1>Your inflation</h1><div class="empty">Your personal inflation appears once you've bought the same products in at least two different months.</div></div>`;
  const pts = I.pts; const last = pts[pts.length-1];
  const refI = Math.max(0, pts.length-13); const ref = pts[refI];
  const span = pts.length-1-refI; const ch = last.v/ref.v - 1;
  const annual = span >= 12 ? ch : Math.pow(1+ch, 12/Math.max(1,span)) - 1;
  const movers = Object.values(A.products).filter(P=>P.change!=null && !NO_INDEX.has(P.category)).sort((a,b)=>b.change-a.change);
  const up = movers.filter(P=>P.change>0).slice(0,5), down = movers.filter(P=>P.change<0).slice(-3).reverse();
  const cats = [...new Set(Object.values(A.products).filter(P=>P.monthsBought>=2 && !NO_INDEX.has(P.category)).map(P=>P.category))]
    .map(c => { const ci = priceIndex(A, c); const p = ci.pts; return [c, p[p.length-1].v/p[0].v - 1, ci.count]; }).sort((a,b)=>b[1]-a[1]);
  return `
  <div class="section"><h1>Your inflation</h1><span class="muted small">How much the prices of the things <i>you</i> actually buy have changed. Rent, bills, restaurants and clothes are left out because their prices can't be compared like for like.</span></div>
  <div class="hero"><span class="label">${span>=12?"Last 12 months":`Since ${mkLabel(ref.mk,true)} (${span} mo)`}</span><span class="big num">${pct(ch)}</span>
    ${span<12?`<span class="pill ${annual>0?"up":"down"}">≈ ${pct(annual)} per year at this pace</span>`:""}</div>
  <div class="section"><span class="label">Price index, ${mkLabel(pts[0].mk)} = 100</span>${lineChart(pts.map(p=>({...p})), {base:100, label:"Personal price index"})}</div>
  <div class="section"><h2>Biggest price rises</h2><div class="ledger">${up.map(productRow).join("") || `<div class="empty">No price rises yet.</div>`}</div></div>
  ${down.length?`<div class="section"><h2>Got cheaper</h2><div class="ledger">${down.map(productRow).join("")}</div></div>`:""}
  <div class="section"><h2>By category</h2><table class="mini"><thead><tr><th>Category</th><th>Products</th><th>Change</th></tr></thead><tbody>
    ${cats.map(([c,v,n])=>`<tr><td>${esc(CAT[c])}</td><td class="muted">${n}</td><td class="chg ${chgClass(v)}">${pct(v)}</td></tr>`).join("")}</tbody></table></div>
  <div class="card"><h3>How this is calculated</h3><p class="small muted" style="margin:6px 0 0">For every product you've bought in at least two months, MijnParagon takes its price per unit (per piece, kg or litre) and compares each month with that product's own starting price. Products you spend more on count more. The result is one index that starts at 100, so 105 means your usual basket costs 5% more than when you started. Promotions and switching shops move the number too, which is the point: it measures your real basket, not an official one.</p></div>`;
}
 
function viewHistory(A, list){
  const byM = {}; list.forEach(r => (byM[mkOf(r.date)] ||= []).push(r));
  const mks = Object.keys(byM).sort().reverse();
  return `
  <div class="section"><div class="section-head"><h1>Receipts</h1><button class="btn ghost" data-action="manual" style="padding:8px 14px;font-size:.9rem">+ Add expense</button></div>
  <span class="muted small">Tap a receipt to correct products, prices or categories.</span></div>
  ${mks.map(mk => `<div class="section"><div class="section-head"><h2>${mkLabel(mk,true)}</h2><span class="num muted">${money(A.months[mk]?.total||0)}</span></div>
    <div class="ledger">${byM[mk].sort((a,b)=>b.date.localeCompare(a.date)).map(r=>`<button class="receipt" data-receipt="${esc(r.id)}">
      <span class="st">${esc(r.store||"Expense")}</span><span class="num" style="font-family:var(--display)">${money(receiptTotal(r))}</span>
      <span class="meta">${fmtDate(r.date)} · ${(r.items||[]).length} item${(r.items||[]).length===1?"":"s"} <span class="tag ${r.source==="manual"?"manual":"scan"}">${r.source==="manual"?"manual":"scanned"}</span></span></button>`).join("")}</div></div>`).join("") || `<div class="empty">No receipts yet. Tap the button below to scan one.</div>`}`;
}
 
/* ---------- sheets ---------- */
function openSheet(html){
  $("#sheetRoot").innerHTML = `<div class="scrim" data-scrim><div class="sheet" role="dialog" aria-modal="true">${html}</div></div>`;
  document.body.style.overflow = "hidden";
}
function closeSheet(){
  if (S.scanCtl){ S.scanCtl.abort(); S.scanCtl = null; }
  if (S.draft?.imageUrl) URL.revokeObjectURL(S.draft.imageUrl);
  S.draft = null; $("#sheetRoot").innerHTML = ""; document.body.style.overflow = "";
}
const closeBtn = `<button class="icon-btn" data-action="close" aria-label="Close"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 6l12 12M18 6L6 18"/></svg></button>`;
 
function sheetAdd(){
  openSheet(`<div class="sheet-head"><h2>Add a receipt</h2>${closeBtn}</div>
  <div class="choice">
    <button data-action="scan"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2"/><circle cx="12" cy="12" r="3.5"/></svg>
      <span><b style="font-family:var(--display);font-size:1.05rem;font-weight:700">Scan a receipt</b><br><span class="small muted">Take a photo or pick one. MijnParagon reads the date, shop, products and prices; you check them before saving.${S.limit?` ${Math.max(0,S.limit-(S.used||0))} of ${S.limit} scans left this month.`:""}</span></span></button>
    <button data-action="manual"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 20h4L19 9l-4-4L4 16v4zM13 7l4 4"/></svg>
      <span><b style="font-family:var(--display);font-size:1.05rem;font-weight:700">Add an expense by hand</b><br><span class="small muted">Rent, a market stall, cash payments, anything without a receipt.</span></span></button>
  </div>`);
}
 
function sheetSettings(){
  const cfg = window.PARAGON_CONFIG || {};
  openSheet(`<div class="sheet-head"><h2>Settings</h2>${closeBtn}</div>
    <div class="settings-list">
    <div class="card small"><span class="label">Signed in as</span><br><b id="setEmail"></b></div>
    <label class="field"><span class="label">Currency</span><select id="cur">${CURRENCIES.map(c=>`<option ${c===S.currency?"selected":""}>${c}</option>`).join("")}</select></label>
    <div class="card small"><b>Scans this month</b><br><span class="muted" id="usage">${S.used!=null?`${S.used}${S.limit?` of ${S.limit}`:""} used`:"Checking…"}</span></div>
    <div class="card small"><b>Learned corrections</b><br><span class="muted">${Object.keys(S.aliases).length} product name${Object.keys(S.aliases).length===1?"":"s"} remembered. When you fix a product name or category after a scan, MijnParagon applies the same fix to future receipts.</span></div>
    <button class="btn ghost wide" data-action="export">Export my data (CSV)</button>
    <button class="btn ghost wide" data-action="signout">Sign out</button>
    <button class="btn danger wide" data-action="delaccount" id="delAccBtn">Delete my account and all data</button>
    <p class="foot"><a href="${esc(cfg.privacyUrl||"privacy.html")}" target="_blank" rel="noopener">Privacy policy</a></p>
    </div>`);
  $("#setEmail").textContent = S.user?.email || "";
  refreshUsage().then(() => { const u = $("#usage"); if (u && S.used != null) u.textContent = `${S.used}${S.limit?` of ${S.limit}`:""} used`; });
}
 
function sheetProduct(k){
  const A = analyze(receipts()); const P = A.products[k]; if (!P) return;
  const unit = P.unit==="kg"?"kg":P.unit==="l"?"litre":"piece";
  const pts = P.buys.map(b => ({mk:b.mk, v:b.unitPrice, label:`${+b.date.slice(8)} ${mkShort(b.mk)}`}));
  const notes = [];
  if (P.sdUnit && P.avgUnit) { const cv = P.sdUnit/P.avgUnit; notes.push(cv < .04 ? "Price is very stable." : cv < .1 ? "Price moves a little between shops and weeks." : "Price varies a lot: promotions or shop choice matter here."); }
  if (P.stores.length > 1){ const [cs, cp] = P.stores[0], [es, ep] = P.stores[P.stores.length-1]; notes.push(`Cheapest at ${cs} (${money(cp)}), dearest at ${es} (${money(ep)}): ${pct(ep/cp-1,0)}.`); }
  if (Math.abs(P.lastVsAvg) > .03) notes.push(`Last time you paid ${pct(P.lastVsAvg,0)} ${P.lastVsAvg>0?"more":"less"} than usual.`);
  notes.push(`You buy it about ${P.perMonth >= 1 ? P.perMonth.toFixed(1)+"× a month" : "once every "+Math.round(1/P.perMonth)+" months"}, ${money(P.total/Math.max(1,A.mks.length))} a month on average.`);
  openSheet(`<div class="sheet-head"><h2 style="text-transform:capitalize">${esc(P.label)}</h2>${closeBtn}</div>
    <span class="small muted">${esc(CAT[P.category])} · ${P.buys.length} purchases · ${money(P.total)} total</span>
    <div class="stats">
      <div class="stat"><span class="label">Avg / ${unit}</span><span class="v num">${money(P.avgUnit)}</span></div>
      <div class="stat"><span class="label">Range</span><span class="v num" style="font-size:.95rem">${money(P.minUnit)}–${money(P.maxUnit)}</span></div>
      <div class="stat"><span class="label">Change</span><span class="v num chg ${P.change==null?"flat":chgClass(P.change)}">${P.change==null?"—":pct(P.change)}</span></div>
    </div>
    ${pts.length>1?`<div class="section"><span class="label">Price per ${unit}, each purchase</span>${lineChart(pts,{fmt:v=>money(v), label:"Price history"})}</div>`:""}
    <div class="card small" style="display:flex;flex-direction:column;gap:6px">${notes.map(n=>`<span>${esc(n)}</span>`).join("")}</div>
    ${P.stores.length?`<table class="mini"><thead><tr><th>Shop</th><th>Bought</th><th>Avg / ${unit}</th></tr></thead><tbody>${P.stores.map(([s,p,n])=>`<tr><td>${esc(s)}</td><td class="muted">${n}×</td><td>${money(p)}</td></tr>`).join("")}</tbody></table>`:""}`);
}
 
/* ---------- editor ---------- */
function blankItem(){ return {name:"", product:"", category:"other", qty:1, unit:"pcs", unitPrice:0, price:0}; }
function startEditor(draft){ S.draft = draft; renderEditor(); }
function renderEditor(){
  const D = S.draft; const total = r2(sum(D.items.map(i=>num(i.price))));
  const mismatch = D.printedTotal && Math.abs(D.printedTotal - total) > .02;
  const isNew = !D.id;
  openSheet(`<div class="sheet-head"><h2>${D.source==="scan"?(isNew?"Check the scan":"Edit receipt"):(isNew?"New expense":"Edit expense")}</h2>${closeBtn}</div>
    ${D.demo?`<div class="warn">This is an example receipt. Changes to example data aren't saved.</div>`:""}
    ${D.imageUrl?`<img class="thumb" src="${D.imageUrl}" alt="Your receipt photo">`:""}
    ${D.source==="scan"&&isNew?`<span class="small muted">Compare with the photo and fix anything the scanner misread. Product names group the same item across shops and months.</span>`:""}
    <div class="two"><label class="field"><span class="label">Shop / payee</span><input id="f-store" value="${esc(D.store)}" placeholder="e.g. Lidl"></label>
      <label class="field"><span class="label">Date</span><input id="f-date" type="date" value="${esc(D.date)}"></label></div>
    <div class="items">${D.items.map((it,i)=>`<div class="item">
      ${it.name && it.name!==it.product?`<span class="printed" title="As printed">${esc(it.name)}</span>`:""}
      <input data-i="${i}" data-f="product" value="${esc(it.product)}" placeholder="Product, e.g. milk" aria-label="Product">
      <input class="price" data-i="${i}" data-f="price" inputmode="decimal" value="${esc(it.price||"")}" placeholder="0.00" aria-label="Price">
      <button class="x" data-action="delitem" data-i="${i}" aria-label="Remove line">×</button>
      <div class="line2">
        <select data-i="${i}" data-f="category" aria-label="Category">${CATS.map(([id,l])=>`<option value="${id}" ${id===it.category?"selected":""}>${l}</option>`).join("")}</select>
        <input data-i="${i}" data-f="qty" inputmode="decimal" value="${esc(it.qty)}" aria-label="Quantity">
        <select data-i="${i}" data-f="unit" aria-label="Unit"><option value="pcs" ${it.unit==="pcs"?"selected":""}>pcs</option><option value="kg" ${it.unit==="kg"?"selected":""}>kg</option><option value="l" ${it.unit==="l"?"selected":""}>litre</option></select>
      </div></div>`).join("")}</div>
    <button class="btn ghost" data-action="additem">+ Add line</button>
    <div class="totals"><span>Total</span><span class="num" id="f-total">${money(total)}</span></div>
    <div id="f-warn">${mismatch?`<div class="warn">The receipt says ${money(D.printedTotal)}, the lines add up to ${money(total)}. A line may be missing or misread.</div>`:""}</div>
    <div class="actions"><button class="btn" data-action="save" ${D.demo?"disabled":""}>Save</button>
      ${!isNew&&!D.demo?`<button class="btn danger" data-action="delete" id="delBtn">Delete</button>`:""}</div>`);
}
function onEditorInput(e){
  const el = e.target; const D = S.draft; if (!D) return;
  if (el.id === "f-store") D.store = el.value; else if (el.id === "f-date") D.date = el.value;
  else if (el.dataset.f){ const it = D.items[+el.dataset.i]; const f = el.dataset.f;
    it[f] = el.value;
    if (f === "price" || f === "qty"){ const q = num(it.qty)||1; it.unitPrice = r2(num(it.price)/q); }
    const total = r2(sum(D.items.map(i=>num(i.price)))); const t = $("#f-total"); if (t) t.textContent = money(total);
    const w = $("#f-warn"); if (w) w.innerHTML = D.printedTotal && Math.abs(D.printedTotal-total) > .02 ? `<div class="warn">The receipt says ${money(D.printedTotal)}, the lines add up to ${money(total)}. A line may be missing or misread.</div>` : "";
  }
}
async function saveDraft(){
  const D = S.draft; if (!D) return;
  const items = D.items.map(it => { const qty = num(it.qty)||1, price = r2(num(it.price));
    const product = String(it.product||it.name||"").trim().toLowerCase();
    return {name: String(it.name||product).trim(), product, category: CAT[it.category]?it.category:"other", qty, unit: it.unit||"pcs", unitPrice: r2(price/qty), price}; })
    .filter(it => it.product || it.price);
  if (!items.length){ toast("Add at least one line with a price."); return; }
  if (!D.date){ toast("Pick a date."); return; }
  const rec = {id: D.id || rid(), date: D.date, store: String(D.store||"").trim(), items, source: D.source, createdAt: D.createdAt || new Date().toISOString()};
  if (D.printedTotal) rec.printedTotal = D.printedTotal;
  // learn corrections from scans
  let learned = false;
  if (D.original) items.forEach((it,i) => { const o = D.original[i]; if (o && it.name && (key(o.product)!==key(it.product) || o.category!==it.category)){ S.aliases[key(it.name)] = {product:it.product, category:it.category}; learned = true; } });
  const btn = document.querySelector('[data-action="save"]'); if (btn){ btn.disabled = true; btn.textContent = "Saving…"; }
  try {
    await persistReceipt(rec);
    if (learned) await persistProfile();
    S.month = mkOf(rec.date);
    closeSheet(); render(); toast(learned ? "Saved. Corrections remembered for next time." : "Saved");
  } catch(e){ if (btn){ btn.disabled = false; btn.textContent = "Save"; } toast("Couldn't save. Check your connection and try again."); }
}
async function deleteDraft(){
  const b = $("#delBtn"); if (!b) return;
  if (!b.dataset.armed){ b.dataset.armed = "1"; b.textContent = "Tap again to delete"; setTimeout(()=>{ if(b.isConnected){ delete b.dataset.armed; b.textContent = "Delete"; } }, 3000); return; }
  try { await removeReceipt(S.draft.id); closeSheet(); render(); toast("Deleted"); } catch(e){ toast("Couldn't delete. Try again."); }
}
 
/* ---------- backend (Supabase) ---------- */
const CFG = window.PARAGON_CONFIG || {};
const configured = !!(CFG.supabaseUrl && CFG.supabaseKey && window.supabase) && !/YOUR-/.test(CFG.supabaseUrl + CFG.supabaseKey);
// Accept the project URL with or without a trailing "/" or "/rest/v1/".
const SB_URL = String(CFG.supabaseUrl || "").trim().replace(/\/+$/, "").replace(/\/rest\/v1$/, "");
let sb = null;
try { if (configured) sb = window.supabase.createClient(SB_URL, String(CFG.supabaseKey).trim()); } catch(e){ console.error(e); }
const thisMonth = () => new Date().toISOString().slice(0,7);
const fromRow = r => ({id:r.id, date:r.date, store:r.store||"", items:r.items||[], source:r.source, printedTotal: r.printed_total==null ? null : Number(r.printed_total), createdAt:r.created_at});
 
async function loadData(){
  S.loaded = false; render();
  const [rec, prof] = await Promise.all([
    sb.from("receipts").select("*").order("date", {ascending:true}),
    sb.from("profiles").select("*").maybeSingle()
  ]);
  if (rec.error){ toast("Couldn't load your receipts. Check your connection."); console.error(rec.error); }
  S.real = (rec.data || []).map(fromRow);
  if (prof.data){ S.currency = prof.data.currency || "EUR"; S.aliases = prof.data.aliases || {}; fmtCache = {}; }
  S.loaded = true; render();
  refreshUsage();
  markActive(prof.data);
}
// Records the day of last use (no time, no device). Accounts unused for 12 months are deleted.
async function markActive(profile){
  const today = todayISO();
  if (profile && profile.last_active_at === today) return;
  await sb.from("profiles").upsert({user_id:S.user.id, last_active_at:today});
}
async function refreshUsage(){
  if (!sb || !S.user) return;
  const {data} = await sb.from("scan_usage").select("count").eq("month", thisMonth()).maybeSingle();
  S.used = data ? data.count : 0;
}
async function persistReceipt(rec){
  const row = {id:rec.id, date:rec.date, store:rec.store, items:rec.items, source:rec.source, printed_total: rec.printedTotal ?? null, updated_at:new Date().toISOString()};
  const {error} = await sb.from("receipts").upsert(row);
  if (error) throw error;
  const i = S.real.findIndex(r=>r.id===rec.id); if (i>=0) S.real[i] = rec; else S.real.push(rec);
  S.real.sort((a,b)=>a.date.localeCompare(b.date));
}
async function removeReceipt(id){
  const {error} = await sb.from("receipts").delete().eq("id", id);
  if (error) throw error;
  S.real = S.real.filter(r=>r.id!==id);
}
async function persistProfile(){
  const {error} = await sb.from("profiles").upsert({user_id:S.user.id, currency:S.currency, aliases:S.aliases, updated_at:new Date().toISOString()});
  if (error) throw error;
}
 
/* ---------- scanning ---------- */
// Shrinks the photo on the phone before upload: faster, cheaper, and the AI doesn't need more.
async function prepareImage(file){
  let src;
  try { src = await createImageBitmap(file); }
  catch(_){ src = await new Promise((ok, bad) => { const im = new Image(); im.onload = () => ok(im); im.onerror = bad; im.src = URL.createObjectURL(file); }); }
  const w = src.width, h = src.height, k = Math.min(1, 1568 / Math.max(w, h));
  const c = document.createElement("canvas"); c.width = Math.round(w*k); c.height = Math.round(h*k);
  c.getContext("2d").drawImage(src, 0, 0, c.width, c.height);
  const blob = await new Promise(ok => c.toBlob(ok, "image/jpeg", .85));
  const dataUrl = await new Promise(ok => { const r = new FileReader(); r.onload = () => ok(r.result); r.readAsDataURL(blob); });
  return String(dataUrl).split(",")[1];
}
 
async function runScan(file){
  const url = URL.createObjectURL(file);
  S.draft = {imageUrl:url, source:"scan", items:[]};
  const ctl = new AbortController(); S.scanCtl = ctl;
  openSheet(`<div class="sheet-head"><h2>Scanning</h2>${closeBtn}</div>
    <img class="thumb" src="${url}" alt="Your receipt photo">
    <div class="scanning"><div class="progress"><i></i></div><span class="muted small">Reading shop, date, products and prices… this usually takes 5–20 seconds.</span>
    <button class="btn ghost" data-action="close">Stop</button></div>`);
  let code = "server_error", detail = "";
  try {
    const image = await prepareImage(file);
    if (ctl.signal.aborted) return;
    const {data, error} = await sb.functions.invoke("scan-receipt", {body:{image, mediaType:"image/jpeg"}, signal: ctl.signal});
    if (ctl.signal.aborted) return;
    if (error){
      detail = `${error.name || "Error"}: ${error.message || ""}` + (error.context?.status ? ` (HTTP ${error.context.status})` : "");
      try { const b = await error.context.json(); code = b.error || code; if (b.limit) S.limit = b.limit; detail += ` · ${JSON.stringify(b).slice(0,200)}`; } catch(_){ code = navigator.onLine ? "server_error" : "offline"; }
      throw new Error(code);
    }
    S.scanCtl = null;
    const res = data.receipt; S.used = data.used; S.limit = data.limit;
    const items = res.items.map(it => {
      const name = String(it.name||"").trim(); let product = key(it.product || name); let category = CAT[it.category] ? it.category : "other";
      const a = S.aliases[key(name)]; if (a){ product = a.product; category = a.category; }
      const qty = num(it.qty)||1, price = r2(num(it.price)); const unit = ["pcs","kg","l"].includes(it.unit)?it.unit:"pcs";
      return {name, product, category, qty, unit, unitPrice: r2(num(it.unitPrice) || price/qty), price};
    });
    const date = /^\d{4}-\d{2}-\d{2}$/.test(res.date||"") ? res.date : todayISO();
    startEditor({imageUrl:url, source:"scan", store:String(res.store||"").trim(), date, printedTotal: num(res.total)||null, items, original: items.map(i=>({...i}))});
  } catch(e){
    if (ctl.signal.aborted || e?.name === "AbortError") return;
    S.scanCtl = null;
    if (!detail) detail = `${e?.name || "Error"}: ${e?.message || e}`;
    console.error("scan failed", code, detail, e);
    code = e?.message && e.message !== "Failed to fetch" ? e.message : code;
    const msg = {
      not_receipt: "That doesn't look like a receipt. Try a sharper, well-lit photo of the whole slip.",
      unreadable: "The receipt couldn't be read cleanly. Try again with a flatter, sharper photo.",
      limit_reached: `You've used all ${S.limit || ""} scans for this month. You can still add receipts by hand.`,
      busy: "The scanner is busy right now. Try again in a minute.",
      bad_image: "This photo couldn't be used. Try a JPEG or PNG photo.",
      not_signed_in: "Your session has ended. Sign in again to scan.",
      offline: "You're offline. Connect to the internet to scan, or add the receipt by hand."
    }[code] || "Something went wrong while reading the receipt. Try again, or add it by hand.";
    openSheet(`<div class="sheet-head"><h2>Couldn't read it</h2>${closeBtn}</div>
      ${S.draft?.imageUrl?`<img class="thumb" src="${S.draft.imageUrl}" alt="Your receipt photo">`:""}
      <div class="warn">${esc(msg)}</div>
      <details class="small muted"><summary>Technical details</summary><code style="word-break:break-all">${esc(code)} · ${esc(detail)} · ${esc(location.origin)}</code></details>
      <div class="actions">${code!=="limit_reached"?`<button class="btn" data-action="scan">Try another photo</button>`:""}<button class="btn ghost" data-action="manual-keep">Enter by hand</button></div>`);
  }
}
 
/* ---------- export & account ---------- */
function exportCsv(){
  const q = v => { const s = String(v ?? ""); return /[",\n;]/.test(s) ? `"${s.replace(/"/g,'""')}"` : s; };
  const rows = [["date","store","source","product","name_on_receipt","category","qty","unit","unit_price","price","currency"]];
  [...S.real].sort((a,b)=>a.date.localeCompare(b.date)).forEach(r => (r.items||[]).forEach(it =>
    rows.push([r.date, r.store, r.source, it.product, it.name, CAT[it.category]||"Other", it.qty, it.unit, it.unitPrice, it.price, S.currency])));
  if (rows.length === 1){ toast("Nothing to export yet."); return; }
  const blob = new Blob(["﻿" + rows.map(r=>r.map(q).join(",")).join("\n")], {type:"text/csv;charset=utf-8"});
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `mijnparagon-${todayISO()}.csv`;
  document.body.appendChild(a); a.click(); setTimeout(()=>{ URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
async function deleteAccount(){
  const b = $("#delAccBtn"); if (!b) return;
  if (!b.dataset.armed){ b.dataset.armed = "1"; b.textContent = "Tap again: this can't be undone"; setTimeout(()=>{ if(b.isConnected){ delete b.dataset.armed; b.textContent = "Delete my account and all data"; } }, 4000); return; }
  b.disabled = true; b.textContent = "Deleting…";
  const {error} = await sb.functions.invoke("delete-account", {body:{}});
  if (error){ b.disabled = false; b.textContent = "Delete my account and all data"; toast("Couldn't delete the account. Try again."); return; }
  closeSheet(); await sb.auth.signOut(); toast("Your account and data were deleted.");
}
 
/* ---------- sign-in screens ---------- */
const BRAND = document.querySelector(".brand").outerHTML;
let authMode = "signin", authMsg = null;
function showAuth(mode, msg){
  if (mode) authMode = mode; authMsg = msg || null;
  $("#app").hidden = true; $("#tabs").hidden = true; closeSheet();
  const root = $("#authRoot"); root.hidden = false;
  const m = authMsg ? `<div class="msg ${authMsg.err?"err":""}">${esc(authMsg.text)}</div>` : "";
  const privacy = `<p class="foot">By creating an account you agree to the <a href="${esc(CFG.privacyUrl||"privacy.html")}" target="_blank" rel="noopener">privacy policy</a>.</p>`;
  if (!configured){
    root.innerHTML = `<div class="auth">${BRAND}<div class="msg err">MijnParagon isn't connected to its database yet. Fill in <b>config.js</b> with your Supabase URL and key (see README).</div></div>`; return;
  }
  const forms = {
    signin: `<h2 style="text-align:center">Sign in</h2>
      <form data-form="signin"><label class="field"><span class="label">Email</span><input id="a-email" type="email" autocomplete="email" required></label>
      <label class="field"><span class="label">Password</span><input id="a-pass" type="password" autocomplete="current-password" required></label>
      <button class="btn wide" type="submit">Sign in</button></form>
      <div class="switch"><button class="linkbtn" data-auth="signup">Create an account</button><button class="linkbtn" data-auth="forgot">Forgot password?</button></div>`,
    signup: `<h2 style="text-align:center">Create your account</h2>
      <form data-form="signup"><label class="field"><span class="label">Email</span><input id="a-email" type="email" autocomplete="email" required></label>
      <label class="field"><span class="label">Password (at least 8 characters)</span><input id="a-pass" type="password" autocomplete="new-password" minlength="8" required></label>
      <button class="btn wide" type="submit">Create account</button></form>
      <div class="switch"><button class="linkbtn" data-auth="signin">I already have an account</button></div>${privacy}`,
    forgot: `<h2 style="text-align:center">Reset your password</h2>
      <form data-form="forgot"><label class="field"><span class="label">Email</span><input id="a-email" type="email" autocomplete="email" required></label>
      <button class="btn wide" type="submit">Send reset link</button></form>
      <div class="switch"><button class="linkbtn" data-auth="signin">Back to sign in</button></div>`,
    reset: `<h2 style="text-align:center">Choose a new password</h2>
      <form data-form="reset"><label class="field"><span class="label">New password (at least 8 characters)</span><input id="a-pass" type="password" autocomplete="new-password" minlength="8" required></label>
      <button class="btn wide" type="submit">Save password</button></form>`
  };
  root.innerHTML = `<div class="auth">${BRAND}<p class="lead">Scan your receipts. See where the money goes and how your prices change.</p>${m}${forms[authMode]}</div>`;
}
const redirectTo = () => location.origin + location.pathname;
document.addEventListener("submit", async e => {
  const f = e.target.closest("[data-form]"); if (!f) return;
  e.preventDefault();
  const btn = f.querySelector("button[type=submit]"); btn.disabled = true;
  const email = $("#a-email")?.value.trim(), password = $("#a-pass")?.value;
  try {
    if (f.dataset.form === "signin"){
      const {error} = await sb.auth.signInWithPassword({email, password});
      if (error) showAuth("signin", {err:true, text: /confirm/i.test(error.message) ? "Confirm your email first: open the link we sent you." : "Email or password is wrong."});
    } else if (f.dataset.form === "signup"){
      const {data, error} = await sb.auth.signUp({email, password, options:{emailRedirectTo: redirectTo()}});
      if (error) showAuth("signup", {err:true, text: error.message});
      else if (!data.session) showAuth("signin", {text:`Almost done: we sent a confirmation link to ${email}. Open it, then sign in.`});
    } else if (f.dataset.form === "forgot"){
      const {error} = await sb.auth.resetPasswordForEmail(email, {redirectTo: redirectTo()});
      showAuth("signin", error ? {err:true, text:error.message} : {text:`If ${email} has an account, a reset link is on its way.`});
    } else if (f.dataset.form === "reset"){
      const {error} = await sb.auth.updateUser({password});
      if (error) showAuth("reset", {err:true, text:error.message}); else { toast("Password changed"); enterApp(); }
    }
  } catch(err){ showAuth(authMode, {err:true, text:"No connection. Check your internet and try again."}); }
  finally { if (btn.isConnected) btn.disabled = false; }
});
function enterApp(){
  if (/access_token/.test(location.hash)) history.replaceState(null, "", location.pathname);
  $("#authRoot").hidden = true; $("#app").hidden = false; $("#tabs").hidden = false;
  loadData();
}
 
/* ---------- events ---------- */
document.addEventListener("click", e => {
  const au = e.target.closest("[data-auth]"); if (au){ showAuth(au.dataset.auth); return; }
  const t = e.target.closest("[data-action],[data-nav],[data-cat],[data-prod],[data-receipt],[data-month],[data-scrim]");
  if (!t) return;
  if (t.dataset.scrim !== undefined && e.target !== t) return;
  if (t.dataset.scrim !== undefined){ if (!S.scanCtl) closeSheet(); return; }
  if (t.dataset.nav){ S.view = t.dataset.nav; if (location.hash !== "#"+S.view) history.replaceState(null, "", "#"+S.view); closeSheet(); render(); window.scrollTo(0,0); return; }
  if (t.dataset.month){ const A = analyze(receipts()); const allM = A.mks.includes(A.curMk) ? A.mks : [...A.mks, A.curMk]; const i = allM.indexOf(S.month) + +t.dataset.month; if (allM[i]){ S.month = allM[i]; S.openCat = null; render(); } return; }
  if (t.dataset.cat){ S.openCat = S.openCat === t.dataset.cat ? null : t.dataset.cat; render(); return; }
  if (t.dataset.prod){ sheetProduct(t.dataset.prod); return; }
  if (t.dataset.receipt){ const r = receipts().find(x=>x.id===t.dataset.receipt); if (r) startEditor({...JSON.parse(JSON.stringify(r)), printedTotal:r.printedTotal||null}); return; }
  const a = t.dataset.action;
  if (a === "add") sheetAdd();
  else if (a === "settings") sheetSettings();
  else if (a === "close") closeSheet();
  else if (a === "scan"){ if (S.limit && S.used >= S.limit){ toast(`You've used all ${S.limit} scans this month.`); return; } const fi = $("#fileInput"); fi.value = ""; fi.click(); }
  else if (a === "manual"){ closeSheet(); startEditor({source:"manual", store:"", date:todayISO(), items:[blankItem()]}); }
  else if (a === "manual-keep"){ const url = S.draft?.imageUrl; S.draft = null; startEditor({source:"scan", imageUrl:url, store:"", date:todayISO(), items:[blankItem()]}); }
  else if (a === "additem"){ S.draft.items.push(blankItem()); renderEditor(); const ins = document.querySelectorAll('[data-f="product"]'); ins[ins.length-1]?.focus(); }
  else if (a === "delitem"){ S.draft.items.splice(+t.dataset.i, 1); if (!S.draft.items.length) S.draft.items.push(blankItem()); renderEditor(); }
  else if (a === "save") saveDraft();
  else if (a === "delete") deleteDraft();
  else if (a === "export") exportCsv();
  else if (a === "signout"){ closeSheet(); sb.auth.signOut(); }
  else if (a === "delaccount") deleteAccount();
});
document.addEventListener("input", e => {
  if (e.target.id === "q"){ S.q = e.target.value; S._focusQ = true; render(); S._focusQ = false; return; }
  if (S.draft) onEditorInput(e);
});
document.addEventListener("change", async e => {
  if (e.target.id === "cur"){ S.currency = e.target.value; fmtCache = {}; render(); try { await persistProfile(); } catch(_){ toast("Couldn't save the currency."); } return; }
  if (e.target.id === "fileInput"){ const f = e.target.files?.[0]; if (f) runScan(f); return; }
  if (S.draft && e.target.tagName === "SELECT") onEditorInput(e);
});
document.addEventListener("keydown", e => { if (e.key === "Escape" && $("#sheetRoot").firstChild) closeSheet(); });
function fromHash(){ const h = location.hash.slice(1); if (["home","products","inflation","history"].includes(h)){ S.view = h; if (S.user) render(); } }
window.addEventListener("hashchange", fromHash);
 
/* ---------- boot ---------- */
const h0 = location.hash.slice(1); if (["home","products","inflation","history"].includes(h0)) S.view = h0;
if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(()=>{});
if (!sb) showAuth();
else {
  // A password-reset link lands here with "type=recovery" in the address.
  let recovering = /type=recovery/.test(location.hash);
  const linkErr = /error_description/.test(location.hash) ? new URLSearchParams(location.hash.slice(1)).get("error_description") : null;
  if (linkErr) setTimeout(() => { showAuth("signin", {err:true, text: linkErr + ". Request a new link."}); history.replaceState(null, "", location.pathname); }, 300);
  sb.auth.onAuthStateChange((event, session) => {
    if (event === "PASSWORD_RECOVERY" || (recovering && session)){
      recovering = false; S.user = session?.user || null; S.pendingReset = true; setTimeout(() => showAuth("reset"), 0); return;
    }
    if (S.pendingReset && event !== "USER_UPDATED") return;
    if (event === "USER_UPDATED"){ S.pendingReset = false; return; }
    const u = session?.user || null;
    if (u && (!S.user || S.user.id !== u.id)){ S.user = u; setTimeout(enterApp, 0); }
    else if (!u && S.user !== null){ S.user = null; S.real = []; S.loaded = false; S.aliases = {}; S.used = null; showAuth("signin"); }
    else if (!u && event === "INITIAL_SESSION") { S.user = null; showAuth("signin"); }
  });
}
})();
