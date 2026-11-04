// Gym clothes in Everyday outfits, checked on a real wardrobe backup. Run with:
//   node tools/audit-sim.mjs <backup.json> --runs 0 --eval tools/gym-everyday.eval.js
// (or WARDROBE_BACKUP=<backup.json> node --test tools/gym-everyday.test.mjs). Returns PASS/FAIL lines.
const N = 30, out = [];
const check = (label, ok, shown) => out.push(`${ok ? "PASS" : "FAIL"}  ${label}: ${shown}`);
const sim = [["gym-top", "Sim gym top", "base", ["white"]], ["track-pants", "Sim track pants", "bottom", ["black"]], ["gym-hoodie", "Sim training hoodie", "mid", ["grey"]], ["training-shoes", "Sim training shoes", "shoes", ["black"]]]
  .map(([category, name, , colors]) => ({ id: `sim-${category}`, name, category, colors, brand: "Nike", styles: ["sporty"], warmth: category === "gym-hoodie" ? 3 : 2, tags: [], wearCount: 0, lastWorn: null, createdAt: new Date().toISOString() }));
st.items.push(...sim);
st.items.forEach((i) => { i.wash = null; delete i.everyday; });
const gymIn = (o) => Object.values(o.pieces).filter((p) => p && T.slotOf(p) === "gym");
const sets = (occ, temp = 15) => {
  const all = [];
  st.occasion = occ; st.manualTemp = temp; st.level = null; st.anchor = null;
  for (let i = 0; i < N; i++) { st.outfits = []; T.generateOutfits(3); all.push(...st.outfits); }
  return all;
};
// 1. Nothing switched on, everyday clothes clean: no gym piece in Everyday
let ideas = sets("casual");
check("Everyday, no gym piece switched on, nothing in the wash: ideas with a gym piece", ideas.filter((o) => gymIn(o).length).length === 0, `${ideas.filter((o) => gymIn(o).length).length} of ${ideas.length}`);
// 2. "Everyday too" on the 4 pieces: wearing the top idea every day for 30 days (as you would), each
// comes up in the ideas like any other piece (rotation gives every piece its turn)
sim.forEach((p) => { p.everyday = true; });
// …scored like the same piece as an everyday one (its twin: same colour, brand and style, an everyday type)
const twins = sim.map((p) => ({ ...p, id: `twin-${p.id}`, category: T.EVERYDAY_AS[p.category], everyday: undefined }));
st.items.push(...twins); st.occasion = "casual"; st.manualTemp = 15; st.anchor = null; st.level = null;
const gaps = [];
for (let k = 0; k < 5; k++) {
  const pool = T.ideaPool({});
  const best = (p) => Math.max(...pool.cands.filter((x) => Object.values(x.pieces).includes(p)).map((x) => x.score));
  sim.forEach((p, n) => { gaps[n] = (gaps[n] || 0) + (best(p) - best(twins[n])) / 5; });
}
st.items.splice(st.items.length - twins.length, twins.length);
check("Everyday, switched on: each piece's best idea scores like its everyday twin's (within 0.6)", gaps.every((g) => Math.abs(g) <= 0.6), sim.map((p, n) => `${p.name} ${gaps[n] >= 0 ? "+" : ""}${gaps[n].toFixed(2)}`).join(", "));
ideas = [];
for (let d = 0; d < N; d++) {
  window.__advance(1);
  for (const i of st.items) if (i.wash && (Date.now() - new Date(i.wash)) / 864e5 >= 2) { i.wash = null; i.wornSinceWash = 0; }
  st.occasion = "casual"; st.manualTemp = 15; st.level = null; st.anchor = null; st.outfits = [];
  T.generateOutfits(3);
  ideas.push(...st.outfits);
  const pick = st.outfits[0];
  await T.wearOutfit([...Object.values(pick.pieces).filter(Boolean), ...(pick.extras || [])], { occasion: "casual", feels: 15, source: "idea" });
}
st.items.forEach((i) => { i.wash = null; });
const seen = sim.map((p) => [p.name, ideas.filter((o) => Object.values(o.pieces).includes(p)).length]);
// (a new, unworn piece among many of its kind comes up like any other new piece: most of them, not always all)
check("Everyday, the 4 pieces switched on, 30 days of wearing the top idea: pieces that came up", seen.filter(([, n]) => n >= 1).length >= 3, seen.map(([n, k]) => `${n} ${k}`).join(", ") + ` (of ${ideas.length})`);
check("Everyday ideas with a switched-on piece get no gym-only warning", !ideas.some((o) => (o.warn || []).some((w) => /gym/i.test(w))), ideas.filter((o) => (o.warn || []).some((w) => /gym/i.test(w))).length + " warned");
// 3. Never at work, smart casual, night out or Elegant
for (const occ of ["work", "smart", "night", "event"]) {
  const s = sets(occ);
  check(`${occ}: ideas with a gym piece (switched on)`, !s.some((o) => gymIn(o).length), `${s.filter((o) => gymIn(o).length).length} of ${s.length}`);
}
// 4. Every everyday top in the wash, nothing switched on: a gym top stands in, with the line
sim.forEach((p) => { delete p.everyday; });
const tops = st.items.filter((i) => T.roleOf(i) === "base" && T.slotOf(i) !== "gym");
tops.forEach((i) => { i.wash = new Date().toISOString(); });
ideas = sets("casual");
const standing = ideas.filter((o) => gymIn(o).some((p) => T.roleOf(p) === "base"));
const line = standing.length ? T.standInLine(standing[0], "casual") : "";
check("Everyday with all T-shirts and tops in the wash: a gym top stands in", standing.length >= 1, `${standing.length} of ${ideas.length} ideas`);
check("…with the line under the idea", /standing in: your T-shirts and tops are in the wash/.test(line), line.replace(/<[^>]+>/g, "") || "none");
check("…and no gym piece for the parts that still have clothes free", !ideas.some((o) => gymIn(o).some((p) => T.roleOf(p) !== "base")), `${ideas.filter((o) => gymIn(o).some((p) => T.roleOf(p) !== "base")).length} ideas`);
tops.forEach((i) => { i.wash = null; });
// 5. Picking a gym piece yourself on Everyday keeps Everyday
st.occasion = "casual"; st.manualTemp = 15; st.outfits = [];
await T.setAnchor(sim[1].id);
check("Building outfits around a gym piece on Everyday: the occasion", st.occasion === "casual" && st.outfits.length > 0 && st.outfits.every((o) => o.pieces.bottom === sim[1]), `${st.occasion}, ${st.outfits.filter((o) => o.pieces.bottom === sim[1]).length} of ${st.outfits.length} ideas with it`);
st.anchor = null;
// 6. The Gym occasion as before: gym pieces
ideas = sets("gym");
check("Gym: ideas made of gym pieces", ideas.length > 0 && ideas.every((o) => gymIn(o).length >= 1), `${ideas.filter((o) => gymIn(o).length).length} of ${ideas.length}`);
return out;
