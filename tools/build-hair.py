# Builds avatar/hair/<style>.json + <style>.webp: real photographed hair for the 3D mirror on Today
# (avatar-stage.js), taken from Microsoft Rocketbox's male heads and fitted onto our MakeHuman head.
#
# Rocketbox (https://github.com/microsoft/Microsoft-Rocketbox) is MIT licensed (copy in
# avatar/hair/LICENSE-rocketbox.md). Each head has hair painted on its scalp (photographed, in
# <id>_head_color.tga) and a few hair cards (<id>_opacity_color.tga). Get only what is needed:
#     git clone --depth 1 --filter=blob:none --sparse https://github.com/microsoft/Microsoft-Rocketbox rb
#     cd rb && git sparse-checkout set --no-cone /LICENSE.md \
#        '/Assets/Avatars/Adults/Male_Adult_*/Export/Male_Adult_??.fbx' \
#        '/Assets/Avatars/Adults/Male_Adult_*/Textures/*head_color*' \
#        '/Assets/Avatars/Adults/Male_Adult_*/Textures/*opacity*'
# and run, from this repository's root:
#     python3 -I tools/build-hair.py <rb>/Assets/Avatars/Adults avatar
# Needs numpy and Pillow (with WebP).
#
# How a style is fitted: both heads are lined up on their skulls (crown, back of the head, forehead,
# skull width above the ears, nose tip height), then every hair point is stored as a direction from
# the hair centre (HAIR_CENTER in avatar-stage.js, rest units = decimetres) and its height above the
# Rocketbox head in that direction. The stage puts it back at the same height above our head in the
# same direction, so the hair follows our head's shape and the body sliders.
import json, struct, sys, zlib
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

RB, OUT = Path(sys.argv[1]), Path(sys.argv[2])
CENTER = np.array([0.0, 8.25, 0.35])  # HAIR_CENTER in avatar-stage.js (rest, dm)

# style id -> Rocketbox head, and how far below the nose tip the hair may reach at the nape (in
# head heights, nose tip to crown). Every one a men's cut.
NO_CARDS = {'sidepart'}  # its cards are grey hair seen root-on: a pale net over the crown
STYLES = {
    'buzz': ('Male_Adult_12', 0.05),      # very short, close to the scalp
    'short': ('Male_Adult_20', 0.05),     # short, neat, a little length on top
    'fade': ('Male_Adult_08', 0.05),      # quiff on top, faded sides
    'sidepart': ('Male_Adult_05', 0.05),  # classic side part
    'crop': ('Male_Adult_07', 0.05),      # textured crop, short sides
    'slick': ('Male_Adult_09', 0.08),     # slicked back
    'curly': ('Male_Adult_06', 0.1),      # medium curls
    'wavy': ('Male_Adult_01', 0.12),      # medium, wavy, over the ears
    'long': ('Male_Adult_02', 0.2),       # to the bottom of the ears and the nape
}


# ---------- a small reader for binary FBX (enough for Rocketbox's meshes) ----------
def read_fbx(path):
    data = Path(path).read_bytes()
    assert data[:20] == b'Kaydara FBX Binary  ', path
    wide = struct.unpack_from('<I', data, 23)[0] >= 7500

    def prop(o):
        t = chr(data[o]); o += 1
        if t in 'YCIFDL':
            fmt = {'Y': '<h', 'C': '<?', 'I': '<i', 'F': '<f', 'D': '<d', 'L': '<q'}[t]
            return struct.unpack_from(fmt, data, o)[0], o + struct.calcsize(fmt)
        if t in 'fdlib':
            n, enc, clen = struct.unpack_from('<III', data, o); o += 12
            raw = data[o:o + clen]; o += clen
            if enc: raw = zlib.decompress(raw)
            return np.frombuffer(raw, dtype={'f': '<f4', 'd': '<f8', 'l': '<i8', 'i': '<i4', 'b': '?'}[t], count=n), o
        if t in 'SR':
            n = struct.unpack_from('<I', data, o)[0]; o += 4
            v = data[o:o + n]
            return (v.decode('utf8', 'replace') if t == 'S' else v), o + n
        raise ValueError(t)

    def node(o):
        if wide: end, nprop, _ = struct.unpack_from('<QQQ', data, o); o += 24
        else: end, nprop, _ = struct.unpack_from('<III', data, o); o += 12
        if end == 0: return None, o
        nl = data[o]; o += 1
        name = data[o:o + nl].decode(); o += nl
        props = []
        for _ in range(nprop):
            v, o = prop(o); props.append(v)
        kids = []
        while o < end:
            k, o2 = node(o)
            if k is None: break
            kids.append(k); o = o2
        return {'name': name, 'props': props, 'kids': kids}, end

    o, top = 27, []
    while o < len(data) - 160:
        n, o = node(o)
        if n is None: break
        top.append(n)
    return top


def kid(n, name): return [k for k in n['kids'] if k['name'] == name]


def rocketbox_mesh(folder):
    """Triangles of a Rocketbox avatar: corners (T,3,3) in decimetres (y up, face +z), UVs (T,3,2),
    material name per triangle."""
    fbx = next((folder / 'Export').glob(f'{folder.name}.fbx'))
    top = read_fbx(fbx)
    objs = next(t for t in top if t['name'] == 'Objects')
    g = kid(objs, 'Geometry')[0]
    V = kid(g, 'Vertices')[0]['props'][0].reshape(-1, 3).astype(np.float64)
    # 3ds Max's z-up with the model's PreRotation (-90 about x): world = (x, z, -y), cm -> dm
    V = np.stack([V[:, 0], V[:, 2], -V[:, 1]], 1) / 10
    pvi = kid(g, 'PolygonVertexIndex')[0]['props'][0]
    luv = kid(g, 'LayerElementUV')[0]
    UV = kid(luv, 'UV')[0]['props'][0].reshape(-1, 2)
    UVI = kid(luv, 'UVIndex')[0]['props'][0]
    MAT = kid(kid(g, 'LayerElementMaterial')[0], 'Materials')[0]['props'][0]
    mats = {m['props'][0]: m['props'][1].split('\x00')[0] for m in kid(objs, 'Material')}
    model = next(m for m in kid(objs, 'Model') if m['props'][2] == 'Mesh')['props'][0]
    con = next(t for t in top if t['name'] == 'Connections')
    order = [mats[c['props'][1]] for c in con['kids'] if c['props'][0] == 'OO' and c['props'][2] == model and c['props'][1] in mats]
    tris, uvs, tm = [], [], []
    poly, corner, pi = [], [], 0
    for k, v in enumerate(pvi):
        last = v < 0
        poly.append(~v if last else v); corner.append(k)
        if last:
            for j in range(1, len(poly) - 1):
                ids = [0, j, j + 1]
                tris.append([V[poly[i]] for i in ids]); uvs.append([UV[UVI[corner[i]]] for i in ids])
                tm.append(order[MAT[pi] if len(MAT) > 1 else MAT[0]])
            poly, corner = [], []; pi += 1
    return np.array(tris), np.array(uvs), np.array(tm)


def mh_head(avatar):
    """Our head (rest, dm): its points, and its head + neck triangles (corners)."""
    hdr = json.loads((avatar / 'avatar.json').read_text())
    buf = (avatar / 'avatar.bin').read_bytes()
    arr = lambda k, dt: np.frombuffer(buf, dtype=dt, count=hdr[k]['length'], offset=hdr[k]['offset'])
    P = arr('base', np.float32).reshape(-1, 3).astype(np.float64)
    region = arr('region', np.uint8)
    I = arr('index', np.uint32).reshape(-1, 3)
    ok = np.isin(region[I], (8, 9)).all(1)
    return P[region == 8], P[I[ok]]


HA, HP = 128, 181
def radius_grid(T):
    """Outer radius of triangles T from CENTER on an (azimuth, polar angle) grid, as the stage does."""
    az = -np.pi + np.arange(HA) * 2 * np.pi / HA
    q = np.linspace(0, np.pi, HP)
    A, Q = np.meshgrid(az, q, indexing='ij')
    dirs = np.stack([np.sin(Q) * np.sin(A), np.cos(Q), np.sin(Q) * np.cos(A)], -1).reshape(-1, 3)
    return outer_radius(dirs, T, CENTER).reshape(HA, HP)


def grid_at(G, az, q):
    fi = (az + np.pi) / (2 * np.pi / HA); fj = np.clip(q / (np.pi / (HP - 1)), 0, HP - 1.001)
    i = np.floor(fi).astype(int); j = np.floor(fj).astype(int); ti, tj = fi - i, fj - j
    i0 = i % HA; i1 = (i0 + 1) % HA
    a = G[i0, j] * (1 - tj) + G[i0, j + 1] * tj
    b = G[i1, j] * (1 - tj) + G[i1, j + 1] * tj
    return a * (1 - ti) + b * ti


def landmarks(P):
    """Skull landmarks of a head's points (y up, face +z): nose tip, crown, forehead, back, width."""
    front = P[np.abs(P[:, 0]) < 0.06]
    nose = front[np.argmax(front[:, 2])]
    top = P[:, 1].max()
    h = top - nose[1]
    band = lambda a, b: P[(P[:, 1] > nose[1] + a * h) & (P[:, 1] < nose[1] + b * h)]
    mid = band(0.55, 0.7)
    fore = mid[np.abs(mid[:, 0]) < 0.08][:, 2].max()
    back = band(0.2, 0.8)[:, 2].min()
    width = np.abs(band(0.6, 0.85)[:, 0]).max()
    return dict(noseY=nose[1], top=top, fore=fore, back=back, width=width)


def align(L_rb, L_mh):
    sx = L_mh['width'] / L_rb['width']
    sy = (L_mh['top'] - L_mh['noseY']) / (L_rb['top'] - L_rb['noseY'])
    sz = (L_mh['fore'] - L_mh['back']) / (L_rb['fore'] - L_rb['back'])
    return lambda X: np.stack([X[..., 0] * sx, L_mh['noseY'] + (X[..., 1] - L_rb['noseY']) * sy, L_mh['back'] + (X[..., 2] - L_rb['back']) * sz], -1)


def outer_radius(dirs, T, c):
    """Distance from c along each direction to the outermost triangle of T (0 when none is hit)."""
    out = np.zeros(len(dirs))
    a, e1, e2 = T[:, 0], T[:, 1] - T[:, 0], T[:, 2] - T[:, 0]
    s = c - a
    for k in range(0, len(dirs), 256):
        D = dirs[k:k + 256, None, :]
        p = np.cross(D, e2[None])
        det = (e1[None] * p).sum(-1)
        ok = np.abs(det) > 1e-12
        inv = np.where(ok, 1 / np.where(ok, det, 1), 0)
        u = (s[None] * p).sum(-1) * inv
        q = np.cross(s, e1)
        v = (D * q[None]).sum(-1) * inv
        t = (e2[None] * q[None]).sum(-1) * inv
        hit = ok & (u >= -1e-6) & (v >= -1e-6) & (u + v <= 1 + 1e-6) & (t > 0)
        out[k:k + 256] = np.where(hit, t, 0).max(1)
    return out


def sample(img, uv):
    """Bilinear-free nearest sample of an image (H,W,C float) at UVs (bottom-left origin)."""
    H, W = img.shape[:2]
    x = np.clip((uv[..., 0] % 1) * W, 0, W - 1).astype(int)
    y = np.clip((1 - uv[..., 1] % 1) * H, 0, H - 1).astype(int)
    return img[y, x]


def hairness(rgb, skin):
    """0 skin .. 1 hair, from how far a colour is from this head's skin (darker, or less red)."""
    lum = rgb @ np.array([0.2126, 0.7152, 0.0722])
    ls = skin @ np.array([0.2126, 0.7152, 0.0722])
    dark = np.clip((ls - lum) / (0.45 * ls), 0, 1)
    red = lambda c: (c[..., 0] - c[..., 2]) / (c[..., 0] + c[..., 1] + c[..., 2] + 1e-3)
    pale = np.clip((red(skin) - red(rgb)) / max(red(skin) * 0.8, 1e-3), 0, 1)
    return np.clip(np.maximum(dark, pale * 0.9), 0, 1)


def blur(a, r):
    """Three box blurs of radius r (about a Gaussian), edges clamped."""
    for ax in (0, 1):
        for _ in range(3):
            n = a.shape[ax]
            c = np.cumsum(np.pad(a, [(r + 1, r) if k == ax else (0, 0) for k in range(a.ndim)], mode='edge'), axis=ax)
            a = (np.take(c, np.arange(2 * r + 1, 2 * r + 1 + n), axis=ax) - np.take(c, np.arange(0, n), axis=ax)) / (2 * r + 1)
    return a


def normconv(x, w, radii):
    """x averaged with weights w around each pixel; far from any weight, from wider and wider rings."""
    out, got = np.zeros_like(x), np.zeros_like(x)
    for r in radii:
        bw = blur(w, r)
        v = blur(x * w, r) / np.maximum(bw, 1e-6)
        take = (got == 0) & (bw > 1e-3)
        out[take] = v[take]; got[take] = 1
    return np.where(got > 0, out, x)


def smooth(e0, e1, x): t = np.clip((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t)


def build(style, folder, nape, mh, mh_grid):
    T, UV, M = rocketbox_mesh(folder)
    tex_id = next((folder / 'Textures').glob('*_head_color.tga')).name.split('_')[0]
    head_img = np.asarray(Image.open(folder / 'Textures' / f'{tex_id}_head_color.tga').convert('RGB'), dtype=np.float32) / 255
    opf = folder / 'Textures' / f'{tex_id}_opacity_color.tga'
    op_img = np.asarray(Image.open(opf).convert('RGBA'), dtype=np.float32) / 255 if opf.exists() else None
    is_head = np.char.endswith(M.astype(str), '_head')
    is_op = np.char.endswith(M.astype(str), '_opacity')
    Lr = landmarks(T[is_head].reshape(-1, 3))
    Lm = landmarks(mh)
    fit = align(Lr, Lm)
    T = fit(T)
    L = landmarks(T[is_head].reshape(-1, 3))  # now in our head's frame
    h = L['top'] - L['noseY']
    cen = T.mean(1)
    # this head's skin: the middle of the face around the nose (median; the nostrils don't count)
    mid = is_head & (np.abs(cen[:, 0]) < 0.4) & (np.abs(cen[:, 1] - L['noseY']) < 0.15 * h) & (cen[:, 2] > L['fore'] - 0.5)
    skin = np.median(sample(head_img, UV[mid].mean(1)), 0)
    # hair painted on the scalp: the head's triangles that are hair, above the cheekbones or behind
    # the ears, never the brows, the face or a beard
    hn = np.stack([hairness(sample(head_img, UV[:, i] * 0.8 + UV.mean(1) * 0.2), skin) for i in range(3)] + [hairness(sample(head_img, UV.mean(1)), skin)], 1).mean(1)
    above = cen[:, 1] > L['noseY'] + 0.18 * h
    behind = (cen[:, 2] < CENTER[2] - 0.15) & (cen[:, 1] > L['noseY'] - (nape + 0.1) * h)  # down to the nape hairline
    face = (cen[:, 2] > L['fore'] - 0.3) & (cen[:, 1] < L['noseY'] + 0.62 * h) & (np.abs(cen[:, 0]) < 0.62)
    cap = is_head & (above | behind) & ~face & (hn > 0.12)
    # one ring more, so the hairline fades out inside the cap (by the texture), not at its edge
    key = lambda p: tuple(np.round(p, 4))
    vset = {key(p) for t in T[cap] for p in t}
    ring = is_head & ~cap & ~face & np.array([any(key(p) in vset for p in t) for t in T]) & (above | behind)
    cap |= ring
    # hair cards: the pieces of the card mesh that reach the hair (a fringe hangs over the forehead);
    # pieces that stay low on the face are brows and lashes
    cards = (is_op if op_img is not None and style not in NO_CARDS else np.zeros(len(T), bool)) & (cen[:, 1] > L['noseY'] - 0.2 * h)
    ids = np.where(cards)[0]
    parent = {i: i for i in ids}
    def root(i):
        while parent[i] != i: parent[i] = parent[parent[i]]; i = parent[i]
        return i
    seen = {}
    for i in ids:
        for p in T[i]:
            k = tuple(np.round(p, 4))
            if k in seen: parent[root(i)] = root(seen[k])
            else: seen[k] = i
    top = {}
    for i in ids: r = root(i); top[r] = max(top.get(r, -1e9), T[i][:, 1].max())
    for i in ids:
        front = cen[i, 2] > CENTER[2]
        if front and top[root(i)] < L['noseY'] + 0.5 * h: cards[i] = False
    # the cap's border (where it meets the rest of the head) fades out, wherever it was cut
    other = {key(p) for t in T[is_head & ~cap] for p in t}

    # textures: the cap's part of the head texture (alpha = hairness) and the cards' part of the
    # opacity texture, one atlas 1024 wide
    def crop(img, uvs):
        Hh, Ww = img.shape[:2]
        u0, u1 = uvs[..., 0].min(), uvs[..., 0].max()
        v0, v1 = uvs[..., 1].min(), uvs[..., 1].max()
        x0, x1 = max(0, int(u0 * Ww) - 4), min(Ww, int(np.ceil(u1 * Ww)) + 4)
        y0, y1 = max(0, int((1 - v1) * Hh) - 4), min(Hh, int(np.ceil((1 - v0) * Hh)) + 4)
        return img[y0:y1, x0:x1], (x0, y0, x1, y1, Ww, Hh)
    cimg, cbox = crop(head_img, UV[cap])
    # where the head's UV islands are (outside them the texture is padding: never sampled from)
    x0, y0, x1, y1, Ww, Hh = cbox
    isl = Image.new('L', (x1 - x0, y1 - y0), 0)
    dr = ImageDraw.Draw(isl)
    for t in UV[is_head]:
        dr.polygon([(u * Ww - x0, (1 - v) * Hh - y0) for u, v in t], fill=255)
    isl = np.asarray(isl, dtype=np.float32) / 255
    # alpha = how much hair covers the scalp, at the scale of a few strands (a per-strand alpha
    # would leave skin speckles between them; the strands stay in the luminance)
    fine = hairness(cimg, skin) * isl
    ca = smooth(0.18, 0.5, normconv(fine, isl, (3, 8, 24)))
    # luminance: the photo's where it is hair; between strands and at the hairline, the hair's
    # around it (not the skin's, which would read as a pale halo)
    lum = cimg @ np.array([0.2126, 0.7152, 0.0722])
    lum_h = normconv(lum, fine ** 2 * isl, (4, 12, 32, 96))
    sure = smooth(0.45, 0.9, fine)
    lum = np.where(isl > 0.5, lum * sure + lum_h * (1 - sure), lum_h)
    capRGBA = np.dstack([lum, lum, lum, ca])
    kimg, kbox = crop(op_img, UV[cards]) if cards.any() else (np.zeros((4, 4, 4), np.float32), (0, 0, 4, 4, 4, 4))
    if cards.any():
        # the cards' faint parts take the luminance of the solid strands around them (their own
        # colour there is often pale, which reads as a grey veil)
        ka = kimg[..., 3]
        kl = kimg[..., :3] @ np.array([0.2126, 0.7152, 0.0722])
        kh = normconv(kl, ka ** 2, (4, 12, 32, 96))
        sure = smooth(0.35, 0.85, ka)
        kl = kl * sure + kh * (1 - sure)
        kimg = np.dstack([kl, kl, kl, ka])
    # atlas 1024 px wide: the scalp across the top at full width, the cards below in what is left
    W = 1024
    def fit(a, w, hmax=10 ** 6):
        im = Image.fromarray((np.clip(a, 0, 1) * 255).astype(np.uint8), 'RGBA')
        k = min(w / a.shape[1], hmax / a.shape[0])
        return im.resize((max(4, round(a.shape[1] * k)), max(4, round(a.shape[0] * k))), Image.LANCZOS)
    ci = fit(capRGBA, W, 640)
    ki = fit(kimg, W, max(256, 1024 - ci.height)) if cards.any() else None
    # colour bleed under transparent pixels (no dark halos when filtered)
    def bleed(im):
        a = np.asarray(im, dtype=np.float32) / 255
        rgb, al = a[..., :3], a[..., 3:]
        acc, wsum = rgb * al, al.copy()
        for r in (2, 6, 16, 40):
            b = lambda x: np.asarray(Image.fromarray((np.clip(x, 0, 1) * 255).astype(np.uint8).squeeze()).filter(ImageFilter.BoxBlur(r)), dtype=np.float32) / 255
            accb = np.dstack([b(acc[..., k]) for k in range(3)]); wb = b(wsum[..., 0])[..., None]
            fill = (wsum < 0.02)
            acc = np.where(fill, accb, acc); wsum = np.where(fill, wb, wsum)
        out = np.where(al > 0.02, rgb, acc / np.maximum(wsum, 1e-3))
        return Image.fromarray((np.dstack([np.clip(out, 0, 1), al]) * 255).astype(np.uint8), 'RGBA')
    ci = bleed(ci); ki = bleed(ki) if ki else None
    Hc, Hk = ci.height, (ki.height if ki else 0)
    atlas = Image.new('RGBA', (W, Hc + Hk)); atlas.paste(ci, (0, 0))
    if ki: atlas.paste(ki, (0, Hc))
    AH = Hc + Hk
    CW, KW = ci.width / W, (ki.width / W if ki else 1)
    # the stage re-colours the hair from its luminance: store grey + alpha, at most 1024 px a side
    a = np.asarray(atlas, dtype=np.float32) / 255
    g = a[..., :3] @ np.array([0.2126, 0.7152, 0.0722])
    # each part's hair averages 0.5 (the painted scalp is often lighter than the cards)
    for r0, r1 in ((0, Hc), (Hc, AH)):
        if r1 <= r0: continue
        m = a[r0:r1, :, 3] > 0.5
        if m.any(): g[r0:r1] = np.clip(g[r0:r1] * (0.5 / max(g[r0:r1][m].mean(), 0.02)), 0, 1)
    # a little less pixel-sized grain (on screen it would flicker as single dots); strands stay
    b = blur(g, 1)
    g = np.clip(b + 0.6 * (g - b), 0, 1)
    atlas = Image.fromarray((np.dstack([g, g, g, a[..., 3]]) * 255).round().astype(np.uint8), 'RGBA')
    k = 1024 / max(W, AH)
    if k < 1: atlas = atlas.resize((round(W * k), round(AH * k)), Image.LANCZOS)

    def remap(uv, box, y_off, hh, xw):
        x0, y0, x1, y1, Ww, Hh = box
        px = (uv[..., 0] * Ww - x0) / (x1 - x0) * xw
        py = ((1 - uv[..., 1]) * Hh - y0) / (y1 - y0)
        return np.stack([px, 1 - (y_off + py * hh) / AH], -1)

    # geometry: the cap subdivided once (no flat triangle under our scalp), then the cards
    capT, capU = T[cap], remap(UV[cap], cbox, 0, Hc, CW)
    capE = np.array([[0.0 if key(p) in other else 1.0 for p in t] for t in capT])

    def subdivide(T3, U3, E3):
        mT, mU, mE = [(x + np.roll(x, -1, 1)) / 2 for x in (T3, U3, E3)]  # midpoints ab, bc, ca
        out = [[], [], []]
        for i, j, k in ((0, 3, 5), (3, 1, 4), (5, 4, 2), (3, 4, 5)):
            for o, (c, m) in zip(out, ((T3, mT), (U3, mU), (E3, mE))):
                o.append(np.stack([c[:, n] if n < 3 else m[:, n - 3] for n in (i, j, k)], 1))
        return [np.concatenate(o) for o in out]
    # twice: edges of about 6 mm, so no chord dips under our scalp between two points
    for _ in range(2): capT, capU, capE = subdivide(capT, capU, capE)
    kT, kU = T[cards], remap(UV[cards], kbox, Hc, Hk, KW)
    allT = np.concatenate([capT, kT]) if len(kT) else capT
    allU = np.concatenate([capU, kU]) if len(kT) else capU
    allE = np.concatenate([capE, np.ones((len(kT), 3))]) if len(kT) else capE
    kind = np.concatenate([np.zeros(len(capT)), np.ones(len(kT))])
    # weld equal corners
    verts, index, lut = [], [], {}
    for t in range(len(allT)):
        for i in range(3):
            k = (tuple(np.round(allT[t, i], 5)), tuple(np.round(allU[t, i], 5)), kind[t])
            if k not in lut: lut[k] = len(verts); verts.append((allT[t, i], allU[t, i], kind[t], allE[t, i]))
            index.append(lut[k])
    P = np.array([v[0] for v in verts]); U = np.array([v[1] for v in verts]); K = np.array([v[2] for v in verts]); E = np.array([v[3] for v in verts])
    d = P - CENTER; dist = np.linalg.norm(d, axis=1); dirs = d / dist[:, None]
    R = outer_radius(dirs, T[is_head], CENTER)
    hgt = np.where(K > 0, np.maximum(dist - R, 0.004), 0.0)
    hgt[R == 0] = 0.01
    # Low on the head (sides, sideburns, nape) a direction from the centre would land lower on our
    # head than on theirs (our neck is further in): there, keep the height the hair has on their
    # head instead, at the same azimuth.
    az = np.arctan2(dirs[:, 0], dirs[:, 2]); q0 = np.arccos(np.clip(dirs[:, 1], -1, 1))
    target = CENTER[1] + np.where(R > 0, R, dist) * dirs[:, 1]
    qs = np.linspace(0, np.pi - 0.05, 400)
    ys = CENTER[1] + grid_at(mh_grid, az[:, None], qs[None, :]) * np.cos(qs)[None, :]
    below = ys <= target[:, None]
    first = np.where(below.any(1), below.argmax(1), len(qs) - 1)
    qa, qb = qs[np.maximum(first - 1, 0)], qs[first]
    ya, yb = ys[np.arange(len(ys)), np.maximum(first - 1, 0)], ys[np.arange(len(ys)), first]
    qh = qa + (qb - qa) * np.clip((ya - target) / np.maximum(ya - yb, 1e-6), 0, 1)
    w = smooth(0.6, 0.25, dirs[:, 1])
    qn = q0 + w * (qh - q0)
    dirs = np.stack([np.sin(qn) * np.sin(az), np.cos(qn), np.sin(qn) * np.cos(az)], 1)
    # where each point lands on our head: the painted hair stops at our nape (for most cuts about
    # the height of the nose tip, fading over 1.5 cm), the cards fade out just below it
    yl = CENTER[1] + grid_at(mh_grid, az, qn) * np.cos(qn)
    hm = Lm['top'] - Lm['noseY']
    ycap, ycard = Lm['noseY'] - nape * hm, Lm['noseY'] - (nape + 0.12) * hm
    E = E * np.where(K > 0, smooth(ycard, ycap + 0.05, yl), smooth(ycap, ycap + 0.15, yl))
    tri = np.array(index).reshape(-1, 3)
    tri = tri[np.where(K[tri[:, 0]] > 0, yl[tri].max(1) > ycard, yl[tri].max(1) > ycap)]
    used = np.unique(tri)
    remapv = np.full(len(K), -1); remapv[used] = np.arange(len(used))
    index = remapv[tri].ravel().tolist()
    dirs, hgt, K, U, E = dirs[used], hgt[used], K[used], U[used], E[used]
    lmean = 0.5
    HOUT = OUT / 'hair'
    HOUT.mkdir(parents=True, exist_ok=True)
    atlas.save(HOUT / f'{style}.webp', 'WEBP', quality=88, method=6)
    r = lambda a, n=4: [round(float(x), n) for x in np.ravel(a)]
    (HOUT / f'{style}.json').write_text(json.dumps({
        'style': style, 'source': f'Microsoft Rocketbox {folder.name} (MIT)', 'lum': round(lmean, 4),
        'd': r(dirs), 'h': r(hgt), 'k': [int(x) for x in K], 'e': r(E, 2), 'uv': r(U, 5), 'i': [int(x) for x in index],
    }, separators=(',', ':')))
    print(f'{style:9s} {folder.name}: {len(index) // 3} tris ({int((K == 0).sum())} cap verts), atlas {atlas.width}x{atlas.height}, lum {lmean:.3f}, skin {np.round(skin, 2)}')


mh, mh_tris = mh_head(OUT)
mh_grid = radius_grid(mh_tris)
for style, src in STYLES.items():
    if len(sys.argv) > 3 and style not in sys.argv[3].split(','): continue
    build(style, RB / src[0], src[1], mh, mh_grid)
