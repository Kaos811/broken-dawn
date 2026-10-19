// builds a mid-progress save in the page, saves it (caller reloads)
window.__midSave = () => {
  const st = __BD.store, s = st.state;
  st.skipTutorial();
  s.beacon.level = 4; s.beacon.charge = 64;
  Object.entries({ commandCenter: 4, barracks: 5, armory: 3, infirmary: 3, archive: 3 }).forEach(([id, lv]) => { s.buildings[id].level = lv; });
  const sp = st.suggestSpot('archive'); if (sp) { s.buildings.archive.gx = sp.gx; s.buildings.archive.gy = sp.gy; s.buildings.archive.placed = true; }
  Object.assign(s.resources, { energy: 48200, alloy: 3240, shards: 1860, cores: 24 });
  Object.assign(s.troops, { sentinel: 60, bearer: 50, voyager: 45, bulwark: 20, lancer: 12 });
  s.research.levels = { tier2: 1, energyYield: 3, trainSpeed: 2, beds: 2, staminaCells: 1, sentinelDrills: 2 };
  s.research.job = { id: 'buildSpeed', toLevel: 2, cost: { energy: 900, alloy: 120, shards: 60 }, total: 600, progress: 220 };
  s.construction = [{ id: 'armory', toLevel: 4, cost: 2400, total: 360, progress: 110 }];
  s.leaders = { kael: { stars: 2 }, lyra: { stars: 1 }, jax: { stars: 3 }, seren: { stars: 1 }, vex: { stars: 1 }, orin: { stars: 1 } };
  s.gear = { pulseCarbine: 1, fieldWeave: 2, arcRifle: 1, scrapPlating: 1 }; s.gearLevels = { pulseCarbine: 2 };
  st.saveFormation('alpha', [{ type: 'sentinel', count: 20 }, { type: 'bearer', count: 15 }, { type: 'voyager', count: 15 }]);
  st.saveFormation('bravo', [{ type: 'bulwark', count: 10 }, { type: 'lancer', count: 8 }, { type: 'voyager', count: 10 }]);
  st.assignLeader('kael', 'alpha', { silent: true }); st.assignLeader('jax', 'bravo', { silent: true });
  for (const [sq, sl, g] of [['alpha', 'weapon', 'pulseCarbine'], ['alpha', 'armor', 'fieldWeave'], ['bravo', 'weapon', 'arcRifle'], ['bravo', 'armor', 'scrapPlating']]) try { st.equipGear(sq, sl, g); } catch (e) {}
  st.train('sentinel', 10); st.promote?.('bearer', 5);
  s.infirmary.wounded.sentinel.alpha = 6; s.infirmary.wounded.voyager.reserve = 7; st.heal('voyager', 4);
  s.missions.progress = { daily: 1, kills: 5, train: 30, build: 1 }; s.missions.claimed = ['daily', 'train']; s.missions.chests = [20];
  st.save();
};
// early game: fresh base, tutorial skipped
window.__earlySave = () => { const st = __BD.store; st.skipTutorial(); st.state.resources.cores = Math.max(10, st.state.resources.cores); st.save(); };
// late game: long numbers, everything owned, many items
window.__lateSave = () => {
  window.__midSave();
  const st = __BD.store, s = st.state;
  s.beacon.level = 9;
  for (const id of Object.keys(s.buildings)) s.buildings[id].level = Math.max(s.buildings[id].level, 9);
  Object.assign(s.resources, { energy: 1234567, alloy: 987654, shards: 456789, cores: 1234 });
  for (const t of Object.keys(s.troops)) s.troops[t] = 12345 + t.length * 1111;
  for (const id of ['kael', 'lyra', 'jax', 'seren', 'vex', 'orin', 'nova', 'rook', 'dax', 'mira', 'thane']) s.leaders[id] = { stars: 5 };
  for (const g of ['scrapPlating', 'pulseCarbine', 'fieldWeave', 'aegisMesh', 'arcRifle', 'wardenShell', 'lumenLance', 'dawnforgedAegis', 'beaconEdge']) { s.gear[g] = 9; s.gearLevels[g] = 9; }
  for (const t of Object.keys(s.infirmary.wounded)) s.infirmary.wounded[t].reserve = 1234;
  for (const k of Object.keys(s.research.levels)) s.research.levels[k] = Math.max(s.research.levels[k], 3);
  st.save();
};
