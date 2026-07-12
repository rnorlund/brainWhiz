"""Compact 3D U-Net for binary brain extraction. Small enough to train on Apple MPS and to ship as
a lightweight ONNX model that runs in-browser via onnxruntime-web. Original implementation."""
import torch, torch.nn as nn

class ConvBlock(nn.Module):
    def __init__(self, ci, co):
        super().__init__()
        self.net = nn.Sequential(
            nn.Conv3d(ci, co, 3, padding=1, bias=False), nn.InstanceNorm3d(co, affine=True), nn.LeakyReLU(0.1, True),
            nn.Conv3d(co, co, 3, padding=1, bias=False), nn.InstanceNorm3d(co, affine=True), nn.LeakyReLU(0.1, True))
    def forward(self, x): return self.net(x)

class Up(nn.Module):
    """2x nearest upsample via repeat_interleave (MPS-native — avoids ConvTranspose3d) + conv."""
    def __init__(self, ci, co):
        super().__init__(); self.conv = nn.Conv3d(ci, co, 3, padding=1)
    def forward(self, x):
        x = x.repeat_interleave(2, 2).repeat_interleave(2, 3).repeat_interleave(2, 4)
        return self.conv(x)

class UNet3D(nn.Module):
    """Downsamples with stride-2 convs (not MaxPool3d) so it runs natively on Apple MPS."""
    def __init__(self, base=16, depth=4, ch_in=1):
        super().__init__()
        self.depth = depth
        chs = [base * (2 ** i) for i in range(depth)]         # e.g. 16,32,64,128
        self.enc = nn.ModuleList(); self.down = nn.ModuleList(); prev = ch_in
        for c in chs:
            self.enc.append(ConvBlock(prev, c))
            self.down.append(nn.Conv3d(c, c, 2, stride=2))    # MPS-native downsample
            prev = c
        self.bott = ConvBlock(chs[-1], chs[-1] * 2)
        self.up = nn.ModuleList(); self.dec = nn.ModuleList(); prev = chs[-1] * 2
        for c in reversed(chs):
            self.up.append(Up(prev, c))
            self.dec.append(ConvBlock(c * 2, c)); prev = c
        self.head = nn.Conv3d(chs[0], 1, 1)
    def forward(self, x):
        skips = []
        for i, e in enumerate(self.enc):
            x = e(x); skips.append(x); x = self.down[i](x)
        x = self.bott(x)
        for i in range(self.depth):
            x = self.up[i](x); s = skips[-1 - i]
            if x.shape[2:] != s.shape[2:]:                     # pad if odd-size mismatch
                d = [s.shape[2 + k] - x.shape[2 + k] for k in range(3)]
                x = nn.functional.pad(x, [0, max(0, d[2]), 0, max(0, d[1]), 0, max(0, d[0])])
                x = x[:, :, :s.shape[2], :s.shape[3], :s.shape[4]]
            x = self.dec[i](torch.cat([x, s], 1))
        return self.head(x)     # logits

if __name__ == '__main__':
    m = UNet3D(); n = sum(p.numel() for p in m.parameters())
    y = m(torch.randn(1, 1, 96, 112, 96)); print('params', f'{n/1e6:.2f}M', 'out', tuple(y.shape))
