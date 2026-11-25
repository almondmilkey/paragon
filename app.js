 
(() => {
"use strict";
/* ---------- constants ---------- */
const CATS = [
  ["bakery","Bread & bakery"],["dairy","Dairy & cheese"],["meat","Meat & fish"],["produce","Fruit & veg"],
  ["pantry","Pantry"],["snacks","Snacks & sweets"],["drinks","Drinks"],["alcohol","Alcohol & tobacco"],["household","Household"],
  ["hygiene","Hygiene & cosmetics"],["clothes_and_shoes","Clothes and shoes"],["transport","Transport"],["eating_out","Eating out"],
  ["health","Health"],["leisure","Leisure & subscriptions"],["housing","Rent & utilities"],
  ["child_care","Child care"],["pet_care","Pet care"],["telecommunications","Telecommunications"],
  ["insurance_financial","Insurance & financial services"],["education","Education"],
  ["arts_culture","Arts & culture"],["sports_fitness","Sports & fitness"],["specialized_equipment","Specialized equipment"],
  ["car_expenses","Car Expenses"],["other","Other"]];
const CAT = Object.fromEntries(CATS);
const CURRENCIES = ["EUR","PLN","USD","GBP","CHF"];
const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const MONTHS_LONG = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const LS_R = "paragon.receipts.v1", LS_P = "paragon.profile.v1";
 
/* ---------- state ---------- */
const S = {
  view: "home", month: null, openCat: null, q: "", withFixed: false, rules: [],
  real: [], loaded: false, currency: "EUR", aliases: {},
  user: null, draft: null, scanCtl: null, used: null, limit: null,
  openNotes: new Set(),  // fold-out notes the person opened, kept open when the page redraws
  cards: {current:null, since:null, unlocked:{}, readings:[], unseen:null}, demoCards: null, dealCard: null
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
// total of a receipt, a repeat rule or the draft in the editor
const itemsTotal = r => r2(sum((r.items||[]).map(i => num(i.price))));
/* Three kinds of receipt lines (stored as items[].kind):
   - "product" (the default, usually not stored): something you bought. price = what you paid after offers,
     discount = what the offers saved you on that line (a positive amount, 0 when none).
   - "deposit": a bottle deposit you paid (statiegeld, Pfand, kaucja). Not spending: you can get it back.
   - "deposit_return": a deposit you got back (a negative amount on the receipt). Not a discount either:
     it's your own money returning.
   Older receipts stored deposits as a product called "bottle deposit"; they are read as deposits. */
const kindOf = it => {
  if (it.kind === "deposit" || it.kind === "deposit_return") return it.kind;
  const p = key(it.product);
  if (p === "bottle deposit") return num(it.price) < 0 ? "deposit_return" : "deposit";
  if (p === "deposit return") return "deposit_return";
  return "product";
};
// product lines only: what counts as spending everywhere (deposits are left out)
const lines = r => (r.items || []).filter(it => kindOf(it) === "product");
const discOf = it => Math.max(0, num(it.discount));
// A discount on the whole receipt (a coupon, % off the total, loyalty points) is spread over the products in
// proportion to their price, so every product carries its share and the lines still add up to the total paid.
function spreadReceiptDiscount(items, amount){
  const prods = items.filter(it => kindOf(it) === "product" && num(it.price) > 0);
  const base = sum(prods.map(it => num(it.price)));
  if (!(amount > 0) || !base) return;
  let left = r2(Math.min(amount, base));
  prods.forEach((it, i) => {
    const want = i === prods.length - 1 ? left : r2(amount * num(it.price) / base);
    const d = Math.min(want, num(it.price), left);
    it.price = r2(num(it.price) - d); it.discount = r2(discOf(it) + d); left = r2(left - d);
    it.unitPrice = r2(it.price / (num(it.qty) || 1));
  });
}
const dayOf = iso => +String(iso).slice(8,10) || 1;
const daysIn = mk => { const [y,m] = mk.split("-").map(Number); return new Date(y, m, 0).getDate(); };
const catOf = c => CAT[c] ? c : "other";
const byDate = (a,b) => a.date.localeCompare(b.date);
const plural = n => n===1 ? "" : "s";
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
  // [shop, price level, how often you go there]: discounters are clearly cheaper, and the demo person
  // does most shopping at a pricier supermarket, so the shop comparison has something to show
  // Over the months they drift towards Edeka, so the demo tells one story: spending creeps up partly through shop choice.
  const stores = [["Edeka",1.14],["Lidl",.94],["REWE",1.10],["Aldi Nord",.92]];
  const pickStore = monthsIn => { const e = .25 + .04*monthsIn, w = [e, (1-e)*.45, (1-e)*.3, (1-e)*.25];
    let r = rnd(); for (let i = 0; i < stores.length; i++){ if ((r -= w[i]) < 0) return stores[i]; } return stores[0]; };
  const drift = {coffee:.012, butter:-.006, "olive oil":.009, cheese:.006, eggs:.005, chocolate:.01};
  const out = []; const now = new Date(); const curMk = mkOf(todayISO());
  for (let k = 7; k >= 0; k--){
    const mk = addMonths(curMk, -k);
    const lastDay = k===0 ? now.getDate() : daysIn(mk);
    const trips = k===0 ? 2 : 6 + Math.floor(rnd()*3);
    for (let t = 0; t < trips; t++){
      const d = Math.max(1, Math.min(lastDay, Math.round((t+.5)*lastDay/trips)));
      const [store, mult] = pickStore(7-k);
      const items = [];
      P.forEach(([prod,name,cat,unit,base,[q0,q1],p]) => {
        if (rnd() > p) return;
        const months = 7-k; const g = .006 + (drift[prod]||0);
        const regUnit = r2(base*mult*Math.pow(1+g, months)*(1+(rnd()-.5)*.03));
        const qty = unit === "kg" ? r2(q0 + rnd()*(q1-q0)) : Math.round(q0 + rnd()*(q1-q0));
        const regular = r2(qty*regUnit), discount = rnd() < .08 ? r2(regular*.2) : 0;   // promotion: 20% off
        const it = {name, product:prod, category:cat, qty, unit, unitPrice:r2((regular-discount)/qty), price:r2(regular-discount)};
        if (discount) it.discount = discount;
        items.push(it);
        if (prod === "sparkling water") items.push({name:"PFAND", product:"bottle deposit", category:"other", kind:"deposit", qty, unit:"pcs", unitPrice:.25, price:r2(qty*.25)});
      });
      if (items.length && rnd() < .2) items.push({name:"LEERGUT", product:"deposit return", category:"other", kind:"deposit_return", qty:1, unit:"pcs", unitPrice:-1.25, price:-1.25});
      if (items.length) out.push({id:`demo-${mk}-${t}`, date:`${mk}-${pad(d)}`, store, items, source:"scan", demo:true});
    }
    const man = (day, store, product, cat, price) => { if (k===0 && day>now.getDate()) return; out.push({id:`demo-${mk}-${product}`, date:`${mk}-${pad(day)}`, store, source:"manual", demo:true, items:[{name:product, product, category:cat, qty:1, unit:"pcs", unitPrice:price, price}]}); };
    man(1, "Landlord", "rent", "housing", 900);
    man(3, "Monthly transit pass", "transit pass", "transport", 63);
    man(15, "Vattenfall", "electricity & heating", "housing", r2(92 + rnd()*22));
    for (let e = 0; e < 2 + Math.floor(rnd()*3); e++) man(5+e*6, ["Café Liebling","Pho Hanoi","Pizzeria Due"][e%3], "restaurant", "eating_out", r2(14 + rnd()*30));
    if (rnd() < .4) man(20, "Uniqlo", "clothing", "clothes_and_shoes", r2(29 + rnd()*60));
  }
  return out.sort(byDate);
}
const DEMO = makeDemo();
const receipts = () => S.real.length ? S.real : (S.loaded ? DEMO : []);
const isDemo = () => S.loaded && S.real.length === 0;
 
/* ---------- analysis ---------- */
function analyze(list){
  const months = {}, products = {};
  for (const r of list){
    const mk = mkOf(r.date); if (!mk) continue;
    const M = months[mk] ||= {total:0, cats:{}, prods:{}, count:0, minDay:31, premium:0, premCats:{}, premProds:{}, offers:0, depPaid:0, depBack:0};
    M.count++; M.minDay = Math.min(M.minDay, dayOf(r.date));
    for (const it of r.items || []){ const k = kindOf(it);
      if (k === "deposit") M.depPaid += num(it.price); else if (k === "deposit_return") M.depBack += Math.abs(num(it.price)); }
    for (const it of lines(r)){
      const price = num(it.price); const cat = catOf(it.category), disc = discOf(it);
      M.total += price; M.offers += disc; M.cats[cat] = (M.cats[cat]||0) + price;
      const pk = key(it.product || it.name); if (!pk) continue;
      M.prods[pk] = (M.prods[pk]||0) + price;
      const P = products[pk] ||= {key:pk, label:it.product || it.name, category:cat, buys:[], total:0};
      P.total += price;
      // unitPrice = the regular price per unit (before offers). Price comparisons (price premium, inflation, shops)
      // use it, so a one-off promotion isn't mistaken for a price change; offers are counted on their own.
      const qty = num(it.qty) || 1; const up = disc ? (price + disc)/qty : (num(it.unitPrice) || (qty ? price/qty : price));
      P.buys.push({date:r.date, mk, cat, price, discount:disc, qty, unit:it.unit||"pcs", unitPrice:up, store:r.store||""});
    }
  }
  const mks = Object.keys(months).sort();
  const curMk = mkOf(todayISO());
  // leave out the running month, and a first month that was only partly tracked
  const completeMks = mks.filter(m => m < curMk && !(m === mks[0] && months[m].minDay > 5));
  const complete = completeMks.map(m => months[m].total);
  const stats = {avg: mean(complete), sd: sd(complete), n: complete.length};
  for (const P of Object.values(products)){
    P.buys.sort(byDate);
    const ups = P.buys.map(b=>b.unitPrice);
    P.avgUnit = mean(ups); P.minUnit = Math.min(...ups); P.maxUnit = Math.max(...ups); P.sdUnit = sd(ups);
    P.unit = P.buys[P.buys.length-1].unit;
    const byM = {}; P.buys.forEach(b => (byM[b.mk] ||= []).push(b.unitPrice));
    P.monthly = Object.fromEntries(Object.entries(byM).map(([m,a])=>[m, mean(a)]));
    P.monthsBought = Object.keys(byM).length;
    const pm = Object.keys(byM).sort();
    P.firstMk = pm[0]; P.lastMk = pm[pm.length-1];
    P.pc = sameShopChange(P, mks.slice(-13));   // price change: same product, same shop, last 12 months
    P.change = P.pc ? P.pc.change : null;
    P.lastUnit = ups[ups.length-1];
    P.lastVsAvg = P.avgUnit ? P.lastUnit/P.avgUnit - 1 : 0;
    const st = {}; P.buys.forEach(b => { if (b.store) (st[b.store] ||= []).push(b.unitPrice); });
    const sts = Object.entries(st).map(([s,a])=>[s, mean(a), a.length]).sort((a,b)=>a[1]-b[1]);
    P.stores = sts;
    P.share = mks.length ? P.monthsBought / mks.length : 0;
    P.perMonth = P.buys.length / Math.max(1, mks.length);
  }
  // price premium: what you paid above the cheapest regular price you paid for the same product in the same month
  // (compared per unit, before offers: what offers saved you is counted separately, never twice). Staying within one month keeps inflation from counting as a premium. Services and
  // fixed costs are left out (PREMIUM_OUT): there a different price usually means a different choice.
  let premium = 0;
  for (const P of Object.values(products)){
    P.premium = 0; if (PREMIUM_OUT.includes(P.category) || P.buys.length < 2) continue;
    const lo = {}, k = b => b.mk + "|" + b.unit;
    P.buys.forEach(b => { lo[k(b)] = Math.min(lo[k(b)] ?? Infinity, b.unitPrice); });
    for (const b of P.buys){
      const p = (b.unitPrice - lo[k(b)]) * b.qty; if (!(p >= 0.005)) continue;
      const M = months[b.mk]; P.premium += p; premium += p; M.premium += p;
      M.premCats[b.cat] = (M.premCats[b.cat]||0) + p; M.premProds[P.key] = (M.premProds[P.key]||0) + p;
    }
  }
  const staples = Object.values(products).filter(P => P.category !== "housing" && mks.length >= 2 && P.monthsBought >= 2 && P.share > .5)
    .sort((a,b)=> b.share - a.share || b.total - a.total);
  const allM = Object.values(months);
  const offers = sum(allM.map(M => M.offers)), deposit = {paid: sum(allM.map(M => M.depPaid)), back: sum(allM.map(M => M.depBack))};
  return {months, mks, completeMks, stats, products, staples, curMk, premium, offers, deposit};
}
// every month you can step through on Home: all months with receipts, plus the running one
const monthList = A => A.mks.includes(A.curMk) ? A.mks : [...A.mks, A.curMk];
 
/* Personal price index, chained month to month. Each month, every product bought in both that month and the one
   before is compared on price per unit, weighted by what you spent on it.
   sameShop: true → only the same product at the same shop counts: pure price change (inflation), the same rule as
     "Why your spending changed" on Overview. Prices are regular prices (before offers), so a promotion isn't
     counted as a price change: what offers saved you shows up separately ("Offers" and "Found for you").
   sameShop: false → the price you paid wherever you bought it, so switching shops moves it too.
   The gap between the two is what your choice of shop added or saved. */
const NO_INDEX = new Set(["housing","eating_out","clothes_and_shoes","leisure","health","transport"]);
const indexable = (P, cat) => !NO_INDEX.has(P.category) && (!cat || P.category === cat);
function chainIndex(A, {sameShop = true, cat = null} = {}){
  const per = {}; const used = new Set();
  for (const P of Object.values(A.products)){
    if (!indexable(P, cat)) continue;
    for (const b of P.buys){
      if (!(b.qty > 0) || (sameShop && !b.store)) continue;
      const g = P.key + "|" + b.unit + (sameShop ? "|" + key(b.store) : "");
      const X = ((per[g] ||= {P, m:{}}).m[b.mk] ||= {q:0, e:0}); X.q += b.qty; X.e += b.unitPrice * b.qty;
    }
  }
  const pts = []; let v = 100;
  A.mks.forEach((mk, i) => {
    if (i){ const prev = A.mks[i-1]; let w = 0, s = 0;
      for (const G of Object.values(per)){ const x = G.m[prev], y = G.m[mk]; if (!x || !y) continue;
        const wt = (x.e + y.e)/2; w += wt; s += wt * (y.e/y.q)/(x.e/x.q); used.add(G.P.key); }
      if (w) v *= s/w; }
    pts.push({mk, v});
  });
  return {pts, count: used.size};
}
// change over the last 12 months (or since your first month), from an index
function indexChange(I){ const p = I.pts; if (p.length < 2) return null; const ref = p[Math.max(0, p.length-13)]; return {ref, span: p.length-1-p.indexOf(ref), ch: p[p.length-1].v/ref.v - 1}; }
// what the products in the index cost you in a year, from your recent months
function indexedSpendYear(A, cat){
  const W = new Set(saveWindow(A)); let e = 0;
  for (const P of Object.values(A.products)) if (indexable(P, cat)) e += sum(P.buys.filter(b => W.has(b.mk)).map(b => b.price));
  return e / Math.max(1, W.size) * 12;
}
// A product's price change: for each shop where you bought it in two or more months (within W), your first month's
// price per unit against your last; shops you spend more at count more. The single definition used everywhere
// (Inflation tab, product list, product sheet), so the numbers always agree.
function sameShopChange(P, W){
  const Wset = new Set(W), st = {};
  for (const b of P.buys){ if (!Wset.has(b.mk) || !b.store || !(b.qty > 0) || b.unit !== P.unit) continue;
    const S_ = st[key(b.store)] ||= {name:b.store, m:{}, e:0}; const X = S_.m[b.mk] ||= {q:0, e:0}; X.q += b.qty; X.e += b.unitPrice*b.qty; S_.e += b.unitPrice*b.qty; }
  let w = 0, dch = 0, dp = 0, main = null, since = null;
  for (const S_ of Object.values(st)){
    const ms = Object.keys(S_.m).sort(); if (ms.length < 2) continue;
    const f = S_.m[ms[0]], l = S_.m[ms[ms.length-1]], p0 = f.e/f.q, p1 = l.e/l.q;
    w += S_.e; dch += S_.e * (p1/p0 - 1); dp += S_.e * (p1 - p0);
    if (!main || S_.e > main.e) main = S_; if (!since || ms[0] < since) since = ms[0];
  }
  return w ? {change: dch/w, perUnit: dp/w, shop: main.name, since} : null;
}
// biggest price changes, ranked by what they cost you in a year
function priceMovers(A){
  const W = A.mks.slice(-13), Wset = new Set(W), recent = new Set(saveWindow(A)), out = [];
  for (const P of Object.values(A.products)){
    if (!indexable(P) || !P.pc) continue;
    const buys = P.buys.filter(b => Wset.has(b.mk) && b.qty > 0 && b.unit === P.unit);
    const year = P.pc.perUnit * sum(buys.map(b => b.qty)) / W.length * 12;
    // where it's cheaper now: recent average price per shop, against the shop you mostly buy it at
    const st = {};
    for (const b of buys){ if (!recent.has(b.mk) || !b.store) continue; const X = st[key(b.store)] ||= {name:b.store, q:0, e:0}; X.q += b.qty; X.e += b.unitPrice*b.qty; }
    const mainR = st[key(P.pc.shop)], cheaper = Object.values(st).filter(X => X !== mainR).map(X => ({name:X.name, p:X.e/X.q})).sort((x,y) => x.p - y.p)[0];
    out.push({P, change: P.pc.change, year, shop: P.pc.shop, cheaper: mainR && cheaper && cheaper.p < (mainR.e/mainR.q)*.97 ? cheaper : null});
  }
  return out;
}

/* why spending changed: a month vs. the previous one, split into inflation / where you shop / offers / habits.
   Spending is what you paid (after offers). Prices are compared as regular prices (before offers).
   Price effect per product (Bennet): (p1 - p0) * (q0 + q1)/2, with p = regular price per unit. The part of it seen
   at the same place in both months is inflation, the rest comes from switching places. Offers = how much less
   (or more) you saved with offers than the month before. Everything else (quantities, new or dropped products)
   is habits, so the four parts add up exactly to the change. The running month is compared with the same days
   of the previous month. Bottle deposits are left out: they're not spending. */
function decompose(list, mk, curMk){
  const prevMk = addMonths(mk, -1), cut = mk === curMk ? +todayISO().slice(8,10) : 31;
  const per = [{}, {}], tot = [0, 0];
  for (const r of list){
    const m = mkOf(r.date), t = m === prevMk ? 0 : m === mk ? 1 : -1; if (t < 0) continue;
    if (dayOf(r.date) > cut) continue;
    const st = key(r.store);
    for (const it of lines(r)){
      const price = num(it.price), disc = discOf(it), reg = price + disc; tot[t] += price;
      const pk = key(it.product || it.name); if (!pk) continue;
      const q = num(it.qty) || 1, G = per[t][pk + "|" + (it.unit || "pcs")] ||= {l:it.product || it.name, q:0, e:0, r:0, d:0, st:{}};
      G.q += q; G.e += price; G.r += reg; G.d += disc; const X = G.st[st] ||= {q:0, r:0}; X.q += q; X.r += reg;
    }
  }
  const D = {prevMk, cut, e0:tot[0], e1:tot[1]}; if (!tot[0]) return D;
  let infl = 0, stores = 0, offers = 0; const drv = {};
  for (const k of new Set([...Object.keys(per[0]), ...Object.keys(per[1])])){
    const a = per[0][k], b = per[1][k];
    const dv = drv[k] = {l:(b || a).l, change:(b ? b.e : 0) - (a ? a.e : 0), infl:0, stores:0, offers: -((b ? b.d : 0) - (a ? a.d : 0))};
    offers += dv.offers; dv.habits = dv.change - dv.offers;
    if (!a || !a.q || !b || !b.q) continue;
    const qm = (a.q + b.q)/2, priceEff = (b.r/b.q - a.r/a.q) * qm;
    let w = 0, d = 0;
    for (const s in b.st){ const x = a.st[s], y = b.st[s]; if (!x || !x.q || !y.q) continue; const ws = (x.q + y.q)/2; w += ws; d += ws * (y.r/y.q - x.r/x.q); }
    const inf = w ? d/w * qm : 0; infl += inf; stores += priceEff - inf;
    dv.infl = inf; dv.stores = priceEff - inf; dv.habits = dv.change - priceEff - dv.offers;
  }
  D.drivers = Object.values(drv).filter(x => Math.abs(x.change) >= 0.005 || Math.abs(x.infl) + Math.abs(x.stores) + Math.abs(x.offers) >= 0.005)
    .sort((x,y) => Math.abs(y.change) - Math.abs(x.change)).slice(0, 3);
  D.change = tot[1] - tot[0]; D.infl = infl; D.stores = stores; D.offers = offers; D.habits = D.change - infl - stores - offers;
  return D;
}

/* ---------- charts ---------- */
function niceMax(v){ if (v <= 0) return 1; const p = Math.pow(10, Math.floor(Math.log10(v))); const n = v/p; return (n<=1?1:n<=2?2:n<=2.5?2.5:n<=5?5:10)*p; }
const gridRow = (yy, label, L, x2) => `<line class="grid" x1="${L}" x2="${x2}" y1="${yy}" y2="${yy}"/><text x="${L-6}" y="${yy+3}" text-anchor="end">${esc(label)}</text>`;
const moneyGrid = (max, y, L, x2) => [0,.5,1].map(f => gridRow(y(max*f), money(max*f,0), L, x2)).join("");
const areaLine = (d, xEnd, L, yBase) => `<path class="area" d="${d}L${xEnd},${yBase}L${L},${yBase}Z"/><path class="line" d="${d}"/>`;
const endDot = (x, y, label) => `<circle class="dot" cx="${x}" cy="${y}" r="3.5"/><text class="end" x="${x+6}" y="${y+3}">${esc(label)}</text>`;
function barChart(A, sel){
  const mks = A.mks.slice(-12); if (!mks.length) return "";
  const W=340,H=160,L=40,B=20,T=10,R=6; const vals = mks.map(m=>A.months[m].total);
  const max = niceMax(Math.max(...vals, A.stats.avg||0)); const y = v => T + (H-T-B)*(1 - v/max);
  const bw = (W-L-R)/mks.length; let g = moneyGrid(max, y, L, W-R);
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
  [lo+padv, (lo+hi)/2, hi-padv].forEach(v => { g += gridRow(y(v), f(v), L, W-R); });
  if (opts.base != null) g += `<line class="base" x1="${L}" x2="${W-R}" y1="${y(opts.base)}" y2="${y(opts.base)}"/>`;
  const li = pts.length-1;
  const d = pts.map((p,i)=>`${i?"L":"M"}${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join("");
  g += areaLine(d, x(li), L, H-B);
  const step = Math.ceil(pts.length/7);
  pts.forEach((p,i) => { if (i%step===0 || i===li) g += `<text x="${x(i)}" y="${H-5}" text-anchor="middle">${esc(p.label || mkShort(p.mk))}</text>`; });
  g += endDot(x(li), y(pts[li].v), f(pts[li].v));
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(opts.label||"Trend")}">${g}</svg>`;
}
 
/* ---------- views ---------- */
const VIEWS = {home:viewHome, products:viewProducts, inflation:viewInflation, history:viewHistory};
function render(){
  const list = receipts(); const A = analyze(list);
  if (!S.month || (!A.months[S.month] && S.month !== A.curMk)) S.month = A.months[A.curMk] ? A.curMk : (A.mks[A.mks.length-1] || A.curMk);
  document.querySelectorAll("[data-nav]").forEach(b => b.setAttribute("aria-current", b.dataset.nav===S.view ? "page" : "false"));
  $("#banner").innerHTML = isDemo()
    ? `<div class="banner"><span>●</span><span><b>Example data.</b> You're looking at 8 made-up months so you can see how MijnParagon works. Scan or add your first receipt and only your own data will show.</span></div>` : "";
  if (!S.loaded){ $("#view").innerHTML = `<div class="empty">Loading your receipts…</div>`; return; }
  $("#view").dataset.view = S.view;   // lets styles target one tab
  $("#view").innerHTML = (VIEWS[S.view] || viewHome)(A, list);
  const qi = $("#q"); if (qi && S._focusQ){ qi.focus(); qi.setSelectionRange(qi.value.length, qi.value.length); }
}
 
/* ---------- spending pace & where the money goes ---------- */
const FIXED_COSTS = ["housing","insurance_financial","telecommunications"];
// Services and fixed costs: not products you pick off a shelf, so they're left out of product comparisons
// (shops, regular buys, savings, price premium). Child care stays in: nappies, baby food or school supplies are products.
const NOT_PRODUCTS = ["housing","insurance_financial","telecommunications","transport","education","eating_out"];
// Price premium only counts everyday purchases you can change, not services or fixed costs where a different price
// means a deliberately different choice (another restaurant, rent for a new flat).
const PREMIUM_OUT = NOT_PRODUCTS;
const catList = ids => ids.map(c => CAT[c]).join(", ");
// a[d] = money spent from the 1st up to and including day d (stays flat after the month ends)
function cumDays(list, mk, withFixed){
  const n = daysIn(mk), a = Array(32).fill(0);
  for (const r of list){
    if (mkOf(r.date) !== mk) continue;
    const d = Math.min(n, dayOf(r.date));
    for (const it of lines(r)){ if (!withFixed && FIXED_COSTS.includes(catOf(it.category))) continue; a[d] += num(it.price); }
  }
  for (let d = 1; d <= 31; d++) a[d] += a[d-1];
  return a;
}
function paceChart(mk, cur, avg, lastDay){
  const W=340,H=170,L=40,B=20,T=14,R=48, n = daysIn(mk);
  const max = niceMax(Math.max(cur[lastDay], avg ? avg[n] : 0, 1));
  const x = d => L + (d-1)*(W-L-R)/(n-1), y = v => T + (H-T-B)*(1 - v/max);
  let g = moneyGrid(max, y, L, W-R);
  if (avg){ let d = ""; for (let i = 1; i <= n; i++) d += `${i>1?"L":"M"}${x(i).toFixed(1)},${y(avg[i]).toFixed(1)}`; g += `<path class="avg" d="${d}"/>`; }
  let d = ""; for (let i = 1; i <= lastDay; i++) d += `${i>1?"L":"M"}${x(i).toFixed(1)},${y(cur[i]).toFixed(1)}`;
  if (lastDay > 1) g += areaLine(d, x(lastDay), L, H-B);
  [1,8,15,22,n].forEach(i => { g += `<text x="${x(i)}" y="${H-5}" text-anchor="middle">${i}</text>`; });
  g += endDot(x(lastDay), y(cur[lastDay]), money(cur[lastDay],0));
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Spending so far this month, day by day">${g}</svg>`;
}
function paceSection(A, list, mk){
  const isCur = mk === A.curMk, n = daysIn(mk), today = isCur ? Math.min(n, +todayISO().slice(8,10)) : n;
  const cur = cumDays(list, mk, S.withFixed);
  const base = A.completeMks.filter(m => m !== mk);
  let avg = null;
  if (base.length){ const arrs = base.map(m => cumDays(list, m, S.withFixed)); avg = Array.from({length:32}, (_, d) => mean(arrs.map(a => a[d]))); }
  const name = esc(MONTHS_LONG[+mk.slice(5)-1]);
  const vsAvg = diff => Math.abs(diff) < 1 ? "the same as" : `<b class="chg ${diff>0?"up":"down"}">${money(Math.abs(diff),0)} ${diff>0?"above":"below"}</b>`;
  let lead;
  if (!avg) lead = "Your usual pace appears once you have a complete month of receipts.";
  else if (isCur){ const proj = cur[today] + (avg[n] - avg[today]);
    lead = `At your usual pace you'll end ${name} at about <b class="num">${money(proj,0)}</b>, ${vsAvg(proj - avg[n])} an average month.`; }
  else lead = `You ended ${name} at <b class="num">${money(cur[n],0)}</b>, ${vsAvg(cur[n] - avg[n])} an average month.`;
  const note = (S.withFixed ? "Includes every category, rent and bills too." : `Left out: ${esc(catList(FIXED_COSTS))}. These fixed costs are usually paid on one day and would hide your everyday pace. Use the button above to include them.`)
    + (avg ? ` Dashed line: your average of ${base.length} complete month${plural(base.length)}${base.length < A.mks.length ? " (the running month and a partly tracked first month don't count)" : ""}.` : "");
  return `<div class="section pace">
    <div class="section-head"><h2>Spending pace</h2><button class="chip" data-action="togglefixed" aria-pressed="${S.withFixed}">${S.withFixed ? "Rent &amp; bills included" : "Rent &amp; bills left out"}</button></div>
    <p class="pace-lead">${lead}</p>
    ${paceChart(mk, cur, avg, today)}
    <details class="more chart-note" data-note="pace"${S.openNotes.has("pace")?" open":""}><summary class="small muted">How this is worked out</summary><p class="small muted">Pace shows how this month builds up day by day. Month by month, below, shows whether it's part of a longer trend.</p><p class="small muted">${note}</p></details></div>`;
}
/* ---------- spending type ----------
   Three questions about how you shop, each scored 0–100 from your own receipts:
     Price   T Thrifty  / C Carefree  : offers you use, how much you pay above your own best price, deposits you return
     Rhythm  D Drop-in  / B Big shop  : how often you shop, and how much goes on small top-up days
     Novelty R Ritual   / E Explorer  : how much goes on products you buy again, and how loyal you are to one shop
   A score of 50 or more gives the first letter. The code is read price · rhythm · novelty, e.g. TBR.
   Every number the rules use lives in TYPE_CFG, so calibrating means changing only this object. */
const TYPE_CFG = {
  minExpenses: 20,       // qualifying expenses needed before a type can be read
  minDays: 10,           // days from your first qualifying expense to today
  minShopDays: 4,        // different days you went shopping
  windowDays: 60,        // later readings look at the last 60 days (the first one uses everything)
  confirm: 2,            // a new type must come out of this many readings in a row before its card is given
  near: [40, 60],        // a score in this band means "with a bit of" the other letter
  thrift: { offers:[0, .10], premium:[.04, 0], deposits:[0, 1], weights:{offers:.4, premium:.4, deposits:.2}, minComparable:3, minDeposit:1 },
  dropin: { freq:[.15, .45], small:[0, 1], smallDay:.25, weights:{freq:.5, small:.5} },
  ritual: { repeat:[.20, .70], loyal:[.30, .80], weights:{repeat:.6, loyal:.4} },
};
const TYPE_GOAL = TYPE_CFG.minExpenses;
const AXES = [
  {k:"thrift", hi:"T", lo:"C", hiName:"Thrifty",  loName:"Carefree", q:"Price"},
  {k:"dropin", hi:"D", lo:"B", hiName:"Drop-in",  loName:"Big shop", q:"Rhythm"},
  {k:"ritual", hi:"R", lo:"E", hiName:"Ritual",   loName:"Explorer", q:"Novelty"},
];
const scale = (x, [a, b]) => Math.max(0, Math.min(100, (x - a) / (b - a) * 100));
const isoDaysAgo = n => { const d = new Date(); d.setDate(d.getDate() - n); return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; };
const dayDiff = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);
const shopLines = r => lines(r).filter(it => !NOT_PRODUCTS.includes(catOf(it.category)));
// Counts for your type: an expense with at least one product, scanned or added by hand. Monthly repeats and
// services (rent, transport, eating out…) say little about how you shop.
const qualifies = r => !r.recurringId && shopLines(r).length > 0;

function typeReading(list, since){
  const C = TYPE_CFG, today = todayISO();
  const inWin = r => r.date && r.date <= today && (!since || r.date >= since);
  const Q = list.filter(r => inWin(r) && qualifies(r));
  if (!Q.length) return {n:0, days:0, shopDays:0, ready:false};
  const first = Q.reduce((m, r) => r.date < m ? r.date : m, Q[0].date);
  const span = dayDiff(first, today) + 1;
  const day = {}, shops = {}, prods = {}, groups = {};
  let paid = 0, saved = 0;
  for (const r of Q) for (const it of shopLines(r)){
    const p = num(it.price), d = discOf(it), qty = num(it.qty) || 1;
    paid += p; saved += d;
    day[r.date] = (day[r.date] || 0) + p;
    if (r.store){ const X = shops[key(r.store)] ||= {name:r.store, e:0}; X.e += p; }
    const pk = key(it.product || it.name); if (!pk) continue;
    const P = prods[pk] ||= {days:new Set(), e:0}; P.days.add(r.date); P.e += p;
    (groups[`${pk}|${mkOf(r.date)}|${it.unit || "pcs"}`] ||= {pk, buys:[]}).buys.push({up:(p + d)/qty, qty});
  }
  // price premium: same product, same month, against the lowest regular price you paid
  let prem = 0, compReg = 0; const comparable = new Set();
  for (const G of Object.values(groups)){
    if (G.buys.length < 2) continue;
    const lo = Math.min(...G.buys.map(b => b.up)); comparable.add(G.pk);
    for (const b of G.buys){ prem += (b.up - lo) * b.qty; compReg += b.up * b.qty; }
  }
  let depPaid = 0, depBack = 0;
  for (const r of list) if (inWin(r)) for (const it of r.items || []){ const k = kindOf(it);
    if (k === "deposit") depPaid += num(it.price); else if (k === "deposit_return") depBack += Math.abs(num(it.price)); }

  const T = C.thrift, sig = [];
  const o = paid + saved ? saved / (paid + saved) : 0;
  sig.push([scale(o, T.offers), T.weights.offers]);
  const p = compReg ? prem / compReg : null;
  if (comparable.size >= T.minComparable) sig.push([scale(p, T.premium), T.weights.premium]);
  const dep = depPaid >= T.minDeposit ? Math.min(1, depBack / depPaid) : null;
  if (dep !== null) sig.push([scale(dep, T.deposits), T.weights.deposits]);
  const thrift = sum(sig.map(([s, w]) => s*w)) / sum(sig.map(([, w]) => w));

  const bs = Object.values(day), tot = sum(bs), shopDays = bs.length;
  const f = shopDays / span, week = tot / (span / 7);
  const c = tot ? sum(bs.filter(b => b < C.dropin.smallDay * week)) / tot : 0;
  const dropin = C.dropin.weights.freq * scale(f, C.dropin.freq) + C.dropin.weights.small * scale(c, C.dropin.small);

  const rep = tot ? sum(Object.values(prods).filter(P => P.days.size >= 2).map(P => P.e)) / tot : 0;
  const sh = Object.values(shops).sort((a, b) => b.e - a.e), shTot = sum(sh.map(s => s.e));
  const loyal = shTot ? sh[0].e / shTot : 0;
  const ritual = C.ritual.weights.repeat * scale(rep, C.ritual.repeat) + C.ritual.weights.loyal * scale(loyal, C.ritual.loyal);

  const scores = {thrift, dropin, ritual};
  const code = AXES.map(a => scores[a.k] >= 50 ? a.hi : a.lo).join("");
  // "with a bit of": the score closest to 50, if it lies in the band
  let bit = null, best = 99;
  AXES.forEach((a, i) => { const s = scores[a.k], d = Math.abs(s - 50);
    if (s >= C.near[0] && s <= C.near[1] && d < best){ best = d; bit = code.slice(0, i) + (code[i] === a.hi ? a.lo : a.hi) + code.slice(i + 1); } });
  return {n:Q.length, days:span, shopDays, code, bit, scores,
    ready: Q.length >= C.minExpenses && span >= C.minDays && shopDays >= C.minShopDays,
    detail:{offers:o, premium:p, deposits:dep, freq:f, small:c, repeat:rep, loyal, topShop:sh[0]?.name || ""}};
}

/* ---------- the eight types (texts by MijnParagon) ---------- */
const TYPES = {
  TBR: {slug:"domowik", name:"Domowik", quote:"A penny saved is a penny earned.",
    legend:"In Slavic homes, the Domowik lived behind the stove. This small, bearded guardian kept the household in order and the pantry full, and families left him bread and salt in thanks. He was kind to tidy, careful homes and grumpy with wasteful ones.",
    how:"You don’t pop out for milk: you plan one big shop, fill the cupboards and know exactly what’s in them. Your basket barely changes from week to week, and you know what each staple should cost.",
    sup:["the well-stocked pantry", "Planning ahead means fewer trips, fewer temptations and better prices per kilo. Your price premium stays low."],
    blind:["the back of the cupboard", "Big shops can mean food that expires before you get to it. A full pantry only saves money if everything in it gets used."],
    dyk:"Studies of grocery shopping suggest that people who shop with a list tend to make fewer unplanned purchases, which is your natural habitat.",
    opp:"CDE", kin:"TDR"},
  TBE: {slug:"pooka", name:"Pooka", quote:"To each his own.",
    legend:"The Púca of Irish folklore is a shapeshifter: a dark horse one night, a goat or a hare the next. Pull it close and it takes you on a wild ride across the countryside, and you never quite know where you’ll end up, but it’s always a story worth telling.",
    how:"Your big shops are adventures. You hunt for good prices, but your cart is full of new finds: a cheese you’ve never tried, a sauce on special, a different brand of coffee each time.",
    sup:["the bargain explorer", "You combine curiosity with a sharp eye. You try new things without paying the price of novelty, often because you find them on offer."],
    blind:["“too good to leave”", "A good deal on something new is tempting, even when you didn’t need it. If it ends up unused, it was never a bargain."],
    dyk:"Researchers have a name for the glow you feel after a good deal: the “smart shopper feeling”. For some people it’s as rewarding as the product itself.",
    opp:"CDR", kin:"TDE"},
  TDR: {slug:"baku", name:"Baku", quote:"Waste not, want not.",
    legend:"In Japanese folklore, the Baku is a gentle creature stitched together from many animals: an elephant’s trunk, a tiger’s paws, an ox’s tail. It feeds on bad dreams. People used to keep its picture by their pillow and, waking from a nightmare, whisper: “Baku, eat my dream.” By morning, the bad dream was gone, and nothing was wasted.",
    how:"You shop little and often: a quick stop on the way home rather than one big weekly haul. Your basket is familiar: you know what you like, and you know what it should cost. When something is overpriced, you notice. Like the Baku, you quietly clear away what isn’t worth keeping.",
    sup:["price memory", "You know the normal price of your staples better than almost anyone. Because you buy the same products again and again, every price change stands out to you, and you rarely pay more than you need to."],
    blind:["the little extras", "Every trip to a shop is a small temptation. Research on in-store behaviour suggests that a large share of what people buy is unplanned, and each extra visit is another chance for a chocolate bar or a coffee to slip into the basket. One extra item per trip doesn’t feel like much, but it adds up over a month."],
    dyk:"Shopping researchers distinguish between “stock-up” trips and quick “fill-in” trips. Fill-in shoppers tend to waste less food, because they buy what they need right now, but they also spend more time shopping in total.",
    opp:"CBE", kin:"TBR",
    oppTxt:"Rare, big, adventurous hauls where price is not the main thing. Where you clear away waste, Zar-ptak fills the cart with discoveries.",
    kinTxt:"Just as careful with money and just as loyal to favourites, but prefers one big planned trip to many small ones."},
  TDE: {slug:"chupacabra", name:"Chupacabra", quote:"Fond of the sound of a strange bell.",
    legend:"First reported in Puerto Rico in the 1990s, the Chupacabra became a legend across the Americas: a mysterious creature that appears out of nowhere, strikes quickly and vanishes before anyone gets a good look.",
    how:"Quick, frequent raids. You pop into whichever shop is closest, scan the offers and leave with something cheap and new. Your receipts are short, varied and spread across many shops.",
    sup:["the quick find", "You spot deals and novelties others walk past. Your price premium stays low because you buy whatever is good value that day."],
    blind:["many small raids", "Every visit costs a little: time, and the occasional extra you didn’t plan. Many tiny baskets can add up to more than one planned one."],
    dyk:"Psychologists think some people simply need more novelty than others to feel good. They call it the “optimal stimulation level”. Trying new things is how you keep life interesting.",
    opp:"CBR", kin:"TBE"},
  CBR: {slug:"selkie", name:"Selkie", quote:"The world is your oyster.",
    legend:"In the tales of Scotland, Ireland and the Faroe Islands, selkies are seals that shed their skins to walk on land as people. However long they stay, they always long to return to the sea, to the place that feels like home.",
    how:"One big, comfortable shop at your favourite place, with your favourite products. You don’t compare prices across town: you value knowing the aisles, the brands and the routine.",
    sup:["effortless shopping", "No endless comparing, no decision fatigue. Your shopping takes little time and little energy, and that’s worth something too."],
    blind:["the comfort premium", "Loyalty to one shop and familiar brands means you sometimes pay more for the same thing. Not a problem in itself, as long as it’s a choice."],
    dyk:"In a famous study, shoppers offered 24 kinds of jam were less likely to buy than those offered 6. Later research is mixed, but many people know the feeling: fewer choices can mean an easier life.",
    opp:"TDE", kin:"CDR"},
  CBE: {slug:"zar-ptak", name:"Zar-ptak", quote:"No generous person ever went to hell.",
    legend:"In Slavic fairy tales, the Zar-ptak’s feathers glow so brightly that a single one lights up a whole room. Princes leave their homes on long journeys just to catch a glimpse of it, and come back with treasures they never expected.",
    how:"Shopping is an outing. You do it less often, but in style: a big basket, new flavours, something special for the weekend. Price matters less than the experience.",
    sup:["making it count", "You enjoy what you buy, and you bring home discoveries others never try. Your table is rarely boring."],
    blind:["the overflowing cart", "Big, exciting shops can mean more than you can use, and new products often cost more than the familiar ones."],
    dyk:"When people plan several purchases at once, they tend to choose more variety than they later actually want. Researchers call it the diversification bias.",
    opp:"TDR", kin:"TBE"},
  CDR: {slug:"kitsune", name:"Kitsune", quote:"Spend and God will send.",
    legend:"In Japan, kitsune are fox spirits and messengers of Inari, the deity of rice. They grow a new tail with each century of wisdom, up to nine, and are known for their loyalty to the places and people they choose.",
    how:"The same route, the same shop, almost every day. You know the staff, the shelves and what you’ll buy before you walk in. Shopping fits seamlessly into your day.",
    sup:["rhythm", "You rarely forget anything and rarely buy too much, because you shop for today. Fresh bread, fresh fruit, no overflowing fridge."],
    blind:["the convenience premium", "The shop closest to your route is not always the cheapest, and daily visits make small differences add up."],
    dyk:"Habit researchers estimate that a large part of what we do every day we do on autopilot, in the same places at the same times. Your shopping is a habit that works for you.",
    opp:"TBE", kin:"CBR"},
  CDE: {slug:"anansi", name:"Anansi", quote:"Joie de vivre.",
    legend:"Anansi the spider is a hero of Akan folktales from Ghana, later told across the Caribbean. Clever and endlessly curious, he once won all the world’s stories from the sky god Nyame, and has been spreading them ever since.",
    how:"Often, spontaneously, and always with an eye for something new. You go wherever life takes you that day, and every receipt tells a slightly different story.",
    sup:["curiosity", "You discover new products, new shops and new flavours before anyone else. Your shopping is never dull."],
    blind:["small, painless payments", "Many small, spontaneous purchases don’t feel like much one by one, especially when you just tap a card. Together, they can become a big part of the month."],
    dyk:"Studies suggest that people are willing to pay more when paying by card than with cash. Paying feels less painful when you don’t see the money leave your hand.",
    opp:"TBR", kin:"CBE"},
};
const TYPE_ORDER = ["TBR","TBE","TDR","TDE","CBR","CBE","CDR","CDE"];
const dotCode = c => c.split("").join("·");

/* Your own numbers for the back of the card, from the last 30 days (the lever looks at your last months). */
function typeFacts(list, A){
  const today = todayISO(), since = isoDaysAgo(29);
  const Q = list.filter(r => r.date >= since && r.date <= today && qualifies(r));
  const tot = r => sum(shopLines(r).map(it => num(it.price)));
  const spend = sum(Q.map(tot));
  const st = {}; Q.forEach(r => { if (r.store){ const X = st[key(r.store)] ||= {name:r.store, e:0}; X.e += tot(r); } });
  const shops = Object.values(st).sort((a, b) => b.e - a.e);
  // new products only mean something once you've tracked for a while before these 30 days
  const firstEver = list.filter(qualifies).reduce((m, r) => !m || r.date < m ? r.date : m, "");
  const canNew = firstEver && firstEver <= isoDaysAgo(59);
  const newKeys = new Set(Object.values(A.products).filter(P => !NOT_PRODUCTS.includes(P.category) && P.buys[0].date >= since).map(P => P.key));
  let newSpend = 0; Q.forEach(r => shopLines(r).forEach(it => { if (newKeys.has(key(it.product || it.name))) newSpend += num(it.price); }));
  const smallR = Q.filter(r => tot(r) < 5);
  const prodSpend = {}; Q.forEach(r => shopLines(r).forEach(it => { const k = key(it.product || it.name); if (k) prodSpend[k] = (prodSpend[k] || 0) + num(it.price); }));
  const top5 = Object.values(prodSpend).sort((a, b) => b - a).slice(0, 5);
  const lastMk = [...A.mks].reverse().find(m => A.months[m]?.count);
  return {visits:Q.length, basket: Q.length ? spend/Q.length : 0, spend, shops:shops.length, top:shops[0], topShare: spend && shops[0] ? shops[0].e/spend : 0,
    canNew, newN:newKeys.size, newShare: spend ? newSpend/spend : 0, distinct:Object.keys(prodSpend).length,
    smallN:smallR.length, smallSum:sum(smallR.map(tot)), top5Share: spend ? sum(top5)/spend : 0, top5N: top5.length,
    premium: lastMk ? A.months[lastMk].premium : 0, premMk: lastMk};
}
const P0 = v => `${Math.round(v*100)}%`;
function typeDataLine(code, F, R){
  if (!F.visits) return "";
  const trips = `${F.visits} shopping trip${plural(F.visits)}`;
  const newTxt = F.canNew ? `you tried <b>${F.newN}</b> new product${plural(F.newN)}` : `you bought <b>${F.distinct}</b> different products`;
  const L = {
    TBR: `Last 30 days: <b>${trips}</b>, average basket <b>${money(F.basket)}</b>.`,
    TBE: `In the last 30 days ${newTxt}.`,
    TDR: `Your price premium in ${F.premMk ? mkLabel(F.premMk, true) : "your last month"}: <b>${money(F.premium)}</b>. In the last 30 days you went shopping <b>${F.visits}</b> time${plural(F.visits)}, with an average basket of <b>${money(F.basket)}</b>.`,
    TDE: `Last 30 days: <b>${trips}</b> across <b>${F.shops}</b> different shop${plural(F.shops)}.`,
    CBR: `Last 30 days: <b>${trips}</b>.${R?.detail ? ` <b>${P0(R.detail.repeat)}</b> of your spending goes on favourites you buy again and again.` : ""}`,
    CBE: `In the last 30 days ${newTxt}.`,
    CDR: F.top ? `Last 30 days: <b>${trips}</b>, <b>${P0(F.topShare)}</b> of your spending at <b>${esc(F.top.name)}</b>.` : `Last 30 days: <b>${trips}</b>.`,
    CDE: `Last 30 days: <b>${trips}</b>, ${newTxt}.`,
  };
  return L[code] || "";
}
function typeLever(code, F, A, list){
  const sv = () => shopSavings(A).rows, perM = y => money(y/12, 0);
  const switchOne = () => { const x = sv()[0]; return x && `<b style="text-transform:capitalize">${esc(x.P.label)}</b> costs you <b>${money(x.yours)}</b> per ${esc(x.P.unit)} on average, while at <b>${esc(x.shop)}</b> you paid <b>${money(x.price)}</b>. Buying it there would save about <b>${perM(x.year)}</b> a month.`; };
  const shopGap = () => { const {rows} = shopIndex(A, list); if (rows.length < 2) return null;
    const main = rows[0], cheap = [...rows].sort((x, y) => x.idx - y.idx)[0]; if (main === cheap) return null;
    const gap = 1 - (1 + cheap.idx) / (1 + main.idx); return gap >= .03 ? {main, cheap, gap} : null; };
  let t = null;
  if (code === "TBR") t = switchOne() && `${switchOne()} Stocking up where it’s cheapest adds up.`;
  else if (code === "TDR") t = switchOne() && `${switchOne()} It doesn’t change your routine, only where you pick it up.`;
  else if (code === "CBR"){ const rs = sv().slice(0, 3); if (rs.length) t = `${switchOne()}${rs.length > 1 ? ` Switching just your top ${rs.length} products would save about <b>${perM(sum(rs.map(x => x.year)))}</b> a month, without changing your routine.` : ""}`; }
  else if (code === "TDE" || code === "CDR"){ const g = shopGap(), {rows} = shopIndex(A, list);
    if (!g && rows.length >= 2) t = `Good news: <b>${esc(rows[0].name)}</b>, where you shop most, is already one of your cheapest shops for the same products. Keep an eye on the little extras that daily visits invite.`;
    if (g) t = (code === "TDE" ? `You’ve shopped at <b>${F.shops}</b> place${plural(F.shops)} in the last 30 days. ` : "")
      + `At <b>${esc(g.cheap.name)}</b> the same products cost you on average <b>${P0(g.gap)}</b> less than at <b>${esc(g.main.name)}</b>. ${code === "TDE" ? "Making it your first stop" : "Doing one of your visits there each week"} would cut what you pay.`; }
  else if (code === "TBE"){ if (F.top5N >= 5) t = `Your <b>5</b> most-bought products are <b>${P0(F.top5Share)}</b> of your spending. Knowing your lowest price for these few saves more than chasing every new offer.`; }
  else if (code === "CBE"){ if (F.canNew && F.newShare > 0) t = `New products made up <b>${P0(F.newShare)}</b> of your spending in the last 30 days. Keeping the ones you loved and dropping the rest saves money without losing the fun.`; }
  else if (code === "CDE"){ if (F.smallN) t = `Your <b>${F.smallN}</b> small purchase${plural(F.smallN)} under ${money(5, 0)} added up to <b>${money(F.smallSum)}</b> in the last 30 days. Knowing that number is often enough to make the next one a conscious choice.`; }
  return t || `Keep adding receipts: once there’s enough to compare, your own numbers show up here.`;
}

/* ---------- your collection: which cards you have, kept with your account ----------
   cards = {current, since, unlocked:{CODE:date}, readings:[{mk, at, code, scores}], unseen}
   The first card is revealed when you tap it. After that, once a month, your last 60 days are read again;
   a new type only takes over when it comes out of TYPE_CFG.confirm readings in a row. */
const emptyCards = () => ({current:null, since:null, unlocked:{}, readings:[], unseen:null});
const normCards = c => ({...emptyCards(), ...(c && typeof c === "object" ? c : {}), unlocked:{...(c?.unlocked || {})}, readings:[...(c?.readings || [])]});
const LS_CARDS = "paragon.cards.v1.";
const cardsNow = () => isDemo() ? (S.demoCards ||= emptyCards()) : S.cards;
const roundScores = s => Object.fromEntries(Object.entries(s).map(([k, v]) => [k, Math.round(v)]));
async function saveCards(){
  if (isDemo() || !sb || !S.user) return;
  const {error} = await sb.from("profiles").upsert({user_id:S.user.id, cards:S.cards, updated_at:new Date().toISOString()});
  if (error){ // the cards column isn't there yet (005_cards.sql not run): keep them on this device meanwhile
    console.warn("cards saved on this device only:", error.message);
    try { localStorage.setItem(LS_CARDS + S.user.id, JSON.stringify(S.cards)); } catch(_){}
  }
}
function loadCards(profile){
  let c = profile?.cards;
  if (!c?.current){ try { c = JSON.parse(localStorage.getItem(LS_CARDS + S.user.id) || "null") || c; } catch(_){} }
  S.cards = normCards(c);
}
// once a month, after the first card: read the last 60 days again
async function monthlyTypeReading(){
  const C = S.cards; if (!C.current) return;
  const mk = mkOf(todayISO()), last = C.readings[C.readings.length - 1];
  if (last && last.mk >= mk) return;
  const R = typeReading(S.real, isoDaysAgo(TYPE_CFG.windowDays - 1));
  if (!R.ready) return;
  C.readings = [...C.readings, {mk, at:todayISO(), code:R.code, scores:roundScores(R.scores)}].slice(-24);
  const lastN = C.readings.slice(-TYPE_CFG.confirm);
  if (R.code !== C.current && lastN.length === TYPE_CFG.confirm && lastN.every(x => x.code === R.code)){
    C.current = R.code; C.since = todayISO();
    if (!C.unlocked[R.code]){ C.unlocked[R.code] = todayISO(); C.unseen = R.code; }
  }
  await saveCards();
}
// The reading shown on your card: the latest one that gave your current type (or a fresh one in the example)
function shownReading(list){
  const C = cardsNow();
  const saved = [...C.readings].reverse().find(x => x.code === C.current);
  const R = typeReading(list, C.readings.length > 1 ? isoDaysAgo(TYPE_CFG.windowDays - 1) : null);
  if (saved && R.code !== saved.code) return {...R, code:saved.code, scores:saved.scores, bit:null};
  return R;
}

/* ---------- the card itself ---------- */
const typeArt = T => `<span class="tc-ph" aria-hidden="true">${esc(T.name[0])}</span><img class="tc-art" src="icons/types/${T.slug}.png" alt="" loading="lazy">`;
function cardFront(code, cls = ""){
  const T = TYPES[code];
  return `<span class="tcard tc-front-face ${cls}"><img class="tc-frame" src="icons/cards/front.webp" alt="">
    <span class="tc-in"><span class="tc-name">${esc(T.name)}</span>
      <span class="tc-chips">${code.split("").map(l => `<i>${l}</i>`).join("")}</span>
      <span class="tc-pic">${typeArt(T)}</span>
      <span class="tc-quote">“${esc(T.quote)}”</span></span></span>`;
}
const cardDown = (cls = "") => `<span class="tcard tc-down ${cls}"><img class="tc-frame" src="icons/cards/back.webp" alt=""><span class="tc-q" aria-hidden="true">?</span></span>`;
function whyBars(R){
  if (!R?.scores) return "";
  return `<div class="why"><h4>Why this type</h4>${AXES.map(a => { const s = Math.round(R.scores[a.k]);
    return `<div class="why-row"><span class="${s >= 50 ? "on" : ""}">${a.hiName}</span><span class="why-bar" role="img" aria-label="${a.q}: ${s} of 100 towards ${a.hiName}"><i style="left:${s}%"></i></span><span class="${s < 50 ? "on" : ""}">${a.loName}</span></div>`; }).join("")}</div>`;
}
function cardBack(code, list, A, R){
  const C = cardsNow(), T = TYPES[code], F = typeFacts(list, A), mine = code === (C.pending?.code || C.current);
  const data = mine ? typeDataLine(code, F, R) : "";
  const rel = (c, txt, label) => `<b>${label}:</b> ${esc(TYPES[c].name)} (${dotCode(c)})${txt ? `. ${esc(txt)}` : ""}`;
  return `<div class="tcard tc-back-face"><img class="tc-frame" src="icons/cards/back.webp" alt="">
    <div class="tc-text">
      <h3>${esc(T.name)} <span>(${dotCode(code)})</span></h3>
      <p class="tc-quote-b">“${esc(T.quote)}”</p>
      ${mine ? whyBars(R) : ""}
      <h4>The legend</h4><p>${esc(T.legend)}</p>
      <h4>How you shop</h4><p>${esc(T.how)}</p>
      <h4>Your superpower: ${esc(T.sup[0])}</h4><p>${esc(T.sup[1])}</p>${data ? `<p class="tc-data">${data}</p>` : ""}
      <h4>Your blind spot: ${esc(T.blind[0])}</h4><p>${esc(T.blind[1])}</p>
      ${mine ? `<h4>Your lever</h4><p>${typeLever(code, F, A, list)}</p>` : ""}
      <h4>Did you know?</h4><p>${esc(T.dyk)}</p>
      <p class="tc-rel">${rel(T.opp, T.oppTxt, "Your opposite")}<br>${rel(T.kin, T.kinTxt, "Your kindred spirit")}</p>
    </div></div>`;
}
// One card you can turn over. reveal: starts face down and turns itself over, the first time you get it.
function openTypeCard(code, {reveal = false} = {}){
  const list = receipts(), A = analyze(list), R = shownReading(list);
  $("#sheetRoot").innerHTML = `<div class="tc-stage${reveal ? " revealing" : ""}" role="dialog" aria-modal="true" aria-label="${esc(TYPES[code].name)} card">
    <button class="icon-btn tc-close" data-action="tcclose" aria-label="Close"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
    ${reveal ? `<p class="tc-title">Your spending type is…</p>` : ""}
    <div class="tc-flip${reveal ? " down" : ""}" data-action="tcflip" role="button" tabindex="0" aria-label="Turn the card over">
      <div class="tc-face front">${cardFront(code)}</div>
      <div class="tc-face back">${reveal ? cardDown() : ""}${cardBack(code, list, A, R)}</div>
    </div>
    <p class="tc-hint small">${reveal ? "&nbsp;" : "Tap the card to turn it over"}</p>
    ${reveal ? `<button class="btn tc-done" data-action="tcdone" hidden>Add to my collection</button>` : ""}
  </div>`;
  document.body.style.overflow = "hidden";
  const stage = $(".tc-stage"), flip = $(".tc-flip");
  if (!reveal){ flip.focus(); return; }
  const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
  setTimeout(() => {
    flip.classList.remove("down"); stage.classList.add("shown");
    setTimeout(() => {
      stage.classList.remove("revealing"); stage.querySelector(".tc-down")?.remove();
      const T = TYPES[code];
      $(".tc-title").innerHTML = `Your spending type is <b>${esc(T.name)}</b> (${dotCode(code)})!${R.bit && R.bit !== code ? `<span class="small"> With a bit of ${esc(TYPES[R.bit].name)}.</span>` : ""}`;
      $(".tc-hint").textContent = "Tap the card to turn it over and read about your type";
      const d = $(".tc-done"); d.hidden = false; d.focus();
    }, still ? 0 : 900);
  }, still ? 0 : 700);
}
function closeTypeCard(){ $("#sheetRoot").innerHTML = ""; document.body.style.overflow = ""; }
async function revealType(){
  const list = receipts(), C = cardsNow();
  if (C.unseen){ const code = C.unseen; openTypeCard(code, {reveal:true}); return; }
  const R = typeReading(list, null);
  if (!R.ready) return;
  C.pending = R; openTypeCard(R.code, {reveal:true});
}
async function finishReveal(){
  const C = cardsNow(), today = todayISO();
  if (C.unseen){ C.unseen = null; }
  else if (C.pending){ const R = C.pending; delete C.pending;
    C.current = R.code; C.since = today; C.unlocked[R.code] ||= today;
    C.readings = [...C.readings, {mk:mkOf(today), at:today, code:R.code, scores:roundScores(R.scores)}]; }
  S.dealCard = C.current;
  closeTypeCard(); render();
  saveCards().catch(() => {});
  document.getElementById("sec-type")?.scrollIntoView({behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block:"start"});
  setTimeout(() => { S.dealCard = null; }, 2500);
}

/* ---------- Overview: the spending type section ---------- */
function typeSection(){
  const list = receipts(), C = cardsNow();
  const R = typeReading(list, null);
  if (!C.current && !R.ready) return typeProgressSection(R);
  if (!C.current || C.unseen) return `<div class="section type-ready" id="sec-type">
    <button class="tr-card" data-action="revealtype" aria-label="Reveal your spending type">${cardDown("wiggle")}</button>
    <div class="tp-body"><span class="label">${C.unseen ? "A new card for your collection" : "Your spending type"}</span>
      <h2>${C.unseen ? "Your type has changed!" : "Your card is ready!"}</h2>
      <p class="small muted">${C.unseen ? "Your last two readings agree: the way you shop has shifted." : `You've collected ${R.n} expenses over ${R.days} days. Time to see what kind of shopper you are.`}</p>
      <button class="btn" data-action="revealtype">Tap to reveal</button></div></div>`;
  const T = TYPES[C.current], Rs = shownReading(list), deal = S.dealCard;
  const n = Object.keys(C.unlocked).length;
  const slots = TYPE_ORDER.map((code, i) => { const at = C.unlocked[code];
    return at ? `<button class="slot got${code === C.current ? " cur" : ""}${code === deal ? " new" : ""}" style="--i:${i}" data-action="opentype" data-code="${code}" aria-label="${esc(TYPES[code].name)}, unlocked ${fmtDate(at)}">${cardFront(code, "mini")}<span class="slot-n">${esc(TYPES[code].name)}</span><span class="slot-d">${fmtDate(at)}</span></button>`
      : `<span class="slot" style="--i:${i}" aria-label="Not unlocked yet">${cardDown("mini")}<span class="slot-n">?</span><span class="slot-d">&nbsp;</span></span>`; }).join("");
  return `<div class="section type-now" id="sec-type">
    <div class="section-head"><h2>Your spending type</h2>${isDemo() ? `<span class="tag">example</span>` : ""}</div>
    <div class="tn-row"><button class="tn-card" data-action="opentype" data-code="${C.current}" aria-label="Open your ${esc(T.name)} card">${cardFront(C.current, "mini")}</button>
      <div class="tp-body"><span class="tn-name">${esc(T.name)} <span class="muted">(${dotCode(C.current)})</span></span>
        <span class="small">“${esc(T.quote)}”</span>
        ${Rs.bit && Rs.bit !== C.current ? `<span class="small muted">With a bit of ${esc(TYPES[Rs.bit].name)}</span>` : ""}
        <span class="small muted">Your superpower: ${esc(T.sup[0])}</span>
        <button class="linkbtn" data-action="opentype" data-code="${C.current}">Open your card</button></div></div>
    <div class="album${deal ? " dealing" : ""}" role="list" aria-label="Your collection: ${n} of 8 cards">${slots}</div>
    <p class="small muted album-note"><b class="num">${n}</b> of 8 cards. Habits shift, and so can your type. Keep adding expenses: when your type changes, a new card joins your collection.</p>
    <details class="more" data-note="type"${S.openNotes.has("type")?" open":""}><summary class="small muted">How your type is worked out</summary>
      <p class="small muted">Three questions, each scored from 0 to 100 from your receipts. <b>Price</b>: how much you save with offers, how much you pay above your own best price for the same product, and how many bottle deposits you take back. <b>Rhythm</b>: how often you shop, and how much goes on small top-up days. <b>Novelty</b>: how much you spend on products you buy again, and how much at your main shop.</p>
      <p class="small muted">Your first card uses everything you've added. After that, once a month, your last ${TYPE_CFG.windowDays} days are read again. A new type has to come out ${TYPE_CFG.confirm} months in a row before its card joins your collection, so one unusual week doesn't change it.</p>
      <p class="small muted">Only expenses with products count: monthly repeats and services such as rent, transport or eating out are left out. Bottle deposits aren't spending.</p>
    </details></div>`;
}
function typeProgressSection(R){
  const C = TYPE_CFG, n = Math.min(C.minExpenses, R.n);
  const pips = Array.from({length: C.minExpenses}, (_, i) => `<i class="${i < n ? "on" : ""}"></i>`).join("");
  const ok = v => v ? ` <span class="ok" aria-label="done">✓</span>` : "";
  const daysLeft = Math.max(0, C.minDays - R.days);
  return `<div class="type-progress card" id="sec-type" role="group" aria-label="Spending type progress">
    ${cardDown("thumb")}
    <div class="tp-body">
      <span class="label">Your spending type</span>
      <span class="tp-count"><b class="num">${n}</b> / ${C.minExpenses} expenses${ok(n >= C.minExpenses)}</span>
      <div class="pips" role="progressbar" aria-valuemin="0" aria-valuemax="${C.minExpenses}" aria-valuenow="${n}">${pips}</div>
      <span class="small tp-cond">${R.days >= C.minDays ? `${C.minDays} days${ok(true)}` : R.n ? `${daysLeft} more day${plural(daysLeft)} to go` : `at least ${C.minDays} days`} · ${Math.min(R.shopDays, C.minShopDays)} / ${C.minShopDays} shopping days${ok(R.shopDays >= C.minShopDays)}</span>
      <span class="small muted">Collect at least ${C.minExpenses} expenses to learn your spending type. Be patient and act natural to obtain reliable results!</span>
      <span class="small muted">Scanned receipts and expenses you add by hand count, over at least ${C.minDays} days and ${C.minShopDays} different shopping days. Monthly repeats and services such as rent or eating out don't, because they say little about how you shop.</span>
    </div></div>`;
}

/* ---------- Overview: conclusions ----------
   One place that turns the numbers into answers. The guide at the top of Overview asks the questions in the
   order you'd think them through (is it unusual → is it a trend → prices or habits → where → paying too much),
   and each section repeats its own answer under the chart, so the two always agree. */
const amt0 = v => `${v >= 0 ? "+" : "−"}${money(Math.abs(v),0)}`;
function homeInsights(A, list, mk, D){
  const M = A.months[mk] || {total:0, cats:{}, prods:{}, premium:0, premProds:{}};
  const isCur = mk === A.curMk, {avg, sd: s} = A.stats, I = {};
  const base = A.completeMks.filter(m => m !== mk);

  // 1. is this month unusual? The running month is projected to its end at your usual pace.
  if (avg){
    let val = M.total, est = false;
    if (isCur && base.length){
      const n = daysIn(mk), today = Math.min(n, +todayISO().slice(8,10)), cur = cumDays(list, mk, true), arrs = base.map(m => cumDays(list, m, true));
      const av = d => mean(arrs.map(x => x[d])); val = cur[today] + av(n) - av(today); est = true;
    }
    const lo = Math.max(0, avg - (s||0)), hi = avg + (s||0), range = s ? `your usual range (${money(lo,0)}–${money(hi,0)})` : `your average (${money(avg,0)})`;
    const what = est ? `you're on track for about <b class="num">${money(val,0)}</b>` : `you spent <b class="num">${money(val,0)}</b>`;
    I.unusual = val > hi + 0.5 ? `${est ? "Likely yes" : "Yes"}: ${what}, ${money(val - hi,0)} above ${range}.`
      : val < lo - 0.5 ? `No: ${what}, below ${range}.`
      : `No: ${what}, ${s ? "within" : "close to"} ${range}.`;
    I.over = val > hi + 0.5;
  }

  // 2. one-off or trend? last 3 complete months against the 3 before (or against your average)
  const cm = A.completeMks, tot = m => A.months[m].total;
  if (cm.length >= 3){
    const last = mean(cm.slice(-3).map(tot)), prev = cm.length >= 6 ? mean(cm.slice(-6,-3).map(tot)) : avg, ch = prev ? last/prev - 1 : 0;
    const vs = cm.length >= 6 ? "the 3 before" : "your overall average";
    I.trend = Math.abs(ch) < .05 ? `Steady: your last 3 complete months averaged <b class="num">${money(last,0)}</b>, about the same as ${vs}.`
      : ch > 0 ? `Creeping up: your last 3 complete months averaged <b class="num">${money(last,0)}</b>, <b class="chg up">${pct(ch,0)}</b> vs. ${vs}. That points to a change in habits or prices, not a one-off.`
      : `Going down: your last 3 complete months averaged <b class="num">${money(last,0)}</b>, <b class="chg down">${pct(ch,0)}</b> vs. ${vs}.`;
  }

  // 3. prices, shops or habits? (this month vs. the previous one)
  if (D.e0){
    const since = isCur ? `the same days of ${mkLabel(D.prevMk,true)}` : mkLabel(D.prevMk,true);
    const parts = [["prices", D.infl], ["shops", D.stores], ["offers", D.offers], ["habits", D.habits]];
    const main = parts.reduce((x,y) => Math.abs(y[1]) > Math.abs(x[1]) ? y : x);
    const expl = {prices: `price changes (the same products at the same shops cost ${main[1] >= 0 ? "more" : "less"})`,
      shops: `where you shop (the same products bought at ${main[1] >= 0 ? "pricier" : "cheaper"} places)`,
      offers: `offers (you saved ${main[1] >= 0 ? "less" : "more"} with promotions than before)`,
      habits: `your habits (buying ${main[1] >= 0 ? "more or different" : "less or different"} things)`}[main[0]];
    I.mainCause = main[0]; I.mainVal = main[1];
    I.top = D.drivers?.[0] && Math.abs(D.drivers[0].change) >= 1 ? D.drivers[0] : null;
    I.why = Math.abs(D.change) < 1 ? `About the same as ${esc(since)}.`
      : `<b class="chg ${D.change > 0 ? "up" : "down"}">${amt0(D.change)}</b> vs. ${esc(since)}. The biggest part is ${expl}: ${amt0(main[1])}.`;
    I.topTxt = I.top ? `Biggest single change: <b style="text-transform:capitalize">${esc(I.top.l)}</b> <span class="chg ${chgClass(I.top.change)}">${amt0(I.top.change)}</span>.` : "";
  }
  const PI = chainIndex(A), pc = PI.count && indexChange(PI);
  if (pc) I.infl = `Since ${mkLabel(pc.ref.mk,true)}, the prices of what you buy (same product, same shop) ${pc.ch >= 0 ? "rose" : "fell"} ${(Math.abs(pc.ch)*100).toFixed(1)}%.`;

  // 4. where does the money go? Everyday costs separately from rent and bills, which you can't change month to month.
  const flex = Object.entries(M.cats).filter(([c,v]) => !FIXED_COSTS.includes(c) && v > 0).sort((x,y) => y[1] - x[1]);
  const flexTot = sum(flex.map(e => e[1])), fixed = M.total - flexTot;
  if (flex.length){
    const [c, v] = flex[0];
    I.topCat = c;
    let riser = null;
    if (!isCur && base.length){
      riser = flex.map(([k,val]) => [k, val - mean(base.map(m => A.months[m].cats[k] || 0))]).sort((x,y) => y[1] - x[1])[0];
      if (riser[1] < 5) riser = null;
    }
    I.where = `<b>${esc(CAT[c])}</b> is your biggest category outside rent and bills: <b class="num">${money(v,0)}</b> (${(v/flexTot*100).toFixed(0)}%).`
      + (riser ? ` <b>${esc(CAT[riser[0]])}</b> grew most: ${money(riser[1],0)} above its usual month.` : "");
    I.fixedTxt = fixed >= 1 ? `${esc(catList(FIXED_COSTS))}: ${money(fixed,0)}. These are fixed costs, so they change only when you change a contract.` : "";
  }

  // 5. paying more than you need to?
  if (M.premium >= 0.5){
    const [k, v] = Object.entries(M.premProds).sort((x,y) => y[1] - x[1])[0], P = A.products[k];
    const best = P?.buys.filter(b => b.mk === mk && b.store).sort((x,y) => x.unitPrice - y.unitPrice)[0];
    I.premK = k; I.premV = v;
    I.premium = `Yes: <b class="num">${money(M.premium)}</b> above your best prices this month, most on <b style="text-transform:capitalize">${esc(P?.label || k)}</b> (${money(v)}).`
      + (best ? ` You got it cheapest at ${esc(best.store)}.` : "");
  } else I.premium = A.premium ? "No: this month you paid your best price each time." : "Not measurable yet: it needs the same product bought more than once in a month.";

  // 6–7. conclusions from the Products tab (last 6 complete months, not just this month)
  const R = shopSavings(A), B = bigSpending(A, list), SH = shopIndex(A, list), save = {};
  const parts = [];
  if (R.rows.length){ const r = R.rows[0];
    parts.push(`Buying <b style="text-transform:capitalize">${esc(r.P.label)}</b> at ${esc(r.shop)} would save about <b class="num">${money(r.year,0)}</b> a year${R.rows.length > 1 ? `, and all your regular buys together about <b class="num">${money(R.total,0)}</b>` : ""}.`); }
  if (SH.rows.length){ const main = SH.rows[0], cheap = [...SH.rows].sort((x,y) => x.idx - y.idx)[0], gap = (1 + main.idx)/(1 + cheap.idx) - 1;
    if (main !== cheap){ I.shopGap = gap; I.shopMain = main; I.shopCheap = cheap; }
    parts.push(main === cheap || gap < .05
      ? `Your main shop, ${esc(main.name)} (${(main.share*100).toFixed(0)}% of your shopping), is one of your cheapest, so switching shops wouldn't save much overall.`
      : `You do ${(main.share*100).toFixed(0)}% of your shopping at ${esc(main.name)}, where the same products cost about <b class="chg up">${(gap*100).toFixed(0)}% more</b> than at ${esc(cheap.name)}.`); }
  if (parts.length) save.shops = parts.join(" ");
  const bg = B.rows.find(x => !x.fixed);
  if (bg) save.big = `<b>${esc(CAT[bg.c])}</b>: about <b class="num">${money(bg.year,0)}</b> a year. ` + (bg.regular
    ? `One fewer a month saves about <b class="num">${money(bg.avg*12,0)}</b>.`
    : `It's occasional for you, so each time you skip it saves about ${money(bg.avg,0)}.`);
  I.save = save;

  // where to start: the single most useful thing to look at
  const flexTop = I.topCat ? `<b>${esc(CAT[I.topCat])}</b>, your biggest category outside rent and bills: small changes there go furthest.` : "";
  let start = "";
  if (I.mainCause === "habits" && I.mainVal > 0 && I.top && I.top.change > 0)
    start = `<b style="text-transform:capitalize">${esc(I.top.l)}</b>: it changed the most. Buying it less often, or swapping it for something cheaper, has the biggest effect.`;
  else if (I.mainCause === "shops" && I.mainVal > 0)
    start = `where you shop: you paid more for the same products at other places. Open a product to see where you paid least.`;
  else if (I.mainCause === "prices" && I.mainVal > 0)
    start = `rising prices. See the <button class="linkbtn" data-nav="inflation">Inflation</button> tab for the products that rose most, and look for alternatives to those.`;
  else if (I.shopGap >= .1 && I.shopMain.share >= .3)
    start = `where you shop: you do ${(I.shopMain.share*100).toFixed(0)}% of your shopping at ${esc(I.shopMain.name)}, where the same products cost about ${(I.shopGap*100).toFixed(0)}% more than at ${esc(I.shopCheap.name)}. Moving your regular buys could save about <b class="num">${money(R.total,0)}</b> a year.`;
  else if (I.premV >= 5)
    start = `<b style="text-transform:capitalize">${esc(A.products[I.premK]?.label || I.premK)}</b>: buy it where you got it cheapest. That saves money without buying less.`;
  else start = flexTop;
  I.start = start ? (I.over === false ? `This month is not above usual. If you want to save more anyway, start with ${start}` : `Start with ${start}`) : "";
  return I;
}

function guideSection(I){
  const save = I.save || {};
  const step = (q, ans) => ans ? `<li><span class="gq">${q}</span><span class="ga">${ans}</span></li>` : "";
  const steps = [
    step("Is this month unusual?", I.unusual),
    step("Is it a one-off or a trend?", I.trend),
    step("Prices, shops, offers or habits?", I.why ? I.why + (I.infl ? ` ${I.infl}` : "") : ""),
    step("Where does the money go?", I.where),
    step("Paying more than you need to?", I.premium),
    step("Could you pay less for the same things?", save.shops),
    step("Which choices add up the most?", save.big),
  ].join("");
  if (!steps) return "";
  return `<div class="card guide" role="group" aria-label="What's behind your spending">
    <h2>What's behind your spending</h2>
    <ol>${steps}</ol>
    ${I.start ? `<p class="takeaway">${I.start}</p>` : ""}
    <p class="small muted">MijnParagon doesn't see your income. If you earn more than before, spending more can be a choice rather than a problem. Compare these numbers with what you want to save.</p>
  </div>`;
}

// gifts: still spending, counted everywhere as usual. This only says thank you.
function giftLine(list, mk){
  const y = mk.slice(0,4); let m = 0, yr = 0;
  for (const r of list){ const rm = mkOf(r.date); if (!rm || rm.slice(0,4) !== y || rm > mk) continue;
    const g = sum(lines(r).filter(it => it.gift).map(it => num(it.price))); yr += g; if (rm === mk) m += g; }
  if (yr < 0.01) return "";
  const thanks = "Thank you for caring for others ♥";
  return `<span class="gift-line">${m >= 0.01
    ? `This month you spent <b class="num">${money(m)}</b> on gifts for others, <b class="num">${money(yr)}</b> so far in ${y}. ${thanks}`
    : `So far in ${y} you've spent <b class="num">${money(yr)}</b> on gifts for others. ${thanks}`}</span>`;
}

function viewHome(A, list){
  const mk = S.month, M = A.months[mk] || {total:0, cats:{}, prods:{}, count:0, premium:0, premCats:{}, premProds:{}};
  const allM = monthList(A);
  const pos = allM.indexOf(mk);
  const {avg, sd: s, n} = A.stats;
  let vs = "";
  if (avg){ const d = M.total/avg - 1; const partial = mk === A.curMk;
    vs = `<span class="pill ${d>0?"up":"down"}">${pct(d,0)} vs. your monthly average${partial?" · month in progress":""}</span>`; }
  const cats = Object.entries(M.cats).sort((a,b)=>b[1]-a[1]); const top = cats[0]?.[1] || 1;
  const rowsHtml = cats.map(([c,v]) => {
    const open = S.openCat === c;
    let sub = "";
    if (open){ const items = {};
      list.filter(r=>mkOf(r.date)===mk).forEach(r => lines(r).forEach(it => { if (catOf(it.category)===c){ const k = key(it.product||it.name); items[k] = items[k] || {k, l:it.product||it.name, v:0, n:0}; items[k].v += num(it.price); items[k].n++; } }));
      sub = `<div class="sub">${Object.values(items).sort((a,b)=>b.v-a.v).map(i=>`<div><span>${esc(i.l)}${i.n>1?` <span class="muted">×${i.n}</span>`:""}</span><span class="num">${M.premProds[i.k]?`<span class="prem">premium ${money(M.premProds[i.k])}</span> `:""}${money(i.v)}</span></div>`).join("")}</div>`; }
    return `<button class="row" data-cat="${c}" aria-expanded="${open}"><span class="chev-r">›</span><span class="name">${esc(CAT[c])}</span><span class="amt">${money(v)}${M.premCats[c]?`<small class="prem">premium ${money(M.premCats[c])}</small>`:""}</span><span class="meter"><i style="width:${(v/top*100).toFixed(1)}%"></i></span></button>${sub}`;
  }).join("");
  // regular buys: products (not services) bought in more than half of your months (A.staples).
  // Savings add up on these because you buy them again and again; one-off purchases stay visible in the categories.
  const regular = new Set(A.staples.filter(P => !NOT_PRODUCTS.includes(P.category)).map(P => P.key));
  const prods = Object.entries(M.prods).filter(([k]) => regular.has(k)).sort((a,b)=>b[1]-a[1]).slice(0,5);
  const perYear = k => A.products[k].total / Math.max(1, A.mks.length) * 12;
  const D = decompose(list, mk, A.curMk), I = homeInsights(A, list, mk, D);
  // a card waiting to be revealed goes near the top, so it isn't missed; otherwise the section sits at the end
  const TS = typeSection(), tsTop = TS.includes("type-ready");
  return `
  <div class="section">
    <div class="monthbar"><button class="chev" data-month="-1" ${pos<=0?"disabled":""} aria-label="Previous month">‹</button><span class="m">${mkLabel(mk,true)}</span><button class="chev" data-month="1" ${pos>=allM.length-1?"disabled":""} aria-label="Next month">›</button></div>
    <div class="hero"><span class="label">Spent this month</span><span class="big num">${money(M.total)}</span>${vs}${giftLine(list, mk)}</div>
  </div>
  <div class="stats two">
    <div class="stat"><span class="label">Monthly avg</span><span class="v num">${avg?money(avg,0):"—"}</span></div>
    <div class="stat"><span class="label">Typical range</span><span class="v num" style="font-size:.95rem">${avg&&s?`${money(Math.max(0,avg-s),0)}–${money(avg+s,0)}`:"—"}</span></div>
  </div>
  <div class="stats-note">
    <p class="small muted">${avg?`With this average, you spend <b class="num">${money(avg*12,0)}</b> a year.`:"Averages appear once you have a complete month of receipts."}</p>
    ${n?`<details class="more" data-note="stats"${S.openNotes.has("stats")?" open":""}><summary class="small muted">How these are worked out</summary>
      <div class="stats two"><div class="stat"><span class="label">Std deviation</span><span class="v num">${s?"± "+money(s,0):"—"}</span></div></div>
      <p class="small muted">Based on ${n} complete month${plural(n)}. The current month, and a first month you only partly tracked, are left out.</p>
      <p class="small muted">Spending is what you paid, after offers. Bottle deposits aren't counted, because you get them back.</p>
      <p class="small muted">Standard deviation shows how much your monthly spending varies from the average, so you can tell whether a month is usual or unusual. The typical range is the average plus or minus one standard deviation.</p>
    </details>`:""}
  </div>
  ${tsTop ? TS : ""}
  ${guideSection(I)}
  ${decompSection(A, list, mk, D, I)}
  <div class="section" id="sec-cats">
    <div class="section-head"><h2>Spending per category</h2></div>
    ${cats.length ? `<div class="ledger">${rowsHtml}</div>` : `<div class="empty">No expenses in ${mkLabel(mk,true)} yet.</div>`}
    ${I.where ? `<p class="takeaway">${I.where}</p>` : ""}
    <details class="more" data-note="cats"${S.openNotes.has("cats")?" open":""}><summary class="small muted">More about this</summary>
      ${I.fixedTxt ? `<p class="small muted">${I.fixedTxt}</p>` : ""}
      <p class="small muted">Tap a category to see its products. Your regular buys, below, shows the products you buy again and again.</p>
    </details>
  </div>
  ${prods.length ? `<div class="section top-prods"><div class="section-head"><h2>Your regular buys</h2><span class="small muted">this month · a year</span></div>
    <table class="mini"><tbody>${prods.map(([k,v])=>`<tr><td style="text-transform:capitalize">${esc(A.products[k]?.label||k)}</td><td>${money(v)}</td><td class="muted">≈ ${money(perYear(k),0)}</td></tr>`).join("")}</tbody></table>
    <p class="takeaway">Of what you buy regularly, the biggest is <b style="text-transform:capitalize">${esc(A.products[prods[0][0]]?.label || prods[0][0])}</b>: ${money(prods[0][1])} this month, about ${money(perYear(prods[0][0]),0)} a year. Saving a little on it, every time you buy it, adds up.</p>
    <details class="more" data-note="regular"${S.openNotes.has("regular")?" open":""}><summary class="small muted">What counts as a regular buy</summary>
      <p class="small muted">Products you bought in more than half of your months. One-off purchases, like clothes, and services, like eating out or transport, aren't here: you'll find them under Spending per category. A year is your average month for that product, times 12.</p>
      <p class="small muted">For every product ranked by what it costs you, see <button class="linkbtn" data-nav="products">All products</button> on Products.</p>
    </details></div>`:""}
  ${foundSection(A, M, mk, I)}
  ${paceSection(A, list, mk)}
  <div class="section" id="sec-months"><h2>Month by month</h2>${barChart(A, mk)}
    ${I.trend ? `<p class="takeaway">${I.trend}</p>` : ""}
    <details class="more chart-note" data-note="months"${S.openNotes.has("months")?" open":""}><summary class="small muted">How to read this chart</summary><p class="small muted">Bars: monthly totals. Dashed line: your monthly average. Includes every category, rent and bills too.</p></details></div>
  ${tsTop ? "" : TS}`;
}

/* ---------- Found for you ----------
   One equation ties it together, for every product you buy:
     what you paid = your best regular price + paid above your best price − saved with offers
   Saved with offers: money you already kept (discounts printed on your receipts).
   Paid above your best price (price premium): money you could still keep, by paying your lowest regular price.
   Bottle deposits are neither: they're your own money, waiting to be returned. */
function foundSection(A, M, mk, I){
  const off = M.offers || 0, prem = M.premium || 0, y = mk.slice(0,4);
  const yr = Object.entries(A.months).filter(([m]) => m.slice(0,4) === y && m <= mk);
  const depPaidY = sum(yr.map(([,X]) => X.depPaid || 0)), depBackY = sum(yr.map(([,X]) => X.depBack || 0));
  const depOpen = Math.max(0, A.deposit.paid - A.deposit.back);
  const dep = A.deposit.paid > 0 ? `<div class="found-row dep"><span>Bottle deposit to get back<br><span class="small muted">paid in ${y}: ${money(depPaidY)} · returned: ${money(depBackY)}</span></span><span class="num">${money(depOpen)}</span></div>` : "";
  return `<div class="premium found" id="sec-premium">
    <div class="premium-head"><span class="label">Found for you · ${esc(mkLabel(mk,true))}</span><span class="v num">${money(off + prem)}</span></div>
    <div class="found-row"><span>Saved with offers<br><span class="small muted">already in your pocket</span></span><span class="num chg down">${money(off)}</span></div>
    <div class="found-row"><span>Paid above your best price<br><span class="small muted">you could still save this</span></span><span class="num chg ${prem >= 0.005 ? "up" : "flat"}">${money(prem)}</span></div>
    ${dep}
    <p class="takeaway">${I.premium}</p>
    <details class="more" data-note="premium"${S.openNotes.has("premium")?" open":""}><summary class="small muted">How this is worked out</summary>
      <p class="small muted"><b>The equation behind it:</b> for every product, <i>what you paid = your best regular price + paid above your best price − saved with offers</i>. The regular price is the price before offers. So “Found for you” is both the money offers already saved you and the money you could still save by paying your best price. Nothing is counted twice.</p>
      <p class="small muted"><b>Saved with offers</b> adds up the discounts on your receipts: promotions, bonus or loyalty-card prices, “2 for 1”, and coupons on the whole receipt (spread over its products in proportion to their price). All time: <b class="num">${money(A.offers)}</b>.</p>
      <p class="small muted"><b>Paid above your best price</b>, also called the price premium: what you'd have saved by always paying your lowest regular price for the same product in the same month. Comparing within one month means price rises over time (inflation) don't count, and using regular prices means a promotion you didn't catch doesn't count either. Left out: ${esc(catList(PREMIUM_OUT))}. These are services and fixed costs, where a different price usually means a different choice, like another restaurant or a new flat. Products you bought only once are left out too. All time: <b class="num">${money(A.premium)}</b>.</p>
      <p class="small muted"><b>Bottle deposits</b> (statiegeld, Pfand, kaucja) aren't spending and aren't savings: you paid them, and you can get them back. They're left out of all totals and charts. “To get back” is what you paid in deposits minus the returns printed on your receipts, all time. If you return bottles for cash or a voucher that doesn't show up on a receipt, the real amount is lower.</p>
    </details>
  </div>`;
}

function decompSection(A, list, mk, D, I){
  const sofar = mk === A.curMk;
  const pctS = v => Math.abs(v) < .005 ? "0%" : pct(v,0);
  const prevL = mkLabel(D.prevMk, true), base = sofar ? `the same days of ${prevL} (1–${D.cut})` : prevL;
  let body;
  if (!D.e0) body = `<div class="empty">Add receipts from ${esc(prevL)} to see what drove the change.</div>`;
  else {
    const rows = [["Inflation","same product, same place",D.infl],["Where you shop","same product, different place",D.stores],["Offers","more or less saved with promotions",D.offers],["Your habits","what and how much you buy",D.habits]];
    const mx = Math.max(...rows.map(r => Math.abs(r[2])), 1e-9);
    const amt = v => `${v >= 0 ? "+" : "−"}${money(Math.abs(v))}`;
    body = `<p class="decomp-lead">${sofar ? `So far in ${esc(mkLabel(mk,true))}` : `In ${esc(mkLabel(mk,true))}`} you spent <b class="chg ${chgClass(D.change/D.e0)}">${pctS(D.change/D.e0)}</b> vs. ${esc(base)}: <b>${pctS(D.infl/D.e0)}</b> due to inflation, <b>${pctS(D.stores/D.e0)}</b> to where you shop, <b>${pctS(D.offers/D.e0)}</b> to offers and <b>${pctS(D.habits/D.e0)}</b> to your habits.</p>
    <table class="mini decomp"><tbody>${rows.map(([l,sub,v]) => `<tr><td>${l}<br><span class="small muted">${sub}</span></td><td class="dbar" aria-hidden="true"><i class="${v >= 0 ? "pos" : "neg"}" style="width:${(Math.abs(v)/mx*50).toFixed(1)}%"></i></td><td class="chg ${chgClass(v/D.e0)}">${amt(v)}<br><span class="small">${pctS(v/D.e0)}</span></td></tr>`).join("")}
      <tr class="tot"><td>Total change</td><td></td><td class="chg ${chgClass(D.change/D.e0)}">${amt(D.change)}<br><span class="small">${pctS(D.change/D.e0)}</span></td></tr></tbody></table>
    ${D.drivers.length ? `<details class="drivers-fold" data-note="drivers"${S.openNotes.has("drivers")?" open":""}><summary><h3 class="drivers-head">Biggest drivers</h3></summary><table class="mini drivers"><tbody>${D.drivers.map(x => {
      const parts = [["inflation",x.infl],["where you shop",x.stores],["offers",x.offers],["habits",x.habits]].filter(([,v]) => Math.abs(v) >= 0.005)
        .map(([n,v]) => `<span class="chg ${chgClass(v)}">${amt(v)}</span> ${n}`).join(" · ");
      return `<tr><td><span style="text-transform:capitalize">${esc(x.l)}</span><br><span class="small muted">${parts}</span></td><td class="chg ${chgClass(x.change)}">${amt(x.change)}</td></tr>`; }).join("")}</tbody></table></details>` : ""}`;
  }
  const take = D.e0 && I.why ? `<p class="takeaway">${I.why}${I.topTxt ? ` ${I.topTxt}` : ""}</p>` : "";
  return `<div class="section decomp-sec" id="sec-why"><div class="section-head"><h2>Why your spending changed</h2></div>${body}${take}
    ${I.infl ? `<p class="small muted bridge">${I.infl} <button class="linkbtn" data-nav="inflation">See your inflation</button></p>` : ""}
    <details class="more" data-note="decomp"${S.openNotes.has("decomp")?" open":""}><summary class="small muted">How this is worked out</summary><p class="small muted decomp-note">Compared with the previous month. The current month is compared only with the same days of last month (e.g. 1–11 Nov vs. 1–11 Oct), so an unfinished month doesn't bias the results. A price change counts as inflation only when you bought the same product at the same place in both months. If you have lunch at two different restaurants, the difference in price isn't counted as inflation, because the restaurants are different by design: it shows up under “Where you shop”.</p><p class="small muted decomp-note">Prices are compared as regular prices, before offers. What offers saved you is its own part: “Offers” is positive when you saved less with promotions than the month before (so you paid more), and negative when you saved more. Everything else, like buying more, less or different things, is “Your habits”. The four parts add up exactly to the total change. Bottle deposits aren't counted: they're not spending, because you get them back.</p></details></div>`;
}
 
function productRow(P){
  const ch = P.change;
  return `<button class="prod" data-prod="${esc(P.key)}">
    <span class="pn">${esc(P.label)}</span><span class="pr">${money(P.avgUnit)}<span class="muted small">/${P.unit==="kg"?"kg":P.unit==="l"?"l":"pc"}</span></span>
    <span class="meta">${esc(CAT[P.category])} · ${P.buys.length}× in ${P.monthsBought} mo</span>
    <span class="chg ${ch==null?"flat":chgClass(ch)}">${ch==null?"no price comparison yet":`${pct(ch)} since ${mkShort(P.pc.since)} at ${esc(P.pc.shop)}`}</span></button>`;
}
/* ---------- Products: where you could save ----------
   Two levers. Regular buys: the same product, bought where it's cheapest for you. Bigger and occasional spending:
   how often and how much, per visit. Both use your last 6 complete months, so old prices and a half-finished
   month don't skew the estimate. */
const BIG_CATS = ["eating_out","clothes_and_shoes","transport","child_care","pet_care","leisure","arts_culture","sports_fitness","specialized_equipment"];
const unitShort = u => u === "kg" ? "kg" : u === "l" ? "l" : "pc";
function saveWindow(A){ const w = A.completeMks.slice(-6); return w.length ? w : A.mks.slice(-6); }

// Regular buys: your average price per unit vs. the average at the shop where it's cheapest for you
function shopSavings(A){
  const W = new Set(saveWindow(A)), n = W.size, rows = []; let oneShop = 0;
  for (const P of A.staples){
    if (NOT_PRODUCTS.includes(P.category)) continue;
    const buys = P.buys.filter(b => W.has(b.mk) && b.unit === P.unit && b.store && b.qty > 0);
    const st = {};
    for (const b of buys){ const S_ = st[key(b.store)] ||= {name:b.store, q:0, e:0}; S_.q += b.qty; S_.e += b.unitPrice * b.qty; }
    const shops = Object.values(st);
    if (shops.length < 2){ if (buys.length) oneShop++; continue; }
    const q = sum(shops.map(s => s.q)), e = sum(shops.map(s => s.e)), yours = e/q;
    const best = shops.map(s => ({...s, avg: s.e/s.q})).sort((x,y) => x.avg - y.avg)[0];
    const year = (yours - best.avg) * (q/n) * 12;
    if (year >= 5) rows.push({P, shop:best.name, price:best.avg, yours, year});
  }
  rows.sort((x,y) => y.year - x.year);
  return {rows: rows.slice(0, 8), total: sum(rows.map(r => r.year)), oneShop, n};
}

// Bigger and occasional spending: per visit (one receipt), leaving out monthly repeats
function bigSpending(A, list){
  const months = saveWindow(A), W = new Set(months), n = months.length, C = {};
  for (const r of list){
    const mk = mkOf(r.date); if (!W.has(mk) || r.recurringId) continue;
    const per = {};
    for (const it of lines(r)){ const c = catOf(it.category); if (BIG_CATS.includes(c)) per[c] = (per[c]||0) + num(it.price); }
    for (const [c, v] of Object.entries(per)){ if (v <= 0) continue; const X = C[c] ||= {c, visits:0, e:0, ms:new Set(), amts:[], perMk:{}}; X.visits++; X.e += v; X.ms.add(mk); X.amts.push(v); X.perMk[mk] = (X.perMk[mk]||0) + 1; }
  }
  // once a month at (almost) the same amount looks like a pass or subscription that wasn't added as a monthly repeat
  const fixedLike = X => X.ms.size === n && n >= 2 && Object.values(X.perMk).every(k => k === 1) && sd(X.amts) / mean(X.amts) < .05;
  return {n, rows: Object.values(C).map(X => ({...X, avg: X.e/X.visits, perMonth: X.visits/n, year: X.e/n*12, regular: X.ms.size/n > .5, fixed: fixedLike(X)}))
    .filter(X => X.year >= 1).sort((x,y) => y.year - x.year)};
}

// Your shops: for products you bought at two or more shops, how each shop's price compares with your own
// average price for that same product. Weighted by what you spend, so products you buy a lot count more.
function shopIndex(A, list){
  const W = new Set(saveWindow(A)), sh = {};
  let productTot = 0;
  // share of your shopping: everything you bought as products (services and fixed costs left out)
  for (const r of list){
    if (!W.has(mkOf(r.date)) || !r.store) continue;
    const v = sum(lines(r).filter(it => !NOT_PRODUCTS.includes(catOf(it.category))).map(it => num(it.price)));
    if (v <= 0) continue;
    const X = sh[key(r.store)] ||= {name:r.store, spend:0, w:0, rel:0, prods:0};
    X.spend += v; productTot += v;
  }
  for (const P of Object.values(A.products)){
    if (NOT_PRODUCTS.includes(P.category)) continue;
    const buys = P.buys.filter(b => W.has(b.mk) && b.unit === P.unit && b.store && b.qty > 0);
    const st = {};
    for (const b of buys){ const Y = st[key(b.store)] ||= {q:0, e:0}; Y.q += b.qty; Y.e += b.unitPrice * b.qty; }
    const ks = Object.keys(st); if (ks.length < 2) continue;
    const ref = sum(ks.map(k => st[k].e)) / sum(ks.map(k => st[k].q));
    for (const k of ks){ const X = sh[k]; if (!X) continue; X.rel += (st[k].e/st[k].q / ref) * st[k].e; X.w += st[k].e; X.prods++; }
  }
  const all = Object.values(sh).map(X => ({...X, share: productTot ? X.spend/productTot : 0, idx: X.w ? X.rel/X.w - 1 : null}));
  const rows = all.filter(X => X.prods >= 2).sort((x,y) => y.share - x.share);
  return {rows: rows.length >= 2 ? rows : [], others: all.length - (rows.length >= 2 ? rows.length : 0)};
}

function shopsSection(A, list){
  const {rows, others} = shopIndex(A, list);
  if (!rows.length) return "";
  const n = saveWindow(A).length, main = rows[0], cheap = [...rows].sort((x,y) => x.idx - y.idx)[0];
  const gap = (1 + main.idx) / (1 + cheap.idx) - 1;
  const take = main === cheap || gap < .05
    ? `Your main shop, <b>${esc(main.name)}</b> (${(main.share*100).toFixed(0)}% of your shopping), is one of your cheapest for the same products. Switching shops wouldn't save much overall.`
    : `You do ${(main.share*100).toFixed(0)}% of your shopping at <b>${esc(main.name)}</b>, where the same products cost you about <b class="chg up">${(gap*100).toFixed(0)}% more</b> than at <b>${esc(cheap.name)}</b>.`;
  // a price level, not a change over time: say "pricier/cheaper" so it can't be mistaken for inflation
  const vs = v => Math.abs(v) < .005 ? `<span class="chg flat">your usual price</span>` : `<span class="chg ${v > 0 ? "up" : "down"}">${Math.abs(v*100).toFixed(0)}% ${v > 0 ? "pricier" : "cheaper"}</span>`;
  return `<div class="section shops-sec"><h2>Your shops</h2>
    <table class="mini"><thead><tr><th>Shop</th><th>Share</th><th>Same products</th></tr></thead><tbody>
      ${rows.map(X => `<tr><td>${esc(X.name)}<br><span class="small muted">compared on ${X.prods} products</span></td><td class="num">${(X.share*100).toFixed(0)}%</td><td>${vs(X.idx)}</td></tr>`).join("")}
    </tbody></table>
    <p class="takeaway">${take}</p>
    <details class="more" data-note="shops"${S.openNotes.has("shops")?" open":""}><summary class="small muted">How this is worked out</summary>
      <p class="small muted">Share: how much of your shopping you did at each shop over your last ${n} complete month${plural(n)}. Services and fixed costs (${esc(catList(NOT_PRODUCTS))}) aren't counted as shopping.</p>
      <p class="small muted">Same products: for every product you bought at two or more shops, each shop's average price per kg, litre or piece is compared with your own average price for that product. “8% pricier” means that shop charged you 8% more than you usually pay for the same things. It compares shops with each other, not prices over time: for that, see Inflation. Products you spend more on count more.</p>
      <p class="small muted">A shop is listed once you've bought at least 2 products there that you also bought somewhere else.${others ? ` ${others} other shop${plural(others)} ${others === 1 ? "doesn't" : "don't"} have enough to compare yet.` : ""}</p>
    </details></div>`;
}

// how concentrated your product spending is: tells you whether to start with a few products or with shops
function concentration(A){
  const W = new Set(saveWindow(A)), v = {};
  for (const P of Object.values(A.products)){ if (NOT_PRODUCTS.includes(P.category)) continue; const t = sum(P.buys.filter(b => W.has(b.mk)).map(b => b.price)); if (t > 0) v[P.key] = t; }
  const vals = Object.values(v).sort((x,y) => y - x); if (vals.length < 6) return "";
  const share = sum(vals.slice(0,5)) / sum(vals), ratio = share / (5/vals.length), p = (share*100).toFixed(0);
  return ratio >= 1.6 ? `A few products take most of your money: your top 5 are ${p}% of what you spend on products. Saving on those first has the biggest effect.`
    : ratio >= 1.25 ? `Your top 5 products are ${p}% of what you spend on products: a good place to start, but the rest adds up too.`
    : `Your spending is spread over many products (your top 5 are only ${p}%), so where you shop matters more than any single product.`;
}

function savingsSection(A, list){
  const R = shopSavings(A), B = bigSpending(A, list);
  if (!R.rows.length && !B.rows.length) return "";
  const basis = `your last ${R.n} complete month${plural(R.n)}`;
  const regular = R.rows.length ? `
    <h3 class="save-h">Your regular buys: buy where it's cheapest</h3>
    <table class="mini save-table"><thead><tr><th>Product</th><th>Cheapest at</th><th>Price there</th><th>Save / year</th></tr></thead><tbody>
      ${R.rows.map(r => `<tr data-prod="${esc(r.P.key)}"><td style="text-transform:capitalize">${esc(r.P.label)}</td><td>${esc(r.shop)}</td><td class="num">${money(r.price)}/${unitShort(r.P.unit)}</td><td class="num chg down">≈ ${money(r.year,0)}</td></tr>`).join("")}
    </tbody></table>
    <p class="takeaway">Buying these where they're cheapest for you could save about <b class="num">${money(R.total,0)}</b> a year, without buying less.</p>
    <details class="more" data-note="save-shop"${S.openNotes.has("save-shop")?" open":""}><summary class="small muted">How this is estimated</summary>
      <p class="small muted">For each product you buy regularly, we take your average price per kg, litre or piece over ${basis} and the average at the shop where it's cheapest for you. Averages, not your single best deal, because a one-off promotion can't be repeated every time. Prices are regular prices, before offers.</p>
      <p class="small muted">Save per year = (your average price − the price at the cheapest shop) × how much you buy in an average month × 12. It assumes you keep buying the same amounts, just at the cheaper shop.</p>
      <p class="small muted">Only products you bought at two or more shops can be compared, and only savings of ${money(5,0)} a year or more are shown.${R.oneShop ? ` ${R.oneShop} regular product${plural(R.oneShop)} you always buy at the same shop ${R.oneShop === 1 ? "isn't" : "aren't"} here.` : ""} Tap a product to see all its shops.</p>
    </details>` : "";
  const times = v => { const r = Math.round(v*10)/10; return Number.isInteger(r) || r >= 3 ? String(Math.round(r)) : r.toFixed(1); };
  const fmtFreq = x => x.perMonth >= 1 ? `about ${times(x.perMonth)}× a month` : `about once every ${Math.round(1/x.perMonth)} months`;
  const big = B.rows.length ? `
    <h3 class="save-h">Bigger and occasional spending</h3>
    <div class="big-list">${B.rows.map(x => `<div class="big-row"><div class="big-top"><span class="name">${esc(CAT[x.c])}</span><span class="num">≈ ${money(x.year,0)} / year</span></div>
      <span class="small muted">${x.fixed
        ? `Looks like a fixed monthly payment of about ${money(x.avg,0)}, like a pass or a subscription. If it is, adding it as a monthly repeat keeps it out of this list.`
        : `${fmtFreq(x)}, ${money(x.avg,0)} per visit on average. ${x.regular
        ? `One fewer a month saves about <b class="num">${money(x.avg*12,0)}</b> a year.`
        : `It's occasional for you, so each single decision counts: skipping one saves ${money(x.avg,0)}.`}`}</span></div>`).join("")}</div>
    <p class="takeaway"><b>${esc(CAT[B.rows[0].c])}</b> adds up the most: about ${money(B.rows[0].year,0)} a year at your current pace.</p>
    <details class="more" data-note="save-big"${S.openNotes.has("save-big")?" open":""}><summary class="small muted">How this is estimated</summary>
      <p class="small muted">Based on ${basis}. A visit is one receipt: one dinner out, one trip to a clothes shop, one ticket. Per year = your average month in that category × 12.</p>
      <p class="small muted">Whether something is regular or occasional comes from your own receipts: regular means you spent on it in more than half of those months. Monthly repeats, like a transit pass or insurance, are left out, because they don't change with each choice.</p>
      <p class="small muted">Only you know whether it's worth it to you. Some of this spending is exactly what money is for.</p>
    </details>` : "";
  const conc = concentration(A);
  return `<div class="section save-sec"><h2>Where you could save</h2>
    ${conc ? `<p class="pace-lead">${conc}</p>` : ""}
    ${R.n < 3 ? `<p class="small muted">An estimate based on ${R.n} month${plural(R.n)} so far. It gets more reliable as you add receipts.</p>` : ""}
    ${regular}${big}</div>`;
}

function viewProducts(A, list){
  const all = Object.values(A.products).filter(P=>P.category!=="housing").sort((a,b)=>b.total-a.total);
  const q = key(S.q); const filtered = q ? all.filter(P => P.key.includes(q) || key(CAT[P.category]).includes(q)) : all;
  return `
  <div class="section"><h1>Products</h1></div>
  ${q ? "" : savingsSection(A, list)}
  ${q ? "" : shopsSection(A, list)}
  <div class="section all-sec"><div class="section-head"><h2>${q?"Results":"All products"}</h2>${q ? "" : `<span class="small muted">by what they've cost you so far</span>`}</div>
    <input class="search" id="q" type="search" placeholder="Search products or categories" value="${esc(S.q)}" aria-label="Search products">
    ${filtered.map(productRow).join("") || `<div class="empty">No products match.</div>`}</div>`;
}
 
function viewInflation(A){
  const I = chainIndex(A), c = indexChange(I);
  if (A.mks.length < 2 || !I.count || !c) return `<div class="section"><h1>Your inflation</h1><div class="empty">Your personal inflation appears once you've bought the same product at the same shop in two different months.</div></div>`;
  const {ref, span, ch} = c, pts = I.pts;
  const yr = indexedSpendYear(A), extra = yr * ch / (1 + ch);
  // what your choice of shop added on top: prices paid wherever you bought, against the same-shop index
  const paid = indexChange(chainIndex(A, {sameShop:false})), shopFx = paid ? (1 + paid.ch)/(1 + ch) - 1 : 0;
  const annual = Math.pow(1+ch, 12/Math.max(1,span)) - 1;
  const fmtP = v => `${(Math.abs(v)*100).toFixed(1)}%`;
  const shopLine = Math.abs(shopFx) < .01
    ? `Where you shopped made little difference on top of that: you paid about the same as if you'd stayed at the same shops.`
    : shopFx > 0
      ? `On top of that, shopping at pricier places added <b class="chg up">${fmtP(shopFx)}</b>, so in total you paid <b>${fmtP(paid.ch)}</b> ${paid.ch >= 0 ? "more" : "less"}. That part is your choice: see <button class="linkbtn" data-nav="products">Your shops</button>.`
      : `Shopping at cheaper places saved you <b class="chg down">${fmtP(shopFx)}</b> on top of that, so in total you paid <b>${fmtP(paid.ch)}</b> ${paid.ch >= 0 ? "more" : "less"}.`;

  const mv = priceMovers(A);
  const up = mv.filter(x => x.year >= 1 && x.change > 0).sort((x,y) => y.year - x.year).slice(0,5);
  const down = mv.filter(x => x.year <= -1 && x.change < 0).sort((x,y) => x.year - y.year).slice(0,3);
  const moverRow = x => `<button class="prod" data-prod="${esc(x.P.key)}">
    <span class="pn">${esc(x.P.label)}</span><span class="pr chg ${chgClass(x.change)}">${pct(x.change,0)}</span>
    <span class="meta">at ${esc(x.shop)} · about ${money(Math.abs(x.year),0)} a year ${x.year > 0 ? "more" : "less"}${x.cheaper ? ` · cheaper now at ${esc(x.cheaper.name)} (${money(x.cheaper.p)}/${unitShort(x.P.unit)})` : ""}</span></button>`;

  const cats = [...new Set(Object.values(A.products).filter(P => indexable(P)).map(P => P.category))].map(cat => {
    const ci = chainIndex(A, {cat}), cc = ci.count && indexChange(ci); if (!cc) return null;
    const y = indexedSpendYear(A, cat); return {cat, ch: cc.ch, n: ci.count, eur: y * cc.ch / (1 + cc.ch)};
  }).filter(Boolean).sort((x,y) => y.eur - x.eur);
  const topCat = cats.find(x => x.eur >= 1);

  return `
  <div class="section"><h1>Your inflation</h1><span class="muted small">How much the prices of the things <i>you</i> buy have changed, comparing the same product at the same shop.</span></div>
  <div class="hero"><span class="label">${span>=12?"Last 12 months":`Since ${mkLabel(ref.mk,true)} (${span} mo)`}</span><span class="big num">${pct(ch)}</span>
    ${Math.abs(extra) >= 1 ? `<span class="pill ${extra>0?"up":"down"}">about ${money(Math.abs(extra),0)} a year ${extra>0?"more":"less"} for the same basket</span>` : ""}
    ${span >= 6 && span < 12 ? `<span class="small muted">≈ ${pct(annual)} per year at this pace</span>` : ""}</div>
  <p class="takeaway">${shopLine}</p>
  <div class="section spaced" style="margin-top:16px"><details class="more" data-note="inflation"${S.openNotes.has("inflation")?" open":""}><summary class="small muted">Show the chart and notes</summary>
    <span class="label">Price index, same product at the same shop, ${mkLabel(pts[0].mk)} = 100</span>${lineChart(pts, {base:100, label:"Personal price index"})}
    <p class="small muted chart-note">Dashed line: 100, your starting level. Only products you bought at the same shop in two different months count (${I.count} so far). Left out: ${esc(catList([...NO_INDEX]))}, because their prices can't be compared like for like.</p>
    <p class="small muted chart-note"><mark class="hl">Prices are compared as regular prices, before offers, so a promotion doesn't count as a price change: what offers saved you is shown under “Found for you” on Overview. Switching shops doesn't count either: that's your choice, shown separately above.</mark> “About ${money(Math.abs(extra),0)} a year” is what the same products cost you in a year now, compared with the prices back then.</p>
  </details></div>
  <div class="section infl-sec"><h2>Biggest price rises</h2><div class="ledger">${up.map(moverRow).join("") || `<div class="empty">No price rises yet.</div>`}</div>
    ${up.length ? `<p class="takeaway"><b style="text-transform:capitalize">${esc(up[0].P.label)}</b> costs you the most extra: about ${money(up[0].year,0)} a year.${up[0].cheaper ? ` It's cheaper now at ${esc(up[0].cheaper.name)}.` : ""}</p>` : ""}</div>
  ${down.length ? `<div class="section infl-sec"><h2>Got cheaper</h2><div class="ledger">${down.map(moverRow).join("")}</div></div>` : ""}
  <div class="section infl-sec"><h2>By category</h2><table class="mini"><thead><tr><th>Category</th><th>Change</th><th>A year</th></tr></thead><tbody>
    ${cats.map(x => `<tr><td>${esc(CAT[x.cat])}<br><span class="small muted">${x.n} product${plural(x.n)}</span></td><td class="chg ${chgClass(x.ch)}">${pct(x.ch)}</td><td class="chg ${chgClass(x.eur/100)}">${Math.abs(x.eur) < .5 ? "—" : amt0(x.eur)}</td></tr>`).join("")}</tbody></table>
    ${topCat ? `<p class="takeaway"><b>${esc(CAT[topCat.cat])}</b> adds the most to your inflation: about ${money(topCat.eur,0)} a year more than ${span>=12?"12 months ago":`in ${mkLabel(ref.mk,true)}`}.</p>` : ""}</div>
  <details class="card fold-card" data-note="calc"${S.openNotes.has("calc")?" open":""}><summary><h3>How this is calculated</h3></summary>
    <p class="small muted" style="margin:10px 0 0">Every month, each product you bought at the same shop in that month and the month before is compared on price per unit (per piece, kg or litre). Products you spend more on count more. The monthly changes are chained into one index that starts at 100, so 105 means the same products at the same shops cost 5% more than when you started.</p>
    <p class="small muted" style="margin:10px 0 0">Price rises per product compare your first and last month at the same shop within the last 12 months. “A year” is that price change times how much you usually buy. The shop effect compares this index with the prices you actually paid wherever you shopped.</p></details>`;
}
 
function viewHistory(A, list){
  const byM = {}; list.forEach(r => (byM[mkOf(r.date)] ||= []).push(r));
  const mks = Object.keys(byM).sort().reverse();
  return `
  <div class="section"><div class="section-head"><h1>Receipts</h1><button class="btn ghost" data-action="manual" style="padding:8px 14px;font-size:.9rem">+ Add expense</button></div>
  <span class="muted small receipts-hint">Tap a receipt to correct products, prices or categories.</span></div>
  ${!isDemo() && S.rules.length ? `<div class="section repeats"><div class="section-head"><h2>Monthly repeats</h2><span class="num muted">${money(sum(S.rules.map(itemsTotal)))} / month</span></div>
    <div class="ledger">${S.rules.map(R => `<div class="rule-row"><span class="st">${esc(R.store || R.items[0]?.product || "Expense")}</span><span class="num">${money(itemsTotal(R))}</span>
      <span class="meta">Every month on ${dayText(R.day)} · ${esc(untilText(R))}</span><button class="linkbtn" data-action="stoprule" data-rule="${esc(R.id)}">Stop</button></div>`).join("")}</div>
    <p class="small muted chart-note">Added automatically when the day arrives. To change the amount from now on, open the latest one below and tick “Use these details for future months”. Stopping keeps the months already added.</p></div>` : ""}
  ${mks.map(mk => `<div class="section month-sec"><div class="section-head"><h2>${mkLabel(mk,true)}</h2><span class="num muted">${money(A.months[mk]?.total||0)}</span></div>
    <div class="ledger">${byM[mk].sort((a,b)=>byDate(b,a)).map(r=>{ const n = (r.items||[]).length, manual = r.source==="manual";
      return `<button class="receipt" data-receipt="${esc(r.id)}">
      <span class="st">${esc(r.store||"Expense")}</span><span class="num" style="font-family:var(--display)">${money(itemsTotal(r))}</span>
      <span class="meta">${fmtDate(r.date)} · ${n} item${plural(n)} <span class="tag ${manual?"manual":"scan"}">${manual?"manual":"scanned"}</span>${r.recurringId?`<span class="tag repeat-tag">monthly</span>`:""}</span></button>`; }).join("")}</div></div>`).join("") || `<div class="empty">No receipts yet. Tap the button below to scan one.</div>`}`;
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
const sheetHead = (title, h2attrs="") => `<div class="sheet-head"><h2${h2attrs}>${title}</h2>${closeBtn}</div>`;
const thumb = url => url ? `<img class="thumb" src="${url}" alt="Your receipt photo">` : "";
// First tap arms a dangerous button and changes its label; only a second tap within `ms` returns true.
function confirmTap(b, prompt, ms=3000){
  if (b.dataset.armed) return true;
  const label = b.textContent; b.dataset.armed = "1"; b.textContent = prompt;
  setTimeout(() => { if (b.isConnected){ delete b.dataset.armed; b.textContent = label; } }, ms);
  return false;
}

function sheetAdd(){
  openSheet(`${sheetHead("Add a receipt")}
  <div class="choice">
    <button data-action="scan"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2"/><circle cx="12" cy="12" r="3.5"/></svg>
      <span><b style="font-family:var(--display);font-size:1.05rem;font-weight:700">Scan a receipt</b><br><span class="small muted">Take a photo or pick one. MijnParagon reads the date, shop, products and prices; you check them before saving.${S.limit?` ${Math.max(0,S.limit-(S.used||0))} of ${S.limit} scans left this month.`:""}</span></span></button>
    <button data-action="manual"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 20h4L19 9l-4-4L4 16v4zM13 7l4 4"/></svg>
      <span><b style="font-family:var(--display);font-size:1.05rem;font-weight:700">Add an expense by hand</b><br><span class="small muted">Rent, a market stall, cash payments, anything without a receipt.</span></span></button>
  </div>`);
}
 
function sheetSettings(){
  const feedbackSubject = encodeURIComponent("MijnParagon feedback");
  const feedbackBody = encodeURIComponent("Hi MijnParagon,\n\nMy feedback:\n\n");
  const usageText = () => `${S.used}${S.limit?` of ${S.limit}`:""} used`;
  const nAliases = Object.keys(S.aliases).length;
  openSheet(`${sheetHead("Settings")}
    <div class="settings-list">
    <div class="card small"><span class="label">Signed in as</span><br><b id="setEmail"></b></div>
    <label class="field"><span class="label">Currency</span><select id="cur">${CURRENCIES.map(c=>`<option ${c===S.currency?"selected":""}>${c}</option>`).join("")}</select></label>
    <div class="card small"><b>Scans this month</b><br><span class="muted" id="usage">${S.used!=null?usageText():"Checking…"}</span></div>
    <div class="card small"><b>Learned corrections</b><br><span class="muted">${nAliases} product name${plural(nAliases)} remembered. When you fix a product name or category after a scan, MijnParagon applies the same fix to future receipts.</span></div>
    <a class="btn ghost wide" style="display:block;text-align:center;text-decoration:none" href="mailto:info@mijnparagon.nl?subject=${feedbackSubject}&body=${feedbackBody}">Send feedback</a>
    <button class="btn ghost wide" data-action="export">Export my data (CSV)</button>
    <button class="btn ghost wide" data-action="signout">Sign out</button>
    <button class="btn danger wide" data-action="delaccount" id="delAccBtn">Delete my account and all data</button>
    <p class="foot"><a href="${PRIVACY_URL}" target="_blank" rel="noopener">Privacy policy</a></p>
    </div>`);
  $("#setEmail").textContent = S.user?.email || "";
  refreshUsage().then(() => { const u = $("#usage"); if (u && S.used != null) u.textContent = usageText(); });
}
 
function sheetProduct(k){
  const A = analyze(receipts()); const P = A.products[k]; if (!P) return;
  const unit = P.unit==="kg"?"kg":P.unit==="l"?"litre":"piece";
  const pts = P.buys.map(b => ({mk:b.mk, v:b.unitPrice, label:`${+b.date.slice(8)} ${mkShort(b.mk)}`}));
  const notes = [];
  if (P.sdUnit && P.avgUnit) { const cv = P.sdUnit/P.avgUnit; notes.push(cv < .04 ? "Price is very stable." : cv < .1 ? "Price moves a little between shops and weeks." : "Price varies a lot: promotions or shop choice matter here."); }
  if (P.stores.length > 1){ const [cs, cp] = P.stores[0], [es, ep] = P.stores[P.stores.length-1]; notes.push(`Cheapest at ${cs} (${money(cp)}), dearest at ${es} (${money(ep)}): ${pct(ep/cp-1,0)}.`); }
  if (Math.abs(P.lastVsAvg) > .03) notes.push(`Last time you paid ${pct(P.lastVsAvg,0)} ${P.lastVsAvg>0?"more":"less"} than usual.`);
  const offSum = sum(P.buys.map(b => b.discount || 0));
  if (offSum >= 0.01) notes.push(`Offers saved you ${money(offSum)} on it so far.`);
  notes.push(`You buy it about ${P.perMonth >= 1 ? P.perMonth.toFixed(1)+"× a month" : "once every "+Math.round(1/P.perMonth)+" months"}, ${money(P.total/Math.max(1,A.mks.length))} a month on average.`);
  openSheet(`${sheetHead(esc(P.label), ` style="text-transform:capitalize"`)}
    <span class="small muted">${esc(CAT[P.category])} · ${P.buys.length} purchases · ${money(P.total)} total</span>
    <div class="stats no-outline">
      <div class="stat"><span class="label">Avg / ${unit}</span><span class="v num">${money(P.avgUnit)}</span></div>
      <div class="stat"><span class="label">Range</span><span class="v num" style="font-size:.95rem">${money(P.minUnit)}–${money(P.maxUnit)}</span></div>
      <div class="stat"><span class="label">Change, same shop</span><span class="v num chg ${P.change==null?"flat":chgClass(P.change)}">${P.change==null?"—":pct(P.change)}</span></div>
    </div>
    ${pts.length>1?`<div class="section"><span class="label">Price per ${unit}, each purchase</span>${lineChart(pts,{fmt:v=>money(v), label:"Price history"})}<span class="small muted chart-note">Each point is one purchase, as the regular price per ${unit} (before offers), at any shop. Nothing is left out. “Change, same shop” compares your first and last month at the same shop within the last 12 months, the same way as on Inflation, so a cheaper or pricier shop doesn't count as a price change.</span></div>`:""}
    <div class="card small no-outline" style="display:flex;flex-direction:column;gap:6px">${notes.map(n=>`<span>${esc(n)}</span>`).join("")}</div>
    ${P.stores.length?`<table class="mini"><thead><tr><th>Shop</th><th>Bought</th><th>Avg / ${unit}</th></tr></thead><tbody>${P.stores.map(([s,p,n])=>`<tr><td>${esc(s)}</td><td class="muted">${n}×</td><td>${money(p)}</td></tr>`).join("")}</tbody></table>`:""}`);
}
 
/* ---------- editor ---------- */
function blankItem(){ return {name:"", product:"", category:"other", qty:1, unit:"pcs", unitPrice:0, price:0}; }
function startEditor(draft){ S.draft = draft; if (draft.recurringId){ const R = S.rules.find(x => x.id === draft.recurringId); if (R) draft.until = R.until || ""; } renderEditor(); }
function renderEditorKeep(){ const sc = document.querySelector(".sheet")?.scrollTop || 0; renderEditor(); const sh = document.querySelector(".sheet"); if (sh) sh.scrollTop = sc; }
// warning when the lines don't add up to the total printed on the receipt
const mismatchWarn = (D, total) => D.printedTotal && Math.abs(D.printedTotal - total) > .02
  ? `<div class="warn">The receipt says ${money(D.printedTotal)}, the lines add up to ${money(total)}. A line may be missing or misread.</div>` : "";
const UNITS = [["pcs","pcs"],["kg","kg"],["l","litre"]];
const KINDS = [["product","Product"],["deposit","Bottle deposit"],["deposit_return","Deposit returned"]];
function renderEditor(){
  const D = S.draft; const total = itemsTotal(D);
  const isNew = !D.id;
  openSheet(`${sheetHead(D.source==="scan"?(isNew?"Check the scan":"Edit receipt"):(isNew?"New expense":"Edit expense"))}
    ${D.demo?`<div class="warn">This is an example receipt. Changes to example data aren't saved.</div>`:""}
    ${thumb(D.imageUrl)}
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
        <select data-i="${i}" data-f="unit" aria-label="Unit">${UNITS.map(([id,l])=>`<option value="${id}" ${it.unit===id?"selected":""}>${l}</option>`).join("")}</select>
      </div>
      <div class="line3">
        <select data-i="${i}" data-f="kind" aria-label="Kind of line">${KINDS.map(([id,l])=>`<option value="${id}" ${kindOf(it)===id?"selected":""}>${l}</option>`).join("")}</select>
        ${kindOf(it) === "product" ? `<label class="disc"><span>Saved</span><input data-i="${i}" data-f="discount" inputmode="decimal" value="${esc(it.discount||"")}" placeholder="0.00" aria-label="Discount on this line"></label>` : `<span class="small muted">${kindOf(it) === "deposit" ? "Not counted as spending" : "Your deposit back, not a discount"}</span>`}
      </div>
      ${kindOf(it) === "product" ? `<label class="check gift"><input type="checkbox" data-i="${i}" data-f="gift" ${it.gift ? "checked" : ""}> Mark product as a gift</label>` : ""}</div>`).join("")}</div>
    <button class="btn ghost" data-action="additem">+ Add line</button>
    ${D.source === "manual" && !D.demo ? repeatBlock(D) : ""}
    <div class="totals"><span>Total</span><span class="num" id="f-total">${money(total)}</span></div>
    <div id="f-warn">${mismatchWarn(D, total)}</div>
    <div class="actions"><button class="btn" data-action="save" ${D.demo?"disabled":""}>Save</button>
      ${!isNew&&!D.demo?`<button class="btn danger" data-action="delete" id="delBtn">Delete</button>`:""}</div>`);
}
function repeatBlock(D){
  const R = D.recurringId && S.rules.find(x => x.id === D.recurringId);
  const d = dayOf(D.date || todayISO());
  const untilCtl = `<div class="until" role="radiogroup" aria-label="Repeat until">
      <label><input type="radio" name="f-untilmode" value="none" ${D.until ? "" : "checked"}> No end date</label>
      <label><input type="radio" name="f-untilmode" value="date" ${D.until ? "checked" : ""}> Until <input type="date" id="f-until" value="${esc(D.until || "")}" ${D.until ? "" : "disabled"} aria-label="Last date"></label></div>`;
  if (R) return `<div class="repeat card small"><span><b>Repeats monthly</b> on ${dayText(R.day)}, ${esc(untilText(R))}.</span>
      ${untilCtl}
      <label class="check"><input type="checkbox" id="f-future" ${D.applyFuture ? "checked" : ""}> Use these details (payee, amounts, day) for future months</label>
      <span class="muted">Changes without this tick only affect this month. Months already added stay as they are.</span>
      <button class="linkbtn" data-action="stoprule" id="stopRuleBtn">Stop repeating</button></div>`;
  return `<div class="repeat card small"><label class="check"><input type="checkbox" id="f-repeat" ${D.repeat ? "checked" : ""}> <b>Repeat monthly</b></label>
    ${D.repeat ? `<span>Added automatically every month on ${dayText(d)}, starting ${esc(mkLabel(mkOf(D.date || todayISO()), true))}. Past months up to today are added too.</span>${untilCtl}` : `<span class="muted">For rent, subscriptions and other fixed costs.</span>`}</div>`;
}
function onEditorInput(e){
  const el = e.target; const D = S.draft; if (!D) return;
  if (el.id === "f-repeat"){ D.repeat = el.checked; renderEditorKeep(); return; }
  if (el.id === "f-future"){ D.applyFuture = el.checked; return; }
  if (el.name === "f-untilmode"){ const on = el.value === "date"; const u = $("#f-until"); if (u){ u.disabled = !on; if (on) u.focus(); } D.until = on ? (u?.value || "") : ""; return; }
  if (el.id === "f-until"){ D.until = el.value; return; }
  if (el.id === "f-store") D.store = el.value; else if (el.id === "f-date"){ D.date = el.value; if (D.repeat) renderEditorKeep(); }
  else if (el.dataset.f === "gift"){ D.items[+el.dataset.i].gift = el.checked; return; }
  else if (el.dataset.f){ const it = D.items[+el.dataset.i]; const f = el.dataset.f;
    it[f] = el.value;
    if (f === "kind"){ if (el.value === "deposit_return" && num(it.price) > 0) it.price = -num(it.price);
      if (el.value !== "deposit_return" && num(it.price) < 0) it.price = -num(it.price);
      if (el.value !== "product"){ delete it.discount; delete it.gift; if (!it.product) it.product = el.value === "deposit" ? "bottle deposit" : "deposit return"; }
      renderEditorKeep(); return; }
    if (f === "price" || f === "qty"){ const q = num(it.qty)||1; it.unitPrice = r2(num(it.price)/q); }
    const total = itemsTotal(D); const t = $("#f-total"); if (t) t.textContent = money(total);
    const w = $("#f-warn"); if (w) w.innerHTML = mismatchWarn(D, total);
  }
}
async function saveDraft(){
  const D = S.draft; if (!D) return;
  const items = D.items.map(it => { const qty = num(it.qty)||1, kind = kindOf(it);
    // a returned deposit is stored as a negative amount, everything else as positive
    let price = r2(num(it.price)); if (kind === "deposit_return") price = -Math.abs(price); else if (kind === "deposit") price = Math.abs(price);
    const product = key(it.product||it.name) || (kind === "deposit" ? "bottle deposit" : kind === "deposit_return" ? "deposit return" : "");
    const row = {name: String(it.name||product).trim(), product, category: kind === "product" ? catOf(it.category) : "other", qty, unit: it.unit||"pcs", unitPrice: r2(price/qty), price};
    if (kind !== "product") row.kind = kind;                     // stored only when it isn't a product
    else { const d = r2(Math.abs(num(it.discount))); if (d >= 0.01) row.discount = d; if (it.gift) row.gift = true; }   // stored only when used, so older receipts need no change
    return row; })
    .filter(it => it.product || it.price);
  if (!items.length){ toast("Add at least one line with a price."); return; }
  if (!D.date){ toast("Pick a date."); return; }
  const repeating = D.repeat || D.recurringId;
  if (repeating && $('[name="f-untilmode"][value="date"]')?.checked && !D.until){ toast("Pick an end date, or choose “No end date”."); return; }
  if (repeating && D.until && D.until < D.date){ toast("The end date is before the first date."); return; }
  const rec = {id: D.id || rid(), date: D.date, store: String(D.store||"").trim(), items, source: D.source, createdAt: D.createdAt || new Date().toISOString(), recurringId: D.recurringId || null};
  if (D.printedTotal) rec.printedTotal = D.printedTotal;
  // learn corrections from scans
  let learned = false;
  if (D.original) items.forEach((it,i) => { const o = D.original[i]; if (o && it.name && (key(o.product)!==key(it.product) || o.category!==it.category)){ S.aliases[key(it.name)] = {product:it.product, category:it.category}; learned = true; } });
  const btn = document.querySelector('[data-action="save"]'); if (btn){ btn.disabled = true; btn.textContent = "Saving…"; }
  try {
    let newRule = null;
    if (D.repeat && !D.recurringId){
      newRule = {id: rid(), store: rec.store, items, day: dayOf(rec.date), startMonth: mkOf(rec.date), until: D.until || null, lastGenerated: mkOf(rec.date)};
      await saveRule(newRule); rec.recurringId = newRule.id;
    } else if (D.recurringId){
      const R = S.rules.find(x => x.id === D.recurringId);
      if (R){ const upd = {...R, until: D.until || null}; if (D.applyFuture) Object.assign(upd, {store: rec.store, items, day: dayOf(rec.date)}); await saveRule(upd); }
    }
    await persistReceipt(rec);
    if (newRule || D.recurringId) await generateRecurring();
    if (learned) await persistProfile();
    S.month = mkOf(rec.date);
    closeSheet(); render(); toast(learned ? "Saved. Corrections remembered for next time." : (D.repeat && !D.recurringId) ? "Saved. It will repeat every month." : "Saved");
  } catch(e){ if (btn){ btn.disabled = false; btn.textContent = "Save"; } toast("Couldn't save. Check your connection and try again."); }
}
async function deleteDraft(){
  const b = $("#delBtn"); if (!b || !confirmTap(b, "Tap again to delete")) return;
  try { await removeReceipt(S.draft.id); closeSheet(); render(); toast("Deleted"); } catch(e){ toast("Couldn't delete. Try again."); }
}
 
/* ---------- backend (Supabase) ---------- */
const CFG = window.PARAGON_CONFIG || {};
const configured = !!(CFG.supabaseUrl && CFG.supabaseKey && window.supabase) && !/YOUR-/.test(CFG.supabaseUrl + CFG.supabaseKey);
// Accept the project URL with or without a trailing "/" or "/rest/v1/".
const SB_URL = String(CFG.supabaseUrl || "").trim().replace(/\/+$/, "").replace(/\/rest\/v1$/, "");
let sb = null;
try { if (configured) sb = window.supabase.createClient(SB_URL, String(CFG.supabaseKey).trim()); } catch(e){ console.error(e); }
const PRIVACY_URL = esc(CFG.privacyUrl || "privacy.html");
const thisMonth = () => new Date().toISOString().slice(0,7);
const fromRow = r => ({id:r.id, date:r.date, store:r.store||"", items:r.items||[], source:r.source, printedTotal: r.printed_total==null ? null : Number(r.printed_total), createdAt:r.created_at, recurringId:r.recurring_id || null});
const toRow = rec => ({id:rec.id, date:rec.date, store:rec.store, items:rec.items, source:rec.source, printed_total: rec.printedTotal ?? null, recurring_id: rec.recurringId || null, updated_at:new Date().toISOString()});
const ruleFromRow = r => ({id:r.id, store:r.store||"", items:r.items||[], day:r.day, startMonth:r.start_month, until:r.until || null, lastGenerated:r.last_generated});
 
async function loadData(){
  S.loaded = false; render();
  const [rec, prof, rul] = await Promise.all([
    sb.from("receipts").select("*").order("date", {ascending:true}),
    sb.from("profiles").select("*").maybeSingle(),
    sb.from("recurring").select("*")
  ]);
  if (rec.error){ toast("Couldn't load your receipts. Check your connection."); console.error(rec.error); }
  S.real = (rec.data || []).map(fromRow);
  S.rules = (rul.data || []).map(ruleFromRow);
  if (rul.error) console.error(rul.error);
  try { await generateRecurring(); } catch(e){ console.error("repeats", e); }
  if (prof.data){ S.currency = prof.data.currency || "EUR"; S.aliases = prof.data.aliases || {}; fmtCache = {}; }
  loadCards(prof.data);
  S.loaded = true; render();
  monthlyTypeReading().then(() => { if (S.cards.unseen) render(); }).catch(e => console.error("type", e));
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
  const {error} = await sb.from("receipts").upsert(toRow(rec));
  if (error) throw error;
  const i = S.real.findIndex(r=>r.id===rec.id); if (i>=0) S.real[i] = rec; else S.real.push(rec);
  S.real.sort(byDate);
}
async function removeReceipt(id){
  const {error} = await sb.from("receipts").delete().eq("id", id);
  if (error) throw error;
  S.real = S.real.filter(r=>r.id!==id);
}
/* ---------- monthly repeats ---------- */
const dateIn = (mk, day) => `${mk}-${pad(Math.min(day, daysIn(mk)))}`;
// Same repeat + same month always gives the same id, so two devices can't add a month twice.
async function seriesId(ruleId, mk){
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(ruleId + "|" + mk)));
  h[6] = (h[6] & 0x0f) | 0x40; h[8] = (h[8] & 0x3f) | 0x80;
  const x = [...h.slice(0,16)].map(v => v.toString(16).padStart(2,"0")).join("");
  return `${x.slice(0,8)}-${x.slice(8,12)}-${x.slice(12,16)}-${x.slice(16,20)}-${x.slice(20,32)}`;
}
// Adds every month whose date has arrived since the repeat last ran. A month you deleted is not added again.
async function generateRecurring(){
  const today = todayISO(), nowMk = mkOf(today);
  for (const R of S.rules){
    const rows = []; let mk = R.lastGenerated;
    while (mk < nowMk){
      const next = addMonths(mk, 1), date = dateIn(next, R.day);
      if (date > today || (R.until && date > R.until)) break;
      rows.push(toRow({id: await seriesId(R.id, next), date, store: R.store, items: R.items, source: "manual", recurringId: R.id}));
      mk = next;
    }
    if (!rows.length) continue;
    const {error} = await sb.from("receipts").upsert(rows); if (error) throw error;
    const up = await sb.from("recurring").update({last_generated: mk, updated_at: new Date().toISOString()}).eq("id", R.id); if (up.error) throw up.error;
    R.lastGenerated = mk;
    rows.forEach(r => { if (!S.real.some(x => x.id === r.id)) S.real.push(fromRow(r)); });
  }
  S.real.sort(byDate);
}
async function saveRule(R){
  const {error} = await sb.from("recurring").upsert({id:R.id, store:R.store, items:R.items, day:R.day, start_month:R.startMonth, until:R.until || null, last_generated:R.lastGenerated, updated_at:new Date().toISOString()});
  if (error) throw error;
  const i = S.rules.findIndex(x => x.id === R.id); if (i >= 0) S.rules[i] = R; else S.rules.push(R);
}
async function stopRule(id){
  const {error} = await sb.from("recurring").delete().eq("id", id); if (error) throw error;
  S.rules = S.rules.filter(R => R.id !== id);
  S.real.forEach(r => { if (r.recurringId === id) r.recurringId = null; });
}
const untilText = R => R.until ? `until ${fmtDate(R.until)}` : "no end date";
const dayText = d => d > 28 ? `day ${d} (or the last day of shorter months)` : `day ${d}`;

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
  openSheet(`${sheetHead("Scanning")}
    ${thumb(url)}
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
      const name = String(it.name||"").trim(); let product = key(it.product || name); let category = catOf(it.category);
      const a = S.aliases[key(name)]; if (a){ product = a.product; category = a.category; }
      const qty = num(it.qty)||1, price = r2(num(it.price)); const unit = ["pcs","kg","l"].includes(it.unit)?it.unit:"pcs";
      const kind = ["deposit","deposit_return"].includes(it.kind) ? it.kind : "product";
      if (kind !== "product") return {name, product: kind === "deposit" ? "bottle deposit" : "deposit return", category:"other", kind, qty, unit:"pcs",
        unitPrice: r2((kind === "deposit_return" ? -Math.abs(price) : Math.abs(price))/qty), price: kind === "deposit_return" ? -Math.abs(price) : Math.abs(price)};
      const row = {name, product, category, qty, unit, unitPrice: r2(price/qty), price};
      const d = r2(Math.abs(num(it.discount))); if (d >= 0.01) row.discount = d;
      return row;
    });
    spreadReceiptDiscount(items, r2(sum((res.receiptDiscounts || []).map(x => Math.abs(num(x.amount))))));
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
    openSheet(`${sheetHead("Couldn't read it")}
      ${thumb(S.draft?.imageUrl)}
      <div class="warn">${esc(msg)}</div>
      <details class="small muted"><summary>Technical details</summary><code style="word-break:break-all">${esc(code)} · ${esc(detail)} · ${esc(location.origin)}</code></details>
      <div class="actions">${code!=="limit_reached"?`<button class="btn" data-action="scan">Try another photo</button>`:""}<button class="btn ghost" data-action="manual-keep">Enter by hand</button></div>`);
  }
}
 
/* ---------- export & account ---------- */
function exportCsv(){
  const q = v => { const s = String(v ?? ""); return /[",\n;]/.test(s) ? `"${s.replace(/"/g,'""')}"` : s; };
  const rows = [["date","store","source","kind","product","name_on_receipt","category","qty","unit","unit_price","price","discount","gift","currency"]];
  [...S.real].sort(byDate).forEach(r => (r.items||[]).forEach(it =>
    rows.push([r.date, r.store, r.source, kindOf(it), it.product, it.name, CAT[it.category]||"Other", it.qty, it.unit, it.unitPrice, it.price, discOf(it) || "", it.gift ? "yes" : "", S.currency])));
  if (rows.length === 1){ toast("Nothing to export yet."); return; }
  const blob = new Blob(["﻿" + rows.map(r=>r.map(q).join(",")).join("\n")], {type:"text/csv;charset=utf-8"});
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `mijnparagon-${todayISO()}.csv`;
  document.body.appendChild(a); a.click(); setTimeout(()=>{ URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
async function deleteAccount(){
  const b = $("#delAccBtn"); if (!b || !confirmTap(b, "Tap again: this can't be undone", 4000)) return;
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
  const privacy = `<p class="foot">By creating an account you agree to the <a href="${PRIVACY_URL}" target="_blank" rel="noopener">privacy policy</a>.</p>`;
  if (!configured){
    root.innerHTML = `<div class="auth">${BRAND}<div class="msg err">MijnParagon isn't connected to its database yet. Fill in <b>config.js</b> with your Supabase URL and key (see README).</div></div>`; return;
  }
  const email = `<label class="field"><span class="label">Email</span><input id="a-email" type="email" autocomplete="email" required></label>`;
  const newPass = label => `<label class="field"><span class="label">${label} (8+ characters, letters and numbers)</span><input id="a-pass" type="password" autocomplete="new-password" minlength="8" required></label>`;
  const form = (name, title, fields, submit) => `<h2 style="text-align:center">${title}</h2>
      <form data-form="${name}"${name === "signup" ? " novalidate" : ""}>${fields}
      <button class="btn wide" type="submit">${submit}</button></form>`;
  const forms = {
    signin: form("signin", "Sign in", email + `
      <label class="field"><span class="label">Password</span><input id="a-pass" type="password" autocomplete="current-password" required></label>`, "Sign in") + `
      <div class="switch"><button class="linkbtn" data-auth="signup">Create an account</button><button class="linkbtn" data-auth="forgot">Forgot password?</button></div>`,
    signup: form("signup", "Create your account", email + newPass("Password") + `
      <altcha-widget challenge="${esc(SB_URL)}/functions/v1/altcha-challenge" auto="onfocus" name="altcha" language="en"></altcha-widget>`, "Create account") + `
      <div class="switch"><button class="linkbtn" data-auth="signin">I already have an account</button></div>${privacy}`,
    forgot: form("forgot", "Reset your password", email, "Send reset link") + `
      <div class="switch"><button class="linkbtn" data-auth="signin">Back to sign in</button></div>`,
    reset: form("reset", "Choose a new password", newPass("New password"), "Save password")
  };
  root.innerHTML = `<div class="auth">${BRAND}<p class="lead">Scan your receipts. See where the money goes and how your prices change.</p>${m}${forms[authMode]}</div>`;
}
const redirectTo = () => location.origin + location.pathname;
// Waits for the ALTCHA robot check in the sign-up form and returns its result ("" if it failed).
async function altchaPayload(f){
  const w = f.querySelector("altcha-widget"), val = () => f.querySelector('input[name="altcha"]')?.value || "";
  if (val() || !w) return val();
  return new Promise(resolve => {
    const done = v => { clearTimeout(timer); resolve(v); };
    const timer = setTimeout(() => done(val()), 45000);
    w.addEventListener("statechange", ev => {
      const st = ev.detail?.state;
      if (st === "verified") setTimeout(() => done(val()), 0);
      else if (st === "error" || st === "expired") done("");
    });
    try { if (w.getState?.() !== "verifying") w.verify?.(); } catch(_){}
  });
}
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
      // the form skips the browser's own checks so a click during the robot check isn't blocked
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)){ showAuth("signup", {err:true, text:"That email address doesn't look right."}); return; }
      if (password.length < 8 || !/[A-Za-z]/.test(password) || !/[0-9]/.test(password)){ showAuth("signup", {err:true, text:"Use at least 8 characters with both letters and numbers."}); return; }
      btn.textContent = "Checking you're not a robot…";
      const altcha = await altchaPayload(f);
      if (!altcha){ showAuth("signup", {err:true, text:"The robot check didn't finish. Tick the box above the button and try again."}); return; }
      btn.textContent = "Creating your account…";
      const {error} = await sb.functions.invoke("signup", {body:{email, password, altcha}});
      if (error){
        let code = "server_error"; try { code = (await error.context.json()).error || code; } catch(_){}
        showAuth("signup", {err:true, text: {
          altcha_failed: "The robot check didn't go through. Please try again.",
          invalid_email: "That email address doesn't look right.",
          weak_password: "Use at least 8 characters with both letters and numbers.",
          rate_limited: "Too many sign-ups right now. Please try again in an hour."
        }[code] || "Couldn't create the account. Please try again later."});
      } else showAuth("signin", {text:`Almost done: if ${email} is new here, a confirmation link is on its way. Open it to start using MijnParagon.`});
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
 
/* ---------- light / dark mode ---------- */
// The choice is remembered on this device only. Until someone picks one, the app follows the phone's setting.
const LS_THEME = "paragon.theme";
const systemDark = matchMedia("(prefers-color-scheme: dark)");
const SUN = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>`;
const MOON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>`;
const currentTheme = () => document.documentElement.dataset.theme || (systemDark.matches ? "dark" : "light");
function applyTheme(){
  const dark = currentTheme() === "dark";
  // phone status bar colour follows the app
  document.querySelectorAll('meta[name="theme-color"]').forEach(m => { m.content = dark ? "#0b2230" : "#f5e9d8"; });
  // the button shows the mode you'd switch to
  const b = $("#themeBtn"); b.innerHTML = dark ? SUN : MOON; b.setAttribute("aria-label", dark ? "Switch to light mode" : "Switch to dark mode");
}
function toggleTheme(){
  const next = currentTheme() === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem(LS_THEME, next); } catch(_){}
  applyTheme();
}
systemDark.addEventListener("change", applyTheme);

/* ---------- events ---------- */
document.addEventListener("click", e => {
  const au = e.target.closest("[data-auth]"); if (au){ showAuth(au.dataset.auth); return; }
  const t = e.target.closest("[data-action],[data-nav],[data-cat],[data-prod],[data-receipt],[data-month],[data-scrim]");
  if (!t) return;
  if (t.dataset.scrim !== undefined){ if (e.target === t && !S.scanCtl) closeSheet(); return; }
  if (t.dataset.nav){ S.view = t.dataset.nav; if (location.hash !== "#"+S.view) history.replaceState(null, "", "#"+S.view); closeSheet(); render(); window.scrollTo(0,0); return; }
  if (t.dataset.month){ const allM = monthList(analyze(receipts())); const i = allM.indexOf(S.month) + +t.dataset.month; if (allM[i]){ S.month = allM[i]; S.openCat = null; render(); } return; }
  if (t.dataset.cat){ S.openCat = S.openCat === t.dataset.cat ? null : t.dataset.cat; render(); return; }
  if (t.dataset.prod){ sheetProduct(t.dataset.prod); return; }
  if (t.dataset.receipt){ const r = receipts().find(x=>x.id===t.dataset.receipt); if (r) startEditor({...JSON.parse(JSON.stringify(r)), printedTotal:r.printedTotal||null}); return; }
  const a = t.dataset.action;
  if (a === "add") sheetAdd();
  else if (a === "settings") sheetSettings();
  else if (a === "theme") toggleTheme();
  else if (a === "close") closeSheet();
  else if (a === "scan"){ if (S.limit && S.used >= S.limit){ toast(`You've used all ${S.limit} scans this month.`); return; } const fi = $("#fileInput"); fi.value = ""; fi.click(); }
  else if (a === "manual"){ closeSheet(); startEditor({source:"manual", store:"", date:todayISO(), items:[blankItem()]}); }
  else if (a === "manual-keep"){ const url = S.draft?.imageUrl; S.draft = null; startEditor({source:"scan", imageUrl:url, store:"", date:todayISO(), items:[blankItem()]}); }
  else if (a === "additem"){ S.draft.items.push(blankItem()); renderEditor(); const ins = document.querySelectorAll('[data-f="product"]'); ins[ins.length-1]?.focus(); }
  else if (a === "delitem"){ S.draft.items.splice(+t.dataset.i, 1); if (!S.draft.items.length) S.draft.items.push(blankItem()); renderEditor(); }
  else if (a === "save") saveDraft();
  else if (a === "delete") deleteDraft();
  else if (a === "export") exportCsv();
  else if (a === "togglefixed"){ S.withFixed = !S.withFixed; render(); }
  else if (a === "stoprule"){
    const id = t.dataset.rule || S.draft?.recurringId; if (!id) return;
    if (!confirmTap(t, "Tap again to stop")) return;
    stopRule(id).then(() => { if (S.draft){ closeSheet(); } render(); toast("Stopped. Months already added stay."); }).catch(() => toast("Couldn't stop it. Try again."));
  }
  else if (a === "signout"){ closeSheet(); sb.auth.signOut(); }
  else if (a === "delaccount") deleteAccount();
  else if (a === "revealtype") revealType();
  else if (a === "opentype") openTypeCard(t.dataset.code);
  else if (a === "tcflip"){ if (!t.closest(".revealing")) t.classList.toggle("flipped"); }
  else if (a === "tcclose"){ const C = cardsNow(); if (C.pending) delete C.pending; closeTypeCard(); }
  else if (a === "tcdone") finishReveal();
});
// pictures for each type are optional (icons/types/<name>.png): without one, the card shows its first letter
document.addEventListener("error", e => { if (e.target.classList?.contains("tc-art")) e.target.remove(); }, true);
document.addEventListener("load", e => { if (e.target.classList?.contains("tc-art")) e.target.parentNode.classList.add("has-art"); }, true);
document.addEventListener("input", e => {
  if (e.target.id === "q"){ S.q = e.target.value; S._focusQ = true; render(); S._focusQ = false; return; }
  if (S.draft) onEditorInput(e);
});
document.addEventListener("change", async e => {
  if (e.target.id === "cur"){ S.currency = e.target.value; fmtCache = {}; render(); try { await persistProfile(); } catch(_){ toast("Couldn't save the currency."); } return; }
  if (e.target.id === "fileInput"){ const f = e.target.files?.[0]; if (f) runScan(f); return; }
  if (S.draft && (e.target.tagName === "SELECT" || e.target.dataset?.f === "gift")) onEditorInput(e);
});
document.addEventListener("toggle", e => { const k = e.target.dataset?.note; if (k) S.openNotes[e.target.open ? "add" : "delete"](k); }, true);
document.addEventListener("keydown", e => {
  if ((e.key === "Enter" || e.key === " ") && e.target.classList?.contains("tc-flip")){ e.preventDefault(); e.target.click(); return; }
  if (e.key === "Escape" && $("#sheetRoot").firstChild){ if ($(".tc-stage")){ const C = cardsNow(); if (C.pending) delete C.pending; closeTypeCard(); } else closeSheet(); }
});
function fromHash(){ const h = location.hash.slice(1); if (Object.hasOwn(VIEWS, h)){ S.view = h; if (S.user) render(); } }
window.addEventListener("hashchange", fromHash);

/* ---------- boot ---------- */
fromHash();
applyTheme();
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
    else if (!u && S.user !== null){ S.user = null; S.real = []; S.loaded = false; S.aliases = {}; S.used = null; S.cards = normCards(null); S.demoCards = null; showAuth("signin"); }
    else if (!u && event === "INITIAL_SESSION") { S.user = null; showAuth("signin"); }
  });
}
})();
