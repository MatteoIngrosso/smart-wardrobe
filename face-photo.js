// "From a photo" on the mirror's body panel, all on this device (no server, no AI): finds the face
// in a photo by skin colour and the dark band of the eyes, crops it the way FACE_FRAME says for the
// 3D stage, and reads skin tone, hair colour and a beard guess from it. A clear, front-facing photo
// of the face in daylight works best.
import { FACE_FRAME } from "./avatar-config.js";

const WORK = 640; // working size: plenty for a face, quick on an iPad

function canvas(w, h) {
  return typeof OffscreenCanvas === "function" ? new OffscreenCanvas(w, h) : Object.assign(document.createElement("canvas"), { width: w, height: h });
}
async function toDataURL(c, type, quality) {
  if (c.toDataURL) return c.toDataURL(type, quality);
  const blob = await c.convertToBlob({ type, quality });
  return new Promise((resolve) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.readAsDataURL(blob); });
}
const hex = (r, g, b) => "#" + [r, g, b].map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0")).join("");
const luma = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;
function isSkin(r, g, b) {
  const y = luma(r, g, b);
  const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
  const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
  return y > 35 && y < 250 && cb >= 75 && cb <= 132 && cr >= 132 && cr <= 182 && r >= g && r + 12 >= b;
}
function median(values) {
  if (!values.length) return null;
  const s = Float64Array.from(values).sort();
  return s[s.length >> 1];
}
function medianColor(list) {
  if (!list.length) return null;
  return [0, 1, 2].map((k) => median(list.map((p) => p[k])));
}

/**
 * @param {Blob} file a photo of you
 * @returns {Promise<{ found: boolean, faceDataUrl?: string, skinTone?: string, hairColor?: string, beard?: string }>}
 */
export async function readFacePhoto(file) {
  const bmp = await createImageBitmap(file, { imageOrientation: "from-image" }).catch(() => createImageBitmap(file));
  const s = Math.min(1, WORK / Math.max(bmp.width, bmp.height));
  const W = Math.max(8, Math.round(bmp.width * s)), H = Math.max(8, Math.round(bmp.height * s));
  const c = canvas(W, H), g = c.getContext("2d", { willReadFrequently: true });
  g.drawImage(bmp, 0, 0, W, H);
  const px = g.getImageData(0, 0, W, H).data;
  const at = (x, y) => (y * W + x) * 4;

  // 1. Skin pixels, and their connected areas: the face is a large one near the top middle.
  const skin = new Uint8Array(W * H);
  for (let i = 0, j = 0; j < skin.length; i += 4, j++) skin[j] = isSkin(px[i], px[i + 1], px[i + 2]) ? 1 : 0;
  const label = new Int32Array(W * H).fill(-1);
  const blobs = [];
  const stack = new Int32Array(W * H);
  for (let start = 0; start < skin.length; start++) {
    if (!skin[start] || label[start] >= 0) continue;
    const id = blobs.length, b = { id, n: 0, x0: W, x1: 0, y0: H, y1: 0 };
    let top = 0;
    stack[top++] = start; label[start] = id;
    while (top) {
      const p = stack[--top], x = p % W, y = (p / W) | 0;
      b.n++; if (x < b.x0) b.x0 = x; if (x > b.x1) b.x1 = x; if (y < b.y0) b.y0 = y; if (y > b.y1) b.y1 = y;
      for (const q of [p - 1, p + 1, p - W, p + W]) {
        if (q < 0 || q >= skin.length || !skin[q] || label[q] >= 0) continue;
        if ((q === p - 1 && x === 0) || (q === p + 1 && x === W - 1)) continue;
        label[q] = id; stack[top++] = q;
      }
    }
    blobs.push(b);
  }
  const score = (b) => {
    const w = b.x1 - b.x0 + 1, h = b.y1 - b.y0 + 1, cx = (b.x0 + b.x1) / 2 / W, cy = (b.y0 + b.y1) / 2 / H;
    if (b.n < W * H * 0.008 || h / w < 0.6 || h / w > 3.2) return 0;
    return b.n * (1 - Math.min(0.8, Math.abs(cx - 0.5))) * (1 - Math.min(0.6, Math.max(0, cy - 0.45)));
  };
  const face = blobs.reduce((best, b) => (score(b) > (best ? score(best) : 0) ? b : best), null);
  if (!face || !score(face)) return { found: false };

  // 2. Width of the face per row (the skin's extent, holes like eyes included).
  const rows = [];
  for (let y = face.y0; y <= face.y1; y++) {
    let l = -1, r = -1;
    for (let x = face.x0; x <= face.x1; x++) if (label[y * W + x] === face.id) { if (l < 0) l = x; r = x; }
    rows.push(l < 0 ? null : { l, r, w: r - l + 1 });
  }
  const maxW = Math.max(...rows.map((r) => r?.w || 0));
  const topRow = rows.findIndex((r) => r && r.w >= maxW * 0.35);
  const faceTop = face.y0 + Math.max(0, topRow);
  const faceH = Math.min(face.y1 - faceTop, maxW * 1.45); // the neck can join the face: cap the height

  // 3. The eye line: the darkest band in the upper middle of the face (the lower of brows and eyes).
  const band = [];
  for (let y = Math.round(faceTop + faceH * 0.25); y <= Math.round(faceTop + faceH * 0.6); y++) {
    const r = rows[y - face.y0];
    if (!r) continue;
    const l = Math.round(r.l + r.w * 0.15), rr = Math.round(r.r - r.w * 0.15);
    let sum = 0, n = 0;
    for (let x = l; x <= rr; x++) { const i = at(x, y); sum += luma(px[i], px[i + 1], px[i + 2]); n++; }
    if (n) band.push({ y, v: sum / n });
  }
  if (band.length < 5) return { found: false };
  const smooth = band.map((b, i) => {
    const w = band.slice(Math.max(0, i - 2), i + 3);
    return { y: b.y, v: w.reduce((a, x) => a + x.v, 0) / w.length };
  });
  const minima = smooth.filter((b, i) => i > 0 && i < smooth.length - 1 && b.v <= smooth[i - 1].v && b.v <= smooth[i + 1].v).sort((a, b) => a.v - b.v);
  let eyeY = (minima[0] || smooth.reduce((a, b) => (b.v < a.v ? b : a))).y;
  const second = minima.find((m) => Math.abs(m.y - eyeY) > faceH * 0.06 && m.v < minima[0].v + 12);
  if (second && second.y > eyeY) eyeY = second.y; // brows above, eyes below: take the eyes

  // 4. Face width at the eyes, and the crop the stage expects.
  const near = rows.slice(Math.max(0, eyeY - face.y0 - 3), eyeY - face.y0 + 4).filter(Boolean);
  if (!near.length) return { found: false };
  const fl = Math.min(...near.map((r) => r.l)), fr = Math.max(...near.map((r) => r.r));
  const faceW = fr - fl + 1, cx = (fl + fr) / 2;
  const side = faceW / FACE_FRAME.faceW;
  const sx = cx - side / 2, sy = eyeY - side * FACE_FRAME.eyeY;
  const out = canvas(FACE_FRAME.size, FACE_FRAME.size), og = out.getContext("2d");
  og.fillStyle = "#808080";
  og.fillRect(0, 0, FACE_FRAME.size, FACE_FRAME.size);
  og.drawImage(bmp, sx / s, sy / s, side / s, side / s, 0, 0, FACE_FRAME.size, FACE_FRAME.size);
  bmp.close?.();
  const faceDataUrl = await toDataURL(out, "image/jpeg", 0.86);

  // 5. Skin tone: the cheeks, between the eyes and the mouth.
  const sample = (y0, y1, x0, x1, keep) => {
    const list = [];
    for (let y = Math.max(0, Math.round(y0)); y <= Math.min(H - 1, Math.round(y1)); y++) {
      for (let x = Math.max(0, Math.round(x0)); x <= Math.min(W - 1, Math.round(x1)); x++) {
        const i = at(x, y);
        if (keep(px[i], px[i + 1], px[i + 2], y * W + x)) list.push([px[i], px[i + 1], px[i + 2]]);
      }
    }
    return list;
  };
  const cheeks = sample(eyeY + side * 0.07, eyeY + side * 0.2, cx - faceW * 0.38, cx + faceW * 0.38, (r, gg, b, k) => skin[k]);
  const tone = medianColor(cheeks);
  const result = { found: true, faceDataUrl, ...(tone ? { skinTone: hex(...tone) } : {}) };

  // 6. Hair colour: what's above the forehead that is neither skin nor the background.
  const corners = [[2, 2], [W - 3, 2], [2, H - 3], [W - 3, H - 3]].map(([x, y]) => { const i = at(x, y); return [px[i], px[i + 1], px[i + 2]]; });
  const isBackground = (r, gg, b) => corners.some(([R, G, B]) => Math.abs(r - R) + Math.abs(gg - G) + Math.abs(b - B) < 60);
  const hairBand = sample(faceTop - side * 0.12, faceTop + side * 0.02, cx - faceW * 0.45, cx + faceW * 0.45, (r, gg, b, k) => !skin[k] && !isBackground(r, gg, b));
  const bandArea = Math.max(1, side * 0.14 * faceW * 0.9);
  if (hairBand.length > bandArea * 0.25) result.hairColor = hex(...medianColor(hairBand));

  // 7. Beard: the jaw and chin much less skin-coloured (and darker) than the cheeks.
  const chinY = eyeY + side * (FACE_FRAME.chinY - FACE_FRAME.eyeY);
  const mouthY = eyeY + (chinY - eyeY) * 0.62;
  const share = (y0, y1, x0, x1) => {
    let n = 0, k = 0, dark = 0;
    for (let y = Math.max(0, Math.round(y0)); y <= Math.min(H - 1, Math.round(y1)); y++) {
      for (let x = Math.max(0, Math.round(x0)); x <= Math.min(W - 1, Math.round(x1)); x++) {
        const i = at(x, y); n++; k += skin[y * W + x]; dark += luma(px[i], px[i + 1], px[i + 2]);
      }
    }
    return { skin: n ? k / n : 0, luma: n ? dark / n : 0 };
  };
  const cheek = share(eyeY + side * 0.07, eyeY + side * 0.2, cx - faceW * 0.38, cx - faceW * 0.15);
  const jaw = share(mouthY + side * 0.03, chinY - side * 0.02, cx - faceW * 0.3, cx + faceW * 0.3);
  const lip = share(mouthY - side * 0.07, mouthY - side * 0.02, cx - faceW * 0.18, cx + faceW * 0.18);
  if (cheek.skin > 0.6) {
    const drop = (cheek.skin - jaw.skin) / cheek.skin, darker = (cheek.luma - jaw.luma) / Math.max(1, cheek.luma);
    const moustache = (cheek.skin - lip.skin) / cheek.skin > 0.45;
    result.beard = drop > 0.6 && darker > 0.2 ? "full" : drop > 0.35 && darker > 0.12 ? "short"
      : drop > 0.15 && darker > 0.06 ? "stubble" : moustache && darker < 0.06 ? "moustache" : "clean";
  }
  return result;
}
