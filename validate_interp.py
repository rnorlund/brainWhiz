"""Validate interpolation: predict JHU connectivity from AICHA (donor != target),
compare to JHU's measured DTI & RS connectomes."""
import numpy as np, nibabel as nib
from scipy.stats import pearsonr, spearmanr
from interpolate_conn import load_conn_js, dense_from_edges, overlap_weights, project

AICHA_NII='/Users/super/Documents/NiiStat/roi/AICHA.nii'
JHU_NII='/Users/super/Documents/LR_LSM_explorationForJulius/jhu.nii'
avol=np.squeeze(np.asarray(nib.load(AICHA_NII).dataobj)).astype(int); aaff=nib.load(AICHA_NII).affine
jvol=np.squeeze(np.asarray(nib.load(JHU_NII).dataobj)).astype(int); jaff=nib.load(JHU_NII).affine
jlabels=[int(x) for x in np.unique(jvol) if x>0]
W=overlap_weights(jvol,jaff,avol,aaff,jlabels)   # JHU x AICHA overlap

for kind in ['dti','rs']:
    A=load_conn_js('bundles/aicha/conn.js')[kind]      # real AICHA
    Ca=dense_from_edges(A,int(avol.max()))
    P=project(W,Ca)                                     # interpolated JHU (0..1)
    J=load_conn_js('bundles/jhu/conn.js')[kind]         # real JHU (ground truth)
    Cj=dense_from_edges(J,len(jlabels))
    iu=np.triu_indices(len(jlabels),1)
    pred, real = P[iu], Cj[iu]
    msk = real>0                                        # pairs with a measured JHU edge
    pr_all=pearsonr(pred,real)[0]; sp_all=spearmanr(pred,real)[0]
    pr_e=pearsonr(pred[msk],real[msk])[0]; sp_e=spearmanr(pred[msk],real[msk])[0]
    # presence: does a strong interpolated value predict a real edge exists?
    from sklearn.metrics import roc_auc_score
    try: auc=roc_auc_score((real>np.percentile(real[msk],50)).astype(int), pred)
    except Exception: auc=float('nan')
    print(f"{kind.upper()}:  edges real={int(msk.sum())}  "
          f"Pearson(all)={pr_all:.2f} Spearman(all)={sp_all:.2f} | "
          f"on measured edges Pearson={pr_e:.2f} Spearman={sp_e:.2f} | AUC(presence)={auc:.2f}")
