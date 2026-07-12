% CAT12 native segmentation for one T1 (teacher labels: p0 = brain + CSF/GM/WM). Headless.
% Run: CAT_INPUT=/abs/T1.nii matlab -nodisplay -batch "run('/abs/cat12_seg.m')"
input = getenv('CAT_INPUT');
try
  restoredefaultpath;                                       % clear startup.m path pollution
  addpath('/Users/super/Documents/Neuro/spm12');
  addpath('/Users/super/Documents/Neuro/spm12/toolbox/cat12');   % ensure CAT12 cfg registers
  spm('defaults','fmri'); spm_get_defaults('cmdline', true); spm_jobman('initcfg');
  clear matlabbatch;
  % MINIMAL batch: only set data + skip surfaces; spm_jobman fills the rest from the INSTALLED
  % cat.estwrite cfg defaults (avoids version-mismatched fields in the standalone template).
  matlabbatch{1}.spm.tools.cat.estwrite.data = {[input ',1']};
  matlabbatch{1}.spm.tools.cat.estwrite.nproc = 0;
  matlabbatch{1}.spm.tools.cat.estwrite.output.surface = 0;
  spm_jobman('run', matlabbatch);
  fprintf('CAT12_DONE\n');
catch err
  fprintf(2, 'CAT12_ERROR:\n%s\n', getReport(err, 'extended', 'hyperlinks', 'off'));
end
