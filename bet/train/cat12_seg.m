% CAT12 native segmentation for one T1 (teacher labels: p0 = brain + CSF/GM/WM). Headless.
% Run: CAT_INPUT=/abs/T1.nii matlab -batch "run('/abs/cat12_seg.m')"
input = getenv('CAT_INPUT');
addpath('/Users/super/Documents/Neuro/spm12');
addpath('/Users/super/Downloads/cat12');
spm('defaults','fmri'); spm_jobman('initcfg');
run('/Users/super/Downloads/cat12/standalone/cat_standalone_segment.m');   % defines matlabbatch (defaults)
matlabbatch{1}.spm.tools.cat.estwrite.data = {[input ',1']};
try matlabbatch{1}.spm.tools.cat.estwrite.nproc = 0; catch, end
try matlabbatch{1}.spm.tools.cat.estwrite.output.surface = 0; catch, end   % skip surfaces (much faster)
try matlabbatch{1}.spm.tools.cat.estwrite.output.label.native = 1; catch, end   % p0 native label map
spm_jobman('run', matlabbatch);
fprintf('CAT12_DONE\n');
