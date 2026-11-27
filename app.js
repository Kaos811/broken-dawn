/* Broken Dawn walkthrough mockup — tappable prototype, not the live game */
(() => {
  const STAGE_W = 390, STAGE_H = 844;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];

  const STORY = [
    { art: "assets/onboarding/story-1.webp", kicker: "The Rift", line: "The Rift tore the sky open. Our cities fell in a single night." },
    { art: "assets/onboarding/story-2.webp", kicker: "The Beacon", line: "The last survivors held on around a dying Beacon, waiting for someone to lead them." },
    { art: "assets/onboarding/story-3.webp", kicker: "Commander", line: "That someone is you, Commander. Relight the Beacon. Rebuild. Fight back." },
  ];

  const GUIDE_DOTS = 6;

  const GOALS = [
    { id: "gather", text: "Gather Alloy from a World node", detail: "Send Squad Alpha to a full Alloy node.", reward: { energy: 800, shards: 40, su_m15: 1 }, tag: "live system · first-trip amount is 200 (live chapter goal is 500)" },
    { id: "cc2", text: "Upgrade the Command Center to Lv 2", detail: "The Command Center is your main hub.", reward: { energy: 400, su_m5: 1 }, tag: "invented earlier beat · live chapter goal starts at Command Center Lv 3" },
    { id: "troops30", text: "Have 30 troops", detail: "Train more Sentinels in the Barracks.", reward: { energy: 400, su_m5: 1 }, tag: "live chapter goal" },
    { id: "beacon3", text: "Raise the Beacon to Lv 3", detail: "Lv 3 unseals the Archive.", reward: { energy: 600, alloy: 60 }, tag: "live chapter goal" },
    { id: "place-archive", text: "Place the Archive", detail: "Set it on the open plot at the base.", reward: { energy: 200 }, tag: "real unlock at Beacon Lv 3, not a listed chapter goal" },
    { id: "research", text: "Research Beacon Harmonics", detail: "Finish one research level at the Archive.", reward: { energy: 1000, su_m15: 2 }, tag: "live chapter goal: Finish a research level" },
    { id: "heal", text: "Heal wounded troops in the Infirmary", detail: "Troops wounded on the first hunt are waiting.", reward: { energy: 200, stamina: 10 }, tag: "live system" },
    { id: "alliance", text: "Visit the Alliance board", detail: "Look over the alliances already on the World map.", reward: { energy: 200, shards: 20 }, tag: "INVENTED screen · live game has NPC alliances and alliances-are-coming, plus Crew Help" },
    { id: "daily", text: "Claim the daily reward", detail: "Open Daily Missions and claim today\u2019s login.", reward: { cores: 1, stamina: 20, su_m15: 1 }, tag: "live Daily Missions task" },
    { id: "kills5", text: "Defeat 5 creatures", detail: "Hunt the nearby Lv 1 creatures. Wins are guaranteed in this mockup.", reward: { stamina: 20, su_m15: 1 }, tag: "shortened from the live Defeat 10 creatures chapter goal" },
  ];

  const FINAL_GIFT = { energy: 500, cores: 2, su_m15: 1, stamina: 20 };

  const ICO = {
    energy: "assets/ui/item-res-energy.webp",
    alloy: "assets/ui/item-res-alloy.webp",
    shards: "assets/ui/item-res-shards.webp",
    cores: "assets/ui/hud-core.webp",
    stamina: "assets/ui/hud-stamina.webp",
    su_m1: "assets/ui/item-su-m1.webp",
    su_m5: "assets/ui/item-su-m5.webp",
    su_m15: "assets/ui/item-su-m15.webp",
  };
  const LABEL = {
    energy: (n) => `+${n} Energy`,
    alloy: (n) => `+${n} Alloy`,
    shards: (n) => `+${n} Shards`,
    cores: (n) => `+${n} Beacon Core${n > 1 ? "s" : ""}`,
    stamina: (n) => `+${n} Stamina`,
    su_m1: (n) => `${n}\u00d7 1m Speed-up`,
    su_m5: (n) => `${n}\u00d7 5m Speed-up`,
    su_m15: (n) => `${n}\u00d7 15m Speed-up`,
  };

  function defaultState() {
    return {
      view: "title", story: 0, phase: "guide", step: "g-beacon", tab: "base",
      screen: null, panel: null, modal: null, tip: null, allow: null,
      beaconLit: false, beaconLevel: 1, charge: 8, energy: 60, alloy: 0, shards: 0, cores: 0, stamina: 100,
      showCores: false, showAlloy: false, showShards: false, showStamina: false, energyRate: false, orb: false,
      ccLevel: 1, archiveUnlocked: false, archivePlaced: false,
      sentinels: 0, wounded: 0, healed: false, training: null, building: null,
      healing: false, researchJob: null, researchDone: false, kael: false, kaelAssigned: false,
      hunts: 0, gathered: 0, dailyClaimed: false, allianceVisited: false, nodeState: "full",
      killed: {}, goalIndex: 0, goalReady: false, giftClaimed: false, tips: {},
      unlocks: { world: false, troops: false, armory: false, squads: false, more: false, builder: false, research: false, training: false, healing: false, missions: false, alliance: false },
      marching: null,
    };
  }

  let S = defaultState();
  let scale = 1;
  let toastTimer = 0;
  const stage = $("#stage");

  function fit() {
    scale = Math.min(window.innerWidth / STAGE_W, window.innerHeight / STAGE_H, 1.6);
    stage.style.transform = `scale(${scale})`;
  }
  window.addEventListener("resize", fit);
  fit();

  function power() {
    return 35 + S.sentinels + (S.beaconLevel - 1) * 15 + (S.ccLevel - 1) * 10 + (S.archivePlaced ? 5 : 0) + (S.kaelAssigned ? 8 : 0);
  }

  function toast(msg, ms = 2200) {
    const t = $("#toast");
    t.textContent = msg;
    t.classList.add("on");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("on"), ms);
  }

  function lootHtml(bundle) {
    return Object.entries(bundle).filter(([, n]) => n).map(([k, n]) =>
      `<div class="loot-item"><img src="${ICO[k]}" alt=""><span>${LABEL[k](n)}</span></div>`
    ).join("");
  }

  function grant(bundle, { silent } = {}) {
    if (bundle.energy) S.energy += bundle.energy;
    if (bundle.alloy) { S.alloy += bundle.alloy; S.showAlloy = true; }
    if (bundle.shards) { S.shards += bundle.shards; S.showShards = true; }
    if (bundle.cores) { S.cores += bundle.cores; S.showCores = true; }
    if (bundle.stamina) { S.stamina = Math.min(200, S.stamina + bundle.stamina); S.showStamina = true; }
    hud();
    if (!silent) {
      const bits = Object.entries(bundle).filter(([, n]) => n).map(([k, n]) => LABEL[k](n));
      if (bits.length) toast(bits.join(" \u00b7 "));
    }
  }

  function hud() {
    $("#power-val").textContent = String(power());
    $("#energy-val").textContent = String(S.energy);
    $("#alloy-val").textContent = String(S.alloy);
    $("#shards-val").textContent = String(S.shards);
    $("#cores-val").textContent = String(S.cores);
    $("#stam-txt").textContent = `${S.stamina} / 100`;
    $("#stam-bar").style.width = `${Math.min(100, S.stamina)}%`;
    $("#stam-mini").textContent = String(S.stamina);
    $("#res-blv").textContent = String(S.beaconLevel);
    $("#lv-beacon").textContent = String(S.beaconLevel);
    $("#lv-cc").textContent = String(S.ccLevel);
    $("#charge-bar").style.width = `${S.charge}%`;
    $("#energy-inc").classList.toggle("hidden", !S.energyRate);
    $("#cores-pill").classList.toggle("hidden", !S.showCores);
    $("#res-alloy").classList.toggle("hidden", !S.showAlloy);
    $("#res-shards").classList.toggle("hidden", !S.showShards);
    $("#res-stamina").classList.toggle("hidden", !S.showStamina);
    $("#cmd-lv").textContent = String(Math.max(1, S.beaconLevel));
    $("#beacon-glow").classList.toggle("on", S.beaconLit);
    $("#beacon-spr").style.filter = S.beaconLit ? "" : "brightness(.45) saturate(.6)";
    $("#energy-orb").classList.toggle("on", S.orb);
    $("#b-archive").classList.toggle("hidden", !S.archivePlaced);
    $("#place-plot").classList.toggle("hidden", !(S.archiveUnlocked && !S.archivePlaced && S.tab === "base" && !S.screen));
    const homeTag = $("#w-home .tag");
    if (homeTag) homeTag.innerHTML = `YOUR BASE<br><span style="color:#8a96a8;font-weight:600">Lv ${S.beaconLevel} \u00b7 ${S.beaconLevel >= 3 ? "Walled Camp" : "Outpost"}</span>`;

    const U = S.unlocks;
    setLock("#tab-world", !U.world);
    setLock("#tab-troops", !U.troops);
    setLock("#tab-armory", !U.armory);
    setLock("#tab-squads", !U.squads);
    setLock("#tab-more", !U.more);
    setLock("#q-builder", !U.builder);
    setLock("#q-research", !U.research);
    setLock("#q-training", !U.training);
    setLock("#q-healing", !U.healing);
    $("#q-missions").classList.toggle("hidden", !U.missions);
    setLock("#q-missions", !U.missions);
    $("#q-alliance").classList.toggle("hidden", !U.alliance);
    setLock("#q-alliance", !U.alliance);

    $$(".tab").forEach((t) => t.classList.toggle("on", t.dataset.tab === S.tab && t.dataset.tab !== "base"));
    $("#tab-base").classList.toggle("on", S.tab === "base");
    $("#base-map").classList.toggle("hidden", S.tab !== "base" || !!S.screen);
    $("#world-map").classList.toggle("hidden", S.tab !== "world" || !!S.screen);
    $("#world-hud").classList.toggle("on", S.tab === "world" && !S.screen);

    const late = S.phase !== "guide";
    ["w-scuttler2", "w-scuttler3", "w-scuttler4", "w-scuttler5"].forEach((id) => {
      const el = $("#" + id);
      el.classList.toggle("hidden", !late || !!S.killed[id]);
    });
    $("#w-scuttler").classList.toggle("hidden", !!S.killed["w-scuttler"]);
    $("#w-alloy").classList.toggle("hidden", !late);
    $("#alloy-img").src = S.nodeState === "full" ? "assets/ui/node-full.webp" : "assets/ui/node-camp.webp";

    const chip = $("#goal-chip");
    if (S.phase === "goals" && !S.screen && S.tab === "base") {
      chip.classList.remove("hidden");
      const G = GOALS[S.goalIndex];
      if (!G) chip.innerHTML = `<span class="g-k">CHAPTER GOALS</span>All goals complete`;
      else if (S.goalReady) chip.innerHTML = `<span class="g-k">CLAIM REWARD</span>${G.text}`;
      else chip.innerHTML = `<span class="g-k">NEXT GOAL</span>${G.text}`;
    } else chip.classList.add("hidden");

    updateTimers();
  }

  function setLock(sel, locked) {
    const el = $(sel);
    if (el) el.classList.toggle("locked", locked);
  }

  function updateTimers() {
    const show = (sel, on, text) => {
      const el = $(sel);
      if (!el) return;
      el.classList.toggle("on", !!on);
      if (on) el.textContent = text;
    };
    show("#tm-beacon", S.building && S.building.id === "beacon", (S.building && S.building.left) || "");
    show("#tm-cc", S.building && S.building.id === "cc", (S.building && S.building.left) || "");
  }

  function view(id) {
    $$(".screen").forEach((s) => s.classList.toggle("on", s.id === id));
    S.view = id;
  }
  function closeScreens() {
    S.screen = null;
    $$(".full").forEach((s) => s.classList.remove("on"));
  }
  function openScreen(id) {
    closeScreens();
    closeSheet();
    S.screen = id;
    const el = $("#scr-" + id);
    if (el) { el.classList.add("on"); fillScreen(id); }
    hud();
    maybeTip(id);
    syncGuide();
  }
  function setTab(tab) {
    if (tab === "more") { toast("More (Settings, Events) is unchanged in this mockup."); return; }
    if (tab === "world" && !S.unlocks.world) return;
    if (tab === "troops" && !S.unlocks.troops) return;
    if (tab === "armory" && !S.unlocks.armory) return;
    if (tab === "squads" && !S.unlocks.squads) return;
    closeScreens();
    closeSheet();
    if (tab === "troops") openScreen("troops");
    else if (tab === "armory") openScreen("armory");
    else if (tab === "squads") openScreen("squads");
    else { S.tab = tab; hud(); maybeTip(tab); syncGuide(); }
  }


  function clearPoint() {
    $("#spot").classList.remove("on");
    $("#hand").classList.remove("on", "up");
    $("#ring").classList.remove("on");
    S.allow = null;
  }
  function pointAt(el, opts) {
    opts = opts || {};
    if (!el) { clearPoint(); return; }
    const st = stage.getBoundingClientRect();
    const rec = el.getBoundingClientRect();
    const x = (rec.left + rec.width / 2 - st.left) / scale;
    const y = (rec.top + rec.height / 2 - st.top) / scale;
    const rad = Math.min(58, opts.r != null ? opts.r : (Math.min(rec.width, rec.height) / scale / 2 + 12));
    const spot = $("#spot");
    spot.classList.add("on");
    spot.style.background = `radial-gradient(circle at ${x}px ${y}px, transparent ${rad}px, rgba(2,3,6,.48) ${rad + 1}px)`;
    const ring = $("#ring");
    ring.classList.add("on");
    ring.style.left = x + "px";
    ring.style.top = y + "px";
    ring.style.width = ring.style.height = (rad * 2) + "px";
    const hand = $("#hand");
    const nearTop = y - rad < 130;
    hand.classList.add("on");
    hand.classList.toggle("up", nearTop);
    hand.style.left = x + "px";
    hand.style.top = (nearTop ? y + rad + 8 : y - rad - 4) + "px";
    S.allow = opts.allow || el;
    placeCoach(y);
  }
  function setFace(f) {
    $("#lyra").src = `assets/onboarding/lyra-${f || "neutral"}.webp`;
  }
  function showCoach(cfg) {
    const c = $("#coach");
    c.classList.add("on");
    setFace(cfg.face);
    $("#coach-title").textContent = cfg.title;
    $("#coach-body").innerHTML = cfg.body;
    $("#coach-skip").classList.toggle("hidden", cfg.skip === false);
    const btn = $("#coach-cont");
    if (cfg.cont) { btn.classList.remove("hidden"); btn.textContent = cfg.cont; }
    else btn.classList.add("hidden");
    const d = $("#coach-dots");
    if (cfg.dots) {
      d.innerHTML = "";
      for (let i = 0; i < GUIDE_DOTS; i++) {
        const n = document.createElement("i");
        if (i < cfg.dots.done) n.className = "done";
        if (i === cfg.dots.done) n.className = "on";
        d.appendChild(n);
      }
      d.style.display = "flex";
    } else d.style.display = "none";
  }
  function hideCoach() { $("#coach").classList.remove("on"); clearPoint(); }
  function placeCoach(targetY) {
    const c = $("#coach");
    c.classList.remove("top", "bot");
    if (targetY < STAGE_H * 0.5) c.classList.add("bot");
    else c.classList.add("top");
  }

  function closeModal() {
    $("#modal").classList.remove("on");
    $("#reveal").classList.remove("on");
    S.modal = null;
  }
  function showModal(cfg) {
    const box = $("#modal-box");
    const onBanner = cfg.banner !== false && cfg.title.length <= 16;
    const banner = cfg.banner !== false
      ? `<div class="banner-wrap"><img src="assets/onboarding/victory-banner.webp" alt="">${onBanner ? `<h2 class="on-banner">${cfg.title}</h2>` : ""}</div>`
      : "";
    box.innerHTML =
      banner +
      (cfg.chest ? `<img class="chest" src="assets/onboarding/chest-open.webp" alt="">` : "") +
      (cfg.art ? `<img class="chest" src="${cfg.art}" alt="">` : "") +
      (onBanner ? "" : `<h2>${cfg.title}</h2>`) +
      (cfg.sub ? `<div class="sub">${cfg.sub}</div>` : "") +
      (cfg.loot ? `<div class="loot">${lootHtml(cfg.loot)}</div>` : "") +
      (cfg.extra || "") +
      `<button class="btn gold" id="modal-btn">${cfg.btn || "Continue"}</button>`;
    hideCoach();
    $("#modal").classList.add("on");
    S.modal = "modal";
    $("#modal-btn").onclick = (e) => { e.stopPropagation(); closeModal(); if (cfg.onBtn) cfg.onBtn(); };
  }
  function closeSheet() {
    $("#sheet").classList.remove("on");
    $("#shade").classList.remove("on");
    S.panel = null;
  }
  function showSheet(html, opts) {
    opts = opts || {};
    const sh = $("#sheet");
    sh.innerHTML = html;
    sh.classList.add("on");
    $("#shade").classList.add("on");
    S.panel = opts.id || "sheet";
  }
  function allowedClick(el) {
    if (!S.allow) return true;
    if (S.phase !== "guide" && !S.tip) return true;
    if (S.modal || $("#confirm").classList.contains("on")) return true;
    const allow = S.allow;
    if (typeof allow === "string") return !!el.closest(allow);
    return allow === el || (allow.contains && allow.contains(el));
  }

  function fillScreen(id) {
    if (id === "troops") fillTroops();
    if (id === "armory") fillArmory();
    if (id === "missions") fillMissions();
    if (id === "research") fillResearch();
    if (id === "alliance") fillAlliance();
    if (id === "squads") fillSquads();
    if (id === "infirmary") fillInfirmary();
  }

  function fillTroops() {
    const q = S.training;
    $("#scr-troops").innerHTML = `
      <div class="head"><h2>Troops</h2><button class="btn ghost close" data-close>Close</button></div>
      <div class="list">
        <div class="rowc ${!q && S.sentinels < 30 ? "ready" : ""}">
          <img class="ic" src="assets/ui/troop-sentinel.webp" alt="">
          <div class="info">
            <h4>Sentinel <span style="color:#8a96a8;font-weight:600">\u00b7 Frontline Wall</span></h4>
            <p>Bulky modular armor and a T-visor helmet. Holds the line.</p>
            <p>Ready: <b>${S.sentinels}</b>${S.wounded ? ` \u00b7 Wounded: ${S.wounded}` : ""}${q ? ` \u00b7 Training ${q.left}` : ""}</p>
          </div>
          <div class="qty">${S.sentinels}</div>
        </div>
        ${q ? `<div class="rowc" style="border-color:var(--teal)">
          <img class="ic" src="assets/ui/ic-clock.webp" alt="">
          <div class="info"><h4>Training queue</h4><p>${q.n} Sentinels \u00b7 ${q.left} left. Jobs under 5 minutes finish free.</p></div>
          <button class="btn green" id="btn-free-train">Free</button>
        </div>` : `<button class="btn gold" id="btn-x10" ${S.energy < 60 ? "disabled" : ""}>Train x10 \u00b7 60 Energy</button>
        ${S.phase !== "guide" ? `<button class="btn cyan" id="btn-x20" ${S.energy < 120 ? "disabled" : ""} style="margin-top:8px">Train x20 \u00b7 120 Energy</button>` : ""}`}
      </div>`;
    const x10 = $("#btn-x10"); if (x10) x10.addEventListener("click", () => startTrain(10));
    const x20 = $("#btn-x20"); if (x20) x20.addEventListener("click", () => startTrain(20));
    const fr = $("#btn-free-train"); if (fr) fr.addEventListener("click", finishTrain);
    const cl = $("[data-close]", $("#scr-troops")); if (cl) cl.addEventListener("click", () => { closeScreens(); hud(); syncGuide(); });
  }
  function startTrain(n) {
    const cost = n * 6;
    if (S.energy < cost) { toast("Need more Energy"); return; }
    S.energy -= cost;
    S.training = { n, left: n === 10 ? "1:20" : "2:40", secs: n === 10 ? 80 : 160 };
    S.unlocks.training = true;
    hud(); fillTroops();
    if (S.step === "g-train-x10") setStep("g-train-free");
    else syncGuide();
  }
  function finishTrain() {
    if (!S.training) return;
    S.sentinels += S.training.n;
    S.training = null;
    hud(); fillTroops();
    if (S.step === "g-train-free") {
      grant({ su_m1: 3 }, { silent: true });
      showModal({
        title: "Sentinels ready!",
        sub: "New: Items. Here are 3\u00d7 1m Speed-ups.<br>I\u2019ve formed <b>Squad Alpha</b> with your Sentinels. They\u2019re ready to march.",
        loot: { su_m1: 3 },
        btn: "Continue",
        onBtn: () => { S.unlocks.world = true; toast("New: World"); setStep("g-world-tab"); },
      });
    } else {
      toast(S.sentinels + " Sentinels ready");
      checkGoals();
    }
  }

  function fillArmory() {
    $("#scr-armory").innerHTML = `
      <div class="head"><h2>Armory \u00b7 Recruit</h2><button class="btn ghost close" data-close>Close</button></div>
      <div class="list">
        <p style="color:#8a96a8;font-size:13px;margin-bottom:8px">Spend Beacon Cores to call leaders to our side. Your first pull is guaranteed: <b style="color:#ffd76a">Kael, Lightbringer</b>.</p>
        <div class="rowc ready">
          <img class="ic" src="assets/ui/hud-core.webp" alt="">
          <div class="info"><h4>Pull x1</h4><p>${S.kael ? "Kael already joined you." : "Costs 1 Beacon Core. This one is on Lyra if you have none."}</p></div>
          <button class="btn gold" id="btn-pull" ${S.kael ? "disabled" : ""}>Pull x1</button>
        </div>
        ${S.kael ? `<div class="rowc">
          <img class="ic" src="assets/ui/leader-kael.webp" alt="">
          <div class="info"><h4>Kael</h4><p>Lightbringer \u00b7 Legendary \u00b7 Bearer affinity. ${S.kaelAssigned ? "Leads Squad Alpha." : "Not assigned."}</p></div>
        </div>` : ""}
      </div>`;
    const p = $("#btn-pull"); if (p) p.addEventListener("click", pullKael);
    const cl = $("[data-close]", $("#scr-armory")); if (cl) cl.addEventListener("click", () => { closeScreens(); hud(); syncGuide(); });
  }
  function pullKael() {
    if (S.kael) return;
    if (S.cores < 1) { S.cores = 1; S.showCores = true; }
    S.cores -= 1;
    S.kael = true;
    hud();
    const rev = $("#reveal");
    rev.classList.add("on");
    rev.innerHTML = `
      <div class="card frame tight">
        <div class="rar">Legendary</div>
        <img class="portrait" src="assets/ui/leader-kael.webp" alt="Kael">
        <h2>Kael</h2>
        <div class="title">Lightbringer</div>
        <p style="font-size:13px;color:#d7dde6;margin-bottom:14px">Bearer affinity \u00b7 +25% Bearer ATK</p>
        <button class="btn gold" id="reveal-cont">Continue</button>
      </div>`;
    $("#reveal-cont").onclick = () => {
      $("#reveal").classList.remove("on");
      showModal({
        art: "assets/ui/leader-kael.webp",
        banner: false,
        title: "Kael joins you!",
        sub: "Lightbringer \u00b7 Legendary leader",
        btn: "Assign to Alpha",
        onBtn: () => {
          S.kaelAssigned = true;
          toast("Kael now leads Squad Alpha");
          hud();
          openGoalsIntro();
        },
      });
    };
  }

  function fillSquads() {
    $("#scr-squads").innerHTML = `
      <div class="head"><h2>Squads</h2><button class="btn ghost close" data-close>Close</button></div>
      <div class="list">
        <div class="rowc ready">
          <img class="ic" src="${S.kaelAssigned ? "assets/ui/leader-kael.webp" : "assets/ui/ic-squad.webp"}" alt="">
          <div class="info"><h4>Squad Alpha</h4><p>${S.sentinels} Sentinels${S.kaelAssigned ? " \u00b7 Leader: Kael" : ""} \u00b7 Home</p></div>
        </div>
        <div class="rowc" style="opacity:.6"><div class="info"><h4>Squad Bravo</h4><p>Locked \u00b7 Command Center Lv 3</p></div></div>
        <div class="rowc" style="opacity:.6"><div class="info"><h4>Squad Charlie</h4><p>Locked \u00b7 Command Center Lv 5</p></div></div>
        <p style="font-size:12px;color:#8a96a8">Edit Formation lets you choose which troops fill each line of a squad. Locked during a march.</p>
      </div>`;
    const cl = $("[data-close]", $("#scr-squads")); if (cl) cl.addEventListener("click", () => { closeScreens(); hud(); syncGuide(); });
  }

  function fillMissions() {
    $("#scr-missions").innerHTML = `
      <div class="head"><h2>Daily Missions</h2><button class="btn ghost close" data-close>Close</button></div>
      <div class="list">
        <div class="rowc ${!S.dailyClaimed ? "ready" : ""}">
          <img class="ic" src="assets/ui/chest-gold.webp" alt="">
          <div class="info"><h4>Claim the daily reward</h4><p>1 Beacon Core \u00b7 +20 Stamina \u00b7 1\u00d7 15m Speed-up. Resets at midnight.</p></div>
          <button class="btn gold" id="btn-daily" ${S.dailyClaimed ? "disabled" : ""}>${S.dailyClaimed ? "Claimed" : "Claim"}</button>
        </div>
        <div class="rowc"><div class="info"><h4>Defeat 8 creatures</h4><p>${Math.min(8, S.hunts)} / 8 \u00b7 20 pts</p></div></div>
        <div class="rowc"><div class="info"><h4>Train or promote 30 troops</h4><p>${Math.min(30, S.sentinels)} / 30 \u00b7 15 pts</p></div></div>
        <div class="rowc"><div class="info"><h4>Start a building upgrade</h4><p>${S.beaconLevel + S.ccLevel > 2 ? "1 / 1" : "0 / 1"} \u00b7 15 pts</p></div></div>
        <p style="font-size:12px;color:#8a96a8">Activity points open Bronze, Silver and Gold chests. The 100-point chest pays a Beacon Core once a day.</p>
      </div>`;
    const d = $("#btn-daily");
    if (d) d.addEventListener("click", () => {
      if (S.dailyClaimed) return;
      S.dailyClaimed = true;
      const loot = { cores: 1, stamina: 20, su_m15: 1 };
      grant(loot, { silent: true });
      showModal({
        chest: true,
        title: "Daily reward",
        sub: "Claimed and waiting until you collect. This panel stays, the way the open walkthrough PR treats rewards.",
        loot, btn: "Collect",
        onBtn: () => { fillMissions(); checkGoals(); },
      });
    });
    const cl = $("[data-close]", $("#scr-missions")); if (cl) cl.addEventListener("click", () => { closeScreens(); hud(); syncGuide(); });
  }


  function fillResearch() {
    $("#scr-research").innerHTML = `
      <div class="head"><h2>Archive \u00b7 Research</h2><button class="btn ghost close" data-close>Close</button></div>
      <div class="list">
        <p style="color:#8a96a8;font-size:13px">The Archive decodes the Beacon\u2019s signal. One project at a time. Economy \u00b7 Military \u00b7 Healing \u00b7 World.</p>
        <div class="rowc ${!S.researchDone ? "ready" : ""}">
          <img class="ic" src="assets/ui/more-research.webp" alt="">
          <div class="info">
            <h4>Beacon Harmonics</h4>
            <p>Economy \u00b7 Energy income +4% per level.</p>
            <p>${S.researchDone ? "Lv 1 complete." : S.researchJob ? "Researching\u2026 0:30. Jobs under 5 minutes finish free." : "Cost: 150 Energy, 20 Alloy, 30 Shards \u00b7 30s"}</p>
          </div>
          ${S.researchDone ? '<span class="qty">Lv 1</span>' :
            S.researchJob ? '<button class="btn green" id="btn-free-res">Free</button>' :
            '<button class="btn gold" id="btn-start-res">Research</button>'}
        </div>
      </div>`;
    const st = $("#btn-start-res");
    if (st) st.addEventListener("click", () => {
      if (S.energy < 150 || S.alloy < 20 || S.shards < 30) { toast("Need 150 Energy, 20 Alloy, 30 Shards"); return; }
      S.energy -= 150; S.alloy -= 20; S.shards -= 30;
      S.researchJob = { left: "0:30" };
      hud(); fillResearch(); syncGuide();
    });
    const fr = $("#btn-free-res");
    if (fr) fr.addEventListener("click", () => {
      S.researchJob = null; S.researchDone = true;
      toast("Beacon Harmonics Lv 1 complete \u00b7 Energy income +4%");
      fillResearch(); hud(); checkGoals();
    });
    const cl = $("[data-close]", $("#scr-research")); if (cl) cl.addEventListener("click", () => { closeScreens(); hud(); syncGuide(); });
  }

  function fillAlliance() {
    const rows = [
      ["ASH", "Ashen Vow", "#d9483b", 14],
      ["TDL", "Tidelight", "#2fc4c9", 11],
      ["GLD", "Gilded Reach", "#e7b24a", 16],
      ["IRN", "Iron Wake", "#7f93a8", 9],
      ["VOI", "Void Choir", "#8d5bd6", 12],
    ].map(([tag, name, col, n]) => `
      <div class="rowc">
        <div style="width:40px;height:40px;border-radius:8px;background:${col}33;border:1px solid ${col};display:flex;align-items:center;justify-content:center;font-weight:700;color:${col};font-size:11px">${tag}</div>
        <div class="info"><h4>${name}</h4><p>Nearby NPC alliance \u00b7 ${n} members (preview)</p></div>
      </div>`).join("");
    $("#scr-alliance").innerHTML = `
      <div class="head"><h2>Alliance board</h2><button class="btn ghost close" data-close>Close</button></div>
      <div class="list">
        <div class="preview-banner">PREVIEW \u00b7 Invented for this mockup. The live game already has these NPC alliances on the World map and says \u201calliances are coming.\u201d Crew Help already works like alliance help on a timer. Joining, war for the Rift Citadel, and PvP are not in the live game yet.</div>
        <div class="rowc ready">
          <img class="ic" src="assets/ui/ic-help.webp" alt="">
          <div class="info"><h4>Your alliance</h4><p>None yet. This is a first look at the board.</p></div>
        </div>
        ${rows}
        <button class="btn cyan" id="btn-viewed-alliance">I\u2019ve looked this over</button>
      </div>`;
    const v = $("#btn-viewed-alliance");
    if (v) v.addEventListener("click", () => {
      S.allianceVisited = true; toast("Alliance board visited"); closeScreens(); hud(); checkGoals();
    });
    const cl = $("[data-close]", $("#scr-alliance"));
    if (cl) cl.addEventListener("click", () => { S.allianceVisited = true; closeScreens(); hud(); checkGoals(); });
  }

  function fillInfirmary() {
    $("#scr-infirmary").innerHTML = `
      <div class="head"><h2>Infirmary</h2><button class="btn ghost close" data-close>Close</button></div>
      <div class="list">
        <p style="font-size:13px;color:#8a96a8">Treats troops wounded on World hunts. Wounded beyond its beds die. Healing costs Energy and time.</p>
        <div class="rowc ${S.wounded && !S.healed ? "ready" : ""}">
          <img class="ic" src="assets/ui/troop-sentinel.webp" alt="">
          <div class="info"><h4>Wounded Sentinels</h4><p>${S.wounded} waiting \u00b7 3 Energy and 4s each. Jobs under 5 minutes finish free.</p></div>
          ${S.wounded && !S.healed ? '<button class="btn gold" id="btn-heal">Heal all</button>' : `<span class="qty">${S.wounded}</span>`}
        </div>
        ${S.healing ? '<div class="rowc" style="border-color:var(--teal)"><div class="info"><h4>Healing\u2026</h4></div><button class="btn green" id="btn-free-heal">Free</button></div>' : ""}
      </div>`;
    const h = $("#btn-heal");
    if (h) h.addEventListener("click", () => {
      const cost = S.wounded * 3;
      if (S.energy < cost) { toast("Need more Energy"); return; }
      S.energy -= cost; S.healing = true; hud(); fillInfirmary();
    });
    const fr = $("#btn-free-heal");
    if (fr) fr.addEventListener("click", () => {
      S.sentinels += S.wounded; S.wounded = 0; S.healing = false; S.healed = true;
      toast("Sentinels healed and back in reserve");
      fillInfirmary(); hud(); checkGoals();
    });
    const cl = $("[data-close]", $("#scr-infirmary")); if (cl) cl.addEventListener("click", () => { closeScreens(); hud(); syncGuide(); });
  }

  function openBuilding(id) {
    if (S.tab !== "base" || S.screen) return;
    const panels = {
      beacon() {
        const lit = S.beaconLit;
        const busy = S.building && S.building.id === "beacon";
        const cost = S.beaconLevel === 1 ? 120 : 222;
        const canUp = lit && S.charge >= 100 && !busy && S.energy >= cost;
        return `
          <h3>The Beacon</h3>
          <div class="desc">An alien power source of unknown origin. It makes Energy and charges up for upgrades. Fully charge it, then spend Energy to raise its level.</div>
          <div class="meta">Level ${S.beaconLevel} \u00b7 Charge ${Math.floor(S.charge)}% \u00b7 Next: ${cost} Energy \u00b7 ${S.beaconLevel === 1 ? "10s" : "30s"}</div>
          <div class="actions">
            ${!lit ? '<button class="btn gold" id="act-relight">Relight</button>' : ""}
            ${lit && !busy ? `<button class="btn gold" id="act-up-beacon" ${canUp ? "" : "disabled"}>Upgrade to Lv ${S.beaconLevel + 1}</button>` : ""}
            ${busy ? '<button class="btn green" id="act-free-beacon">Free</button>' : ""}
            <button class="btn ghost" data-close>Close</button>
          </div>`;
      },
      commandCenter() {
        const busy = S.building && S.building.id === "cc";
        const cost = 50;
        const canUp = !busy && S.energy >= cost;
        return `
          <h3>Command Center</h3>
          <div class="desc">Main hub. Oversees Base Power, unlocks the Bravo and Charlie squads, and caps squad levels.</div>
          <div class="meta">Level ${S.ccLevel}${S.ccLevel < 2 ? ` \u00b7 Upgrade to Lv 2: ${cost} Energy \u00b7 10s` : ""}</div>
          <div class="actions">
            ${S.ccLevel < 2 && !busy ? `<button class="btn gold" id="act-up-cc" ${canUp ? "" : "disabled"}>Upgrade to Lv 2</button>` : ""}
            ${busy ? '<button class="btn green" id="act-free-cc">Free</button>' : ""}
            <button class="btn ghost" data-close>Close</button>
          </div>`;
      },
      barracks() {
        return `
          <h3>Barracks</h3>
          <div class="desc">Trains Sentinels, Bearers and Voyagers side by side. Open Troops to train.</div>
          <div class="meta">Level 1</div>
          <div class="actions"><button class="btn cyan" id="act-open-troops">Open Troops</button><button class="btn ghost" data-close>Close</button></div>`;
      },
      armory() {
        return `
          <h3>Armory</h3>
          <div class="desc">Recruitment hub for leaders, armor and weapons.</div>
          <div class="actions"><button class="btn cyan" id="act-open-armory" ${S.unlocks.armory ? "" : "disabled"}>Open Armory</button><button class="btn ghost" data-close>Close</button></div>`;
      },
      infirmary() {
        return `
          <h3>Infirmary</h3>
          <div class="desc">Treats troops wounded on World hunts. Wounded beyond its capacity die.</div>
          <div class="meta">${S.wounded} wounded \u00b7 Beds 45</div>
          <div class="actions"><button class="btn cyan" id="act-open-inf">Open Infirmary</button><button class="btn ghost" data-close>Close</button></div>`;
      },
      archive() {
        return `
          <h3>Archive</h3>
          <div class="desc">Decodes the Beacon\u2019s signal into research. One project at a time.</div>
          <div class="actions"><button class="btn cyan" id="act-open-res">Open Research</button><button class="btn ghost" data-close>Close</button></div>`;
      },
    };
    const html = panels[id] && panels[id]();
    if (!html) return;
    showSheet(html, { id });
    const r = $("#act-relight"); if (r) r.addEventListener("click", relight);
    const ub = $("#act-up-beacon"); if (ub) ub.addEventListener("click", () => startBuild("beacon"));
    const fb = $("#act-free-beacon"); if (fb) fb.addEventListener("click", () => finishBuild("beacon"));
    const uc = $("#act-up-cc"); if (uc) uc.addEventListener("click", () => startBuild("cc"));
    const fc = $("#act-free-cc"); if (fc) fc.addEventListener("click", () => finishBuild("cc"));
    const ot = $("#act-open-troops"); if (ot) ot.addEventListener("click", () => { closeSheet(); setTab("troops"); });
    const oa = $("#act-open-armory"); if (oa) oa.addEventListener("click", () => { closeSheet(); setTab("armory"); });
    const oi = $("#act-open-inf"); if (oi) oi.addEventListener("click", () => { closeSheet(); openScreen("infirmary"); });
    const ores = $("#act-open-res"); if (ores) ores.addEventListener("click", () => { closeSheet(); openScreen("research"); });
    const cl = $("[data-close]", $("#sheet")); if (cl) cl.addEventListener("click", () => { closeSheet(); syncGuide(); });
    syncGuide();
  }

  function relight() {
    S.beaconLit = true; S.energyRate = true; S.charge = 40; S.orb = true;
    closeSheet(); hud();
    showModal({
      title: "The Beacon burns again",
      sub: "It makes Energy and charges your upgrades.<br><b>Tap the Energy orb</b> over the Beacon to collect your first harvest.",
      extra: '<p class="legend"><span class="inv">INVENTED</span> In the live game, Energy ticks straight into the top bar. This collect orb is new for the \u201cbuild, then collect\u201d beat.</p>',
      loot: { energy: 80 },
      btn: "Continue",
      onBtn: () => setStep("g-collect"),
    });
  }
  function startBuild(id) {
    const cost = id === "beacon" ? (S.beaconLevel === 1 ? 120 : 222) : 50;
    if (S.energy < cost) { toast("Need more Energy"); return; }
    if (id === "beacon" && S.charge < 100) { toast("The Beacon must be fully charged"); return; }
    S.energy -= cost;
    S.building = { id, left: "0:10" };
    if (id === "beacon") S.charge = 0;
    hud();
    openBuilding(id === "cc" ? "commandCenter" : "beacon");
    if (S.step === "g-beacon2-upgrade") setStep("g-beacon2-free");
    else syncGuide();
  }
  function finishBuild(id) {
    S.building = null;
    if (id === "beacon") {
      S.beaconLevel += 1; S.charge = 20;
      grant({ cores: 3 }, { silent: true });
      closeSheet();
      if (S.beaconLevel === 2 && S.phase === "guide") {
        S.unlocks.squads = true; S.unlocks.more = true; S.unlocks.builder = true; S.unlocks.missions = true; S.showCores = true;
        showModal({
          title: "Beacon Lv 2!",
          sub: "New: Squads, Missions, Builder and More. The base is opening up.<br>Each Beacon level also pays 3 Beacon Cores.",
          loot: { cores: 3, su_m5: 3 },
          btn: "Continue",
          onBtn: () => { grant({ su_m5: 3 }, { silent: true }); setStep("g-recruit-tab"); },
        });
      } else {
        if (S.beaconLevel >= 3) { S.archiveUnlocked = true; toast("New: the Archive can be placed"); }
        showModal({
          title: `Beacon Lv ${S.beaconLevel}!`,
          sub: S.beaconLevel === 3 ? "The Archive is unsealed. Place it on the open plot, then research there." : "The Beacon burns brighter.",
          loot: { cores: 3 },
          btn: "Continue",
          onBtn: () => { hud(); checkGoals(); },
        });
      }
    } else if (id === "cc") {
      S.ccLevel = 2; closeSheet(); toast("Command Center Lv 2"); checkGoals();
    }
    hud();
  }

  function openCreature(id) {
    const el = $("#" + id);
    if (!el || el.classList.contains("hidden") || S.killed[id]) return;
    const name = (id.indexOf("hound") >= 0 || id === "w-scuttler4") ? "Hound" : (id.indexOf("drone") >= 0 || id === "w-scuttler5") ? "Drone" : "Scuttler";
    const first = S.hunts === 0;
    showSheet(`
      <h3>${name} \u00b7 Lv 1</h3>
      <div class="desc">Combat Power 20. ${first ? "Squad Alpha out-powers it easily \u2014 this first fight is a guaranteed win." : "A guaranteed win in this mockup."}</div>
      <div class="meta">Stamina cost 10 \u00b7 March a few seconds</div>
      <div class="actions">
        <button class="btn gold" id="act-attack" ${S.stamina < 10 ? "disabled" : ""}>Attack</button>
        <button class="btn ghost" data-close>Close</button>
      </div>`, { id: "creature" });
    const a = $("#act-attack"); if (a) a.addEventListener("click", () => startMarch(id, "hunt", name));
    const cl = $("[data-close]", $("#sheet")); if (cl) cl.addEventListener("click", () => { closeSheet(); syncGuide(); });
    if (S.step === "g-hunt-creature") setStep("g-hunt-attack");
    else syncGuide();
  }
  function openAlloy() {
    if (S.nodeState !== "full") { toast("This node is already being gathered, or is empty."); return; }
    showSheet(`
      <h3>Alloy node</h3>
      <div class="desc">Send Squad Alpha to gather Alloy and march it home. In the live game a node holds more and can be gathered down over several trips.</div>
      <div class="meta">This mockup trip returns 200 Alloy.</div>
      <div class="actions">
        <button class="btn gold" id="act-gather">Gather</button>
        <button class="btn ghost" data-close>Close</button>
      </div>`, { id: "alloy" });
    const g = $("#act-gather"); if (g) g.addEventListener("click", () => startMarch("w-alloy", "gather"));
    const cl = $("[data-close]", $("#sheet")); if (cl) cl.addEventListener("click", () => { closeSheet(); syncGuide(); });
  }
  function startMarch(targetId, kind, name) {
    closeSheet();
    if (kind === "hunt") {
      if (S.stamina < 10) { toast("Not enough Stamina"); return; }
      S.stamina -= 10;
    }
    S.marching = { targetId, kind, name };
    const m = $("#march");
    const home = $("#w-home").getBoundingClientRect();
    const dest = $("#" + targetId).getBoundingClientRect();
    const st = stage.getBoundingClientRect();
    const x0 = (home.left + home.width / 2 - st.left) / scale;
    const y0 = (home.top + home.height / 2 - st.top) / scale;
    const x1 = (dest.left + dest.width / 2 - st.left) / scale;
    const y1 = (dest.top + dest.height / 2 - st.top) / scale;
    m.classList.add("on");
    m.style.left = x0 + "px"; m.style.top = y0 + "px";
    m.style.transition = "none";
    requestAnimationFrame(() => {
      m.style.transition = "left 1.1s ease-in-out, top 1.1s ease-in-out";
      m.style.left = x1 + "px"; m.style.top = y1 + "px";
    });
    hud(); hideCoach();
    setTimeout(() => arriveMarch(), 1200);
  }
  function arriveMarch() {
    const m = S.marching;
    $("#march").classList.remove("on");
    if (!m) return;
    if (m.kind === "hunt") {
      S.killed[m.targetId] = true;
      S.hunts += 1;
      if (S.hunts === 1) S.wounded = 2;
      const loot = { energy: 30, alloy: 4, shards: 10 };
      S.showAlloy = true; S.showShards = true;
      grant(loot, { silent: true });
      const first = S.hunts === 1 && S.phase === "guide";
      showModal({
        title: "Victory!",
        sub: first
          ? `Squad Alpha defeated the Lv 1 ${m.name}. Loot is on its way home.<br><span style="color:#8a96a8">0 dead \u00b7 2 Sentinels wounded (they\u2019ll wait in the Infirmary).</span>`
          : `Squad Alpha defeated the Lv 1 ${m.name}.`,
        loot, btn: "Collect",
        onBtn: () => { S.marching = null; hud(); if (first) setStep("g-beacon2"); else checkGoals(); },
      });
    } else {
      S.nodeState = "camp";
      S.gathered += 200;
      grant({ alloy: 200 }, { silent: true });
      showModal({
        title: "Alloy delivered",
        sub: "Squad Alpha gathered 200 Alloy and marched it home.",
        loot: { alloy: 200 }, btn: "Collect",
        onBtn: () => { S.marching = null; hud(); checkGoals(); },
      });
    }
  }


  function maybeTip(id) {
    let T = null;
    if (id === "world" && S.phase === "goals" && S.goalIndex === 0 && !S.tips.gather)
      T = { title: "A tip from Lyra", body: "Alloy nodes on the World map send resources home. Tap a full node, then Gather.", face: "smile", key: "gather" };
    else if (id === "world" && !S.tips.world && S.phase !== "guide")
      T = { title: "A tip from Lyra", body: "The World map stays closed until your first hunt. Creatures, Alloy nodes and other commanders all live out here. Tap a creature to attack, or a full node to gather.", face: "smile", key: "world" };
    else if (id === "research" && !S.tips.research)
      T = { title: "A tip from Lyra", body: "Beacon Lv 3 opens the Archive. Research there gives permanent bonuses. Start with Beacon Harmonics \u2014 it raises Energy income.", face: "smile", key: "research" };
    else if (id === "infirmary" && !S.tips.infirmary && S.wounded > 0)
      T = { title: "A tip from Lyra", body: "Some of our troops came back wounded. The Infirmary heals them: open it and start a batch. Jobs under 5 minutes finish free.", face: "determined", key: "infirmary" };
    else if (id === "alliance" && !S.tips.alliance)
      T = { title: "A tip from Lyra", body: "Alliances are coming to Broken Dawn. This board is a preview so you can see how that first visit might feel. Looking it over completes the goal.", face: "smile", key: "alliance" };
    else if (id === "missions" && !S.tips.missions)
      T = { title: "A tip from Lyra", body: "Daily Missions fill chests every day. Claim today\u2019s login first \u2014 that\u2019s 1 Beacon Core, 20 Stamina and a 15m Speed-up.", face: "smile", key: "missions" };
    if (!T) return;
    S.tips[T.key] = true;
    S.tip = T.key;
    showCoach({ title: T.title, body: T.body, face: T.face, cont: "Got it", skip: false, dots: null });
    placeCoach(400);
    clearPoint();
    $("#coach-cont").onclick = () => { S.tip = null; hideCoach(); syncGuide(); };
  }

  function goalProgress(g) {
    switch (g.id) {
      case "gather": return { cur: Math.min(200, S.gathered), goal: 200 };
      case "cc2": return { cur: S.ccLevel >= 2 ? 1 : 0, goal: 1 };
      case "troops30": return { cur: Math.min(30, S.sentinels), goal: 30 };
      case "beacon3": return { cur: S.beaconLevel >= 3 ? 1 : 0, goal: 1 };
      case "place-archive": return { cur: S.archivePlaced ? 1 : 0, goal: 1 };
      case "research": return { cur: S.researchDone ? 1 : 0, goal: 1 };
      case "heal": return { cur: S.healed ? 1 : 0, goal: 1 };
      case "alliance": return { cur: S.allianceVisited ? 1 : 0, goal: 1 };
      case "daily": return { cur: S.dailyClaimed ? 1 : 0, goal: 1 };
      case "kills5": return { cur: Math.min(5, S.hunts), goal: 5 };
      default: return { cur: 0, goal: 1 };
    }
  }
  function checkGoals() {
    if (S.phase !== "goals") return;
    const G = GOALS[S.goalIndex];
    if (!G) return;
    const p = goalProgress(G);
    if (p.cur >= p.goal) S.goalReady = true;
    hud(); syncGuide();
  }
  function openGoalsPanel() {
    closeSheet();
    const box = $("#goals");
    const rows = GOALS.map((g, i) => {
      const p = goalProgress(g);
      const cur = i === S.goalIndex;
      const invented = /INVENTED|invented/.test(g.tag);
      let btn = "";
      if (cur && S.goalReady) btn = `<button class="btn gold go" data-claim="${i}">Claim</button>`;
      else if (cur) btn = `<button class="btn cyan go" data-go="${g.id}">Go</button>`;
      return `<div class="goal ${cur ? "cur" : ""} ${i < S.goalIndex ? "done" : ""}">
        <div class="n">${i < S.goalIndex ? "\u2713" : i + 1}</div>
        <div class="body">
          <h4>${g.text}${invented ? '<span class="inv">INVENTED</span>' : ""}</h4>
          <div class="rew">${Object.entries(g.reward).map(([k, n]) => LABEL[k](n)).join(" \u00b7 ")}</div>
          <div class="prog">${p.cur} / ${p.goal}${cur && !S.goalReady ? " \u00b7 " + g.detail : ""}</div>
        </div>${btn}</div>`;
    }).join("");
    box.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center">
        <h2>Chapter Goals</h2>
        <button class="btn ghost close" id="goals-close">Close</button>
      </div>
      <div class="blurb">One goal at a time, each with a reward. New systems only get a one-screen tip the first time you open them.</div>
      ${rows}`;
    box.classList.add("on");
    $("#goals-close").onclick = () => { box.classList.remove("on"); syncGuide(); };
    box.querySelectorAll("[data-go]").forEach((b) => { b.onclick = () => { box.classList.remove("on"); goGoal(b.dataset.go); }; });
    box.querySelectorAll("[data-claim]").forEach((b) => { b.onclick = () => claimGoal(); });
  }
  function claimGoal() {
    const G = GOALS[S.goalIndex];
    if (!G || !S.goalReady) return;
    $("#goals").classList.remove("on");
    showModal({
      chest: true, title: "Goal complete", sub: G.text, loot: G.reward, btn: "Collect",
      onBtn: () => {
        grant(G.reward, { silent: true });
        S.goalIndex += 1; S.goalReady = false;
        if (S.goalIndex >= GOALS.length) openFinalGift();
        else { checkGoals(); toast("Next: " + GOALS[S.goalIndex].text); hud(); }
      },
    });
  }
  function goGoal(id) {
    if (id === "gather" || id === "kills5") { setTab("world"); if (id === "gather") maybeTip("world"); }
    else if (id === "cc2") { setTab("base"); openBuilding("commandCenter"); }
    else if (id === "troops30") setTab("troops");
    else if (id === "beacon3") { setTab("base"); openBuilding("beacon"); }
    else if (id === "place-archive") setTab("base");
    else if (id === "research") { if (!S.archivePlaced) { setTab("base"); toast("Place the Archive first"); } else openScreen("research"); }
    else if (id === "heal") openScreen("infirmary");
    else if (id === "alliance") openScreen("alliance");
    else if (id === "daily") openScreen("missions");
    setTimeout(syncGuide, 50);
  }
  function openGoalsIntro() {
    S.phase = "goals"; S.step = "goals";
    S.unlocks.world = true; S.unlocks.troops = true; S.unlocks.armory = true;
    S.unlocks.squads = true; S.unlocks.more = true; S.unlocks.builder = true;
    S.unlocks.missions = true; S.unlocks.healing = true; S.unlocks.alliance = true;
    S.charge = 100;
    closeScreens(); S.tab = "base"; hud();
    showModal({
      title: "You\u2019re in command",
      sub: "The guided opening is done. These chapter goals will keep teaching you \u2014 gather, research, heal, daily missions, and more. Each one has a reward. New systems only get a one-screen tip the first time you open them.",
      btn: "See the goals",
      onBtn: () => openGoalsPanel(),
    });
    hash("goals");
  }
  function openFinalGift() {
    S.phase = "done"; S.step = "gift";
    showModal({
      chest: true,
      title: "The base is yours, Commander",
      sub: "You\u2019re on your own now. Here is a departure gift \u2014 then the Beacon, the World and the goals are yours to run.",
      loot: FINAL_GIFT,
      extra: '<p class="legend">This mockup pauses here. In the live game, the existing chapter-goal chain would continue (Barracks Lv 4, a Lv 3 hunt, recruiting, rallies, and so on).</p>',
      btn: "Collect",
      onBtn: () => {
        grant(FINAL_GIFT, { silent: true });
        S.giftClaimed = true;
        toast("Walkthrough complete. You can jump or restart from the MOCKUP badge.");
        hud();
      },
    });
    hash("gift");
  }

  const MAJOR = { "g-beacon": 0, "g-relight": 0, "g-collect": 0, "g-train-tab": 1, "g-train-x10": 1, "g-train-free": 1, "g-world-tab": 2, "g-hunt-creature": 2, "g-hunt-attack": 2, "g-beacon2": 3, "g-beacon2-upgrade": 3, "g-beacon2-free": 3, "g-recruit-tab": 4, "g-recruit-pull": 4 };

  function setStep(step) {
    S.step = step;
    const h = (step === "g-collect") ? "g-collect" : (step === "g-hunt-attack" || step === "g-hunt-creature") ? "g-hunt-creature" : step;
    hash(h);
    syncGuide();
  }

  function syncGuide() {
    if (S.view !== "game") return;
    if (S.modal) { hideCoach(); return; }
    if (S.tip) return;
    if (S.phase !== "guide") {
      hideCoach();
      if (S.phase === "goals" && !S.screen && !$("#goals").classList.contains("on") && !S.panel) {
        const G = GOALS[S.goalIndex];
        if (G && !S.goalReady && G.id === "place-archive" && S.archiveUnlocked && !S.archivePlaced && S.tab === "base") {
          showCoach({ title: "Place the Archive", body: "Tap the glowing plot to place it.", face: "smile", skip: false });
          pointAt($("#place-plot"), { allow: "#place-plot" });
          return;
        }
        if (G && S.goalReady && S.tab === "base") {
          showCoach({ title: "Claim your reward", body: "Open the goal list and collect.", face: "excited", skip: false });
          pointAt($("#goal-chip"), { allow: "#goal-chip" });
          return;
        }
      }
      return;
    }
    const dots = { done: MAJOR[S.step] != null ? MAJOR[S.step] : 0 };
    const goBase = () => {
      if (S.tab !== "base" || S.screen) {
        showCoach({ title: "Back to Base", body: "Tap BASE to continue.", face: "neutral", skip: true, dots });
        pointAt($("#tab-base"), { allow: "#tab-base" });
        return true;
      }
      return false;
    };
    switch (S.step) {
      case "g-beacon":
        if (goBase()) return;
        showCoach({ title: "Relight the Beacon", body: "Commander, the Beacon is our last light. Tap it to wake it up.", face: "neutral", skip: true, dots });
        pointAt($("#b-beacon"), { r: 64, allow: "#b-beacon" });
        break;
      case "g-relight":
        showCoach({ title: "Relight the Beacon", body: "Tap Relight and bring it back to life.", face: "determined", skip: true, dots });
        pointAt($("#act-relight"), { allow: "#act-relight, #sheet" });
        break;
      case "g-collect":
        if (goBase()) return;
        showCoach({ title: "Collect Energy", body: "Tap the Energy orb over the Beacon to collect your first harvest.", face: "smile", skip: true, dots });
        pointAt($("#energy-orb"), { r: 40, allow: "#energy-orb" });
        break;
      case "g-train-tab":
        S.unlocks.troops = true; hud();
        if (S.screen !== "troops") {
          showCoach({ title: "Train Sentinels", body: "Open Troops and train 10 Sentinels (x10).", face: "neutral", skip: true, dots });
          pointAt($("#tab-troops"), { allow: "#tab-troops" });
        } else setStep("g-train-x10");
        break;
      case "g-train-x10":
        showCoach({ title: "Train Sentinels", body: "Tap Train x10. We\u2019ll use a free finish on the queue.", face: "neutral", skip: true, dots });
        pointAt($("#btn-x10"), { allow: "#btn-x10, #scr-troops" });
        break;
      case "g-train-free":
        showCoach({ title: "Finish it free", body: "Jobs under 5 minutes finish free. Tap Free!", face: "smile", skip: true, dots });
        pointAt($("#btn-free-train"), { allow: "#btn-free-train, #scr-troops" });
        break;
      case "g-world-tab":
        S.unlocks.world = true; hud();
        if (S.tab !== "world" || S.screen) {
          showCoach({ title: "First hunt", body: "A Scuttler is right outside. Open World, tap it, then Attack.", face: "determined", skip: true, dots });
          pointAt($("#tab-world"), { allow: "#tab-world" });
        } else setStep("g-hunt-creature");
        break;
      case "g-hunt-creature":
        showCoach({ title: "First hunt", body: "The World is open. Tap the Lv 1 Scuttler.", face: "determined", skip: true, dots });
        pointAt($("#w-scuttler"), { r: 48, allow: "#w-scuttler" });
        break;
      case "g-hunt-attack":
        showCoach({ title: "First hunt", body: "Tap Attack. Squad Alpha will march out \u2014 this fight is a guaranteed win.", face: "determined", skip: true, dots });
        pointAt($("#act-attack"), { allow: "#act-attack, #sheet" });
        break;
      case "g-beacon2":
        if (goBase()) return;
        S.charge = 100; hud();
        if (S.panel !== "beacon") {
          showCoach({ title: "Beacon Lv 2", body: "The Beacon is fully charged. Tap it, then Upgrade. This is the moment the base opens up.", face: "excited", skip: true, dots });
          pointAt($("#b-beacon"), { r: 64, allow: "#b-beacon" });
        } else setStep("g-beacon2-upgrade");
        break;
      case "g-beacon2-upgrade":
        showCoach({ title: "Beacon Lv 2", body: "Tap Upgrade. You\u2019ll finish the timer free, just like the Barracks queue.", face: "excited", skip: true, dots });
        pointAt($("#act-up-beacon"), { allow: "#act-up-beacon, #sheet" });
        break;
      case "g-beacon2-free":
        showCoach({ title: "Finish it free", body: "Tap Free to raise the Beacon to Lv 2.", face: "smile", skip: true, dots });
        pointAt($("#act-free-beacon"), { allow: "#act-free-beacon, #sheet" });
        break;
      case "g-recruit-tab":
        S.unlocks.armory = true; S.showCores = true; hud();
        if (S.screen !== "armory") {
          showCoach({ title: "Recruit a leader", body: "Beacon Cores call leaders to our side. Open the Armory and Pull x1 \u2014 it is on me.", face: "excited", skip: true, dots });
          pointAt($("#tab-armory"), { allow: "#tab-armory" });
        } else setStep("g-recruit-pull");
        break;
      case "g-recruit-pull":
        showCoach({ title: "Recruit a leader", body: "Tap Pull x1. Your first recruit is guaranteed: Kael, the Lightbringer.", face: "excited", skip: true, dots });
        pointAt($("#btn-pull"), { allow: "#btn-pull, #scr-armory" });
        break;
      default:
        hideCoach();
    }
  }


  function hash(h) {
    if (location.hash.slice(1) !== h) history.replaceState(null, "", "#" + h);
  }
  function confirmSkip() {
    $("#confirm-title").textContent = "Skip the guided opening?";
    $("#confirm-body").textContent = "You\u2019ll jump to the goal chain with The Beacon at Lv 2, Squad Alpha already formed, and Kael in command. You still get the opening rewards. You can restart from the MOCKUP badge.";
    $("#confirm").classList.add("on");
    $("#confirm-yes").onclick = () => { $("#confirm").classList.remove("on"); skipGuide(); };
    $("#confirm-no").onclick = () => $("#confirm").classList.remove("on");
  }
  function skipGuide() {
    S.beaconLit = true; S.energyRate = true; S.orb = false;
    S.beaconLevel = 2; S.charge = 100; S.energy = 400;
    S.sentinels = 10; S.wounded = 2;
    S.showAlloy = true; S.showShards = true; S.showCores = true; S.showStamina = true;
    S.alloy = 4; S.shards = 10; S.cores = 3;
    S.kael = true; S.kaelAssigned = true;
    S.hunts = 1; S.killed["w-scuttler"] = true;
    S.unlocks = { world: true, troops: true, armory: true, squads: true, more: true, builder: true, research: false, training: true, healing: true, missions: true, alliance: true };
    grant({ energy: 500, cores: 2 }, { silent: true });
    closeSheet(); closeModal(); closeScreens();
    S.tab = "base"; S.view = "game";
    view("game");
    openGoalsIntro();
  }
  function seedGuide() {
    S = defaultState();
    S.view = "game"; S.phase = "guide"; S.tab = "base";
    view("game"); closeScreens(); closeSheet(); closeModal(); hideCoach();
  }
  function jumpTo(id) {
    $("#jump").classList.remove("on");
    if (id === "restart" || id === "title") { restart(); return; }
    if (id === "story") { beginStory(0); return; }
    if (id === "g-beacon") { seedGuide(); hud(); setStep("g-beacon"); return; }
    if (id === "g-collect") {
      seedGuide(); S.beaconLit = true; S.energyRate = true; S.orb = true; S.charge = 40;
      hud(); setStep("g-collect"); return;
    }
    if (id === "g-train-tab") {
      seedGuide(); S.beaconLit = true; S.energyRate = true; S.charge = 40; S.energy = 140; S.unlocks.troops = true;
      hud(); setStep("g-train-tab"); return;
    }
    if (id === "g-hunt-creature") {
      seedGuide();
      S.beaconLit = true; S.energyRate = true; S.sentinels = 10; S.energy = 80;
      S.unlocks.troops = true; S.unlocks.world = true; S.unlocks.training = true;
      S.tab = "world"; hud(); setStep("g-hunt-creature"); return;
    }
    if (id === "hunt-reward") {
      seedGuide();
      S.beaconLit = true; S.sentinels = 10; S.wounded = 2; S.hunts = 1;
      S.showAlloy = true; S.showShards = true; S.alloy = 4; S.shards = 10; S.energy = 110;
      S.unlocks.world = true; S.unlocks.troops = true; S.tab = "world";
      S.killed["w-scuttler"] = true;
      hud();
      showModal({
        title: "Victory!",
        sub: "Squad Alpha defeated the Lv 1 Scuttler. Loot is on its way home.<br><span style=\"color:#8a96a8\">0 dead \u00b7 2 Sentinels wounded (they\u2019ll wait in the Infirmary).</span>",
        loot: { energy: 30, alloy: 4, shards: 10 },
        btn: "Collect",
        onBtn: () => setStep("g-beacon2"),
      });
      hash("hunt-reward");
      return;
    }
    if (id === "g-beacon2") {
      seedGuide();
      S.beaconLit = true; S.energyRate = true; S.sentinels = 10; S.wounded = 2;
      S.energy = 300; S.charge = 100; S.showAlloy = true; S.showShards = true;
      S.unlocks.world = true; S.unlocks.troops = true; S.hunts = 1;
      hud(); setStep("g-beacon2"); return;
    }
    if (id === "g-recruit-tab") {
      seedGuide();
      S.beaconLit = true; S.energyRate = true; S.beaconLevel = 2; S.sentinels = 10; S.wounded = 2;
      S.energy = 200; S.cores = 3; S.showCores = true; S.showAlloy = true; S.showShards = true;
      S.unlocks = { world: true, troops: true, armory: true, squads: true, more: true, builder: true, research: false, training: true, healing: true, missions: true, alliance: false };
      hud(); setStep("g-recruit-tab"); return;
    }
    if (id === "goals") {
      skipGuide();
      closeModal();
      openGoalsPanel();
      hash("goals");
      return;
    }
    if (id === "gift") { skipGuide(); S.goalIndex = GOALS.length; S.goalReady = false; closeModal(); openFinalGift(); }
  }
  function restart() {
    S = defaultState();
    closeSheet(); closeModal(); closeScreens(); hideCoach();
    $("#goals").classList.remove("on");
    $("#jump").classList.remove("on");
    $("#confirm").classList.remove("on");
    view("title"); hash("title"); hud();
  }
  function beginStory(p) {
    S.view = "story"; S.story = p;
    view("story"); renderStory();
    hash(p === 0 ? "story" : "story-" + (p + 1));
  }
  function renderStory() {
    const P = STORY[S.story];
    $("#story-art").src = P.art;
    $("#story-line").textContent = P.line;
    $(".kicker", $("#story")).textContent = P.kicker;
    $("#story-dots").innerHTML = STORY.map((_, i) => `<i class="${i < S.story ? "done" : i === S.story ? "on" : ""}"></i>`).join("");
  }
  function startGuide() {
    S = defaultState();
    S.view = "game"; S.phase = "guide"; S.step = "g-beacon"; S.tab = "base";
    view("game"); hud(); setStep("g-beacon");
  }

  $("#btn-begin").onclick = () => beginStory(0);
  $("#story-cont").onclick = () => { if (S.story < STORY.length - 1) beginStory(S.story + 1); else startGuide(); };
  $("#story-skip").onclick = startGuide;
  $("#badge").onclick = (e) => { e.stopPropagation(); $("#jump").classList.toggle("on"); };
  $$("#jump [data-jump]").forEach((b) => { b.onclick = (e) => { e.stopPropagation(); jumpTo(b.dataset.jump); }; });
  $("#coach-skip").onclick = (e) => { e.stopPropagation(); confirmSkip(); };
  $("#coach-cont").addEventListener("click", (e) => {
    e.stopPropagation();
    if (S.tip) { S.tip = null; hideCoach(); syncGuide(); }
  });

  $("#tab-world").addEventListener("click", () => {
    if (S.phase === "guide" && !allowedClick($("#tab-world"))) return;
    setTab("world");
    if (S.step === "g-world-tab") setStep("g-hunt-creature");
  });
  $("#tab-troops").addEventListener("click", () => {
    if (S.phase === "guide" && !allowedClick($("#tab-troops"))) return;
    setTab("troops");
    if (S.step === "g-train-tab") setStep("g-train-x10");
  });
  $("#tab-base").addEventListener("click", () => setTab("base"));
  $("#tab-armory").addEventListener("click", () => {
    if (S.phase === "guide" && !allowedClick($("#tab-armory"))) return;
    setTab("armory");
    if (S.step === "g-recruit-tab") setStep("g-recruit-pull");
  });
  $("#tab-squads").addEventListener("click", () => setTab("squads"));
  $("#tab-more").addEventListener("click", () => setTab("more"));

  $("#q-missions").addEventListener("click", () => openScreen("missions"));
  $("#q-alliance").addEventListener("click", () => openScreen("alliance"));
  $("#q-research").addEventListener("click", () => {
    if (!S.archivePlaced) { toast(S.archiveUnlocked ? "Place the Archive first" : "The Archive unseals at Beacon Lv 3"); return; }
    openScreen("research");
  });
  $("#q-healing").addEventListener("click", () => openScreen("infirmary"));
  $("#q-training").addEventListener("click", () => setTab("troops"));
  $("#q-builder").addEventListener("click", () => toast(S.building ? S.building.left + " left \u00b7 tap the building to finish free" : "Builder idle"));
  $("#goal-chip").addEventListener("click", openGoalsPanel);

  $$(".bldg[data-id]").forEach((el) => {
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      if (S.phase === "guide" && !allowedClick(el)) return;
      openBuilding(el.dataset.id);
      if (S.step === "g-beacon" && el.dataset.id === "beacon") setStep("g-relight");
      if (S.step === "g-beacon2" && el.dataset.id === "beacon") setStep("g-beacon2-upgrade");
    });
  });

  $("#energy-orb").addEventListener("click", (e) => {
    e.stopPropagation();
    if (!S.orb) return;
    S.orb = false;
    grant({ energy: 80 });
    hud();
    if (S.step === "g-collect") {
      showModal({
        title: "Energy collected",
        sub: "The Beacon will keep making Energy on its own. Next we\u2019ll train a first squad of Sentinels.",
        loot: { energy: 80 },
        extra: '<p class="legend"><span class="inv">INVENTED</span> This collect tap is new for the mockup.</p>',
        btn: "Continue",
        onBtn: () => setStep("g-train-tab"),
      });
    }
  });

  $("#place-plot").addEventListener("click", (e) => {
    e.stopPropagation();
    S.archivePlaced = true; S.unlocks.research = true;
    toast("Archive placed"); hud();
    showModal({
      title: "Archive placed",
      sub: "Research in the Archive gives permanent bonuses. Start with Beacon Harmonics when you\u2019re ready.",
      btn: "Continue",
      onBtn: () => checkGoals(),
    });
  });

  ["w-scuttler", "w-scuttler2", "w-scuttler3", "w-scuttler4", "w-scuttler5"].forEach((id) => {
    $("#" + id).addEventListener("click", (e) => {
      e.stopPropagation();
      if (S.phase === "guide" && !allowedClick($("#" + id))) return;
      openCreature(id);
    });
  });
  $("#w-alloy").addEventListener("click", (e) => { e.stopPropagation(); openAlloy(); });
  $("#shade").addEventListener("click", () => { if (S.phase === "guide") return; closeSheet(); syncGuide(); });

  setInterval(() => {
    if (!S.energyRate) return;
    S.energy += 1;
    if (S.beaconLit && S.charge < 100 && !(S.building && S.building.id === "beacon")) {
      S.charge = Math.min(100, S.charge + (S.beaconLevel === 1 ? 2 : 1.2));
    }
    hud();
  }, 1000);

  function bootFromHash() {
    const h = location.hash.slice(1);
    if (!h || h === "title") { view("title"); return; }
    if (h === "story" || h === "story-1") { beginStory(0); return; }
    if (h === "story-2") { beginStory(1); return; }
    if (h === "story-3") { beginStory(2); return; }
    jumpTo(h);
  }
  bootFromHash();
  function currentHash() {
    if (S.view === "title") return "title";
    if (S.view === "story") return S.story === 0 ? "story" : "story-" + (S.story + 1);
    return S.step || "title";
  }
  window.addEventListener("hashchange", () => {
    const h = location.hash.slice(1);
    if (h && h !== currentHash()) jumpTo(h);
  });

  hud();
})();
