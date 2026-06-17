import json, numpy as np
import matplotlib.cm as cm
import matplotlib.colors as mcolors

# curated list: perceptual + colorblind-safe + classic + diverging
NAMES = [
    # perceptually uniform / colorblind-friendly
    "viridis","plasma","inferno","magma","cividis","turbo",
    # classic sequential
    "jet","hot","cool","gray","bone","copper","hsv","rainbow",
    "spring","summer","autumn","winter",
    # diverging (good for stats: neg/pos)
    "coolwarm","RdBu_r","RdYlBu_r","seismic","bwr","Spectral_r","PiYG","BrBG",
]
N=64
out={}
for nm in NAMES:
    try:
        m=cm.get_cmap(nm)
    except Exception:
        continue
    pts=[[round(float(c),4) for c in m(i/(N-1))[:3]] for i in range(N)]
    out[nm.replace("_r","_rev")]=pts

# ACTC (AFNI / brainSurfer) — blue->cyan->green->yellow->red, manual anchors
def lut(anchors, n=64):
    xs=np.linspace(0,1,len(anchors)); g=np.linspace(0,1,n)
    a=np.array(anchors)
    return [[round(float(np.interp(t,xs,a[:,k])),4) for k in range(3)] for t in g]
out["actc"]=lut([[0,0,0.55],[0,0.6,1],[0,1,0.6],[0.6,1,0],[1,1,0],[1,0.4,0],[0.8,0,0]])
# "Cool-to-warm" simple
out["fire"]=lut([[0,0,0],[0.5,0,0],[1,0.4,0],[1,1,0],[1,1,1]])

with open("colormaps.js","w") as fh:
    fh.write("window.JHU_CMAPS=")
    json.dump(out, fh)
    fh.write(";\n")
print("wrote colormaps.js with", len(out), "maps:", ", ".join(sorted(out)))
