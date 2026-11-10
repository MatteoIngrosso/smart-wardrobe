// Shared contracts for the 3D mirror on Today: the body settings, the garment slots and the baked
// garment textures. app.js, garment-baker.js and avatar-stage.js all use these, so keep them in step.
// Nothing here calls a server or an AI: the mirror runs entirely on the device.

/**
 * The body on the left panel ("You"), saved in the synced `avatar` record.
 * @typedef {Object} AvatarBodyConfig
 * @property {number} heightCm   160-200
 * @property {number} weightKg   50-120
 * @property {'slim'|'regular'|'athletic'|'broad'} build
 * @property {string} skinTone   hex, e.g. "#c88f6b"
 * @property {string} hairStyle  an id of HAIR_STYLES
 * @property {string} hairColor  hex
 * @property {string} beard      an id of BEARDS
 * @property {string} eyeColor   hex
 * @property {string} glasses    "none" | "glasses"
 * @property {string} [facePhotoDataUrl] a square JPEG of your face, framed as FACE_FRAME says
 */

/** @typedef {'top'|'layer'|'jacket'|'bottoms'|'shoes'} GarmentLayerSlot */

/**
 * One wardrobe piece turned into textures once (garment-baker.js), kept in IndexedDB.
 * The required fields are the shared contract; the optional ones are hints the stage may use.
 * @typedef {Object} BakedGarmentAsset
 * @property {string} garmentId     the wardrobe item's id
 * @property {GarmentLayerSlot} slot
 * @property {'tee'|'hoodie'|'sweater'|'bomber'|'jacket_open'|'jeans'|'cargo'|'sneakers'|'boots'} garmentSubType
 * @property {Blob} frontChestUV    the front panel, framed as PANEL_FRAME says (opaque, no cut-out edges)
 * @property {Blob} backPanelUV     the back panel, same framing, as seen from behind
 * @property {string} fabricBaseColor hex: the median fabric colour, for sleeves, collar, hood and sides
 * @property {Blob} normalMap       2:1, left half = front panel normals, right half = back panel normals
 * @property {number} updatedAt     when it was baked (ms)
 * @property {string} [sig]         signature of the photos it was baked from; a new photo bakes again
 * @property {Blob} [fabricTile]    seamless 256 x 256 colour tile of the fabric (grain included)
 * @property {Blob} [fabricNormal]  seamless 256 x 256 normal map of the same tile
 * @property {Blob} [roughnessMap]  2:1 like normalMap (prints and coatings are smoother than the cloth)
 * @property {number} [roughness]   0-1 for the plain fabric (nylon bomber ~0.45, cotton ~0.85, denim ~0.8)
 * @property {string} [trimColor]   hex of ribbing, cuffs, collar or sole when it differs from the fabric
 * @property {string} [secondaryColor] hex
 * @property {string} [fit]         the item's fit: slim, regular, relaxed, oversized, baggy, straight, wide, tapered, cropped
 * @property {'full'|'short'|'long'|'cropped'} [length] shorts are short, coats long, cropped tops cropped
 * @property {boolean} [toeLeft]    shoes: the toe points left in the photos as they were taken
 * @property {boolean} [backToeLeft] shoes: the same for the second photo
 * @property {{top:number[], bot:number[], aspect:number}} [shoeProfile] shoes: the levelled outline of
 *   the front photo (toe right), its top and bottom edge per column heel to toe, 0-1 up from the bottom
 *   of its box, and the box's height over its length (the stage builds the shoe from it)
 * @property {{top:number[], bot:number[], aspect:number}} [shoeProfileBack] shoes: the same for the second photo
 */

// Inner to outer. The stage draws them in this order and offsets each further from the skin.
export const SLOTS = /** @type {GarmentLayerSlot[]} */ (["top", "layer", "jacket", "bottoms", "shoes"]);
// The outfit roles of app.js (wornList) to slots. A coat, when worn, takes the jacket slot (app.js slotsFor).
export const ROLE_TO_SLOT = { base: "top", mid: "layer", outer: "jacket", bottom: "bottoms", shoes: "shoes" };
export const SLOT_OFFSET_MM = { top: 4, layer: 11, jacket: 20, bottoms: 6, shoes: 8 };

// What 3D shell a wardrobe piece is drawn with, from its category (and name for puffers, bombers,
// cargos and joggers). Each shell has its own cut on the stage (avatar-stage.js SPECS): a bomber
// billows over its rib waistband and cuffs, a puffer is quilted, joggers taper to an elastic cuff,
// leggings are skin-tight, a tank top has no sleeves.
export function subTypeOf(item) {
  const c = item?.category || "", name = (item?.name || "").toLowerCase();
  if (c === "tank-top") return "tank";
  if (c === "long-sleeve-top") return "longsleeve";
  if (["tshirt", "polo", "shirt", "gym-top", "sports-bra"].includes(c)) return "tee";
  if (["hoodie", "zip-hoodie", "gym-hoodie"].includes(c)) return "hoodie";
  if (c === "track-jacket") return "trackjacket";
  if (["sweatshirt", "sweater", "overshirt"].includes(c)) return "sweater";
  if (c === "puffer" || (["jacket", "rain", "coat"].includes(c) && /\b(puffer|down|padded|quilted)\b/.test(name))) return "puffer";
  if (/bomber|harrington|varsity|flight/.test(name)) return "bomber";
  if (["jacket", "rain", "coat"].includes(c)) return "jacket_open";
  if (c === "leggings") return "leggings";
  if (["joggers", "track-pants"].includes(c) || (["trousers"].includes(c) && /\b(joggers?|sweatpants?|track ?pants?)\b/.test(name))) return "jogger";
  if (/cargo/.test(name)) return "cargo";
  if (["jeans", "trousers", "shorts", "gym-shorts", "skirt"].includes(c)) return "jeans";
  if (c === "boots") return "boots";
  if (["sneakers", "training-shoes", "dress-shoes"].includes(c)) return "sneakers";
  return null; // not drawn on the mirror (accessories, headwear, underwear)
}
export const lengthOf = (item) => (["shorts", "gym-shorts"].includes(item?.category) ? "short"
  : item?.category === "coat" ? "long" : item?.fit === "cropped" ? "cropped" : "full");

/* How one piece sits on the avatar, kept on the item as `cutoutMeta`:
   - aspectRatio: the trimmed cut-out's height over its width (as photographed, never stretched)
   - trimBounds:  [x, y, w, h] of the garment inside its photo, as fractions of the photo
   - scale:       the wearer's own tweak of its size, 1 = as measured (CUT_SCALE)
   - offsetY:     the wearer's own tweak of where it sits, in cm, + is higher (CUT_OFFSET) */
export const CUT_SCALE = [0.8, 1.25], CUT_OFFSET = [-8, 8];
export function cleanCutMeta(m) {
  const num = (v, lo, hi, d) => (Number.isFinite(+v) && v !== null && v !== "" ? Math.max(lo, Math.min(hi, +v)) : d);
  const out = { scale: Math.round(num(m?.scale, CUT_SCALE[0], CUT_SCALE[1], 1) * 100) / 100, offsetY: Math.round(num(m?.offsetY, CUT_OFFSET[0], CUT_OFFSET[1], 0) * 2) / 2 };
  if (Number.isFinite(+m?.aspectRatio) && +m.aspectRatio > 0) out.aspectRatio = Math.round(+m.aspectRatio * 1000) / 1000;
  if (Array.isArray(m?.trimBounds) && m.trimBounds.length === 4 && m.trimBounds.every((v) => Number.isFinite(+v))) out.trimBounds = m.trimBounds.map((v) => Math.round(+v * 10000) / 10000);
  return out;
}

/* Framing of the baked panels, so the baker and the stage agree.
   - Tops (tee, hoodie, sweater, bomber, jacket_open): the torso only, no sleeves and no hood.
     x: side seam to side seam; y: the top of the shoulders (where the shoulder seam meets the
     collar) to the bottom of the hem. Seen from the front for frontChestUV (the wearer's right on
     the left, as photographed), from behind for backPanelUV (as photographed). The stage maps it
     with a planar projection over its own front (back) panel, without mirroring text. For an open
     jacket each half of the front (u 0-0.5 and 0.5-1) goes on its own front half, side seam to
     opening, so chest logos and the zip tape stay visible.
   - Bottoms: the whole garment, waistband top to hems, outer edge to outer edge.
   - Shoes: one shoe from the side, cropped to the shoe, the toe pointing right (+u), the sole along
     the bottom edge. backPanelUV is the other photo in the same orientation.
   Every panel is fully opaque: what was background is filled with the fabric. */
export const PANEL_SIZE = { top: [768, 1024], bottoms: [768, 1024], shoes: [1024, 512] };

/* facePhotoDataUrl framing: 512 x 512, the face centred, the eye line at 42% of the height, the
   face (cheek to cheek at eye level) 60% of the width, the chin near 85%. */
export const FACE_FRAME = { size: 512, eyeY: 0.42, faceW: 0.6, chinY: 0.85 };

/* ---------- the options on the left panel ---------- */
export const BUILDS = [
  { id: "slim", label: "Slim" },
  { id: "regular", label: "Regular" },
  { id: "athletic", label: "Athletic" },
  { id: "broad", label: "Broad" },
];
export const SKINS = [
  { hex: "#f2cfb1", label: "Very fair" },
  { hex: "#e3b18f", label: "Fair" },
  { hex: "#c88f6b", label: "Light olive" },
  { hex: "#a66e4e", label: "Tan" },
  { hex: "#7b4b33", label: "Brown" },
  { hex: "#4e3023", label: "Deep brown" },
];
export const HAIR_COLORS = [
  { hex: "#17110d", label: "Black" },
  { hex: "#3a2618", label: "Dark brown" },
  { hex: "#6e4a2e", label: "Brown" },
  { hex: "#b08a58", label: "Dark blonde" },
  { hex: "#dcbc84", label: "Light blonde" },
  { hex: "#8e3e1e", label: "Auburn" },
  { hex: "#8b8682", label: "Grey" },
  { hex: "#dedad3", label: "White" },
];
export const HAIR_STYLES = [
  { id: "shaved", label: "Shaved" },
  { id: "buzz", label: "Buzz cut" },
  { id: "short", label: "Short" },
  { id: "fade", label: "Fade" },
  { id: "sidepart", label: "Side part" },
  { id: "crop", label: "Crop" },
  { id: "slick", label: "Slicked back" },
  { id: "curly", label: "Curly" },
  { id: "wavy", label: "Wavy" },
  { id: "long", label: "Long" },
];
export const BEARDS = [
  { id: "clean", label: "None" },
  { id: "stubble", label: "Stubble" },
  { id: "short", label: "Short beard" },
  { id: "full", label: "Full beard" },
  { id: "moustache", label: "Moustache" },
  { id: "goatee", label: "Goatee" },
];
export const EYES = [
  { hex: "#5a3a22", label: "Brown" },
  { hex: "#8a6a35", label: "Hazel" },
  { hex: "#5d7a4a", label: "Green" },
  { hex: "#5d84b0", label: "Blue" },
  { hex: "#8c959c", label: "Grey" },
];
export const GLASSES = [{ id: "none", label: "None" }, { id: "glasses", label: "Glasses" }];

export const DEFAULT_BODY = /** @type {AvatarBodyConfig} */ ({
  heightCm: 178, weightKg: 74, build: "regular", skinTone: SKINS[1].hex, hairStyle: "short",
  hairColor: HAIR_COLORS[1].hex, beard: "clean", eyeColor: EYES[0].hex, glasses: "none",
});

const HEX = /^#[0-9a-f]{6}$/i;
const num = (v, lo, hi, d) => (Number.isFinite(+v) && v !== "" && v != null ? Math.min(hi, Math.max(lo, Math.round(+v))) : d);
const oneOf = (list, id, d) => (list.some((x) => x.id === id) ? id : d);
const hex = (v, d) => (HEX.test(v || "") ? v.toLowerCase() : d);

// A clean AvatarBodyConfig from anything saved before, including the bodies of the picture try-on
// (weight 0-4, build 0-4, skin/hair colour indexes, eyes by name, glasses true/false).
export function cleanBody(b = {}) {
  if (b && b.heightCm == null && (b.height != null || b.weight != null)) b = fromOldBody(b);
  return {
    heightCm: num(b.heightCm, 160, 200, DEFAULT_BODY.heightCm),
    weightKg: num(b.weightKg, 50, 120, DEFAULT_BODY.weightKg),
    build: oneOf(BUILDS, b.build, DEFAULT_BODY.build),
    skinTone: hex(b.skinTone, DEFAULT_BODY.skinTone),
    hairStyle: oneOf(HAIR_STYLES, b.hairStyle, DEFAULT_BODY.hairStyle),
    hairColor: hex(b.hairColor, DEFAULT_BODY.hairColor),
    beard: oneOf(BEARDS, b.beard, DEFAULT_BODY.beard),
    eyeColor: hex(b.eyeColor, DEFAULT_BODY.eyeColor),
    glasses: oneOf(GLASSES, b.glasses, DEFAULT_BODY.glasses),
    ...(typeof b.facePhotoDataUrl === "string" && b.facePhotoDataUrl.startsWith("data:image/") ? { facePhotoDataUrl: b.facePhotoDataUrl } : {}),
  };
}
const OLD_BMI = [19, 21.5, 23.5, 26.5, 30]; // Slim, Lean, Average, Solid, Heavy
const OLD_BUILD = ["slim", "regular", "athletic", "athletic", "broad"]; // Soft, Average, Fit, Athletic, Muscular
const OLD_EYES = { brown: 0, hazel: 1, green: 2, blue: 3, grey: 4 };
function fromOldBody(o) {
  const h = num(o.height, 160, 200, 178);
  const hairIndex = o.hairColor ?? (o.hair === 5 ? 1 : [0, 1, 2, 3, 6][o.hair] ?? 1);
  return {
    heightCm: h,
    weightKg: Math.round(OLD_BMI[num(o.weight, 0, 4, 2)] * (h / 100) ** 2),
    build: OLD_BUILD[num(o.build, 0, 4, 1)],
    skinTone: SKINS[num(o.skin, 0, SKINS.length - 1, 1)].hex,
    hairStyle: o.hairStyle || (o.hair === 5 ? "shaved" : "short"),
    hairColor: HAIR_COLORS[num(hairIndex, 0, HAIR_COLORS.length - 1, 1)].hex,
    beard: o.beard || "clean",
    eyeColor: EYES[OLD_EYES[o.eyes] ?? 0].hex,
    glasses: o.glasses ? "glasses" : "none",
  };
}
export const sameBody = (a, b) => JSON.stringify(cleanBody(a)) === JSON.stringify(cleanBody(b));
export const bodyLine = (b) => `${b.heightCm} cm · ${b.weightKg} kg · ${BUILDS.find((x) => x.id === b.build)?.label.toLowerCase()}`;
