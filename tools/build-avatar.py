# Builds avatar/avatar.bin + avatar/avatar.json (and avatar/eye.png) for the 3D mirror on Today
# (avatar-stage.js) from the MakeHuman base mesh, targets, rig and eye texture.
#
# The data is CC0: MakeHuman's assets were released under CC0 1.0 in September 2020
# (LICENSE.ASSETS.md in https://github.com/makehumancommunity/makehuman). Get it with
#     git clone --depth 1 https://github.com/makehumancommunity/makehuman
# and run, from the repository root:
#     python3 -I tools/build-avatar.py <path to makehuman/makehuman/data> avatar
# Needs numpy and Pillow.
#
# What goes in (all in MakeHuman units, decimetres; the stage scales to metres):
#   base      every vertex of the base mesh (helpers too: the joints are averages of helper vertices),
#             baked as a young man of mixed ethnicity with average proportions and a masculine
#             finish (MASCULINE below: no breasts, narrower hips, sloped shoulders)
#   index     the body's triangles (helpers left out)
#   m:<name>  sparse morph targets: universal muscle x weight grid, height, and a few torso/shoulder
#             shapes for the build (slim, regular, athletic, broad)
#   ao        per vertex 0-255: ambient occlusion on the rest pose (255 open)
#   region    per vertex: 1 torso, 2 upper arm, 3 forearm, 4 hand, 5 thigh, 6 shin, 7 foot, 8 head, 9 neck
#   armL/armR/legL/legR  0-255 weights of the arm and leg chains (arms are lowered at run time)
#   joints    named joints -> vertex lists (their average is the joint)
#   eye*      the high-poly eyeballs (no cornea), relative to each eye joint, with UVs; eye.png their
#             texture (RGB) and header.irises the iris circles in it (recoloured at run time)
import json, sys
import numpy as np
from PIL import Image

MH, OUT = sys.argv[1], sys.argv[2]

vs, faces, groups = [], [], {}
g = None
for line in open(f'{MH}/3dobjs/base.obj'):
    if line.startswith('v '):
        vs.append([float(x) for x in line.split()[1:4]])
    elif line.startswith('g '):
        g = line.split()[1]
    elif line.startswith('f '):
        groups.setdefault(g, []).append([int(p.split('/')[0]) - 1 for p in line.split()[1:]])
V = np.array(vs, dtype=np.float64)
N = len(V)


def target(name):
    d = np.zeros((N, 3))
    for line in open(f'{MH}/targets/{name}.target'):
        if line.startswith('#') or not line.strip():
            continue
        p = line.split()
        d[int(p[0])] = [float(p[1]), float(p[2]), float(p[3])]
    return d


base = V.copy()
for r in ['caucasian', 'african', 'asian']:
    base += target(f'macrodetails/{r}-male-young') / 3
base += 0.5 * target('macrodetails/proportions/male-young-averagemuscle-averageweight-idealproportions')
# MakeHuman's average young man still has soft, rounded breasts, wide hips and a full bottom (it
# blends towards the genderless base mesh). A masculine finish: flat pectorals instead of breasts,
# narrower hips and a flatter bottom. The shoulders narrower and more sloped than MakeHuman's (about
# 119 cm around the deltoids at 178 cm, 67 kg, was 128): broad square shoulders over a slim waist
# read as a box once dressed. (A thicker waist was tried too: it only added a belly.)
MASCULINE = [
    ('breast/breast-point-decr', 1.0), ('breast/breast-volume-vert-up', 0.5),
    ('measure/measure-bust-circ-decr', 0.35), ('torso/torso-muscle-pectoral-incr', 0.3),
    ('hip/hip-scale-horiz-decr', 0.55), ('measure/measure-hips-circ-decr', 0.6),
    ('buttocks/buttocks-volume-decr', 0.7),
    ('torso/torso-vshape-decr', 0.3), ('measure/measure-shoulder-dist-decr', 0.5),
    # and a man's face and neck: a squarer, wider jaw, a firmer chin, a thicker neck
    ('head/head-square', 0.35), ('chin/chin-width-incr', 0.4), ('chin/chin-bones-incr', 0.35),
    ('chin/chin-prominent-incr', 0.2), ('neck/neck-scale-horiz-incr', 0.3), ('measure/measure-neck-circ-incr', 0.3),
]
for name, w in MASCULINE:
    base += w * target(name)

morphs = {}
for m in ['min', 'average', 'max']:
    for w in ['min', 'average', 'max']:
        if m == 'average' and w == 'average':
            continue
        morphs[f'u-{m}muscle-{w}weight'] = target(f'macrodetails/universal-male-young-{m}muscle-{w}weight')
for h in ['min', 'max']:
    morphs[f'{h}height'] = target(f'macrodetails/height/male-young-averagemuscle-averageweight-{h}height')
for name in ['torso/torso-vshape-incr', 'torso/torso-scale-horiz-incr', 'torso/torso-scale-horiz-decr',
             'measure/measure-shoulder-dist-incr', 'measure/measure-shoulder-dist-decr',
             'measure/measure-neck-circ-incr', 'measure/measure-upperarm-circ-incr',
             'stomach/stomach-pregnant-incr', 'breast/breast-point-decr', 'measure/measure-bust-circ-decr',
             'buttocks/buttocks-volume-decr']:
    morphs[name.split('/')[1]] = target(name)

tris = []
for q in groups['body']:
    tris.append([q[0], q[1], q[2]])
    if len(q) == 4:
        tris.append([q[0], q[2], q[3]])
tris = np.array(tris, dtype=np.uint32)

skel = json.load(open(f'{MH}/rigs/default.mhskel'))
W = json.load(open(f'{MH}/rigs/default_weights.mhw'))['weights']
joints = {}
for key, bone, end in [
    ('pelvis', 'spine05', 'head'), ('spine4', 'spine04', 'head'), ('waist', 'spine03', 'head'), ('spine2', 'spine02', 'head'),
    ('chest', 'spine01', 'head'), ('neck', 'neck01', 'head'), ('neck2', 'neck02', 'head'), ('neck3', 'neck03', 'head'),
    ('head', 'head', 'head'), ('headTop', 'head', 'tail'), ('jaw', 'jaw', 'head'),
    ('clavicleL', 'clavicle.L', 'head'), ('clavicleR', 'clavicle.R', 'head'),
    ('shoulderL', 'upperarm01.L', 'head'), ('shoulderR', 'upperarm01.R', 'head'),
    ('elbowL', 'lowerarm01.L', 'head'), ('elbowR', 'lowerarm01.R', 'head'),
    ('wristL', 'wrist.L', 'head'), ('wristR', 'wrist.R', 'head'),
    ('hipL', 'upperleg01.L', 'head'), ('hipR', 'upperleg01.R', 'head'),
    ('kneeL', 'lowerleg01.L', 'head'), ('kneeR', 'lowerleg01.R', 'head'),
    ('ankleL', 'foot.L', 'head'), ('ankleR', 'foot.R', 'head'),
    ('toeL', 'toe1-1.L', 'head'), ('toeR', 'toe1-1.R', 'head'),
]:
    joints[key] = skel['joints'][skel['bones'][bone][end]]
for key, grp in [('eyeL', 'joint-l-eye'), ('eyeR', 'joint-r-eye'), ('mouth', 'joint-mouth')]:
    joints[key] = sorted(set(i for f in groups[grp] for i in f))


def family(b):
    if b.startswith(('upperarm', 'shoulder')): return 2
    if b.startswith('lowerarm'): return 3
    if b.startswith(('wrist', 'finger', 'metacarpal')): return 4
    if b.startswith('upperleg'): return 5
    if b.startswith('lowerleg'): return 6
    if b.startswith(('foot', 'toe')): return 7
    if b.startswith('neck'): return 9
    if b.startswith(('head', 'jaw', 'eye', 'levator', 'oculi', 'orbicularis', 'oris', 'risorius', 'special', 'tongue', 'temporalis', 'mandible')): return 8
    return 1


acc = np.zeros((N, 10))
armL = np.zeros(N); armR = np.zeros(N); legL = np.zeros(N); legR = np.zeros(N)
for b, lst in W.items():
    f = family(b)
    for v, w in lst:
        acc[v, f] += w
        left = b.endswith('.L')
        if f in (2, 3, 4) and not b.startswith('shoulder'):
            (armL if left else armR)[v] += w
        if f in (5, 6, 7):
            (legL if left else legR)[v] += w
region = acc.argmax(axis=1).astype(np.uint8)
region[acc.sum(axis=1) == 0] = 1


def centroid(ids):
    return base[ids].mean(axis=0)


# eyes (high-poly), per corner so the UV seams survive; positions relative to each eye joint.
# The cornea shells (their UVs sit in the texture's transparent corner) are left out.
ev, ef, evt, eft = [], [], [], []
for line in open(f'{MH}/eyes/high-poly/high-poly.obj'):
    if line.startswith('v '): ev.append([float(t) for t in line.split()[1:4]])
    elif line.startswith('vt '): evt.append([float(t) for t in line.split()[1:3]])
    elif line.startswith('f '):
        ps = [p.split('/') for p in line.split()[1:]]
        ef.append([int(p[0]) - 1 for p in ps]); eft.append([int(p[1]) - 1 for p in ps])
ev = np.array(ev); evt = np.array(evt)
eyeP, eyeUV = [], []
for f, t in zip(ef, eft):
    if all(evt[k][0] > 0.85 and evt[k][1] < 0.15 for k in t):
        continue  # cornea
    order = [0, 1, 2] if len(f) == 3 else [0, 1, 2, 0, 2, 3]
    for k in order:
        eyeP.append(ev[f[k]]); eyeUV.append(evt[t[k]])
eyeP = np.array(eyeP); eyeUV = np.array(eyeUV)
side = eyeP[:, 0] > 0
for s, j in [(True, 'eyeL'), (False, 'eyeR')]:
    m = side == s
    eyeP[m] += centroid(joints[j]) - eyeP[m].mean(axis=0)
eyeRel = eyeP - np.where(side[:, None], centroid(joints['eyeL']), centroid(joints['eyeR']))

# eye texture: RGB only (256 x 256); the stage recolours the iris inside the circles found here
rgba = np.asarray(Image.open(f'{MH}/eyes/materials/brown_eye.png').convert('RGBA')).astype(np.float64) / 255
im = Image.open(f'{MH}/eyes/materials/brown_eye.png').convert('RGB')
a = rgba[..., :3]
H, W = a.shape[:2]
dark = (a.max(axis=2) < 0.08) & (rgba[..., 3] > 0.5)
ys, xs = np.nonzero(dark)
irises = []
for c in (xs < ys, xs >= ys):
    cx, cy = xs[c].mean(), ys[c].mean()
    # radius of the iris: where the saturation ring ends along the four directions
    sat = (a.max(axis=2) - a.min(axis=2)) / np.maximum(a.max(axis=2), 1e-6)
    rs = []
    for dx, dy in [(1, 0), (-1, 0), (0, 1), (0, -1), (0.7, 0.7), (-0.7, 0.7), (0.7, -0.7), (-0.7, -0.7)]:
        r = 20
        while r < W / 4 and (sat[int(cy + dy * r), int(cx + dx * r)] > 0.3 or a[int(cy + dy * r), int(cx + dx * r)].max() < 0.5):
            r += 1
        rs.append(r)
    pr = 1
    while a[int(cy), int(cx + pr)].max() < 0.12: pr += 1
    irises.append([round(cx / W, 4), round(1 - cy / H, 4), round(float(np.median(rs)) / W, 4), round(pr / W, 4)])
im.resize((256, 256), Image.LANCZOS).save(f'{OUT}/eye.png', optimize=True)



def ambient_occlusion(P, T, voxel=0.03, reach=1.2, rays=48):
    """Per vertex 0-255 (255 open): how much of the sky each point of the body sees, on the rest
    pose. Darkens eye sockets, the nostrils, behind the ears, under the jaw, armpits and the fingers,
    which the stage multiplies into the skin (no run-time cost)."""
    used = np.unique(T)
    # vertex normals
    n = np.zeros_like(P)
    a, b, c = P[T[:, 0]], P[T[:, 1]], P[T[:, 2]]
    fn = np.cross(b - a, c - a)
    for k in range(3):
        np.add.at(n, T[:, k], fn)
    n /= np.maximum(np.linalg.norm(n, axis=1, keepdims=True), 1e-12)
    # the surface as voxels (triangles sampled finely enough to leave no gaps)
    lo = P[used].min(axis=0) - reach - voxel
    dims = np.ceil((P[used].max(axis=0) + reach + voxel - lo) / voxel).astype(int) + 1
    grid = np.zeros(dims, dtype=bool)
    edge = np.maximum(np.linalg.norm(b - a, axis=1), np.linalg.norm(c - a, axis=1))
    steps = np.clip(np.ceil(edge / (voxel * 0.5)).astype(int), 1, 64)
    for s in np.unique(steps):
        sel = steps == s
        uu, vv = np.meshgrid(np.arange(s + 1), np.arange(s + 1))
        keep = uu + vv <= s
        uu, vv = uu[keep] / s, vv[keep] / s
        pts = a[sel, None] + uu[None, :, None] * (b[sel] - a[sel])[:, None] + vv[None, :, None] * (c[sel] - a[sel])[:, None]
        ijk = np.floor((pts.reshape(-1, 3) - lo) / voxel).astype(int)
        grid[ijk[:, 0], ijk[:, 1], ijk[:, 2]] = True
    # cosine-weighted directions (a fixed spiral), turned into each vertex's hemisphere
    k = np.arange(rays) + 0.5
    r = np.sqrt(k / rays); th = k * np.pi * (3 - np.sqrt(5))
    local = np.stack([r * np.cos(th), r * np.sin(th), np.sqrt(1 - r * r)], axis=1)
    out = np.full(len(P), 255, dtype=np.uint8)
    V = P[used]; N_ = n[used]
    t1 = np.cross(N_, np.where(np.abs(N_[:, :1]) < 0.9, [[1.0, 0, 0]], [[0, 1.0, 0]]))
    t1 /= np.linalg.norm(t1, axis=1, keepdims=True)
    t2 = np.cross(N_, t1)
    dists = np.arange(3, int(reach / voxel)) * voxel
    occ = np.zeros(len(V))
    for d in local:
        dirs = t1 * d[0] + t2 * d[1] + N_ * d[2]
        hit = np.zeros(len(V)); blocked = np.zeros(len(V), dtype=bool)
        for t in dists:
            q = np.floor((V + N_ * voxel * 1.5 + dirs * t - lo) / voxel).astype(int)
            h = grid[q[:, 0], q[:, 1], q[:, 2]] & ~blocked
            hit[h] = 1 - (t / reach) ** 2      # near walls count more than far ones
            blocked |= h
        occ += hit
    out[used] = np.clip(255 * (1 - occ / rays), 0, 255).astype(np.uint8)
    return out


chunks, header = [], {}
off = 0


def put(name, arr, dtype):
    global off
    a = np.ascontiguousarray(arr, dtype=dtype)
    b = a.tobytes()
    pad = (-len(b)) % 4
    header[name] = {'offset': off, 'length': a.size, 'type': np.dtype(dtype).name}
    chunks.append(b + b'\0' * pad); off += len(b) + pad


put('base', base.ravel(), np.float32)
put('index', tris.ravel(), np.uint32)
mlist = []
for name, d in morphs.items():
    nz = np.nonzero(np.abs(d).sum(axis=1) > 1e-6)[0]
    put(f'm:{name}:i', nz, np.uint32)
    put(f'm:{name}:d', d[nz].ravel(), np.float32)
    mlist.append(name)
put('region', region, np.uint8)
put('ao', ambient_occlusion(base, tris), np.uint8)
for nm, arr in [('armL', armL), ('armR', armR), ('legL', legL), ('legR', legR)]:
    put(nm, np.clip(arr, 0, 1) * 255, np.uint8)
put('eyeRel', eyeRel.ravel(), np.float32)
put('eyeUV', eyeUV.ravel(), np.float32)
put('eyeSide', side.astype(np.uint8), np.uint8)
header['morphs'] = mlist
header['joints'] = joints
header['vertexCount'] = N
header['irises'] = irises  # [u, v, iris radius, pupil radius] in eye.png UV
header['source'] = 'MakeHuman base mesh, targets, rig and eyes (CC0 1.0), see tools/build-avatar.py'
open(f'{OUT}/avatar.bin', 'wb').write(b''.join(chunks))
json.dump(header, open(f'{OUT}/avatar.json', 'w'), separators=(',', ':'))
print('vertices', N, 'triangles', len(tris), 'bytes', off, 'morphs', mlist)
