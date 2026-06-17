import os, re, json, glob
B="bundles"
NAMES={'jhu':'JHU (189)','aal':'AAL (116)','bro':'Brodmann (82)','aicha':'AICHA (384)',
 'catani':'Catani (27)','fox':'Fox (10)','ho':'Harvard-Oxford (117)','arterial':'Arterial territories (32)',
 'xtract':'XTRACT tracts (42)','aalcat':'AAL-cat (150)','neuromorph':'Neuromorphometrics (134)',
 'hammers':'Hammers (95)','lpba40':'LPBA40 (56)','cobra':'COBRA (52)','anatomy3':'Anatomy v3 (186)','aal3':'AAL3 (163)'}
reg=[]
for d in sorted(glob.glob(B+"/*/")):
    idd=os.path.basename(d.rstrip("/"))
    data=os.path.join(d,"data.js")
    if not os.path.exists(data): continue
    txt=open(data).read()
    arr=txt.split("ATLAS_GLB_B64")[0]
    m=re.search(r"=\s*(\[.*\])\s*;", arr, re.S)
    nroi=len(json.loads(m.group(1))) if m else 0
    name=NAMES.get(idd, idd.upper()+f" ({nroi})")
    # keep declared count in name accurate
    name=re.sub(r"\(\d+\)$", f"({nroi})", name) if "(" in name else f"{name} ({nroi})"
    dti=rs=False
    if os.path.exists(d+"conn.js"):
        ct=open(d+"conn.js").read(); dti='"dti"' in ct; rs='"rs"' in ct
    reg.append({"id":idd,"name":name,"nroi":nroi,
                "has":{"dti":dti,"rs":rs,"neuro":os.path.exists(d+"neuro.js")}})
reg.sort(key=lambda r:r["name"])
open(B+"/registry.js","w").write("window.ATLAS_REGISTRY = "+json.dumps(reg)+";\n")
print(f"{len(reg)} atlases:")
for r in reg: print(f"  {r['id']:11s} {r['name']:26s} dti={r['has']['dti']} rs={r['has']['rs']} neuro={r['has']['neuro']}")
