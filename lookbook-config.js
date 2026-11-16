// Shared contracts for the mirror's Lookbook look (lookbook-stage.js): its slots, which wardrobe
// pieces go in each, where each slot sits, and how it moves. The Lookbook is an "invisible
// mannequin": only the clothes and accessories, floating in layers with depth and soft shadows.
// It replaced the grey Mannequin look in November 2026; the Avatar look (avatar-stage.js) is the
// other one. Nothing here calls a server or an AI.
// The per-piece nudge (cutoutMeta: scale, offsetY, offsetX, z) is shared with the avatar and kept
// in avatar-config.js (cleanCutMeta), so a piece sits the same wherever it's shown.
export { cleanCutMeta, isPlainCut, CUT_SCALE, CUT_OFFSET, CUT_Z } from "./avatar-config.js";

/**
 * The slots of the stage. `where`: the centre column (the silhouette, top to bottom) or a docked
 * card on its left or right. `roles`: the outfit roles of app.js that fill it (a coat takes the
 * jacket slot, over a jacket); `cats`: the wardrobe categories that fill an accessory slot (the same
 * groups as the wardrobe's Accessories filter).
 * @typedef {'hat'|'top'|'tie'|'layer'|'jacket'|'belt'|'bottoms'|'shoes'|'jewelry'|'watch'|'bag'|'eyewear'} StageSlot
 */
export const STAGE_SLOTS = [
  { id: "hat", label: "Hat", where: "column", cats: ["cap", "beanie", "beret", "bucket-hat", "hat"] },
  { id: "top", label: "Top", where: "column", roles: ["base"] },
  { id: "tie", label: "Tie", where: "column", cats: ["tie"] },
  { id: "layer", label: "Layer", where: "column", roles: ["mid"] },
  { id: "jacket", label: "Jacket", where: "column", roles: ["outer", "coat"] },
  { id: "belt", label: "Belt", where: "column", cats: ["belt"] },
  { id: "bottoms", label: "Bottoms", where: "column", roles: ["bottom"] },
  { id: "shoes", label: "Shoes", where: "column", roles: ["shoes"] },
  { id: "jewelry", label: "Jewelry", where: "left", cats: ["necklace", "bracelet", "ring", "earrings"] },
  { id: "watch", label: "Watch", where: "left", cats: ["watch"] },
  { id: "eyewear", label: "Eyewear", where: "right", cats: ["sunglasses", "glasses", "scarf"] },
  { id: "bag", label: "Bag", where: "right", cats: ["bag", "backpack", "gym-bag"] },
];
export const SLOT = Object.fromEntries(STAGE_SLOTS.map((s) => [s.id, s]));
export const SLOT_IDS = STAGE_SLOTS.map((s) => s.id);
// The outfit roles of app.js (wornList) to slots. A coat, when worn, takes the jacket slot.
export const ROLE_TO_SLOT = { base: "top", mid: "layer", outer: "jacket", coat: "jacket", bottom: "bottoms", shoes: "shoes" };
const CAT_TO_SLOT = Object.fromEntries(STAGE_SLOTS.flatMap((s) => (s.cats || []).map((c) => [c, s.id])));
/** The accessory slot a wardrobe category goes in, or null (an umbrella, gloves, a wallet: not on the stage). */
export const accSlotOf = (category) => CAT_TO_SLOT[category] || null;
/** The categories of an accessory slot (empty for the clothing slots, which go by role). */
export const slotCats = (slot) => SLOT[slot]?.cats || [];
export const ACC_SLOTS = STAGE_SLOTS.filter((s) => s.cats).map((s) => s.id);

/* Where each column slot sits, in fractions of the column's height (hat crown to shoe soles,
   about COLUMN_CM of a person): `top` and `h` the slot's box, `w` its width, `anchor` which edge of
   the garment meets the box (a top hangs from its shoulders, shoes stand on the floor, a hat sits on
   the head line), `z` the drawing order back to front (also its depth on the stage).
   Shorts get a shorter box (SHORT_H). Inner layers sit a little lower and narrower, so a collar or
   a hem shows past the layer over it and the stack reads as worn. */
export const COLUMN_CM = 172;
export const STAGE_LAYOUT = {
  hat: { top: 0.0, h: 0.105, w: 0.21, anchor: "bottom", z: 70 },
  top: { top: 0.118, h: 0.37, w: 0.46, anchor: "top", z: 12 },
  tie: { top: 0.13, h: 0.25, w: 0.075, anchor: "top", z: 22 },
  layer: { top: 0.112, h: 0.375, w: 0.49, anchor: "top", z: 34 },
  jacket: { top: 0.104, h: 0.385, w: 0.53, anchor: "top", z: 48 },
  belt: { top: 0.448, h: 0.05, w: 0.3, anchor: "center", z: 28 },
  bottoms: { top: 0.452, h: 0.445, w: 0.34, anchor: "top", z: 6 },
  shoes: { top: 0.9, h: 0.1, w: 0.32, anchor: "bottom", z: 9 },
};
export const SHORT_H = 0.25;
// The docked cards: their size as a fraction of the column's height (capped in px by the stage),
// and the order down each side.
export const CARD = { size: 0.17, max: 156, z: 80 };
export const SIDE_ORDER = { left: ["jewelry", "watch"], right: ["eyewear", "bag"] };
// How the stage moves: the most it tilts (degrees), zoom range, depth in px per step of `z`.
export const STAGE_MOTION = { tilt: 12, zoom: [1, 2.4], depthPerZ: 0.6, perspective: 1400 };
/** Shorts (and gym shorts, a skirt) stop above the knee: a shorter box. */
export const isShort = (item) => ["shorts", "gym-shorts", "skirt"].includes(item?.category);
