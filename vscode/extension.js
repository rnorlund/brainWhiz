// brainWhiz NIfTI viewer — VS Code extension host. Registers a custom editor for .nii/.nii.gz that opens
// the file in a webview: ortho slices + a 3D Surface-Nets render (with a movable axial cut) + a header
// panel. Also a command "Open Full brainWhiz Viewer" that hosts the complete web app in a tab (served
// from the local repo if present in the workspace, else the live site). Self-contained; no network for
// the file viewer itself (own NIfTI parse + Three.js vendored locally) — works over SSH/WSL/containers.
const vscode = require('vscode');
const http = require('http');
const fs = require('fs');
const path = require('path');

function activate(context){
  const provider = new NiiEditorProvider(context);
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider('brainwhiz.niiViewer', provider, {
      webviewOptions: { retainContextWhenHidden: true },
      supportsMultipleEditorsPerDocument: false,
    }),
    vscode.commands.registerCommand('brainwhiz.openFull', uri => openFull(context, uri)),
    { dispose: stopServer },
  );
}

class NiiEditorProvider {
  constructor(context){ this.context = context; }
  async openCustomDocument(uri){ return { uri, dispose(){} }; }

  async resolveCustomEditor(document, panel){
    const webview = panel.webview;
    const fileDir = vscode.Uri.joinPath(document.uri, '..');
    webview.options = {
      enableScripts: true,
      localResourceRoots: [ vscode.Uri.joinPath(this.context.extensionUri, 'media'), fileDir ],
    };
    webview.onDidReceiveMessage(m => {           // "Open full brainWhiz" button inside the viewer
      if (m && m.cmd === 'openFull') vscode.commands.executeCommand('brainwhiz.openFull', document.uri);
    });
    webview.html = this.getHtml(webview, document.uri);
  }

  getHtml(webview, fileUri){
    const media = p => webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', p));
    const fileWv = webview.asWebviewUri(fileUri);
    const name = fileUri.path.split('/').pop();
    const nonce = String(Date.now()) + String(Math.floor(Math.random()*1e9));
    const csp = [
      `default-src 'none'`,
      `img-src ${webview.cspSource} data: blob:`,
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `script-src ${webview.cspSource} 'nonce-${nonce}'`,
      `connect-src ${webview.cspSource}`,
      `worker-src ${webview.cspSource} blob:`,
    ].join('; ');
    return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="${media('viewer.css')}">
<title>${escapeHtml(name)}</title></head>
<body><div id="app">
  <div id="toolbar">
    <span id="brand"><img class="brandlogo" src="${media('brainwhiz_logo.png')}" alt="">brainWhiz</span>
    <span id="status">Loading…</span>
    <label>Colormap <select id="cmap">
      <option value="gray">gray</option><option value="gray-inv">gray-inv</option><option value="bone">bone</option>
      <option value="hot">hot</option><option value="viridis">viridis</option><option value="inferno">inferno</option>
      <option value="magma">magma</option><option value="plasma">plasma</option><option value="turbo">turbo</option>
      <option value="jet">jet</option><option value="cividis">cividis</option></select></label>
    <label>Window <input id="winr" type="range" min="1" max="100" value="50"></label>
    <label>Level <input id="levr" type="range" min="0" max="100" value="50"></label>
    <span id="framewrap" style="display:none">Frame <input id="frame" type="range" min="0" value="0"><span id="frameV">0</span></span>
    <button id="xhairBtn" class="active" title="Toggle crosshair">✛</button>
    <button id="ovBtn" title="Overlay a second .nii (e.g. a stat map) on the slices">+ Overlay</button>
    <input id="ovFile" type="file" accept=".nii,.nii.gz,.gz" style="display:none">
    <span id="ovGroup" style="display:none">
      <label>Map <select id="ovCmap"><option value="hot">hot</option><option value="viridis">viridis</option><option value="inferno">inferno</option><option value="plasma">plasma</option><option value="turbo">turbo</option><option value="jet">jet</option></select></label>
      <label>Thr <input id="ovThr" type="range" min="0" max="100" value="20"></label>
      <label>α <input id="ovOp" type="range" min="10" max="100" value="80"></label>
      <button id="ovClear" title="Remove overlay">✕</button>
    </span>
    <span style="flex:1"></span>
    <button id="openFull" title="Open the full brainWhiz app (atlases, connectivity, explode) in a tab">brainWhiz ↗</button>
    <button id="hdrBtn" title="Show the NIfTI header details">Header</button>
  </div>
  <div id="grid">
    <div class="cell"><span class="celllabel">Axial</span><canvas id="cv_axi"></canvas><input id="sl_axi" type="range" min="0" value="0"></div>
    <div class="cell"><span class="celllabel">Coronal</span><canvas id="cv_cor"></canvas><input id="sl_cor" type="range" min="0" value="0"></div>
    <div class="cell"><span class="celllabel">Sagittal</span><canvas id="cv_sag"></canvas><input id="sl_sag" type="range" min="0" value="0"></div>
    <div class="cell" id="view3d"><span class="celllabel">3D surface</span>
      <div id="v3dctl">
        <span class="v3dl" title="Isosurface level — peel skin → skull → brain">Level</span>
        <input id="thr3d" type="range" min="1" max="90" value="12">
        <button id="wire3d" title="Wireframe">Wire</button>
        <button id="spin3d" title="Auto-rotate">Spin</button>
        <button id="cut3d" title="Cut into the head with the axial slice — shows the brain inside">Cut</button>
        <input id="cutlev3d" type="range" min="0" value="0" title="Axial cut level">
        <button id="face3d" title="Face-forward view">Face</button>
      </div>
    </div>
  </div>
  <div id="readout"></div>
  <div id="hdrpanel">
    <div class="hdrhead"><b>NIfTI header</b><button id="hdrCopy">Copy</button><button id="hdrClose">✕</button></div>
    <div id="hdrbody" class="hgrid"></div>
  </div>
</div>
<script nonce="${nonce}">window.NII = { uri: "${fileWv}", name: ${JSON.stringify(name)} };</script>
<script type="module" nonce="${nonce}" src="${media('viewer.js')}"></script>
</body></html>`;
  }
}

// ---------- Open Full brainWhiz Viewer ----------
let server, serverPort, serverRoot;
const userFiles = {};                 // basename -> absolute path of the .nii the user opened (served at /__user/…)
const LIVE = 'https://rnorlund.github.io/brainWhiz/';

function findAppRoot(){                            // a workspace folder that IS the brainWhiz repo
  for (const f of (vscode.workspace.workspaceFolders || [])){
    const r = f.uri.fsPath;
    if (fs.existsSync(path.join(r,'index.html')) && fs.existsSync(path.join(r,'bundles','registry.js'))) return r;
  }
  return null;
}
const CTYPE = { '.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.json':'application/json',
  '.css':'text/css','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.svg':'image/svg+xml',
  '.glb':'model/gltf-binary','.wasm':'application/wasm','.nii':'application/octet-stream','.gz':'application/gzip',
  '.map':'application/json','.txt':'text/plain','.ico':'image/x-icon' };
function ctype(fp){ return CTYPE[path.extname(fp).toLowerCase()] || 'application/octet-stream'; }
function ensureServer(root){
  if (server && serverRoot === root) return Promise.resolve(serverPort);
  return new Promise((resolve, reject) => {
    if (server) server.close();
    serverRoot = root;
    const send = (res, fp) => fs.readFile(fp, (err, buf) => {
      if (err) { res.writeHead(404); return res.end('not found'); }
      res.writeHead(200, { 'Content-Type': ctype(fp), 'Access-Control-Allow-Origin': '*' }); res.end(buf);
    });
    server = http.createServer((req, res) => {
      try{
        let p = decodeURIComponent((req.url || '/').split('?')[0]);
        if (p.startsWith('/__user/')){                     // the .nii the user opened, served for the full app
          const up = userFiles[p.slice('/__user/'.length)];
          if (up && fs.existsSync(up)) return send(res, up);
          res.writeHead(404); return res.end('not found');
        }
        if (p === '/' || p === '') p = '/index.html';
        const fp = path.normalize(path.join(root, p));
        if (!fp.startsWith(root)) { res.writeHead(403); return res.end('forbidden'); }
        send(res, fp);
      }catch(e){ res.writeHead(500); res.end('error'); }
    });
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => { serverPort = server.address().port; resolve(serverPort); });
  });
}
function stopServer(){ if (server) { try{ server.close(); }catch(e){} server = null; serverRoot = null; } }

async function openFull(context, fileUri){
  const root = findAppRoot();
  const q = 'mode=slice&slim=1';    // start in Slices (3 ortho + render), sidebars collapsed (reopen via ☰ / 🎨)
  let url;
  if (root){
    const port = await ensureServer(root);
    let extra = '';
    if (fileUri){                    // load the image the user had open as the underlay (shows in the slices)
      const name = fileUri.path.split('/').pop() || 'image.nii';
      userFiles[name] = fileUri.fsPath;
      extra = `&underlay=${encodeURIComponent('/__user/' + encodeURIComponent(name))}`;
    }
    url = `http://127.0.0.1:${port}/index.html?atlas=jhu&${q}${extra}`;
  }
  else { url = `${LIVE}?${q}`; }
  const ext = await vscode.env.asExternalUri(vscode.Uri.parse(url));   // forwards the port on remote/Codespaces
  const finalUrl = ext.toString();
  let origin; try { origin = new URL(finalUrl).origin; } catch { origin = LIVE; }

  const panel = vscode.window.createWebviewPanel('brainwhiz.full', 'brainWhiz — full viewer',
    vscode.ViewColumn.Active, { enableScripts: true, retainContextWhenHidden: true });
  const csp = `default-src 'none'; frame-src ${origin} https:; style-src 'unsafe-inline';`;
  panel.webview.html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<style>html,body{margin:0;padding:0;height:100vh;background:#0b0e13;overflow:hidden}
iframe{border:0;width:100%;height:100vh;display:block}</style></head>
<body><iframe src="${finalUrl}" allow="fullscreen; clipboard-write" referrerpolicy="no-referrer"></iframe></body></html>`;
  if (!root) vscode.window.showInformationMessage(
    'Opened the live brainWhiz. Drag a .nii onto it to load your own data (browser security prevents auto-loading a local file).');
}

function escapeHtml(s){ return String(s).replace(/[&<>"]/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
function deactivate(){ stopServer(); }
module.exports = { activate, deactivate };
