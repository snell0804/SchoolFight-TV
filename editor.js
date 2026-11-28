/* SchoolFight-TV 角色 / 素材編輯器（GitHub Pages 純前端 + 本機後端雙模式）
 * - 在 GitHub Pages 開啟時自動使用 GitHub REST API 直接讀寫（Token 僅存於瀏覽器 localStorage，與遊戲本體共用設定鍵）。
 * - 若由 tools/github_sync.js 提供服務，會自動偵測並啟用本機後端（含 AI Stable Diffusion 生成）。
 */
(function () {
  const { createApp, reactive, ref, computed, watch, nextTick, onMounted, onBeforeUnmount } = Vue;
  const CP = window.ConditionParser;

  const CFG_KEY = 'schoolfight_cloud_sync_cfg_v1';
  const MANIFEST_PATH = 'cloud_manifest.json';
  const ID_RE = /^[A-Za-z0-9_]{1,40}$/;

  const TRIGGER_LABELS = {
    on_idle: '待機時', on_move: '移動時', on_attack: '攻擊時', on_hurt: '受傷時',
    on_ko: '被打倒時', on_low_hp: '低血量時', on_spawn: '出場時', custom: '自訂（僅條件）',
  };
  const ITEM_EFFECTS = [
    { v: 'heal', t: '❤️ 回血' }, { v: 'power', t: '⚡ 能量' }, { v: 'score', t: '⭐ 分數' },
    { v: 'shield', t: '🛡️ 護盾' }, { v: 'speed', t: '👟 加速' },
  ];

  // ---------------- Local Game Save DB (shared with game.js CustomSpriteDB) ----------------
  const LocalGameDB = {
    dbName: 'SchoolFightCustomSpritesDB_v1',
    storeName: 'sheets',
    open() {
      return new Promise((resolve, reject) => {
        if (typeof indexedDB === 'undefined') return reject(new Error('此瀏覽器不支援 IndexedDB'));
        const req = indexedDB.open(this.dbName, 1);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(this.storeName)) {
            db.createObjectStore(this.storeName, { keyPath: 'sheetKey' });
          }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    },
    async putSheet(sheetKey, record) {
      const db = await this.open();
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(this.storeName, 'readwrite');
        tx.objectStore(this.storeName).put({ sheetKey, ...record });
        tx.oncomplete = () => { db.close(); resolve(true); };
        tx.onerror = () => { db.close(); reject(tx.error); };
      });
    },
    async deleteSheet(sheetKey) {
      const db = await this.open();
      return await new Promise((resolve) => {
        const tx = db.transaction(this.storeName, 'readwrite');
        tx.objectStore(this.storeName).delete(sheetKey);
        tx.oncomplete = () => { db.close(); resolve(true); };
        tx.onerror = () => { db.close(); resolve(false); };
      });
    },
    async getAllSheets() {
      try {
        const db = await this.open();
        return await new Promise((resolve) => {
          const tx = db.transaction(this.storeName, 'readonly');
          const req = tx.objectStore(this.storeName).getAll();
          req.onsuccess = () => { db.close(); resolve(req.result || []); };
          req.onerror = () => { db.close(); resolve([]); };
        });
      } catch { return []; }
    },
  };

  /** Remove solid near-white background via per-cell border flood fill (only if corners are opaque white). */
  function stripWhiteBgCanvas(canvas, cols = 1, rows = 1) {
    const w = canvas.width;
    const h = canvas.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const imgData = ctx.getImageData(0, 0, w, h);
    const d = imgData.data;
    const isNearWhite = (idx) => {
      const r = d[idx], g = d[idx + 1], b = d[idx + 2], a = d[idx + 3];
      if (a < 200) return false;
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      return r >= 230 && g >= 230 && b >= 230 && (mx - mn) <= 24;
    };
    const corners = [0, (w - 1) * 4, ((h - 1) * w) * 4, ((h - 1) * w + (w - 1)) * 4];
    const whiteCorners = corners.filter(isNearWhite).length;
    if (whiteCorners < 2) return canvas;

    const visited = new Uint8Array(w * h);
    const queue = new Int32Array(w * h);
    const cw = Math.max(1, Math.floor(w / Math.max(1, cols)));
    const ch = Math.max(1, Math.floor(h / Math.max(1, rows)));

    for (let rIdx = 0; rIdx < Math.max(1, rows); rIdx++) {
      const y0 = Math.floor((rIdx * h) / Math.max(1, rows));
      const y1 = Math.min(h - 1, Math.floor(((rIdx + 1) * h) / Math.max(1, rows)) - 1);
      for (let cIdx = 0; cIdx < Math.max(1, cols); cIdx++) {
        const x0 = Math.floor((cIdx * w) / Math.max(1, cols));
        const x1 = Math.min(w - 1, Math.floor(((cIdx + 1) * w) / Math.max(1, cols)) - 1);
        let head = 0, tail = 0;
        const push = (x, y) => {
          const p = y * w + x;
          if (visited[p]) return;
          if (!isNearWhite(p * 4)) return;
          visited[p] = 1;
          queue[tail++] = p;
        };
        for (let x = x0; x <= x1; x++) { push(x, y0); push(x, y1); }
        for (let y = y0; y <= y1; y++) { push(x0, y); push(x1, y); }
        while (head < tail) {
          const p = queue[head++];
          d[p * 4 + 3] = 0;
          const x = p % w;
          const y = (p - x) / w;
          if (x > x0) push(x - 1, y);
          if (x < x1) push(x + 1, y);
          if (y > y0) push(x, y - 1);
          if (y < y1) push(x, y + 1);
        }
      }
    }
    ctx.putImageData(imgData, 0, 0);
    return canvas;
  }

  const WIDE_CELL_W = 256;
  const WIDE_CELL_H = 256;
  const WIDE_ANCHOR_X = 128;
  const WIDE_ANCHOR_Y = 228;
  const GRID_PRESETS = [
    { label: '5×2（10 幀 · 1280×512）', cols: 5, rows: 2, frames: 10 },
    { label: '5×4（20 幀 · 1280×1024）', cols: 5, rows: 4, frames: 20 },
    { label: '5×6（30 幀 · 1280×1536）', cols: 5, rows: 6, frames: 30 },
    { label: '8×5（40 幀 · 2048×1280）', cols: 8, rows: 5, frames: 40 },
  ];

  function padSheetToWideCells(srcCanvas, cols, rows, frames) {
    const total = Math.max(1, Math.min(cols * rows, Number(frames) || cols * rows));
    const sw = srcCanvas.width / cols;
    const sh = srcCanvas.height / rows;
    const out = document.createElement('canvas');
    out.width = cols * WIDE_CELL_W;
    out.height = rows * WIDE_CELL_H;
    const octx = out.getContext('2d');
    octx.imageSmoothingEnabled = true;
    octx.imageSmoothingQuality = 'high';

    // Scale uniformly so each cell fits cleanly inside fixed 256x256 logical grid with anchor (128, 228)
    const targetH = 196;
    const baseScale = Math.min(targetH / Math.max(1, sh), (WIDE_CELL_W - 16) / Math.max(1, sw), (WIDE_CELL_H - 28) / Math.max(1, sh));
    const dw = Math.round(sw * baseScale);
    const dh = Math.round(sh * baseScale);
    const ox = Math.round((WIDE_CELL_W - dw) / 2);
    const oy = Math.max(6, Math.min(WIDE_CELL_H - dh - 6, WIDE_ANCHOR_Y - dh));

    for (let i = 0; i < total; i++) {
      const cIdx = i % cols;
      const rIdx = Math.floor(i / cols);
      octx.drawImage(
        srcCanvas,
        cIdx * sw, rIdx * sh, sw, sh,
        cIdx * WIDE_CELL_W + ox, rIdx * WIDE_CELL_H + oy, dw, dh
      );
    }
    return out;
  }

  async function renderSpriteToCanvas(fileOrUrl, { cols = 5, rows = 2, frames = null, removeWhiteBg = false, padWideCell = false } = {}) {
    let bmp;
    if (fileOrUrl instanceof Blob) {
      bmp = await createImageBitmap(fileOrUrl);
    } else {
      const res = await fetch(fileOrUrl);
      if (!res.ok) throw new Error('無法讀取既有圖檔');
      bmp = await createImageBitmap(await res.blob());
    }
    const c = document.createElement('canvas');
    c.width = bmp.width;
    c.height = bmp.height;
    c.getContext('2d').drawImage(bmp, 0, 0);
    bmp.close();
    if (removeWhiteBg) stripWhiteBgCanvas(c, cols, rows);
    if (padWideCell && (c.width / cols !== WIDE_CELL_W || c.height / rows !== WIDE_CELL_H)) {
      return padSheetToWideCells(c, cols, rows, frames || cols * rows);
    }
    return c;
  }

  // ---------------- Config (shared with game.js CloudSyncManager) ----------------
  function loadGhConfig() {
    try {
      const c = JSON.parse(localStorage.getItem(CFG_KEY) || '{}');
      return { repo: c.repo || 'snell0804/SchoolFight-TV', branch: c.branch || 'main', token: c.token || '' };
    } catch { return { repo: 'snell0804/SchoolFight-TV', branch: 'main', token: '' }; }
  }
  function saveGhConfig(repo, branch, token) {
    try {
      const prev = JSON.parse(localStorage.getItem(CFG_KEY) || '{}');
      localStorage.setItem(CFG_KEY, JSON.stringify({ ...prev, repo, branch, token }));
    } catch { /* ignore */ }
  }

  // ---------------- Store ----------------
  const initCfg = loadGhConfig();
  const store = reactive({
    mode: 'detecting', // 'backend' | 'github'
    ghRepo: initCfg.repo,
    ghBranch: initCfg.branch,
    ghToken: initCfg.token,
    showSettings: false,
    status: null,
    manifest: { version: 1, characters: [], backgrounds: [], items: [] },
    localOverrides: {}, // sheetKey -> { dataUrl, cols, rows, frameCount, fps, updatedAt, ... }
    loading: false,
    busy: false,
    toasts: [],
    history: JSON.parse(localStorage.getItem('editorPrHistory') || '[]'),
    jobs: [],
  });

  async function loadLocalOverrides() {
    const all = await LocalGameDB.getAllSheets();
    const map = {};
    for (const rec of all) {
      if (rec && rec.sheetKey) map[rec.sheetKey] = rec;
    }
    store.localOverrides = map;
  }

  function toast(msg, kind = 'info') {
    const t = { id: Math.random(), msg, kind };
    store.toasts.push(t);
    setTimeout(() => { store.toasts = store.toasts.filter((x) => x !== t); }, kind === 'error' ? 8000 : 4500);
  }

  function recordResult(title, result) {
    if (result.pr) {
      store.history.unshift({ title, pr: result.pr, at: new Date().toISOString() });
      store.history = store.history.slice(0, 100);
      localStorage.setItem('editorPrHistory', JSON.stringify(store.history));
      toast(`已建立 PR：${title}`, 'success');
    } else if (result.dryRun) {
      toast(`（DRY RUN）已寫入本機：${title}`, 'success');
    }
  }

  function normalizeManifest(m) {
    const out = { version: 1, characters: [], backgrounds: [], items: [] };
    if (!m || typeof m !== 'object') return out;
    out.characters = (m.characters || []).map((c) => {
      if (Array.isArray(c.actions)) {
        return {
          id: c.id, name: c.name || c.id,
          ...(c.turnaround ? { turnaround: c.turnaround, turnaroundUpdatedAt: c.turnaroundUpdatedAt } : {}),
          actions: c.actions,
        };
      }
      return {
        id: c.id, name: c.name || c.id,
        actions: c.sheetKey ? [{
          id: 'attack', sheetKey: c.sheetKey, png: c.png, webp: c.webp, cols: 5, rows: 2, frames: 10, fps: 14,
          trigger: 'on_attack', condition: c.condition || '', priority: 0, updatedAt: c.createdAt,
        }] : [],
      };
    });
    out.backgrounds = Array.isArray(m.backgrounds) ? m.backgrounds : [];
    out.items = Array.isArray(m.items) ? m.items : [];
    return out;
  }

  function rawUrl(p, v, isBuiltin = false) {
    if (!p) return '';
    if (isBuiltin) return `./${p.replace(/^\.?\//, '')}`;
    if (store.mode === 'backend') return `/api/raw?path=${encodeURIComponent(p)}&v=${encodeURIComponent(v || '')}`;
    const q = v ? `?v=${encodeURIComponent(v)}` : '';
    return `https://raw.githubusercontent.com/${store.ghRepo}/${store.ghBranch}/${p}${q}`;
  }

  /** Merge built-in GameCatalog entries with cloud_manifest.json and local IndexedDB overrides. */
  function getMergedCharacters() {
    const builtin = (window.GameCatalog && window.GameCatalog.characters) || [];
    const customMap = new Map((store.manifest.characters || []).map((c) => [c.id, c]));
    const localMap = store.localOverrides || {};
    const applyLocal = (a) => {
      const key = a.sheetKey || a.id;
      const ov = localMap[key];
      if (!ov) return a;
      return {
        ...a,
        cols: ov.cols || a.cols,
        rows: ov.rows || a.rows,
        frames: ov.frameCount || a.frames,
        fps: typeof ov.fps === 'number' ? ov.fps : a.fps,
        label: ov.label || a.label,
        trigger: ov.trigger || a.trigger,
        condition: typeof ov.condition === 'string' ? ov.condition : a.condition,
        priority: typeof ov.priority === 'number' ? ov.priority : a.priority,
        loop: typeof ov.loop === 'boolean' ? ov.loop : a.loop,
        fx: ov.fx ? { ...defaultFxForAction(a.id), ...ov.fx } : (a.fx ? { ...defaultFxForAction(a.id), ...a.fx } : defaultFxForAction(a.id)),
        localSaved: true,
        localDataUrl: ov.dataUrl || null,
        localUpdatedAt: ov.updatedAt || null,
      };
    };
    const merged = builtin.map((bc) => {
      const cc = customMap.get(bc.id);
      if (!cc) {
        const actions = bc.actions.map(applyLocal);
        return { ...bc, actions, hasCustom: actions.some((a) => a.localSaved) };
      }
      customMap.delete(bc.id);
      const customActs = new Map((cc.actions || []).map((a) => [a.id, { ...a, builtin: false, customized: true }]));
      const actions = bc.actions.map((ba) => {
        if (customActs.has(ba.id)) {
          const ov = customActs.get(ba.id);
          customActs.delete(ba.id);
          return applyLocal(ov);
        }
        return applyLocal(ba);
      }).concat([...customActs.values()].map(applyLocal));
      return {
        ...bc,
        name: cc.name || bc.name,
        turnaround: cc.turnaround || bc.turnaround || null,
        turnaroundBuiltin: cc.turnaround ? false : !!bc.turnaroundBuiltin,
        turnaroundUpdatedAt: cc.turnaroundUpdatedAt || null,
        actions,
        hasCustom: true,
      };
    });
    for (const cc of customMap.values()) {
      merged.push({
        id: cc.id, name: cc.name || cc.id, role: 'custom', builtin: false, hasCustom: true,
        turnaround: cc.turnaround || null, turnaroundBuiltin: false, turnaroundUpdatedAt: cc.turnaroundUpdatedAt || null,
        actions: (cc.actions || []).map((a) => applyLocal({ ...a, builtin: false, customized: true })),
      });
    }
    return merged;
  }

  function getMergedSimple(section) {
    const builtin = (window.GameCatalog && window.GameCatalog[section]) || [];
    const customMap = new Map((store.manifest[section] || []).map((e) => [e.id, { ...e, builtin: false, customized: true }]));
    const merged = builtin.map((be) => {
      if (customMap.has(be.id)) {
        const ov = customMap.get(be.id);
        customMap.delete(be.id);
        return ov;
      }
      return be;
    });
    return merged.concat([...customMap.values()]);
  }

  // ---------------- Binary / Canvas helpers (for GitHub Direct Mode) ----------------
  function bytesToBase64(bytes) {
    let bin = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
    return btoa(bin);
  }
  function strToBase64(str) { return bytesToBase64(new TextEncoder().encode(str)); }
  function base64ToStr(b64) {
    const bin = atob(b64.replace(/\s+/g, ''));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  /** Read PNG/JPG/WebP file → { pngB64, webpB64, width, height } in the browser. */
  async function encodePngAndWebp(file) {
    const bmp = await createImageBitmap(file);
    const width = bmp.width;
    const height = bmp.height;
    const c = document.createElement('canvas');
    c.width = width; c.height = height;
    c.getContext('2d').drawImage(bmp, 0, 0);
    bmp.close();

    let pngB64;
    const rawBuf = new Uint8Array(await file.arrayBuffer());
    const isPng = rawBuf.length >= 24 && rawBuf[0] === 0x89 && rawBuf[1] === 0x50 && rawBuf[2] === 0x4e && rawBuf[3] === 0x47;
    if (isPng) {
      pngB64 = bytesToBase64(rawBuf);
    } else {
      const pngBlob = await new Promise((r) => c.toBlob(r, 'image/png'));
      pngB64 = bytesToBase64(new Uint8Array(await pngBlob.arrayBuffer()));
    }
    let webpB64 = null;
    try {
      const blob = await new Promise((r) => c.toBlob(r, 'image/webp', 0.94));
      if (blob && blob.type === 'image/webp') webpB64 = bytesToBase64(new Uint8Array(await blob.arrayBuffer()));
    } catch { /* browser without webp encoder; skip */ }
    return { pngB64, webpB64, width, height };
  }

  // ---------------- Backend API vs GitHub Direct API ----------------
  async function backendApi(path, opts = {}) {
    const res = await fetch(path, opts);
    let json;
    try { json = await res.json(); } catch { json = { success: false, error: `HTTP ${res.status}` }; }
    if (!res.ok || json.success === false) throw new Error(json.error || `HTTP ${res.status}`);
    return json;
  }

  async function ghApi(endpoint, opts = {}) {
    const headers = { Accept: 'application/vnd.github+json', ...(opts.headers || {}) };
    if (store.ghToken) headers.Authorization = `Bearer ${store.ghToken}`;
    const res = await fetch(`https://api.github.com/repos/${store.ghRepo}${endpoint}`, { ...opts, headers });
    if (res.status === 404 && opts.allow404) return null;
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || `GitHub HTTP ${res.status}`);
    return data;
  }

  async function ghCommitAndOpenPR(files, title) {
    if (!store.ghToken) {
      store.showSettings = true;
      throw new Error('請先點上方「🔑 GitHub Token」貼入 Personal Access Token 才能建立 PR（或改點綠色「💾 存檔（套用到遊戲）」直接本機存檔免 Token）');
    }
    const repoInfo = await ghApi('');
    const base = repoInfo.default_branch || store.ghBranch || 'main';
    const ref = await ghApi(`/git/ref/heads/${encodeURIComponent(base)}`);
    const baseSha = ref.object.sha;
    const baseCommit = await ghApi(`/git/commits/${baseSha}`);
    const tree = [];
    for (const f of files) {
      const blob = await ghApi('/git/blobs', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: f.b64, encoding: 'base64' }),
      });
      tree.push({ path: f.path, mode: '100644', type: 'blob', sha: blob.sha });
    }
    const newTree = await ghApi('/git/trees', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ base_tree: baseCommit.tree.sha, tree }),
    });
    const commit = await ghApi('/git/commits', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: title, tree: newTree.sha, parents: [baseSha] }),
    });
    const branch = `editor-sync-${Date.now()}`;
    await ghApi('/git/refs', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: commit.sha }),
    });
    const pr = await ghApi('/pulls', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, head: branch, base, body: `Automated PR from SchoolFight-TV Editor: ${title}` }),
    });
    return { pr: pr.html_url, branch };
  }

  async function detectAndLoad() {
    await loadLocalOverrides();
    try {
      const st = await backendApi('/api/status');
      store.mode = 'backend';
      store.status = st;
    } catch {
      store.mode = 'github';
      store.status = { repo: store.ghRepo, github: store.ghToken ? 'ok' : 'readonly' };
    }
    await loadManifest();
  }

  async function loadManifest() {
    store.loading = true;
    try {
      if (store.mode === 'backend') {
        store.manifest = normalizeManifest((await backendApi('/api/manifest')).manifest);
      } else {
        const res = await ghApi(`/contents/${MANIFEST_PATH}?ref=${encodeURIComponent(store.ghBranch)}`, { allow404: true });
        store.manifest = normalizeManifest(res && res.content ? JSON.parse(base64ToStr(res.content)) : null);
        store.status = { repo: store.ghRepo, github: store.ghToken ? 'ok' : 'readonly' };
      }
    } catch (e) {
      toast(`讀取 manifest 失敗：${e.message}`, 'error');
    } finally { store.loading = false; }
  }

  async function submitEntry(section, payload, file, title) {
    store.busy = true;
    try {
      let result;
      if (store.mode === 'backend') {
        const fd = new FormData();
        fd.append('section', section);
        fd.append('payload', JSON.stringify(payload));
        if (file) fd.append('file', file);
        result = await backendApi('/api/entry', { method: 'POST', body: fd });
      } else {
        // GitHub Direct Mode: reload latest manifest, upsert, convert PNG→WebP, open 1-commit PR
        const res = await ghApi(`/contents/${MANIFEST_PATH}?ref=${encodeURIComponent(store.ghBranch)}`, { allow404: true });
        const manifest = normalizeManifest(res && res.content ? JSON.parse(base64ToStr(res.content)) : null);
        const files = [];
        const now = new Date().toISOString();

        async function attach(baseName) {
          if (!file) return null;
          const enc = await encodePngAndWebp(file);
          const png = `assets/custom/${baseName}.png`;
          files.push({ path: png, b64: enc.pngB64 });
          let webp = null;
          if (enc.webpB64) { webp = `assets/custom/${baseName}.webp`; files.push({ path: webp, b64: enc.webpB64 }); }
          return { png, webp, width: enc.width, height: enc.height };
        }

        let prTitle;
        if (section === 'characters') {
          if (!ID_RE.test(payload.id || '')) throw new Error('角色 ID 只能用英數與底線');
          const a = payload.action || {};
          if (!ID_RE.test(a.id || '')) throw new Error('動作 ID 只能用英數與底線');
          const chk = CP.validateCondition(a.condition || '');
          if (!chk.ok) throw new Error(`條件式錯誤：${chk.error}`);
          let ch = manifest.characters.find((c) => c.id === payload.id);
          if (!ch) { ch = { id: payload.id, name: payload.name || payload.id, actions: [] }; manifest.characters.push(ch); }
          if (payload.name) ch.name = String(payload.name).slice(0, 60);
          const prev = ch.actions.find((x) => x.id === a.id);
          const asset = await attach(`char_${payload.id}_${a.id}`);
          const fallbackPng = prev?.png || a.png || null;
          const fallbackWebp = prev?.webp || a.webp || null;
          if (!asset && !fallbackPng) throw new Error('新動作需要上傳精靈表圖片');
          const cols = Math.max(1, Math.min(20, Number(a.cols) || prev?.cols || 5));
          const rows = Math.max(1, Math.min(20, Number(a.rows) || prev?.rows || 2));
          const next = {
            id: a.id, label: String(a.label || prev?.label || a.id).slice(0, 60),
            sheetKey: a.sheetKey || `custom_${payload.id}_${a.id}`,
            png: asset?.png || fallbackPng, webp: asset?.webp || fallbackWebp,
            cols, rows, frames: Math.max(1, Math.min(cols * rows, Number(a.frames) || cols * rows)),
            fps: Math.max(1, Math.min(60, Number(a.fps) || 12)), loop: !!a.loop,
            trigger: a.trigger || 'on_attack', condition: (a.condition || '').trim(),
            priority: Number(a.priority) || 0,
            ...(a.fx ? { fx: a.fx } : {}),
            updatedAt: now,
          };
          ch.actions = ch.actions.filter((x) => x.id !== a.id).concat(next);
          prTitle = `Editor: update character ${payload.id}/${a.id}`;
        } else {
          if (!ID_RE.test(payload.id || '')) throw new Error('ID 只能用英數與底線');
          const list = manifest[section];
          const prev = list.find((e) => e.id === payload.id);
          const asset = await attach(`${section === 'backgrounds' ? 'bg' : 'item'}_${payload.id}`);
          const fallbackPng = prev?.png || payload.png || null;
          const fallbackWebp = prev?.webp || payload.webp || null;
          if (!asset && !fallbackPng) throw new Error('新項目需要上傳圖片');
          const next = section === 'backgrounds'
            ? { id: payload.id, name: String(payload.name || prev?.name || payload.id).slice(0, 60),
                stage: Math.max(1, Number(payload.stage) || 1), parallax: Math.max(0, Math.min(2, Number(payload.parallax) ?? 1)),
                png: asset?.png || fallbackPng, webp: asset?.webp || fallbackWebp,
                width: asset?.width ?? prev?.width, height: asset?.height ?? prev?.height, updatedAt: now }
            : { id: payload.id, name: String(payload.name || prev?.name || payload.id).slice(0, 60),
                effect: payload.effect || 'heal', value: Math.max(0, Number(payload.value) || 0),
                png: asset?.png || fallbackPng, webp: asset?.webp || fallbackWebp, updatedAt: now };
          manifest[section] = list.filter((e) => e.id !== payload.id).concat(next);
          prTitle = `Editor: update ${section.slice(0, -1)} ${payload.id}`;
        }
        files.push({ path: MANIFEST_PATH, b64: strToBase64(JSON.stringify(manifest, null, 2) + '\n') });
        result = await ghCommitAndOpenPR(files, prTitle);
      }
      recordResult(title, result);
      await loadManifest();
      return true;
    } catch (e) {
      toast(e.message, 'error');
      return false;
    } finally { store.busy = false; }
  }

  async function deleteEntry(body, title) {
    if (!confirm(`確定要刪除？\n${title}\n（會建立一個移除 manifest 條目的 PR，圖檔保留）`)) return false;
    store.busy = true;
    try {
      let result;
      if (store.mode === 'backend') {
        result = await backendApi('/api/delete', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
        });
      } else {
        const res = await ghApi(`/contents/${MANIFEST_PATH}?ref=${encodeURIComponent(store.ghBranch)}`, { allow404: true });
        const manifest = normalizeManifest(res && res.content ? JSON.parse(base64ToStr(res.content)) : null);
        const { section, id, actionId } = body;
        let prTitle;
        if (section === 'characters' && actionId) {
          const ch = manifest.characters.find((c) => c.id === id);
          if (!ch) throw new Error('Character not found');
          ch.actions = ch.actions.filter((a) => a.id !== actionId);
          prTitle = `Editor: remove action ${id}/${actionId}`;
        } else {
          manifest[section] = manifest[section].filter((e) => e.id !== id);
          prTitle = `Editor: remove ${section.slice(0, -1)} ${id}`;
        }
        result = await ghCommitAndOpenPR([{ path: MANIFEST_PATH, b64: strToBase64(JSON.stringify(manifest, null, 2) + '\n') }], prTitle);
      }
      recordResult(title, result);
      await loadManifest();
      return true;
    } catch (e) { toast(e.message, 'error'); return false; } finally { store.busy = false; }
  }

  // ---------------- Components ----------------
  const SpritePreview = {
    props: { src: String, cols: { type: Number, default: 5 }, rows: { type: Number, default: 2 },
      frames: Number, fps: { type: Number, default: 12 }, size: { type: Number, default: 220 } },
    setup(props) {
      const canvas = ref(null);
      const playing = ref(true); // 預設自動連續播放，點暫停或逐幀按鈕即可切換為單幀檢視
      const frame = ref(0);
      const grid = ref(false);
      const info = ref('');
      const img = new Image();
      img.crossOrigin = 'anonymous';
      let raf = 0; let last = 0; let ok = false; let loadedSrc = '';
      const total = computed(() => Math.max(1, Math.min(props.frames || props.cols * props.rows, props.cols * props.rows)));
      const currentPos = computed(() => {
        const f = frame.value % total.value;
        const c = Math.max(1, Number(props.cols) || 1);
        return `第 ${Math.floor(f / c) + 1} 列・第 ${(f % c) + 1} 欄`;
      });

      function prevFrame() {
        playing.value = false;
        frame.value = (frame.value - 1 + total.value) % total.value;
      }
      function nextFrame() {
        playing.value = false;
        frame.value = (frame.value + 1) % total.value;
      }
      function goFrame(idx) {
        playing.value = false;
        frame.value = Math.max(0, Math.min(total.value - 1, idx));
      }
      function onKey(e) {
        if (e.key === 'ArrowLeft') { e.preventDefault(); prevFrame(); }
        else if (e.key === 'ArrowRight') { e.preventDefault(); nextFrame(); }
        else if (e.key === ' ') { e.preventDefault(); playing.value = !playing.value; }
      }

      function updateInfo() {
        if (!ok || !img.naturalWidth) return;
        const c = Math.max(1, Number(props.cols) || 1);
        const r = Math.max(1, Number(props.rows) || 1);
        info.value = `${img.naturalWidth}×${img.naturalHeight}px · 每格 ${(img.naturalWidth / c).toFixed(1)}×${(img.naturalHeight / r).toFixed(1)}`;
      }

      function draw() {
        const c = canvas.value; if (!c) return;
        const ctx = c.getContext('2d');
        ctx.clearRect(0, 0, c.width, c.height);
        if (!ok || !img.naturalWidth) return;
        const cols = Math.max(1, Number(props.cols) || 1);
        const rows = Math.max(1, Number(props.rows) || 1);
        const fw = img.naturalWidth / cols; const fh = img.naturalHeight / rows;
        const f = frame.value % total.value;
        const sx = (f % cols) * fw; const sy = Math.floor(f / cols) * fh;
        const scale = Math.min(c.width / fw, c.height / fh);
        const dw = fw * scale; const dh = fh * scale;
        ctx.imageSmoothingEnabled = scale < 1;
        ctx.drawImage(img, sx, sy, fw, fh, (c.width - dw) / 2, (c.height - dh) / 2, dw, dh);
        if (grid.value) {
          ctx.strokeStyle = 'rgba(239,68,68,.8)';
          ctx.strokeRect((c.width - dw) / 2 + 0.5, (c.height - dh) / 2 + 0.5, dw - 1, dh - 1);
        }
      }
      function loop(t) {
        raf = requestAnimationFrame(loop);
        if (playing.value && ok && t - last >= 1000 / Math.max(1, Number(props.fps) || 12)) {
          last = t; frame.value = (frame.value + 1) % total.value;
        }
        draw();
      }
      function load() {
        if (!props.src) { ok = false; loadedSrc = ''; info.value = ''; return; }
        if (props.src === loadedSrc && ok && img.complete && img.naturalWidth > 0) {
          frame.value = frame.value % total.value;
          updateInfo();
          draw();
          return;
        }
        ok = false; info.value = '';
        loadedSrc = props.src;
        img.onload = () => {
          ok = true; frame.value = 0;
          updateInfo();
          draw();
        };
        img.onerror = () => { ok = false; info.value = '無法載入圖片'; };
        img.src = props.src;
      }
      watch(() => props.src, load);
      watch(() => [props.cols, props.rows, props.frames], () => {
        if (ok && img.naturalWidth > 0) {
          frame.value = frame.value % total.value;
          updateInfo();
          draw();
        }
      });
      onMounted(() => { load(); raf = requestAnimationFrame(loop); });
      onBeforeUnmount(() => cancelAnimationFrame(raf));
      return { canvas, playing, frame, grid, info, total, currentPos, prevFrame, nextFrame, goFrame, onKey };
    },
    template: `
      <div class="space-y-2 outline-none" tabindex="0" @keydown="onKey">
        <canvas ref="canvas" :width="size" :height="size" class="checker rounded border pixel block mx-auto"></canvas>
        <div v-if="src" class="space-y-1.5">
          <div class="flex items-center justify-between gap-1.5 text-xs">
            <div class="flex items-center gap-1">
              <button @click="prevFrame" title="上一幀（鍵盤 ←）"
                class="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-white font-bold">◀</button>
              <button @click="playing=!playing" :title="playing ? '暫停播放（Space）' : '連續播放（Space）'"
                :class="['px-2.5 py-1 rounded font-semibold', playing ? 'bg-amber-500 hover:bg-amber-600 text-white' : 'bg-indigo-600 hover:bg-indigo-700 text-white']">
                {{ playing ? '⏸ 暫停' : '▶ 播放' }}
              </button>
              <button @click="nextFrame" title="下一幀（鍵盤 →）"
                class="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-white font-bold">▶</button>
            </div>
            <span class="font-semibold text-slate-700 tabular-nums">第 {{ frame + 1 }}/{{ total }} 幀</span>
            <label class="flex items-center gap-1 text-slate-600 cursor-pointer"><input type="checkbox" v-model="grid" />框</label>
          </div>
          <input type="range" min="0" :max="total-1" v-model.number="frame" @input="playing=false" class="w-full" />
          <div class="flex flex-wrap gap-1 justify-center">
            <button v-for="n in total" :key="n" @click="goFrame(n - 1)"
              :class="['min-w-[26px] px-1.5 py-0.5 rounded text-xs font-mono border transition',
                       frame === n - 1 ? 'bg-indigo-600 text-white border-indigo-600 font-bold' : 'bg-white hover:bg-indigo-50 text-slate-700 border-slate-300']">
              {{ n }}
            </button>
          </div>
          <p class="text-[11px] text-slate-500 text-center">{{ currentPos }} · 點數字或按鍵盤 ← / → 逐幀檢視</p>
        </div>
        <p v-if="info" class="text-xs text-slate-500 text-center">{{ info }}</p>
        <p v-if="!src" class="text-xs text-slate-400 text-center">尚無圖片</p>
      </div>`,
  };

  const DropZone = {
    props: { file: Object, hint: String },
    emits: ['update:file'],
    setup(props, { emit }) {
      const over = ref(false);
      const input = ref(null);
      function take(f) {
        if (!f) return;
        if (!/^image\/(png|jpeg|webp)$/.test(f.type)) { toast('只接受 PNG / JPG / WebP 圖片', 'error'); return; }
        if (f.size > 12 * 1024 * 1024) { toast('檔案超過 12MB', 'error'); return; }
        emit('update:file', f);
      }
      return { over, input, take };
    },
    template: `
      <div @click="input.click()" @dragover.prevent="over=true" @dragleave="over=false"
           @drop.prevent="over=false; take($event.dataTransfer.files[0])"
           :class="['border-2 border-dashed rounded p-4 text-center cursor-pointer text-sm transition',
                    over ? 'border-indigo-500 bg-indigo-50' : 'border-slate-300 hover:border-indigo-400']">
        <input ref="input" type="file" accept="image/png,image/jpeg,image/webp" class="hidden" @change="take($event.target.files[0]); $event.target.value=''" />
        <div v-if="file">📄 {{ file.name }} <span class="text-slate-400">({{ (file.size/1024).toFixed(0) }} KB)</span>
          <button class="ml-2 text-red-500" @click.stop="$emit('update:file', null)">✕</button></div>
        <div v-else class="text-slate-500">拖曳 PNG / JPG / WebP 到這裡，或點擊選擇<br><span class="text-xs">{{ hint }}</span></div>
      </div>`,
  };

  const ConditionEditor = {
    props: { modelValue: String },
    emits: ['update:modelValue', 'valid'],
    setup(props, { emit }) {
      const sample = reactive({ hp: 25, maxHp: 100, state: 'hurt', type: 'slime', attackStyle: 'melee', facing: 1, x: 400, z: 0, jumpY: 0, speedX: 0, speedZ: 0 });
      const check = computed(() => CP.validateCondition(props.modelValue || ''));
      const result = computed(() => (check.value.ok ? CP.evalCondition(props.modelValue || '', sample) : null));
      watch(check, (v) => emit('valid', v.ok), { immediate: true });
      const snippets = ["hp < maxHp * 0.3", "state === 'hurt'", "hp < 30 && state === 'hurt'", "facing === -1", "jumpY > 0"];
      function insert(s) {
        const cur = (props.modelValue || '').trim();
        emit('update:modelValue', cur ? `${cur} && ${s}` : s);
      }
      return { sample, check, result, snippets, insert, whitelist: CP.WHITELIST };
    },
    template: `
      <div class="space-y-2">
        <input :value="modelValue" @input="$emit('update:modelValue', $event.target.value)"
               placeholder="例如：hp < 30 && state === 'hurt'（留空 = 永遠觸發）"
               :class="['w-full border rounded px-2 py-1 font-mono text-sm', check.ok ? 'border-slate-300' : 'border-red-500 bg-red-50']" />
        <p v-if="!check.ok" class="text-xs text-red-600">✗ {{ check.error }}</p>
        <div class="flex flex-wrap gap-1">
          <button v-for="s in snippets" :key="s" @click="insert(s)" class="text-xs font-mono px-2 py-0.5 rounded bg-slate-100 hover:bg-indigo-100">+ {{ s }}</button>
        </div>
        <details class="text-sm bg-slate-50 rounded p-2">
          <summary class="cursor-pointer select-none">🧪 測試條件
            <span v-if="check.ok" :class="['ml-2 px-2 rounded text-xs', result ? 'bg-green-200 text-green-800' : 'bg-slate-200']">{{ result ? 'TRUE 觸發' : 'FALSE 不觸發' }}</span>
          </summary>
          <div class="grid grid-cols-3 gap-2 mt-2">
            <label class="text-xs">hp <input type="number" v-model.number="sample.hp" class="w-full border rounded px-1" /></label>
            <label class="text-xs">maxHp <input type="number" v-model.number="sample.maxHp" class="w-full border rounded px-1" /></label>
            <label class="text-xs">state
              <select v-model="sample.state" class="w-full border rounded px-1">
                <option v-for="s in ['idle','move','attack','hurt','ko','stun']" :key="s">{{ s }}</option>
              </select></label>
            <label class="text-xs">type <input v-model="sample.type" class="w-full border rounded px-1" /></label>
            <label class="text-xs">facing <select v-model.number="sample.facing" class="w-full border rounded px-1"><option :value="1">1 (右)</option><option :value="-1">-1 (左)</option></select></label>
            <label class="text-xs">jumpY <input type="number" v-model.number="sample.jumpY" class="w-full border rounded px-1" /></label>
          </div>
          <p class="text-xs text-slate-500 mt-2">可用變數：<code>{{ whitelist.join(', ') }}</code></p>
        </details>
      </div>`,
  };

  const FX_PRESETS = {
    dash: { shakeEnabled: false, shakeAmp: 4, shakeDur: 0.12, flashEnabled: false, flashColor: '#67e8f9', flashDur: 0.05, particlesEnabled: false, particleColor: '#67e8f9', particleCount: 10, bubbleEnabled: true, bubbleText: '閃身步!!', bubbleSubText: 'FLASH STEP!', bubbleStyle: 'shout', bubbleFillA: '#67e8f9', bubbleFillB: '#6366f1', bubbleTextColor: '#ffffff', bubbleDur: 0.56 },
    rp_dash: { shakeEnabled: false, shakeAmp: 4, shakeDur: 0.12, flashEnabled: false, flashColor: '#67e8f9', flashDur: 0.05, particlesEnabled: false, particleColor: '#67e8f9', particleCount: 10, bubbleEnabled: true, bubbleText: '閃身步!!', bubbleSubText: 'FLASH STEP!', bubbleStyle: 'shout', bubbleFillA: '#67e8f9', bubbleFillB: '#6366f1', bubbleTextColor: '#ffffff', bubbleDur: 0.56 },
    heavyAttack: { shakeEnabled: true, shakeAmp: 8, shakeDur: 0.16, flashEnabled: true, flashColor: '#67e8f9', flashDur: 0.055, particlesEnabled: true, particleColor: '#67e8f9', particleCount: 14, bubbleEnabled: true, bubbleText: '月牙天沖!!', bubbleSubText: 'GETSUGA TENSHO!!', bubbleStyle: 'shout', bubbleFillA: '#67e8f9', bubbleFillB: '#2563eb', bubbleTextColor: '#ffffff', bubbleDur: 0.66 },
    rp_attack: { shakeEnabled: true, shakeAmp: 9, shakeDur: 0.2, flashEnabled: false, flashColor: '#fde047', flashDur: 0.06, particlesEnabled: true, particleColor: '#fde047', particleCount: 12, bubbleEnabled: true, bubbleText: '升龍拳!!', bubbleSubText: 'SHORYUKEN!!', bubbleStyle: 'shout', bubbleFillA: '#fde047', bubbleFillB: '#ea580c', bubbleTextColor: '#ffffff', bubbleDur: 0.78 },
    dashLightAttack: { shakeEnabled: true, shakeAmp: 7, shakeDur: 0.14, flashEnabled: true, flashColor: '#f0abfc', flashDur: 0.055, particlesEnabled: false, particleColor: '#f472b6', particleCount: 12, bubbleEnabled: true, bubbleText: '浪子踢球!!', bubbleSubText: 'ROGUE SHOOT!!', bubbleStyle: 'shout', bubbleFillA: '#e879f9', bubbleFillB: '#7e22ce', bubbleTextColor: '#ffffff', bubbleDur: 0.66 },
    rp_dashLightAttack: { shakeEnabled: true, shakeAmp: 7, shakeDur: 0.14, flashEnabled: true, flashColor: '#fde047', flashDur: 0.055, particlesEnabled: false, particleColor: '#38bdf8', particleCount: 14, bubbleEnabled: true, bubbleText: '閃電踢球!!', bubbleSubText: 'THUNDER SHOOT!!', bubbleStyle: 'shout', bubbleFillA: '#67e8f9', bubbleFillB: '#2563eb', bubbleTextColor: '#ffffff', bubbleDur: 0.66 },
    dashAttack: { shakeEnabled: true, shakeAmp: 8, shakeDur: 0.18, flashEnabled: true, flashColor: '#fde047', flashDur: 0.06, particlesEnabled: false, particleColor: '#e879f9', particleCount: 14, bubbleEnabled: true, bubbleText: '星杖衝刺斬!!', bubbleSubText: 'STAR SLASH!!', bubbleStyle: 'shout', bubbleFillA: '#fde047', bubbleFillB: '#a855f7', bubbleTextColor: '#ffffff', bubbleDur: 0.66 },
    rp_dashAttack: { shakeEnabled: true, shakeAmp: 9, shakeDur: 0.18, flashEnabled: true, flashColor: '#fde047', flashDur: 0.06, particlesEnabled: false, particleColor: '#fb923c', particleCount: 16, bubbleEnabled: true, bubbleText: '赤焰衝刺撞擊!!', bubbleSubText: 'BLAZING TACKLE!!', bubbleStyle: 'shout', bubbleFillA: '#fde047', bubbleFillB: '#f97316', bubbleTextColor: '#ffffff', bubbleDur: 0.66 },
    tornadoKick: { shakeEnabled: true, shakeAmp: 7, shakeDur: 0.16, flashEnabled: false, flashColor: '#e879f9', flashDur: 0.06, particlesEnabled: true, particleColor: '#e879f9', particleCount: 14, bubbleEnabled: true, bubbleText: '龍捲旋風腳!!', bubbleSubText: 'TORNADO HURRICANE KICK!!', bubbleStyle: 'shout', bubbleFillA: '#e879f9', bubbleFillB: '#7e22ce', bubbleTextColor: '#ffffff', bubbleDur: 0.72 },
    rp_tornadoKick: { shakeEnabled: true, shakeAmp: 8, shakeDur: 0.16, flashEnabled: false, flashColor: '#fde047', flashDur: 0.06, particlesEnabled: true, particleColor: '#fde047', particleCount: 14, bubbleEnabled: true, bubbleText: '烈焰龍捲旋風腳!!', bubbleSubText: 'BLAZING TORNADO KICK!!', bubbleStyle: 'shout', bubbleFillA: '#fde047', bubbleFillB: '#ea580c', bubbleTextColor: '#ffffff', bubbleDur: 0.72 },
    special: { shakeEnabled: true, shakeAmp: 11, shakeDur: 0.25, flashEnabled: true, flashColor: '#f472b6', flashDur: 0.085, particlesEnabled: true, particleColor: '#e879f9', particleCount: 20, bubbleEnabled: true, bubbleText: '能量砲十連發!!', bubbleSubText: 'MEGA CANNON BLAST!!', bubbleStyle: 'super', bubbleFillA: '#fde047', bubbleFillB: '#e11d48', bubbleTextColor: '#ffffff', bubbleDur: 0.92 },
    rp_special: { shakeEnabled: true, shakeAmp: 12, shakeDur: 0.25, flashEnabled: true, flashColor: '#fb923c', flashDur: 0.085, particlesEnabled: true, particleColor: '#fde047', particleCount: 22, bubbleEnabled: true, bubbleText: '赤焰百拳連擊!!', bubbleSubText: '100-FIST FLAME RUSH!!', bubbleStyle: 'super', bubbleFillA: '#fde047', bubbleFillB: '#ea580c', bubbleTextColor: '#ffffff', bubbleDur: 0.92 },
  };

  function defaultFxForAction(actionId = '') {
    const base = {
      shakeEnabled: false, shakeAmp: 7, shakeDur: 0.16,
      flashEnabled: false, flashColor: '#fde047', flashDur: 0.06,
      particlesEnabled: false, particleColor: '#38bdf8', particleCount: 14,
      bubbleEnabled: false, bubbleText: '', bubbleSubText: '',
      bubbleStyle: 'shout', bubbleFillA: '#fde047', bubbleFillB: '#f97316',
      bubbleTextColor: '#ffffff', bubbleDur: 0.66,
    };
    return { ...base, ...(FX_PRESETS[actionId] || {}) };
  }

  /** Interactive VFX, Screen Shake, and Comic Dialogue Bubble Designer with Live Canvas Preview. */
  const FxBubbleEditor = {
    props: { modelValue: { type: Object, required: true } },
    emits: ['update:modelValue'],
    setup(props, { emit }) {
      const canvas = ref(null);
      const shaking = ref(false);
      let animRaf = 0;
      let testAge = 99;
      let testParts = [];

      const fx = computed(() => props.modelValue || defaultFxForAction());
      function patch(obj) { emit('update:modelValue', { ...fx.value, ...obj }); }

      const shakePresets = [
        { label: '關閉', v: { shakeEnabled: false } },
        { label: '微震', v: { shakeEnabled: true, shakeAmp: 4, shakeDur: 0.12 } },
        { label: '重擊', v: { shakeEnabled: true, shakeAmp: 9, shakeDur: 0.2 } },
        { label: '大地震', v: { shakeEnabled: true, shakeAmp: 18, shakeDur: 0.42 } },
      ];
      const bubbleThemes = [
        { label: '⚡ 雷電青金', a: '#67e8f9', b: '#2563eb', t: '#ffffff' },
        { label: '🔥 赤焰橘黃', a: '#fde047', b: '#ea580c', t: '#ffffff' },
        { label: '💜 哥德紫粉', a: '#f472b6', b: '#7e22ce', t: '#ffffff' },
        { label: '💬 純白漫畫', a: '#ffffff', b: '#e2e8f0', t: '#0f172a' },
      ];

      function triggerPreview() {
        testAge = 0;
        testParts = [];
        if (fx.value.particlesEnabled) {
          const n = Math.max(4, Math.min(40, Number(fx.value.particleCount) || 14));
          for (let i = 0; i < n; i++) {
            const ang = (i / n) * Math.PI * 2 + Math.random() * 0.4;
            const spd = 70 + Math.random() * 140;
            testParts.push({ x: 160, y: 74, vx: Math.cos(ang) * spd, vy: Math.sin(ang) * spd, r: 3 + Math.random() * 4, life: 0.5 });
          }
        }
        if (fx.value.shakeEnabled) {
          shaking.value = true;
          setTimeout(() => { shaking.value = false; }, Math.max(120, (Number(fx.value.shakeDur) || 0.16) * 1000));
        }
      }

      function drawPreview() {
        const c = canvas.value;
        if (!c) return;
        const ctx = c.getContext('2d');
        const w = c.width, h = c.height;
        ctx.clearRect(0, 0, w, h);

        // Dark stage backdrop
        const bg = ctx.createLinearGradient(0, 0, 0, h);
        bg.addColorStop(0, '#1e1b4b'); bg.addColorStop(1, '#312e81');
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, w, h);

        const cur = fx.value;
        let ox = 0, oy = 0;
        if (cur.shakeEnabled && testAge < (Number(cur.shakeDur) || 0.16)) {
          const amp = Math.min(18, Number(cur.shakeAmp) || 6) * (1 - testAge / Math.max(0.05, Number(cur.shakeDur) || 0.16));
          ox = (Math.random() - 0.5) * amp * 2;
          oy = (Math.random() - 0.5) * amp * 2;
        }

        ctx.save();
        ctx.translate(ox, oy);

        // Particles
        for (const p of testParts) {
          if (p.life <= 0) continue;
          ctx.globalAlpha = Math.max(0, p.life / 0.5);
          ctx.fillStyle = cur.particleColor || '#38bdf8';
          ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
        }
        ctx.globalAlpha = 1;

        // Dialogue bubble
        if (cur.bubbleEnabled) {
          const style = cur.bubbleStyle || 'shout';
          const rx = style === 'super' ? 116 : (style === 'classic' ? 102 : 96);
          const ry = style === 'super' ? 44 : 38;
          const cx = w / 2, cy = h / 2 - 4;
          const popScale = testAge < 0.12 ? (0.4 + (testAge / 0.12) * 0.72) : (testAge < 0.22 ? (1.12 - ((testAge - 0.12) / 0.10) * 0.12) : 1);

          ctx.save();
          ctx.translate(cx, cy);
          ctx.scale(popScale, popScale);
          if (style !== 'classic') ctx.rotate(-0.04);

          const traceShape = (dx, dy) => {
            ctx.beginPath();
            if (style === 'classic') {
              const x = -rx + dx, y = -ry + dy, bw = rx * 2, bh = ry * 2, rad = 20;
              ctx.moveTo(x + rad, y);
              ctx.lineTo(x + bw - rad, y); ctx.quadraticCurveTo(x + bw, y, x + bw, y + rad);
              ctx.lineTo(x + bw, y + bh - rad); ctx.quadraticCurveTo(x + bw, y + bh, x + bw - rad, y + bh);
              ctx.lineTo(x + rad, y + bh); ctx.quadraticCurveTo(x, y + bh, x, y + bh - rad);
              ctx.lineTo(x, y + rad); ctx.quadraticCurveTo(x, y, x + rad, y);
            } else {
              const spikes = style === 'super' ? 18 : (style === 'shout' ? 14 : 12);
              const n = spikes * 2;
              for (let i = 0; i < n; i++) {
                const ang = (i / n) * Math.PI * 2;
                const r = (i % 2 === 0 ? 1.0 : 0.68) * (0.9 + ((Math.sin(i * 3.7) * 0.5 + 0.5) * 0.18));
                const px = Math.cos(ang) * rx * r + dx;
                const py = Math.sin(ang) * ry * r + dy;
                if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
              }
            }
            ctx.closePath();
          };

          // Shadow
          ctx.fillStyle = '#090710';
          traceShape(4, 5); ctx.fill();

          // Speech tail for shout & classic
          if (style === 'shout' || style === 'classic') {
            ctx.beginPath();
            ctx.moveTo(-24, ry * 0.55);
            ctx.lineTo(-40, ry * 1.18);
            ctx.lineTo(-4, ry * 0.55);
            ctx.closePath();
            ctx.fillStyle = cur.bubbleFillB || '#f97316';
            ctx.fill();
            ctx.lineWidth = 3.5; ctx.strokeStyle = '#090710'; ctx.stroke();
          }

          // Gradient fill
          const grad = ctx.createLinearGradient(0, -ry, 0, ry);
          grad.addColorStop(0, cur.bubbleFillA || '#fde047');
          grad.addColorStop(1, cur.bubbleFillB || '#f97316');
          ctx.fillStyle = grad;
          traceShape(0, 0); ctx.fill();
          ctx.lineWidth = style === 'super' ? 4.5 : 3.5;
          ctx.strokeStyle = '#090710';
          ctx.stroke();

          // Text
          const mainText = (cur.bubbleText || '招式台詞!!').trim();
          const subText = (cur.bubbleSubText || '').trim();
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.font = `900 ${style === 'classic' ? '' : 'italic '}20px "Noto Sans TC", Impact, sans-serif`;
          const ty = subText ? -6 : 1;
          if (style !== 'classic' || (cur.bubbleTextColor || '#ffffff').toLowerCase() === '#ffffff') {
            ctx.lineWidth = 5; ctx.strokeStyle = '#090710'; ctx.strokeText(mainText, 0, ty);
          }
          ctx.fillStyle = cur.bubbleTextColor || '#ffffff';
          ctx.fillText(mainText, 0, ty);
          if (subText) {
            ctx.font = '900 italic 10px Impact, sans-serif';
            ctx.lineWidth = 3; ctx.strokeStyle = '#090710'; ctx.strokeText(subText, 0, 14);
            ctx.fillStyle = '#fef08a'; ctx.fillText(subText, 0, 14);
          }
          ctx.restore();
        } else {
          ctx.fillStyle = 'rgba(255,255,255,0.45)';
          ctx.font = '12px sans-serif'; ctx.textAlign = 'center';
          ctx.fillText('（已關閉對話框）', w / 2, h / 2);
        }

        // Flash overlay
        if (cur.flashEnabled && testAge < (Number(cur.flashDur) || 0.06) * 2.2) {
          ctx.fillStyle = cur.flashColor || '#fde047';
          ctx.globalAlpha = 0.55 * (1 - testAge / ((Number(cur.flashDur) || 0.06) * 2.2));
          ctx.fillRect(-20, -20, w + 40, h + 40);
        }
        ctx.restore();
      }

      let lastT = 0;
      function tick(t) {
        animRaf = requestAnimationFrame(tick);
        const dt = lastT ? Math.min(0.05, (t - lastT) / 1000) : 0.016;
        lastT = t;
        if (testAge < 2) {
          testAge += dt;
          for (const p of testParts) { p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt; }
        }
        drawPreview();
      }
      onMounted(() => { animRaf = requestAnimationFrame(tick); });
      onBeforeUnmount(() => cancelAnimationFrame(animRaf));

      return { fx, patch, canvas, shaking, shakePresets, bubbleThemes, triggerPreview };
    },
    template: `
      <details open class="border rounded-lg bg-slate-50 p-3 space-y-3">
        <summary class="cursor-pointer font-semibold text-sm text-slate-800 flex items-center justify-between select-none">
          <span>⚡ 特效、畫面震動與對話框設計</span>
          <span class="text-xs font-normal text-slate-500">
            {{ fx.shakeEnabled ? '📳 震動 ' + fx.shakeAmp : '無震動' }} ·
            {{ fx.bubbleEnabled ? '💬 ' + (fx.bubbleText || '預設台詞') : '無對話框' }}
          </span>
        </summary>

        <div class="grid grid-cols-12 gap-3 pt-1">
          <!-- Left controls -->
          <div class="col-span-12 lg:col-span-7 space-y-3 text-xs">
            <!-- Screen Shake -->
            <div class="bg-white border rounded p-2.5 space-y-2">
              <div class="flex flex-wrap items-center justify-between gap-2">
                <label class="font-semibold text-slate-700 flex items-center gap-1.5 cursor-pointer">
                  <input type="checkbox" :checked="fx.shakeEnabled" @change="patch({ shakeEnabled: $event.target.checked })" />
                  📳 畫面震動（Screen Shake）
                </label>
                <div class="flex gap-1">
                  <button v-for="p in shakePresets" :key="p.label" @click="patch(p.v)"
                    class="px-2 py-0.5 rounded border bg-slate-50 hover:bg-indigo-50 text-[11px]">{{ p.label }}</button>
                </div>
              </div>
              <div v-if="fx.shakeEnabled" class="grid grid-cols-2 gap-2">
                <label>強度 ({{ fx.shakeAmp }}px)
                  <input type="range" min="1" max="25" :value="fx.shakeAmp" @input="patch({ shakeAmp: Number($event.target.value) })" class="w-full" />
                </label>
                <label>持續秒數 ({{ fx.shakeDur }}s)
                  <input type="range" min="0.05" max="0.8" step="0.02" :value="fx.shakeDur" @input="patch({ shakeDur: Number($event.target.value) })" class="w-full" />
                </label>
              </div>
            </div>

            <!-- Flash & Particles -->
            <div class="bg-white border rounded p-2.5 space-y-2">
              <div class="flex flex-wrap items-center gap-4">
                <label class="font-semibold text-slate-700 flex items-center gap-1.5 cursor-pointer">
                  <input type="checkbox" :checked="fx.flashEnabled" @change="patch({ flashEnabled: $event.target.checked })" />
                  ⚡ 發動閃光幀
                </label>
                <label v-if="fx.flashEnabled" class="flex items-center gap-1">顏色
                  <input type="color" :value="fx.flashColor" @input="patch({ flashColor: $event.target.value })" class="w-6 h-5 border rounded" />
                </label>
                <label class="font-semibold text-slate-700 flex items-center gap-1.5 cursor-pointer">
                  <input type="checkbox" :checked="fx.particlesEnabled" @change="patch({ particlesEnabled: $event.target.checked })" />
                  ✨ 粒子爆發
                </label>
                <template v-if="fx.particlesEnabled">
                  <label class="flex items-center gap-1">顏色
                    <input type="color" :value="fx.particleColor" @input="patch({ particleColor: $event.target.value })" class="w-6 h-5 border rounded" />
                  </label>
                  <label class="flex items-center gap-1">數量
                    <input type="number" min="4" max="40" :value="fx.particleCount" @input="patch({ particleCount: Number($event.target.value) })" class="w-12 border rounded px-1" />
                  </label>
                </template>
              </div>
            </div>

            <!-- Comic Dialogue Bubble -->
            <div class="bg-white border rounded p-2.5 space-y-2">
              <div class="flex flex-wrap items-center justify-between gap-2">
                <label class="font-semibold text-slate-700 flex items-center gap-1.5 cursor-pointer">
                  <input type="checkbox" :checked="fx.bubbleEnabled" @change="patch({ bubbleEnabled: $event.target.checked })" />
                  💬 招式對話框設計
                </label>
                <div v-if="fx.bubbleEnabled" class="flex flex-wrap gap-1">
                  <button v-for="th in bubbleThemes" :key="th.label" @click="patch({ bubbleFillA: th.a, bubbleFillB: th.b, bubbleTextColor: th.t })"
                    class="px-1.5 py-0.5 rounded border bg-slate-50 hover:bg-indigo-50 text-[11px]">{{ th.label }}</button>
                </div>
              </div>
              <div v-if="fx.bubbleEnabled" class="space-y-2">
                <div class="grid grid-cols-2 gap-2">
                  <label>主台詞 <input :value="fx.bubbleText" @input="patch({ bubbleText: $event.target.value })" placeholder="閃電踢球!!" class="w-full border rounded px-2 py-1 mt-0.5" /></label>
                  <label>副標英文 <input :value="fx.bubbleSubText" @input="patch({ bubbleSubText: $event.target.value })" placeholder="THUNDER SHOOT!!" class="w-full border rounded px-2 py-1 mt-0.5" /></label>
                </div>
                <div class="grid grid-cols-5 gap-2 items-center">
                  <label class="col-span-2">造型
                    <select :value="fx.bubbleStyle" @change="patch({ bubbleStyle: $event.target.value })" class="w-full border rounded px-1.5 py-1 mt-0.5">
                      <option value="shout">💥 吶喊星芒 (shout)</option>
                      <option value="burst">⚡ 衝擊爆框 (burst)</option>
                      <option value="super">🔥 必殺大框 (super)</option>
                      <option value="classic">💬 圓潤漫畫框 (classic)</option>
                    </select>
                  </label>
                  <label>上色 <input type="color" :value="fx.bubbleFillA" @input="patch({ bubbleFillA: $event.target.value })" class="w-full h-7 border rounded mt-0.5" /></label>
                  <label>下色 <input type="color" :value="fx.bubbleFillB" @input="patch({ bubbleFillB: $event.target.value })" class="w-full h-7 border rounded mt-0.5" /></label>
                  <label>字色 <input type="color" :value="fx.bubbleTextColor" @input="patch({ bubbleTextColor: $event.target.value })" class="w-full h-7 border rounded mt-0.5" /></label>
                </div>
                <label class="inline-flex items-center gap-2">顯示秒數 ({{ fx.bubbleDur }}s)
                  <input type="range" min="0.3" max="1.8" step="0.05" :value="fx.bubbleDur" @input="patch({ bubbleDur: Number($event.target.value) })" class="w-36" />
                </label>
              </div>
            </div>
          </div>

          <!-- Right live preview -->
          <div class="col-span-12 lg:col-span-5 flex flex-col items-center justify-center bg-white border rounded p-2.5 space-y-2">
            <canvas ref="canvas" width="320" height="148" class="rounded border w-full max-w-[320px]"></canvas>
            <button @click="triggerPreview" class="w-full py-1.5 rounded bg-slate-800 hover:bg-slate-700 text-white text-xs font-semibold">
              🎬 試播震動・特效・對話框
            </button>
          </div>
        </div>
      </details>`,
  };

  /** Full-featured AI Action Modification Modal (prompt, cols/rows/frames, turnaround + action ref uploads). */
  const AiModifyModal = {
    components: { SpritePreview },
    props: {
      open: Boolean,
      charId: String,
      charName: String,
      actionId: String,
      actionLabel: String,
      currentSrc: String,
      charTurnaroundSrc: String,
      initCols: Number,
      initRows: Number,
      initFrames: Number,
      initFps: Number,
      trigger: String,
      condition: String,
    },
    emits: ['close', 'apply'],
    setup(props, { emit }) {
      const GEMINI_KEY_STORAGE = 'sf_editor_gemini_api_key';
      const prompt = ref('');
      const cols = ref(5);
      const rows = ref(2);
      const frames = ref(10);
      const fps = ref(14);
      const turnaroundFile = ref(null);
      const turnaroundUrl = ref('');
      const actionRefFile = ref(null);
      const actionRefUrl = ref('');
      const geminiKey = ref(localStorage.getItem(GEMINI_KEY_STORAGE) || '');
      const geminiModel = ref('gemini-2.5-flash-image');
      const showKeyInput = ref(false);
      const generating = ref(false);
      const genError = ref('');
      const genFile = ref(null);
      const genUrl = ref('');

      function revoke(r) { if (r.value && r.value.startsWith('blob:')) URL.revokeObjectURL(r.value); }
      function setRefFile(targetFile, targetUrl, f) {
        if (!f) { revoke(targetUrl); targetFile.value = null; targetUrl.value = ''; return; }
        if (!/^image\/(png|jpeg|webp)$/.test(f.type)) { toast('參考圖只支援 PNG / JPG / WebP', 'error'); return; }
        if (f.size > 10 * 1024 * 1024) { toast('參考圖超過 10MB', 'error'); return; }
        revoke(targetUrl);
        targetFile.value = f;
        targetUrl.value = URL.createObjectURL(f);
      }

      watch(() => props.open, async (v) => {
        if (!v) return;
        cols.value = props.initCols || 5;
        rows.value = props.initRows || 2;
        frames.value = props.initFrames || (cols.value * rows.value);
        fps.value = props.initFps || 14;
        genError.value = '';
        prompt.value = `${props.charName || props.charId} 施展「${props.actionLabel || props.actionId}」的 2D 橫向格鬥遊戲連幀精靈動畫，可愛Q版動漫風格，每格動作流暢連貫，純白背景無文字`;
        // Auto-attach the character's turnaround sheet so AI always has consistent character reference!
        if (props.charTurnaroundSrc) {
          try {
            const res = await fetch(props.charTurnaroundSrc);
            if (res.ok) {
              const blob = await res.blob();
              const f = new File([blob], `${props.charId || 'char'}_turnaround.webp`, { type: blob.type || 'image/webp' });
              setRefFile(turnaroundFile, turnaroundUrl, f);
            }
          } catch { /* ignore */ }
        } else {
          setRefFile(turnaroundFile, turnaroundUrl, null);
        }
      });

      watch([cols, rows], ([c, r]) => {
        frames.value = Math.max(1, (Number(c) || 1) * (Number(r) || 1));
      });

      onBeforeUnmount(() => { revoke(turnaroundUrl); revoke(actionRefUrl); revoke(genUrl); });

      const styleChips = [
        'Q版2D精靈圖', '純白背景無陰影無文字', '等距整齊網格排列', '高張力發光招式特效', '動作流暢連貫',
      ];
      function addChip(c) {
        if (!prompt.value.includes(c)) prompt.value = prompt.value.trim() ? `${prompt.value.trim()}，${c}` : c;
      }

      async function useCurrentAsActionRef() {
        if (!props.currentSrc) { toast('此招式目前沒有既有圖檔', 'error'); return; }
        try {
          const res = await fetch(props.currentSrc);
          const blob = await res.blob();
          const f = new File([blob], `${props.actionId || 'action'}_ref.png`, { type: blob.type || 'image/png' });
          setRefFile(actionRefFile, actionRefUrl, f);
          toast('已帶入目前招式圖作為參考動作圖', 'success');
        } catch (e) { toast(`帶入失敗：${e.message}`, 'error'); }
      }

      function buildFullPrompt() {
        return [
          `Create a 2D game animation sprite sheet strictly arranged in a clean ${cols.value} columns by ${rows.value} rows grid (${frames.value} sequential animation frames, left-to-right, top-to-bottom).`,
          `Character: ${props.charName || props.charId}. Action: ${props.actionLabel || props.actionId}.`,
          `User description: ${prompt.value.trim()}`,
          turnaroundFile.value ? 'Match the exact character appearance, colors, outfit, and proportions shown in the provided character turnaround reference image.' : '',
          actionRefFile.value ? 'Follow the motion rhythm, pose progression, and attack arcs shown in the provided reference action image.' : '',
          'Continuity & framing rules: each adjacent frame must change only slightly and smoothly with motion evenly distributed across all frames; leave generous empty margin around the character inside every cell so large kicks, jumps, and weapon slashes NEVER touch or get clipped by cell edges; uniform cell sizing, no borders, no grid lines, no text or numbers, solid pure white background (#FFFFFF) for clean transparency extraction.',
        ].filter(Boolean).join('\n');
      }

      async function copyPrompt() {
        try {
          await navigator.clipboard.writeText(buildFullPrompt());
          toast('已複製完整 AI 提示詞（含欄×列與幀數規格）', 'success');
        } catch { toast('無法自動複製，請手動選取提示詞', 'error'); }
      }

      function saveGeminiKey() {
        localStorage.setItem(GEMINI_KEY_STORAGE, geminiKey.value.trim());
        showKeyInput.value = false;
        toast('已儲存 Gemini API Key 於本機瀏覽器', 'success');
      }

      async function fileToInlinePart(f) {
        const buf = new Uint8Array(await f.arrayBuffer());
        return { inlineData: { mimeType: f.type || 'image/png', data: bytesToBase64(buf) } };
      }

      async function imageBlobToPngFile(blob, name) {
        if (blob.type === 'image/png') return new File([blob], name, { type: 'image/png' });
        const bmp = await createImageBitmap(blob);
        const c = document.createElement('canvas');
        c.width = bmp.width; c.height = bmp.height;
        c.getContext('2d').drawImage(bmp, 0, 0);
        bmp.close();
        const pngBlob = await new Promise((r) => c.toBlob(r, 'image/png'));
        return new File([pngBlob], name, { type: 'image/png' });
      }

      async function generateWithGemini() {
        const key = geminiKey.value.trim();
        if (!key) { showKeyInput.value = true; genError.value = '請先貼入 Gemini API Key（可在 Google AI Studio 免費取得）'; return; }
        if (!prompt.value.trim()) { genError.value = '請輸入提示詞'; return; }
        localStorage.setItem(GEMINI_KEY_STORAGE, key);
        generating.value = true; genError.value = '';
        try {
          const parts = [{ text: buildFullPrompt() }];
          if (turnaroundFile.value) parts.push(await fileToInlinePart(turnaroundFile.value));
          if (actionRefFile.value) parts.push(await fileToInlinePart(actionRefFile.value));
          const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(geminiModel.value)}:generateContent?key=${encodeURIComponent(key)}`;
          const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ parts }],
              generationConfig: { responseModalities: ['TEXT', 'IMAGE'] },
            }),
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) {
            const rawMsg = data.error?.message || `Gemini HTTP ${res.status}`;
            if (/quota|limit:\s*0|rate-limit/i.test(rawMsg)) {
              throw new Error('Google AI Studio 免費方案對此圖像模型設為 limit: 0（需在 Google AI Studio 綁定計費帳號才能透過 API 生圖）。你可以改點下方「🆓 免費免 Key 生圖」或「🌐 複製提示詞並開 Gemini 網頁版」免費生圖後匯入！');
            }
            throw new Error(rawMsg);
          }
          const outParts = data.candidates?.[0]?.content?.parts || [];
          const imgPart = outParts.find((p) => p.inlineData && p.inlineData.data);
          if (!imgPart) throw new Error('模型未回傳圖片，請調整提示詞或改選其他模型再試');
          const bin = atob(imgPart.inlineData.data);
          const bytes = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
          const rawBlob = new Blob([bytes], { type: imgPart.inlineData.mimeType || 'image/png' });
          const pngFile = await imageBlobToPngFile(rawBlob, `${props.charId}_${props.actionId}_ai.png`);
          revoke(genUrl);
          genFile.value = pngFile;
          genUrl.value = URL.createObjectURL(pngFile);
          toast('✨ AI 精靈表生成完成！可在右側預覽動畫', 'success');
        } catch (e) {
          genError.value = e.message;
        } finally { generating.value = false; }
      }

      async function generateWithPollinations() {
        if (!prompt.value.trim()) { genError.value = '請輸入提示詞'; return; }
        generating.value = true; genError.value = '';
        try {
          const w = Math.min(1536, Math.max(512, (Number(cols.value) || 5) * 256));
          const h = Math.min(1024, Math.max(512, (Number(rows.value) || 2) * 256));
          const seed = Math.floor(Math.random() * 1e9);
          const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(buildFullPrompt())}?width=${w}&height=${h}&seed=${seed}&nologo=true`;
          const res = await fetch(url);
          if (!res.ok) throw new Error(`Pollinations HTTP ${res.status}`);
          const rawBlob = await res.blob();
          const pngFile = await imageBlobToPngFile(rawBlob, `${props.charId}_${props.actionId}_free_ai.png`);
          revoke(genUrl);
          genFile.value = pngFile;
          genUrl.value = URL.createObjectURL(pngFile);
          toast('🆓 免費 AI 精靈表生成完成！可在右側預覽動畫', 'success');
        } catch (e) {
          genError.value = `免費生圖失敗：${e.message}（可改用「🌐 複製提示詞並開 Gemini 網頁版」）`;
        } finally { generating.value = false; }
      }

      async function openGeminiWeb() {
        await copyPrompt();
        window.open('https://gemini.google.com/app', '_blank', 'noopener');
      }

      async function importGeneratedFile(f) {
        if (!f) return;
        try {
          const pngFile = await imageBlobToPngFile(f, `${props.charId}_${props.actionId}_ai.png`);
          revoke(genUrl);
          genFile.value = pngFile;
          genUrl.value = URL.createObjectURL(pngFile);
          genError.value = '';
          toast('已匯入生成圖並載入動態預覽！', 'success');
        } catch (e) { genError.value = `匯入失敗：${e.message}`; }
      }

      async function generateWithBackend() {
        if (!prompt.value.trim()) { genError.value = '請輸入提示詞'; return; }
        generating.value = true; genError.value = '';
        try {
          const body = {
            prompt: prompt.value.trim(),
            characterId: props.charId,
            name: props.charName,
            actionId: props.actionId,
            label: props.actionLabel,
            cols: cols.value,
            rows: rows.value,
            frameCount: frames.value,
            fps: fps.value,
            trigger: props.trigger,
            condition: props.condition,
          };
          await backendApi('/api/generate', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
          });
          toast('已送出至本機 AI 生成佇列（可至「🤖 AI 生成」分頁檢視進度）', 'success');
          emit('close');
        } catch (e) { genError.value = e.message; } finally { generating.value = false; }
      }

      function applyResult() {
        if (!genFile.value) return;
        emit('apply', {
          file: genFile.value,
          cols: Number(cols.value) || 5,
          rows: Number(rows.value) || 2,
          frames: Number(frames.value) || (Number(cols.value) * Number(rows.value)),
          fps: Number(fps.value) || 14,
        });
        emit('close');
      }

      return {
        store, prompt, cols, rows, frames, fps, styleChips,
        turnaroundFile, turnaroundUrl, actionRefFile, actionRefUrl,
        geminiKey, geminiModel, showKeyInput, generating, genError, genFile, genUrl,
        setRefFile, addChip, useCurrentAsActionRef, copyPrompt, saveGeminiKey,
        generateWithGemini, generateWithPollinations, openGeminiWeb, importGeneratedFile, generateWithBackend, applyResult,
      };
    },
    template: `
      <div v-if="open" class="fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center p-4" @click.self="$emit('close')">
        <div class="bg-white rounded-xl shadow-2xl w-full max-w-5xl max-h-[92vh] flex flex-col overflow-hidden">
          <header class="px-5 py-3 bg-gradient-to-r from-indigo-600 to-fuchsia-600 text-white flex items-center justify-between">
            <div>
              <h2 class="text-lg font-bold">✨ AI 招式動畫修改工作台</h2>
              <p class="text-xs opacity-90">{{ charName }}（#{{ charId }}）→ {{ actionLabel || actionId }}</p>
            </div>
            <button @click="$emit('close')" class="px-2.5 py-1 rounded bg-white/20 hover:bg-white/30 text-sm">✕ 關閉</button>
          </header>

          <div class="p-5 overflow-y-auto grid grid-cols-12 gap-5">
            <!-- Left: Prompt + Grid + Reference Images -->
            <div class="col-span-12 lg:col-span-7 space-y-4">
              <div>
                <div class="flex items-center justify-between mb-1">
                  <label class="text-sm font-semibold">1. 動作提示詞（Prompt）</label>
                  <button @click="copyPrompt" class="text-xs px-2 py-0.5 rounded border hover:bg-slate-50">📋 複製完整提示詞</button>
                </div>
                <textarea v-model="prompt" rows="3" placeholder="描述招式動作、特效顏色、鏡頭張力與畫風…"
                  class="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-400 outline-none"></textarea>
                <div class="flex flex-wrap gap-1 mt-1.5">
                  <button v-for="c in styleChips" :key="c" @click="addChip(c)"
                    class="text-xs px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 hover:bg-indigo-100">＋ {{ c }}</button>
                </div>
              </div>

              <div>
                <p class="text-sm font-semibold mb-1.5">2. 精靈表規格（欄 × 列 × 幀數）</p>
                <div class="grid grid-cols-4 gap-2">
                  <label class="text-xs bg-slate-50 p-2 rounded border">欄 (Cols)
                    <input type="number" min="1" max="20" v-model.number="cols" class="w-full border rounded px-2 py-1 mt-1 bg-white text-sm" /></label>
                  <label class="text-xs bg-slate-50 p-2 rounded border">列 (Rows)
                    <input type="number" min="1" max="20" v-model.number="rows" class="w-full border rounded px-2 py-1 mt-1 bg-white text-sm" /></label>
                  <label class="text-xs bg-slate-50 p-2 rounded border">總幀數
                    <input type="number" min="1" :max="cols*rows" v-model.number="frames" class="w-full border rounded px-2 py-1 mt-1 bg-white text-sm" /></label>
                  <label class="text-xs bg-slate-50 p-2 rounded border">FPS
                    <input type="number" min="1" max="60" v-model.number="fps" class="w-full border rounded px-2 py-1 mt-1 bg-white text-sm" /></label>
                </div>
              </div>

              <div>
                <p class="text-sm font-semibold mb-1.5">3. 上傳參考圖（選填，可大幅提升角色一致性）</p>
                <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <!-- Turnaround Sheet -->
                  <div class="border rounded-lg p-3 bg-slate-50 space-y-2">
                    <div class="flex items-center justify-between">
                      <span class="text-xs font-semibold">🧍 角色三視圖</span>
                      <button v-if="turnaroundFile" @click="setRefFile(turnaroundFile, turnaroundUrl, null)" class="text-xs text-red-500">清除</button>
                    </div>
                    <label class="block cursor-pointer">
                      <input type="file" accept="image/png,image/jpeg,image/webp" class="hidden"
                             @change="setRefFile(turnaroundFile, turnaroundUrl, $event.target.files[0]); $event.target.value=''" />
                      <div v-if="turnaroundUrl" class="checker rounded border h-28 flex items-center justify-center overflow-hidden">
                        <img :src="turnaroundUrl" class="max-h-full max-w-full object-contain" />
                      </div>
                      <div v-else class="border-2 border-dashed border-slate-300 hover:border-indigo-400 rounded h-28 flex flex-col items-center justify-center text-xs text-slate-500 text-center p-2">
                        點擊上傳正面／側面／背面<br>角色設定三視圖
                      </div>
                    </label>
                  </div>

                  <!-- Action Reference -->
                  <div class="border rounded-lg p-3 bg-slate-50 space-y-2">
                    <div class="flex items-center justify-between gap-1">
                      <span class="text-xs font-semibold">🎬 參考動作圖</span>
                      <div class="flex gap-2">
                        <button v-if="currentSrc" @click="useCurrentAsActionRef" class="text-[11px] text-indigo-600 hover:underline">📎 帶入目前招式圖</button>
                        <button v-if="actionRefFile" @click="setRefFile(actionRefFile, actionRefUrl, null)" class="text-xs text-red-500">清除</button>
                      </div>
                    </div>
                    <label class="block cursor-pointer">
                      <input type="file" accept="image/png,image/jpeg,image/webp" class="hidden"
                             @change="setRefFile(actionRefFile, actionRefUrl, $event.target.files[0]); $event.target.value=''" />
                      <div v-if="actionRefUrl" class="checker rounded border h-28 flex items-center justify-center overflow-hidden">
                        <img :src="actionRefUrl" class="max-h-full max-w-full object-contain" />
                      </div>
                      <div v-else class="border-2 border-dashed border-slate-300 hover:border-indigo-400 rounded h-28 flex flex-col items-center justify-center text-xs text-slate-500 text-center p-2">
                        點擊上傳動作參考草圖<br>或點右上角帶入原招式圖
                      </div>
                    </label>
                  </div>
                </div>
              </div>

              <!-- Gemini API key bar -->
              <div class="border rounded-lg p-3 bg-indigo-50/50 space-y-2">
                <div class="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <span class="font-semibold text-indigo-900">⚡ AI 雲端引擎（Gemini 圖像生成）</span>
                  <div class="flex items-center gap-2">
                    <select v-model="geminiModel" class="border rounded px-1.5 py-0.5 bg-white text-xs">
                      <option value="gemini-2.5-flash-image">gemini-2.5-flash-image</option>
                      <option value="gemini-2.0-flash-exp-image-generation">gemini-2.0-flash-exp-image-generation</option>
                    </select>
                    <button @click="showKeyInput=!showKeyInput" class="px-2 py-0.5 rounded border bg-white hover:bg-slate-50">
                      {{ geminiKey ? '🔑 已設 API Key' : '🔑 設定 Gemini Key' }}
                    </button>
                  </div>
                </div>
                <div v-if="showKeyInput || !geminiKey" class="flex gap-2">
                  <input type="password" v-model.trim="geminiKey" placeholder="貼入 Google AI Studio 的 Gemini API Key（僅存於本機瀏覽器）"
                    class="flex-1 border rounded px-2 py-1 text-xs font-mono bg-white" />
                  <button @click="saveGeminiKey" class="px-3 py-1 rounded bg-indigo-600 text-white text-xs">儲存 Key</button>
                </div>
              </div>

              <p v-if="genError" class="text-xs text-red-600 bg-red-50 border border-red-200 rounded p-2">✗ {{ genError }}</p>

              <div class="flex flex-wrap gap-2">
                <button @click="generateWithGemini" :disabled="generating"
                  class="px-4 py-2 rounded-lg bg-gradient-to-r from-indigo-600 to-fuchsia-600 text-white font-semibold text-sm hover:opacity-95 disabled:opacity-40">
                  {{ generating ? '⏳ AI 生成中…' : '✨ Gemini API 生成' }}
                </button>
                <button @click="generateWithPollinations" :disabled="generating"
                  class="px-3 py-2 rounded-lg bg-sky-600 text-white font-semibold text-sm hover:bg-sky-700 disabled:opacity-40"
                  title="免費免 API Key 直接生圖（純文字提示詞）">
                  🆓 免費免 Key 生圖
                </button>
                <button @click="openGeminiWeb"
                  class="px-3 py-2 rounded-lg border border-indigo-300 bg-white text-indigo-700 text-sm hover:bg-indigo-50"
                  title="複製完整提示詞並開啟 Gemini 網頁版，免費附圖生成後再匯入右側預覽">
                  🌐 複製提示詞開 Gemini 網頁版
                </button>
                <button v-if="store.mode==='backend'" @click="generateWithBackend" :disabled="generating"
                  class="px-3 py-2 rounded-lg bg-emerald-600 text-white text-sm disabled:opacity-40">
                  🖥️ 本機 SD 佇列
                </button>
              </div>
            </div>

            <!-- Right: Live Preview of Generated (or Current) Animation -->
            <div class="col-span-12 lg:col-span-5 flex flex-col justify-between bg-slate-50 rounded-lg border p-4 space-y-3">
              <div>
                <p class="text-sm font-semibold mb-2 text-center">{{ genUrl ? '🎉 AI 生成結果預覽' : '目前招式預覽（生成後將顯示於此）' }}</p>
                <sprite-preview :src="genUrl || currentSrc" :cols="cols" :rows="rows" :frames="frames" :fps="fps" :size="260" />
              </div>
              <div class="space-y-2 border-t pt-3">
                <label class="block w-full py-1.5 px-3 rounded-lg border border-dashed border-indigo-400 bg-white text-indigo-700 text-center text-xs cursor-pointer hover:bg-indigo-50">
                  📥 匯入外部 AI 生成圖（Gemini 網頁版 / ChatGPT）即時預覽
                  <input type="file" accept="image/png,image/jpeg,image/webp" class="hidden"
                         @change="importGeneratedFile($event.target.files[0]); $event.target.value=''" />
                </label>
                <button @click="applyResult" :disabled="!genFile"
                  class="w-full py-2 rounded-lg bg-emerald-600 text-white font-semibold text-sm disabled:opacity-40">
                  ✅ 套用此生成圖與格數至編輯器
                </button>
                <a v-if="genUrl" :href="genUrl" :download="charId + '_' + actionId + '_ai.png'"
                  class="block text-center text-xs text-indigo-600 hover:underline">⬇ 下載生成 PNG 備份</a>
              </div>
            </div>
          </div>
        </div>
      </div>`,
  };

  // ---------- Full Sprite Sheet Viewer, Drag-to-Reorder & Per-Frame Scale Sorter ----------
  const SpriteSheetSorter = {
    props: {
      src: String,
      cols: { type: Number, default: 10 },
      rows: { type: Number, default: 1 },
      frames: { type: Number, default: 10 },
      charId: { type: String, default: 'char' },
      actionId: { type: String, default: 'action' },
    },
    emits: ['reordered'],
    setup(props, { emit }) {
      const fullCanvas = ref(null);
      const thumbs = ref([]); // [{ slot, origIdx, scale, dataUrl }]
      const order = ref([]);  // [origIdx0, origIdx1, ...]
      const scales = ref([]); // indexed by origIdx: 1.00 ~ 2.00
      const history = ref([]); // [{ order: [...], scales: [...] }]
      const dragFrom = ref(-1);
      const dragOver = ref(-1);
      const mode = ref('swap'); // 'swap' | 'insert'
      const darkBg = ref(true);
      const showFullSheet = ref(true);
      const zoomOpen = ref(false);
      const imgSize = reactive({ w: 0, h: 0 });
      const dirty = ref(false);
      let origImg = null;
      let origAnchorYRatios = []; // per origIdx bottom-feet ratio (0..1) so scaling locks feet to ground
      let ignoreNextSrc = '';
      let scaleEmitTimer = null;
      let scaleDragSnapshot = null;

      const totalFrames = computed(() => {
        const c = Math.max(1, Number(props.cols) || 1);
        const r = Math.max(1, Number(props.rows) || 1);
        const f = Number(props.frames) || c * r;
        return Math.max(1, Math.min(c * r, f));
      });

      const hasScaleChanges = computed(() => scales.value.some((s) => Math.abs((Number(s) || 1) - 1) > 0.001));

      function computeDirty() {
        const orderChanged = order.value.some((origIdx, slot) => origIdx !== slot);
        const scaleChanged = scales.value.some((s) => Math.abs((Number(s) || 1) - 1) > 0.001);
        return orderChanged || scaleChanged;
      }

      function computeOrigAnchors() {
        origAnchorYRatios = [];
        if (!origImg || !origImg.naturalWidth) return;
        const cols = Math.max(1, Number(props.cols) || 1);
        const rows = Math.max(1, Number(props.rows) || 1);
        const n = totalFrames.value;
        const cw = origImg.naturalWidth / cols;
        const ch = origImg.naturalHeight / rows;
        const defaultRatio = 304 / 340;
        const sampleW = Math.max(16, Math.min(140, Math.round(cw)));
        const sampleH = Math.max(16, Math.min(140, Math.round(ch)));
        const scCanvas = document.createElement('canvas');
        scCanvas.width = sampleW;
        scCanvas.height = sampleH;
        const sctx = scCanvas.getContext('2d', { willReadFrequently: true });
        for (let idx = 0; idx < n; idx++) {
          const sc = idx % cols;
          const sr = Math.floor(idx / cols);
          sctx.clearRect(0, 0, sampleW, sampleH);
          sctx.drawImage(origImg, sc * cw, sr * ch, cw, ch, 0, 0, sampleW, sampleH);
          let ratio = defaultRatio;
          try {
            const data = sctx.getImageData(0, 0, sampleW, sampleH).data;
            let maxY = -1;
            for (let y = sampleH - 1; y >= 0; y--) {
              let rowHit = false;
              for (let x = 0; x < sampleW; x++) {
                if (data[(y * sampleW + x) * 4 + 3] > 20) {
                  rowHit = true;
                  break;
                }
              }
              if (rowHit) { maxY = y; break; }
            }
            if (maxY >= 0) {
              ratio = Math.max(0.5, Math.min(0.98, (maxY + 1) / sampleH));
            }
          } catch (_) {
            ratio = defaultRatio;
          }
          origAnchorYRatios[idx] = ratio;
        }
      }

      function drawScaledFrame(ctx, origIdx, sx, sy, sw, sh, dx, dy, dw, dh) {
        const s = Math.max(1, Math.min(2, Number(scales.value[origIdx]) || 1));
        if (Math.abs(s - 1) <= 0.001) {
          ctx.drawImage(origImg, sx, sy, sw, sh, dx, dy, dw, dh);
          return;
        }
        const ayRatio = origAnchorYRatios[origIdx] || (304 / 340);
        const ax = dx + dw * 0.5;
        const ay = dy + dh * ayRatio;
        const scaledW = dw * s;
        const scaledH = dh * s;
        const drawX = ax - scaledW * 0.5;
        const drawY = ay - scaledH * ayRatio;
        ctx.save();
        ctx.beginPath();
        ctx.rect(dx, dy, dw, dh);
        ctx.clip();
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(origImg, sx, sy, sw, sh, drawX, drawY, scaledW, scaledH);
        ctx.restore();
      }

      function resetOrderState() {
        const n = totalFrames.value;
        order.value = Array.from({ length: n }, (_, i) => i);
        scales.value = Array.from({ length: n }, () => 1);
        history.value = [];
        dirty.value = false;
      }

      function pushHistorySnapshot(snapshot) {
        history.value.push(snapshot || { order: [...order.value], scales: [...scales.value] });
        if (history.value.length > 40) history.value.shift();
      }

      function renderThumbsAndFull() {
        if (!origImg || !origImg.naturalWidth) {
          thumbs.value = [];
          return;
        }
        const cols = Math.max(1, Number(props.cols) || 1);
        const rows = Math.max(1, Number(props.rows) || 1);
        const n = totalFrames.value;
        if (order.value.length !== n || scales.value.length !== n) resetOrderState();
        if (origAnchorYRatios.length !== n) computeOrigAnchors();

        const cw = origImg.naturalWidth / cols;
        const ch = origImg.naturalHeight / rows;
        imgSize.w = origImg.naturalWidth;
        imgSize.h = origImg.naturalHeight;

        // 1. Render per-frame thumbnails in current order with individual scale applied
        const nextThumbs = [];
        const thumbMax = 140;
        const scale = Math.min(1, thumbMax / Math.max(cw, ch));
        const tw = Math.max(24, Math.round(cw * scale));
        const th = Math.max(24, Math.round(ch * scale));
        const tc = document.createElement('canvas');
        tc.width = tw;
        tc.height = th;
        const tctx = tc.getContext('2d');
        for (let slot = 0; slot < n; slot++) {
          const origIdx = order.value[slot];
          const sc = origIdx % cols;
          const sr = Math.floor(origIdx / cols);
          const fScale = Math.max(1, Math.min(2, Number(scales.value[origIdx]) || 1));
          tctx.clearRect(0, 0, tw, th);
          drawScaledFrame(tctx, origIdx, sc * cw, sr * ch, cw, ch, 0, 0, tw, th);
          nextThumbs.push({ slot, origIdx, scale: fScale, dataUrl: tc.toDataURL('image/png') });
        }
        thumbs.value = nextThumbs;

        // 2. Render full numbered Sprite Sheet overview canvas
        const fc = fullCanvas.value;
        if (fc) {
          const maxW = 1600;
          const fScale = origImg.naturalWidth > maxW ? (maxW / origImg.naturalWidth) : 1;
          fc.width = Math.max(1, Math.round(origImg.naturalWidth * fScale));
          fc.height = Math.max(1, Math.round(origImg.naturalHeight * fScale));
          const fctx = fc.getContext('2d');
          fctx.clearRect(0, 0, fc.width, fc.height);
          const dcw = fc.width / cols;
          const dch = fc.height / rows;
          for (let slot = 0; slot < n; slot++) {
            const origIdx = order.value[slot];
            const sc = origIdx % cols;
            const sr = Math.floor(origIdx / cols);
            const dc = slot % cols;
            const dr = Math.floor(slot / cols);
            const frameScale = Math.max(1, Math.min(2, Number(scales.value[origIdx]) || 1));
            const isScaled = Math.abs(frameScale - 1) > 0.001;
            drawScaledFrame(fctx, origIdx, sc * cw, sr * ch, cw, ch, dc * dcw, dr * dch, dcw, dch);
            // Grid cell border
            fctx.strokeStyle = origIdx !== slot ? 'rgba(251, 146, 60, 0.9)' : (isScaled ? 'rgba(16, 185, 129, 0.9)' : 'rgba(56, 189, 248, 0.55)');
            fctx.lineWidth = Math.max(1, Math.round(2 * fScale));
            fctx.strokeRect(dc * dcw + 0.5, dr * dch + 0.5, dcw - 1, dch - 1);
            // Number badge top-left of each cell
            const bw = Math.max(22, Math.min(34, dcw * 0.24));
            const bh = Math.max(18, Math.min(26, dch * 0.22));
            fctx.fillStyle = origIdx !== slot ? '#ea580c' : '#0f172a';
            fctx.beginPath();
            fctx.roundRect(dc * dcw + 4, dr * dch + 4, bw, bh, 5);
            fctx.fill();
            fctx.fillStyle = '#ffffff';
            fctx.font = `800 ${Math.max(11, Math.round(bh * 0.62))}px monospace`;
            fctx.textAlign = 'center';
            fctx.textBaseline = 'middle';
            fctx.fillText(String(slot + 1), dc * dcw + 4 + bw / 2, dr * dch + 4 + bh / 2);
            // Scale badge bottom-right of cell when scaled
            if (isScaled) {
              const swBadge = Math.max(34, Math.min(48, dcw * 0.36));
              const shBadge = Math.max(16, Math.min(22, dch * 0.18));
              const bx = dc * dcw + dcw - swBadge - 4;
              const by = dr * dch + dch - shBadge - 4;
              fctx.fillStyle = '#059669';
              fctx.beginPath();
              fctx.roundRect(bx, by, swBadge, shBadge, 4);
              fctx.fill();
              fctx.fillStyle = '#ffffff';
              fctx.font = `700 ${Math.max(9, Math.round(shBadge * 0.6))}px monospace`;
              fctx.fillText(`${frameScale.toFixed(2)}×`, bx + swBadge / 2, by + shBadge / 2);
            }
          }
        }
      }

      async function buildCleanReorderedCanvas(targetCols = null, targetRows = null) {
        const srcCols = Math.max(1, Number(props.cols) || 1);
        const srcRows = Math.max(1, Number(props.rows) || 1);
        const n = totalFrames.value;
        const cw = origImg.naturalWidth / srcCols;
        const ch = origImg.naturalHeight / srcRows;
        const outCols = targetCols ? Math.max(1, targetCols) : srcCols;
        const outRows = targetRows ? Math.max(1, targetRows) : srcRows;
        const out = document.createElement('canvas');
        out.width = Math.round(cw * outCols);
        out.height = Math.round(ch * outRows);
        const ctx = out.getContext('2d');
        for (let slot = 0; slot < n; slot++) {
          const origIdx = order.value[slot];
          const sc = origIdx % srcCols;
          const sr = Math.floor(origIdx / srcCols);
          const dc = slot % outCols;
          const dr = Math.floor(slot / outCols);
          drawScaledFrame(ctx, origIdx, sc * cw, sr * ch, cw, ch, dc * cw, dr * ch, cw, ch);
        }
        return out;
      }

      async function emitReorderedFile() {
        if (!origImg) return;
        const out = await buildCleanReorderedCanvas();
        const blob = await new Promise((r) => out.toBlob(r, 'image/png'));
        const fName = `${props.charId || 'char'}_${props.actionId || 'action'}_${props.cols}x${props.rows}.png`;
        const newFile = new File([blob], fName, { type: 'image/png' });
        newFile._skipPreprocess = true;
        dirty.value = computeDirty();
        ignoreNextSrc = 'PENDING_SELF_EMIT';
        emit('reordered', newFile);
      }

      function scheduleEmitReordered() {
        if (scaleEmitTimer) clearTimeout(scaleEmitTimer);
        scaleEmitTimer = setTimeout(() => {
          scaleEmitTimer = null;
          emitReorderedFile();
        }, 120);
      }

      function onScaleStart() {
        if (!scaleDragSnapshot) {
          scaleDragSnapshot = { order: [...order.value], scales: [...scales.value] };
        }
      }

      function onFrameScaleInput(origIdx, val) {
        const clamped = Math.round(Math.max(1, Math.min(2, Number(val) || 1)) * 100) / 100;
        const next = [...scales.value];
        next[origIdx] = clamped;
        scales.value = next;
        dirty.value = computeDirty();
        renderThumbsAndFull();
        scheduleEmitReordered();
      }

      async function onFrameScaleChange(origIdx, val) {
        if (scaleDragSnapshot) {
          pushHistorySnapshot(scaleDragSnapshot);
          scaleDragSnapshot = null;
        } else {
          pushHistorySnapshot();
        }
        const clamped = Math.round(Math.max(1, Math.min(2, Number(val) || 1)) * 100) / 100;
        const next = [...scales.value];
        next[origIdx] = clamped;
        scales.value = next;
        dirty.value = computeDirty();
        renderThumbsAndFull();
        if (scaleEmitTimer) { clearTimeout(scaleEmitTimer); scaleEmitTimer = null; }
        await emitReorderedFile();
      }

      async function resetFrameScale(origIdx) {
        if (Math.abs((Number(scales.value[origIdx]) || 1) - 1) <= 0.001) return;
        pushHistorySnapshot();
        const next = [...scales.value];
        next[origIdx] = 1;
        scales.value = next;
        renderThumbsAndFull();
        await emitReorderedFile();
      }

      async function resetAllScales() {
        if (!hasScaleChanges.value) return;
        pushHistorySnapshot();
        scales.value = Array.from({ length: totalFrames.value }, () => 1);
        renderThumbsAndFull();
        await emitReorderedFile();
      }

      async function exportPng() {
        if (!origImg) return;
        const n = totalFrames.value;
        const expCols = Math.min(5, n);
        const expRows = Math.max(1, Math.ceil(n / expCols));
        const out = await buildCleanReorderedCanvas(expCols, expRows);
        const url = out.toDataURL('image/png');
        const a = document.createElement('a');
        a.href = url;
        a.download = `${props.charId || 'char'}_${props.actionId || 'action'}_${expCols}x${expRows}_${n}f.png`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        toast(`⬇ 已匯出 ${expCols}×${expRows}（${n} 幀）Sprite Sheet PNG！`, 'success');
      }

      function onDragStart(slot, ev) {
        dragFrom.value = slot;
        if (ev && ev.dataTransfer) {
          ev.dataTransfer.effectAllowed = 'move';
          try { ev.dataTransfer.setData('text/plain', String(slot)); } catch (_) {}
        }
      }
      function onDragOver(slot) {
        if (dragFrom.value >= 0) dragOver.value = slot;
      }
      function onDragEnd() {
        dragFrom.value = -1;
        dragOver.value = -1;
      }
      async function onDrop(targetSlot) {
        const from = dragFrom.value;
        dragFrom.value = -1;
        dragOver.value = -1;
        if (from < 0 || from === targetSlot) return;
        pushHistorySnapshot();
        const next = [...order.value];
        if (mode.value === 'swap') {
          const tmp = next[from];
          next[from] = next[targetSlot];
          next[targetSlot] = tmp;
        } else {
          const [moved] = next.splice(from, 1);
          next.splice(targetSlot, 0, moved);
        }
        order.value = next;
        renderThumbsAndFull();
        await emitReorderedFile();
      }

      async function undo() {
        if (!history.value.length) return;
        const prev = history.value.pop();
        order.value = [...prev.order];
        scales.value = [...prev.scales];
        renderThumbsAndFull();
        await emitReorderedFile();
      }
      async function reverseAll() {
        if (!order.value.length) return;
        pushHistorySnapshot();
        order.value = [...order.value].reverse();
        renderThumbsAndFull();
        await emitReorderedFile();
      }
      async function resetOrder() {
        if (!origImg) return;
        pushHistorySnapshot();
        order.value = Array.from({ length: totalFrames.value }, (_, i) => i);
        scales.value = Array.from({ length: totalFrames.value }, () => 1);
        renderThumbsAndFull();
        await emitReorderedFile();
      }

      function loadSource(src) {
        if (!src) {
          origImg = null;
          origAnchorYRatios = [];
          thumbs.value = [];
          return;
        }
        if (ignoreNextSrc === 'PENDING_SELF_EMIT' && src.startsWith('blob:')) {
          ignoreNextSrc = src;
          return;
        }
        if (src === ignoreNextSrc) return;
        ignoreNextSrc = '';
        const im = new Image();
        im.crossOrigin = 'anonymous';
        im.onload = () => {
          origImg = im;
          resetOrderState();
          computeOrigAnchors();
          renderThumbsAndFull();
        };
        im.src = src;
      }

      watch(() => props.src, (s) => loadSource(s), { immediate: true });
      watch(() => [props.cols, props.rows, props.frames], () => {
        if (origImg) {
          resetOrderState();
          computeOrigAnchors();
          renderThumbsAndFull();
        }
      });
      watch(showFullSheet, (v) => { if (v && origImg) nextTick(renderThumbsAndFull); });

      return {
        fullCanvas, thumbs, order, scales, history, dragFrom, dragOver, mode, darkBg,
        showFullSheet, zoomOpen, imgSize, dirty, hasScaleChanges, totalFrames,
        onDragStart, onDragOver, onDragEnd, onDrop, undo, reverseAll, resetOrder,
        onScaleStart, onFrameScaleInput, onFrameScaleChange, resetFrameScale, resetAllScales, exportPng,
      };
    },
    template: `
      <div v-if="src" id="spriteSheetSorter" class="border rounded-xl p-3 bg-slate-50/90 space-y-2.5">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <div class="flex items-center gap-2">
            <span class="font-semibold text-sm text-slate-800">🎞️ 完整 Sprite Sheet 檢視、拖曳重排與單幀縮放</span>
            <span class="text-[11px] font-mono px-2 py-0.5 rounded bg-slate-200 text-slate-700">{{ cols }}×{{ rows }} · {{ totalFrames }} 幀 · {{ imgSize.w }}×{{ imgSize.h }}px</span>
            <span v-if="dirty" class="text-[11px] px-2 py-0.5 rounded bg-amber-100 text-amber-800 font-semibold">✨ 已調整順序／大小（記得存檔或匯出）</span>
          </div>
          <div class="flex flex-wrap items-center gap-1.5 text-xs">
            <div class="inline-flex rounded border overflow-hidden bg-white">
              <button type="button" @click="mode='swap'" :class="['px-2 py-1', mode==='swap' ? 'bg-indigo-600 text-white font-semibold' : 'text-slate-600 hover:bg-slate-100']" title="拖曳第 7 幀到第 9 幀上，兩幀直接互換">🔄 互換兩幀</button>
              <button type="button" @click="mode='insert'" :class="['px-2 py-1 border-l', mode==='insert' ? 'bg-indigo-600 text-white font-semibold' : 'text-slate-600 hover:bg-slate-100']" title="將拖曳的幀插入目標位置，其餘幀順移">📌 插入移位</button>
            </div>
            <button type="button" @click="undo" :disabled="!history.length" class="px-2 py-1 rounded border bg-white hover:bg-slate-100 disabled:opacity-40">↩ 復原</button>
            <button type="button" @click="reverseAll" class="px-2 py-1 rounded border bg-white hover:bg-slate-100" title="將全部幀倒序排列">⇄ 反轉</button>
            <button type="button" @click="resetAllScales" :disabled="!hasScaleChanges" class="px-2 py-1 rounded border bg-white hover:bg-slate-100 disabled:opacity-40" title="將所有幀縮放重設回 1.00×">🔍 重設大小</button>
            <button type="button" @click="resetOrder" :disabled="!dirty" class="px-2 py-1 rounded border bg-white hover:bg-slate-100 disabled:opacity-40">↺ 全部重設</button>
            <button type="button" @click="darkBg=!darkBg" class="px-2 py-1 rounded border bg-white hover:bg-slate-100">{{ darkBg ? '🌙 暗底' : '☀️ 亮底' }}</button>
            <button type="button" @click="showFullSheet=!showFullSheet" class="px-2 py-1 rounded border bg-white hover:bg-slate-100">{{ showFullSheet ? '🙈 隱藏大圖' : '🖼️ 顯示完整大圖' }}</button>
            <button id="btnExportReorderedSheet" type="button" @click="exportPng" class="px-2.5 py-1 rounded bg-sky-600 hover:bg-sky-700 text-white font-semibold shadow-sm">⬇ 匯出 {{ Math.min(5, totalFrames) }}×{{ Math.max(1, Math.ceil(totalFrames / Math.min(5, totalFrames))) }} PNG</button>
          </div>
        </div>

        <!-- Full Numbered Sprite Sheet Big Image -->
        <div v-show="showFullSheet" :class="['rounded-lg border overflow-x-auto p-2 transition', darkBg ? 'bg-slate-900 border-slate-700' : 'checker border-slate-300']">
          <div class="flex items-center justify-between text-[11px] mb-1 px-1" :class="darkBg ? 'text-slate-300' : 'text-slate-600'">
            <span>🖼️ 完整 Sprite Sheet 大圖（附格線與編號，直接滑鼠拖曳下方卡片可重排，下方滑桿可微調每幀 1.00×～2.00× 大小）</span>
            <button type="button" @click="zoomOpen=true" class="underline hover:text-sky-400">🔍 放大檢視</button>
          </div>
          <canvas ref="fullCanvas" @click="zoomOpen=true" class="max-h-56 w-auto max-w-none cursor-zoom-in rounded"></canvas>
        </div>

        <!-- Draggable Numbered Frame Cards with Per-Frame 1x~2x Scale Slider -->
        <div class="grid gap-2" :style="{ gridTemplateColumns: 'repeat(auto-fill, minmax(112px, 1fr))' }">
          <div v-for="item in thumbs" :key="item.slot"
               draggable="true"
               @dragstart="onDragStart(item.slot, $event)"
               @dragover.prevent="onDragOver(item.slot)"
               @drop.prevent="onDrop(item.slot)"
               @dragend="onDragEnd"
               :class="['relative rounded-lg border-2 p-1 cursor-grab active:cursor-grabbing select-none transition flex flex-col',
                        darkBg ? 'bg-slate-900' : 'checker bg-white',
                        dragOver === item.slot ? 'border-sky-400 ring-2 ring-sky-300 scale-105' :
                        (dragFrom === item.slot ? 'opacity-40 border-indigo-400' :
                        (item.origIdx !== item.slot ? 'border-amber-400' :
                        (item.scale > 1.001 ? 'border-emerald-400' : 'border-slate-300 hover:border-indigo-400')))]">
            <span :class="['absolute top-1 left-1 px-1.5 py-0.5 rounded text-[11px] font-mono font-bold leading-none shadow z-10',
                           item.origIdx !== item.slot ? 'bg-amber-500 text-white' : 'bg-indigo-600 text-white']">
              {{ item.slot + 1 }}
            </span>
            <span v-if="item.origIdx !== item.slot"
                  class="absolute top-1 right-1 px-1 py-0.5 rounded text-[9px] font-mono bg-slate-800/85 text-amber-300 leading-none z-10">
              原#{{ item.origIdx + 1 }}
            </span>
            <img :src="item.dataUrl" class="w-full h-20 object-contain pointer-events-none" />
            <!-- Per-frame scale control (1.00x ~ 2.00x) -->
            <div class="mt-1 pt-1 border-t border-slate-600/30 flex items-center gap-1 px-0.5 rounded bg-slate-800/85 text-white cursor-default"
                 draggable="false"
                 @dragstart.stop.prevent
                 @mousedown.stop
                 @pointerdown.stop>
              <input type="range"
                     min="1"
                     max="2"
                     step="0.05"
                     :value="item.scale"
                     :data-frame-scale="item.slot + 1"
                     @pointerdown="onScaleStart"
                     @mousedown="onScaleStart"
                     @input="onFrameScaleInput(item.origIdx, $event.target.value)"
                     @change="onFrameScaleChange(item.origIdx, $event.target.value)"
                     class="w-full h-1.5 accent-emerald-400 cursor-pointer"
                     :title="'微調第 ' + (item.slot + 1) + ' 幀大小（1.00× ~ 2.00×，腳底自動貼齊地面）'" />
              <button type="button"
                      @click.stop="resetFrameScale(item.origIdx)"
                      :class="['text-[10px] font-mono leading-none px-1 py-0.5 rounded shrink-0',
                               item.scale > 1.001 ? 'bg-emerald-500 text-white font-bold hover:bg-emerald-600' : 'text-slate-300 hover:text-white']"
                      :title="item.scale > 1.001 ? '點擊還原為 1.00×' : '目前為 1.00× 原尺寸'">
                {{ item.scale.toFixed(2) }}×
              </button>
            </div>
          </div>
        </div>
        <p class="text-[11px] text-slate-500">
          💡 提示：拖曳任一幀卡片可重排順序；每張卡片下方的滑桿可獨立微調該幀大小（<b>1.00× ～ 2.00×</b>，放大時腳底自動鎖定地面不浮空、不溢出相鄰格，點擊右側倍率數字可快速還原 1.00×），右側動畫預覽會即時同步，完成後按 <b>⬇ 匯出 Sprite Sheet</b> 或 <b>💾 存檔（套用到遊戲）</b> 即可永久生效。
        </p>

        <!-- Full-Width Zoom Lightbox -->
        <div v-if="zoomOpen" class="fixed inset-0 z-50 bg-slate-950/85 flex items-center justify-center p-4" @click.self="zoomOpen=false">
          <div class="bg-white rounded-xl shadow-2xl max-w-[95vw] w-full overflow-hidden">
            <div class="px-4 py-2.5 bg-slate-100 flex items-center justify-between border-b">
              <span class="font-semibold text-sm">🖼️ 完整 Sprite Sheet 大圖（{{ cols }}×{{ rows }} · {{ totalFrames }} 幀 · {{ imgSize.w }}×{{ imgSize.h }}px）</span>
              <div class="flex gap-2">
                <button type="button" @click="exportPng" class="text-xs px-2.5 py-1 rounded bg-sky-600 text-white font-semibold">⬇ 匯出 PNG</button>
                <button type="button" @click="zoomOpen=false" class="text-xs px-2.5 py-1 rounded border bg-white">✕ 關閉</button>
              </div>
            </div>
            <div :class="['p-4 overflow-auto max-h-[82vh]', darkBg ? 'bg-slate-900' : 'checker']">
              <img :src="src" class="max-w-none h-auto min-h-[220px] rounded shadow" />
            </div>
          </div>
        </div>
      </div>`,
  };

  // ---------- Characters tab ----------
  const CharactersTab = {
    components: { SpritePreview, SpriteSheetSorter, DropZone, ConditionEditor, AiModifyModal, FxBubbleEditor },
    setup() {
      const selectedId = ref(null);
      const selectedActionId = ref(null);
      const isNewChar = ref(false);
      const charForm = reactive({ id: '', name: '' });
      const blankAction = () => ({ id: '', label: '', cols: 5, rows: 2, frames: 10, fps: 14, loop: false, trigger: 'on_attack', condition: '', priority: 0, png: null, webp: null, sheetKey: null, fx: defaultFxForAction() });
      const actionForm = reactive(blankAction());
      const isNewAction = ref(true);
      const file = ref(null);
      const localUrl = ref('');
      const condOk = ref(true);
      const filter = ref('');
      const roleFilter = ref('all'); // 'all' | 'hero' | 'boss' | 'monster' | 'custom'
      const aiModalOpen = ref(false);
      const turnaroundZoom = ref(false);
      const turnaroundLocalUrl = ref('');

      const allCharacters = computed(() => getMergedCharacters());
      const characters = computed(() => allCharacters.value.filter((c) => {
        if (roleFilter.value === 'custom' && !c.hasCustom && c.builtin) return false;
        if (['hero', 'boss', 'monster'].includes(roleFilter.value) && c.role !== roleFilter.value) return false;
        if (filter.value && !(c.id + ' ' + c.name).toLowerCase().includes(filter.value.toLowerCase())) return false;
        return true;
      }));
      const current = computed(() => allCharacters.value.find((c) => c.id === selectedId.value));
      const currentAction = computed(() => current.value?.actions.find((a) => a.id === selectedActionId.value));
      const turnaroundSrc = computed(() => {
        if (turnaroundLocalUrl.value) return turnaroundLocalUrl.value;
        if (current.value && current.value.turnaround) {
          return rawUrl(current.value.turnaround, current.value.turnaroundUpdatedAt, !!current.value.turnaroundBuiltin);
        }
        return '';
      });
      const previewSrc = computed(() => {
        if (localUrl.value) return localUrl.value;
        if (currentAction.value && !isNewAction.value) {
          if (currentAction.value.localDataUrl) return currentAction.value.localDataUrl;
          return rawUrl(currentAction.value.png || currentAction.value.webp, currentAction.value.updatedAt, !!currentAction.value.builtin);
        }
        return '';
      });
      const autoRemoveWhiteBg = ref(true);
      const autoPadWideCell = ref(true);
      function applyGridPreset(p) {
        actionForm.cols = p.cols;
        actionForm.rows = p.rows;
        actionForm.frames = p.frames;
      }

      function autoDetectGridFromImage(url) {
        const im = new Image();
        im.onload = () => {
          if (!im.naturalWidth || !im.naturalHeight) return;
          const w = im.naturalWidth;
          const h = im.naturalHeight;
          const curC = Math.max(1, Number(actionForm.cols) || 1);
          const curR = Math.max(1, Number(actionForm.rows) || 1);
          const curCellRatio = (w / curC) / (h / curR);
          if (curCellRatio >= 0.55 && curCellRatio <= 1.85) {
            if ((Number(actionForm.frames) || 0) <= 1 && curC * curR > 1) {
              actionForm.frames = curC * curR;
            }
            return;
          }
          const ratio = w / h;
          let detC = curC; let detR = curR;
          if (ratio >= 7.5) {
            const est = Math.round(w / (h * (420 / 340)));
            const candidates = [10, 11, 12, 14, 16, 20];
            detC = candidates.reduce((best, v) => Math.abs(v - est) < Math.abs(best - est) ? v : best, 10);
            detR = 1;
          } else if (ratio >= 1.55 && ratio <= 3.3) {
            detC = 5; detR = 2;
          } else if (ratio >= 1.05 && ratio < 1.55) {
            detC = 5; detR = 4;
          } else if (ratio >= 0.7 && ratio < 1.05) {
            detC = 5; detR = 6;
          }
          if (detC !== curC || detR !== curR) {
            actionForm.cols = detC;
            actionForm.rows = detR;
            actionForm.frames = detC * detR;
            toast(`✨ 已自動偵測精靈表格數為 ${detC}×${detR}（${detC * detR} 幀）`, 'info');
          }
        };
        im.src = url;
      }

      watch(file, (f) => {
        if (localUrl.value) URL.revokeObjectURL(localUrl.value);
        localUrl.value = f ? URL.createObjectURL(f) : '';
        if (f && !f._skipPreprocess && localUrl.value) {
          autoDetectGridFromImage(localUrl.value);
        }
      });
      watch(selectedId, () => {
        if (turnaroundLocalUrl.value) { URL.revokeObjectURL(turnaroundLocalUrl.value); turnaroundLocalUrl.value = ''; }
      });

      async function uploadTurnaround(f) {
        if (!f || !ID_RE.test(charForm.id || '')) { toast('請先選擇或輸入有效的角色 ID', 'error'); return; }
        if (!/^image\/(png|jpeg|webp)$/.test(f.type)) { toast('三視圖只支援 PNG / JPG / WebP', 'error'); return; }
        if (f.size > 10 * 1024 * 1024) { toast('檔案超過 10MB', 'error'); return; }
        if (turnaroundLocalUrl.value) URL.revokeObjectURL(turnaroundLocalUrl.value);
        turnaroundLocalUrl.value = URL.createObjectURL(f);
        if (store.mode === 'github' && !store.ghToken) {
          toast('已暫時套用於本機預覽與 AI 參考（設定 GitHub Token 後即可建立 PR 永久保存）', 'info');
          return;
        }
        store.busy = true;
        try {
          const bmp = await createImageBitmap(f);
          const c = document.createElement('canvas');
          const scale = bmp.width > 1400 ? 1400 / bmp.width : 1;
          c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
          c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
          bmp.close();
          const webpBlob = await new Promise((r) => c.toBlob(r, 'image/webp', 0.92));
          const b64 = bytesToBase64(new Uint8Array(await webpBlob.arrayBuffer()));
          const targetPath = `assets/turnarounds/${charForm.id}_turnaround.webp`;
          const res = await ghApi(`/contents/${MANIFEST_PATH}?ref=${encodeURIComponent(store.ghBranch)}`, { allow404: true });
          const manifest = normalizeManifest(res && res.content ? JSON.parse(base64ToStr(res.content)) : null);
          let ch = manifest.characters.find((x) => x.id === charForm.id);
          if (!ch) { ch = { id: charForm.id, name: charForm.name || charForm.id, actions: [] }; manifest.characters.push(ch); }
          ch.turnaround = targetPath;
          ch.turnaroundUpdatedAt = new Date().toISOString();
          const files = [
            { path: targetPath, b64 },
            { path: MANIFEST_PATH, b64: strToBase64(JSON.stringify(manifest, null, 2) + '\n') },
          ];
          const prRes = await ghCommitAndOpenPR(files, `Editor: update turnaround sheet for ${charForm.id}`);
          recordResult(`角色三視圖 ${charForm.id}`, prRes);
          await loadManifest();
        } catch (e) {
          toast(`上傳三視圖失敗：${e.message}`, 'error');
        } finally { store.busy = false; }
      }

      function selectChar(c) {
        isNewChar.value = false; selectedId.value = c.id; Object.assign(charForm, { id: c.id, name: c.name });
        if (c.actions.length) selectAction(c.actions[0]); else newAction();
      }
      function newChar() {
        isNewChar.value = true; selectedId.value = null; Object.assign(charForm, { id: '', name: '' }); newAction();
      }
      function selectAction(a) {
        isNewAction.value = false; selectedActionId.value = a.id; file.value = null;
        const cloned = JSON.parse(JSON.stringify(a));
        cloned.fx = { ...defaultFxForAction(a.id), ...(cloned.fx || {}) };
        Object.assign(actionForm, blankAction(), cloned);
      }
      function newAction() {
        isNewAction.value = true; selectedActionId.value = null; file.value = null; Object.assign(actionForm, blankAction());
      }
      function onAiApply(payload) {
        actionForm.cols = payload.cols;
        actionForm.rows = payload.rows;
        actionForm.frames = payload.frames;
        actionForm.fps = payload.fps;
        file.value = payload.file;
        toast('已套用 AI 生成結果！請點「💾 存檔（套用到遊戲）」或「☁️ 儲存並建立 PR」', 'success');
      }
      watch(() => [actionForm.cols, actionForm.rows], ([c, r], [oc, or]) => {
        const nc = Math.max(1, Number(c) || 1);
        const nr = Math.max(1, Number(r) || 1);
        const prevMax = Math.max(1, (Number(oc) || 1) * (Number(or) || 1));
        const curF = Number(actionForm.frames) || 0;
        if (curF > nc * nr || curF === prevMax || curF <= 1 || isNewAction.value) {
          actionForm.frames = nc * nr;
        }
      });

      onMounted(() => {
        if (!selectedId.value && !isNewChar.value && allCharacters.value.length) {
          selectChar(allCharacters.value[0]);
        }
      });

      const saveBlockReason = computed(() => {
        if (store.busy) return '處理中…';
        if (!ID_RE.test(charForm.id || '')) return '請輸入有效角色 ID（英數與底線）';
        if (!ID_RE.test(actionForm.id || '')) return '請輸入有效動作 ID（英數與底線）';
        if (!condOk.value) return '觸發條件式語法有誤';
        if (!file.value && isNewAction.value) return '新動作請先上傳精靈表圖片';
        return '';
      });
      const canSave = computed(() => !saveBlockReason.value);

      function onSheetReordered(newFile) {
        file.value = newFile;
      }

      async function prepareUploadFile() {
        if (!file.value) return null;
        if (file.value._skipPreprocess || (!autoRemoveWhiteBg.value && !autoPadWideCell.value)) return file.value;
        const c = await renderSpriteToCanvas(file.value, {
          cols: Number(actionForm.cols) || 10,
          rows: Number(actionForm.rows) || 1,
          frames: Number(actionForm.frames) || null,
          removeWhiteBg: autoRemoveWhiteBg.value,
          padWideCell: autoPadWideCell.value,
        });
        const pngBlob = await new Promise((r) => c.toBlob(r, 'image/png'));
        return new File([pngBlob], `${actionForm.id || 'sprite'}.png`, { type: 'image/png' });
      }

      async function saveLocal() {
        if (!canSave.value) return;
        store.busy = true;
        try {
          const cols = Math.max(1, Math.min(24, Number(actionForm.cols) || 10));
          const rows = Math.max(1, Math.min(20, Number(actionForm.rows) || 1));
          const frames = Math.max(1, Math.min(cols * rows, Number(actionForm.frames) || cols * rows));
          const fps = Math.max(1, Math.min(60, Number(actionForm.fps) || 14));
          const src = file.value || previewSrc.value;
          if (!src) throw new Error('沒有可儲存的精靈表圖片');
          const skipPre = !!(file.value && file.value._skipPreprocess);
          const c = await renderSpriteToCanvas(src, {
            cols,
            rows,
            frames,
            removeWhiteBg: !!file.value && !skipPre && autoRemoveWhiteBg.value,
            padWideCell: !!file.value && !skipPre && autoPadWideCell.value,
          });
          const dataUrl = c.toDataURL('image/png');
          const cellW = c.width / cols;
          const cellH = c.height / rows;
          const isWidePadded = cellW === WIDE_CELL_W && cellH === WIDE_CELL_H;
          const sheetKey = actionForm.sheetKey || actionForm.id;
          await LocalGameDB.putSheet(sheetKey, {
            dataUrl,
            cols,
            rows,
            frameCount: frames,
            fps,
            anchorX: isWidePadded ? WIDE_ANCHOR_X : Math.round(cellW * 0.5),
            anchorY: isWidePadded ? WIDE_ANCHOR_Y : Math.round(cellH * 0.91),
            label: actionForm.label || actionForm.id,
            trigger: actionForm.trigger || 'on_attack',
            condition: (actionForm.condition || '').trim(),
            priority: Number(actionForm.priority) || 0,
            loop: !!actionForm.loop,
            fx: actionForm.fx ? JSON.parse(JSON.stringify(actionForm.fx)) : defaultFxForAction(actionForm.id),
            charId: charForm.id,
            actionId: actionForm.id,
            updatedAt: Date.now(),
          });
          await loadLocalOverrides();
          file.value = null;
          const updated = allCharacters.value.find((ch) => ch.id === charForm.id)?.actions.find((a) => a.id === actionForm.id);
          if (updated) selectAction(updated);
          toast('💾 存檔成功！已套用到本機遊戲，點左上「← 返回大亂鬥」即可立即試玩', 'success');
        } catch (e) {
          toast(`存檔失敗：${e.message}`, 'error');
        } finally { store.busy = false; }
      }

      async function revertLocal() {
        const sheetKey = currentAction.value?.sheetKey || actionForm.sheetKey || actionForm.id;
        if (!sheetKey) return;
        if (!confirm(`確定要還原「${actionForm.label || actionForm.id}」為預設動畫？`)) return;
        store.busy = true;
        try {
          await LocalGameDB.deleteSheet(sheetKey);
          await loadLocalOverrides();
          const orig = allCharacters.value.find((ch) => ch.id === charForm.id)?.actions.find((a) => a.id === actionForm.id);
          if (orig) selectAction(orig);
          toast('↩ 已還原為預設動畫', 'info');
        } catch (e) {
          toast(`還原失敗：${e.message}`, 'error');
        } finally { store.busy = false; }
      }

      async function save() {
        const processedFile = await prepareUploadFile();
        const payload = { id: charForm.id, name: charForm.name || charForm.id, action: { ...actionForm } };
        const ok = await submitEntry('characters', payload, processedFile, `角色 ${charForm.id} / 動作 ${actionForm.id}`);
        if (ok) {
          const cid = charForm.id; const aid = actionForm.id;
          isNewChar.value = false; selectedId.value = cid;
          const a = allCharacters.value.find((c) => c.id === cid)?.actions.find((x) => x.id === aid);
          if (a) selectAction(a);
        }
      }
      async function removeAction() {
        if (await deleteEntry({ section: 'characters', id: charForm.id, actionId: actionForm.id }, `動作 ${charForm.id}/${actionForm.id}`)) {
          const a = allCharacters.value.find((c) => c.id === charForm.id)?.actions[0];
          if (a) selectAction(a); else newAction();
        }
      }
      async function removeChar() {
        if (await deleteEntry({ section: 'characters', id: charForm.id }, `角色 ${charForm.id}`)) {
          if (allCharacters.value.length) selectChar(allCharacters.value[0]); else newChar();
        }
      }
      const roleTabs = [
        { k: 'all', t: '全部' }, { k: 'hero', t: '主角' }, { k: 'boss', t: 'BOSS' },
        { k: 'monster', t: '怪物' }, { k: 'custom', t: '✨自訂' },
      ];
      return { store, allCharacters, characters, current, currentAction, selectedId, selectedActionId, isNewChar, charForm, actionForm, isNewAction,
        file, condOk, filter, roleFilter, roleTabs, aiModalOpen, turnaroundSrc, turnaroundZoom, previewSrc, autoRemoveWhiteBg, autoPadWideCell, GRID_PRESETS, applyGridPreset, saveBlockReason, canSave, TRIGGER_LABELS,
        selectChar, newChar, selectAction, newAction, uploadTurnaround, onAiApply, onSheetReordered, saveLocal, revertLocal, save, removeAction, removeChar };
    },
    template: `
      <div class="grid grid-cols-12 gap-4">
        <aside class="col-span-12 md:col-span-4 lg:col-span-3 bg-white rounded shadow p-3 space-y-2">
          <div class="flex gap-2">
            <input v-model="filter" :placeholder="'搜尋角色（共 ' + allCharacters.length + ' 位）…'" class="flex-1 border rounded px-2 py-1 text-sm" />
            <button @click="newChar" title="新增自訂角色" class="px-2.5 rounded bg-indigo-600 text-white text-sm">＋</button>
          </div>
          <div class="flex flex-wrap gap-1">
            <button v-for="rt in roleTabs" :key="rt.k" @click="roleFilter=rt.k"
                    :class="['text-xs px-2 py-0.5 rounded-full border', roleFilter===rt.k ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-slate-50 hover:bg-slate-100']">{{ rt.t }}</button>
          </div>
          <p v-if="!characters.length" class="text-sm text-slate-400 py-2">找不到符合的角色</p>
          <ul class="divide-y max-h-[68vh] overflow-y-auto pr-1">
            <li v-for="c in characters" :key="c.id" @click="selectChar(c)"
                :class="['py-2 px-2 cursor-pointer rounded text-sm', c.id===selectedId ? 'bg-indigo-50 font-semibold text-indigo-900' : 'hover:bg-slate-50']">
              <div class="flex items-center justify-between gap-1">
                <span class="truncate">{{ c.name }}</span>
                <span v-if="c.hasCustom" class="text-[10px] px-1.5 rounded bg-emerald-100 text-emerald-700 shrink-0">自訂</span>
              </div>
              <div class="text-xs text-slate-400">#{{ c.id }} · {{ c.actions.length }} 個動畫</div>
            </li>
          </ul>
        </aside>

        <section class="col-span-12 md:col-span-8 lg:col-span-9 bg-white rounded shadow p-4 space-y-4">
          <div class="grid grid-cols-12 gap-3 items-start">
            <div class="col-span-12 lg:col-span-7 grid grid-cols-2 gap-3">
              <label class="text-sm">角色 ID <input v-model.trim="charForm.id" :disabled="!isNewChar && !!selectedId" placeholder="red_panda"
                class="w-full border rounded px-2 py-1 font-mono disabled:bg-slate-100" /></label>
              <label class="text-sm">顯示名稱 <input v-model="charForm.name" placeholder="紅熊貓" class="w-full border rounded px-2 py-1" /></label>
            </div>
            <!-- Character Turnaround Reference Card -->
            <div class="col-span-12 lg:col-span-5 flex items-center gap-3 bg-slate-50 border rounded-lg p-2">
              <div @click="turnaroundSrc && (turnaroundZoom=true)"
                   :class="['checker w-24 h-16 rounded border overflow-hidden shrink-0 flex items-center justify-center', turnaroundSrc ? 'cursor-zoom-in' : '']">
                <img v-if="turnaroundSrc" :src="turnaroundSrc" class="max-w-full max-h-full object-contain" alt="角色三視圖" />
                <span v-else class="text-[10px] text-slate-400 text-center">尚無三視圖</span>
              </div>
              <div class="flex-1 min-w-0 space-y-1">
                <div class="text-xs font-semibold text-slate-700 flex items-center gap-1">
                  <span>🧍 角色設定三視圖</span>
                  <span v-if="turnaroundSrc" class="text-[10px] font-normal px-1 rounded bg-indigo-100 text-indigo-700">AI 自動帶入</span>
                </div>
                <div class="flex flex-wrap gap-1.5">
                  <button v-if="turnaroundSrc" @click="turnaroundZoom=true" class="text-[11px] px-2 py-0.5 rounded border bg-white hover:bg-slate-100">🔍 檢視大圖</button>
                  <label class="text-[11px] px-2 py-0.5 rounded bg-indigo-600 text-white cursor-pointer hover:bg-indigo-700">
                    📤 更換三視圖
                    <input type="file" accept="image/png,image/jpeg,image/webp" class="hidden"
                           @change="uploadTurnaround($event.target.files[0]); $event.target.value=''" />
                  </label>
                  <a v-if="turnaroundSrc" :href="turnaroundSrc" :download="(charForm.id || 'char') + '_turnaround.webp'"
                     class="text-[11px] px-2 py-0.5 rounded border bg-white text-indigo-700 hover:bg-indigo-50">⬇ 下載</a>
                </div>
              </div>
            </div>
          </div>

          <div v-if="current" class="flex flex-wrap gap-1.5 items-center">
            <span class="text-sm text-slate-500">動畫 ({{ current.actions.length }})：</span>
            <button v-for="a in current.actions" :key="a.id" @click="selectAction(a)"
                    :class="['px-3 py-1 rounded-full text-xs border transition', a.id===selectedActionId ? 'bg-indigo-600 text-white border-indigo-600' : 'hover:bg-slate-100']">
              {{ a.label || a.id }}
              <span v-if="a.localSaved" class="ml-1" title="已存檔於本機遊戲">💾</span>
              <span v-else-if="a.customized" class="ml-1 opacity-90">✨</span>
            </button>
            <button @click="newAction" :class="['px-3 py-1 rounded-full text-xs border border-dashed', isNewAction ? 'border-indigo-500 text-indigo-600 font-semibold' : '']">＋ 新動作</button>
          </div>

          <div class="grid grid-cols-12 gap-4">
            <div class="col-span-12 lg:col-span-7 space-y-3">
              <div class="grid grid-cols-2 gap-3">
                <label class="text-sm">動作 ID <input v-model.trim="actionForm.id" :disabled="!isNewAction" placeholder="uppercut"
                  class="w-full border rounded px-2 py-1 font-mono disabled:bg-slate-100" /></label>
                <label class="text-sm">名稱 <input v-model="actionForm.label" placeholder="升龍拳" class="w-full border rounded px-2 py-1" /></label>
              </div>
              <div class="grid grid-cols-5 gap-2">
                <label class="text-sm">欄 <input type="number" min="1" max="24" v-model.number="actionForm.cols" class="w-full border rounded px-1" /></label>
                <label class="text-sm">列 <input type="number" min="1" max="20" v-model.number="actionForm.rows" class="w-full border rounded px-1" /></label>
                <label class="text-sm">幀數 <input type="number" min="1" :max="actionForm.cols*actionForm.rows" v-model.number="actionForm.frames" class="w-full border rounded px-1" /></label>
                <label class="text-sm">FPS <input type="number" min="1" max="60" v-model.number="actionForm.fps" class="w-full border rounded px-1" /></label>
                <label class="text-sm">優先度 <input type="number" min="-100" max="100" v-model.number="actionForm.priority" class="w-full border rounded px-1" /></label>
              </div>
              <div class="flex flex-wrap items-center gap-1 text-[11px]">
                <span class="text-slate-500">📐 規格快選：</span>
                <button v-for="p in GRID_PRESETS" :key="p.label" @click="applyGridPreset(p)"
                  :class="['px-2 py-0.5 rounded border transition', actionForm.cols===p.cols && actionForm.rows===p.rows ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-slate-50 hover:bg-indigo-50 text-slate-700']">
                  {{ p.label }}
                </button>
              </div>
              <div class="grid grid-cols-2 gap-3 items-end">
                <label class="text-sm">觸發時機
                  <select v-model="actionForm.trigger" class="w-full border rounded px-2 py-1">
                    <option v-for="(l, k) in TRIGGER_LABELS" :key="k" :value="k">{{ l }} ({{ k }})</option>
                  </select></label>
                <label class="text-sm flex items-center gap-2 pb-1"><input type="checkbox" v-model="actionForm.loop" /> 循環播放</label>
              </div>
              <div>
                <p class="text-sm mb-1">觸發條件式</p>
                <condition-editor v-model="actionForm.condition" @valid="condOk=$event" />
              </div>
              <drop-zone v-model:file="file" :hint="isNewAction ? '新動作必須上傳精靈表圖片（推薦 10~20 欄 × 1 列）' : '留空 = 沿用目前圖檔，或上傳新圖覆寫'" />
              <div class="flex flex-col gap-1">
                <label class="inline-flex items-center gap-2 text-xs text-slate-600 select-none">
                  <input type="checkbox" v-model="autoRemoveWhiteBg" />
                  上傳白底圖時自動去除純白背景（若已是透明去背 PNG 則保留原樣）
                </label>
                <label class="inline-flex items-center gap-2 text-xs text-slate-600 select-none">
                  <input type="checkbox" v-model="autoPadWideCell" />
                  📐 自動正規化每格畫布為固定 256×256 px 邏輯格子（腳底錨點 128, 228）
                </label>
              </div>
            </div>
            <div class="col-span-12 lg:col-span-5 space-y-3">
              <button id="btnOpenAiModify" @click="aiModalOpen=true"
                class="w-full py-2.5 px-3 rounded-lg bg-gradient-to-r from-indigo-600 to-fuchsia-600 text-white font-semibold text-sm shadow hover:opacity-95 transition flex items-center justify-center gap-2">
                <span>✨ 啟動 AI 修改此招式</span>
                <span class="text-[11px] font-normal bg-white/20 px-1.5 py-0.5 rounded">提示詞 / 三視圖 / 參考動作</span>
              </button>
              <sprite-preview :src="previewSrc" :cols="actionForm.cols" :rows="actionForm.rows" :frames="actionForm.frames" :fps="actionForm.fps" :size="260" />
              <p v-if="currentAction && !isNewAction" class="text-xs text-slate-400 font-mono break-all">
                <span v-if="currentAction.localSaved" class="inline-block px-1.5 py-0.5 rounded mr-1 font-sans bg-emerald-100 text-emerald-700 font-semibold">💾 本機已存檔</span>
                <span :class="['inline-block px-1.5 py-0.5 rounded mr-1 font-sans', currentAction.builtin ? 'bg-slate-200 text-slate-600' : 'bg-indigo-100 text-indigo-700']">{{ currentAction.builtin ? '內建動畫' : '雲端自訂' }}</span>
                {{ currentAction.sheetKey }}<br>{{ currentAction.png }}
              </p>
            </div>
          </div>

          <sprite-sheet-sorter
            :src="previewSrc"
            :cols="actionForm.cols"
            :rows="actionForm.rows"
            :frames="actionForm.frames"
            :char-id="charForm.id || 'char'"
            :action-id="actionForm.id || 'action'"
            @reordered="onSheetReordered"
          />

          <fx-bubble-editor v-model="actionForm.fx" />

          <div class="flex flex-wrap items-center gap-2 border-t pt-3">
            <button id="btnSaveLocal" @click="saveLocal" :disabled="!canSave"
              class="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-sm shadow-sm disabled:opacity-40">
              {{ store.busy ? '處理中…' : '💾 存檔（套用到遊戲）' }}</button>
            <button id="btnSavePr" @click="save" :disabled="!canSave"
              class="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-sm disabled:opacity-40">
              {{ store.busy ? '處理中…' : '☁️ 儲存並建立 PR' }}</button>
            <button v-if="currentAction && currentAction.localSaved" @click="revertLocal" :disabled="store.busy"
              class="px-3 py-2 rounded-lg border border-amber-400 text-amber-700 hover:bg-amber-50 text-sm">↩ 還原預設</button>
            <span v-if="saveBlockReason" class="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">⚠️ {{ saveBlockReason }}</span>
            <button v-if="!isNewAction && currentAction && !currentAction.builtin" @click="removeAction" :disabled="store.busy" class="px-3 py-2 rounded border text-red-600 text-sm">刪除自訂動作</button>
            <button v-if="current && !current.builtin" @click="removeChar" :disabled="store.busy" class="px-3 py-2 rounded border text-red-600 text-sm ml-auto">刪除自訂角色</button>
          </div>
        </section>

        <!-- Full-size Turnaround Lightbox -->
        <div v-if="turnaroundZoom && turnaroundSrc" class="fixed inset-0 z-50 bg-slate-900/75 flex items-center justify-center p-4" @click.self="turnaroundZoom=false">
          <div class="bg-white rounded-xl shadow-2xl max-w-4xl w-full overflow-hidden">
            <div class="px-4 py-2.5 bg-slate-100 flex items-center justify-between border-b">
              <span class="font-semibold text-sm">🧍 {{ charForm.name || charForm.id }} — 角色設定三視圖</span>
              <div class="flex gap-2">
                <a :href="turnaroundSrc" :download="(charForm.id || 'char') + '_turnaround.webp'" class="text-xs px-2.5 py-1 rounded bg-indigo-600 text-white">⬇ 下載參考圖</a>
                <button @click="turnaroundZoom=false" class="text-xs px-2.5 py-1 rounded border bg-white">✕ 關閉</button>
              </div>
            </div>
            <div class="p-4 checker flex items-center justify-center max-h-[80vh] overflow-auto">
              <img :src="turnaroundSrc" class="max-w-full max-h-[74vh] object-contain rounded shadow" />
            </div>
          </div>
        </div>

        <ai-modify-modal
          :open="aiModalOpen"
          :char-id="charForm.id || 'custom'"
          :char-name="charForm.name || charForm.id || '角色'"
          :action-id="actionForm.id || 'action'"
          :action-label="actionForm.label || actionForm.id || '招式'"
          :current-src="previewSrc"
          :char-turnaround-src="turnaroundSrc"
          :init-cols="actionForm.cols"
          :init-rows="actionForm.rows"
          :init-frames="actionForm.frames"
          :init-fps="actionForm.fps"
          :trigger="actionForm.trigger"
          :condition="actionForm.condition"
          @close="aiModalOpen=false"
          @apply="onAiApply"
        />
      </div>`,
  };

  // ---------- Generic list+form tab for backgrounds / items ----------
  function makeSimpleTab(section, cfg) {
    return {
      components: { DropZone },
      setup() {
        const form = reactive(cfg.blank());
        const isNew = ref(true);
        const file = ref(null);
        const localUrl = ref('');
        const scroll = ref(0);
        let raf = 0;
        watch(file, (f) => { if (localUrl.value) URL.revokeObjectURL(localUrl.value); localUrl.value = f ? URL.createObjectURL(f) : ''; });
        const list = computed(() => getMergedSimple(section));
        const current = computed(() => list.value.find((e) => e.id === form.id && !isNew.value));
        const previewSrc = computed(() => localUrl.value || (current.value ? rawUrl(current.value.png, current.value.updatedAt, !!current.value.builtin) : ''));
        function select(e) { isNew.value = false; file.value = null; Object.assign(form, cfg.blank(), JSON.parse(JSON.stringify(e))); }
        function reset() { isNew.value = true; file.value = null; Object.assign(form, cfg.blank()); }
        const canSave = computed(() => !store.busy && ID_RE.test(form.id) && (file.value || !isNew.value));
        async function save() {
          if (await submitEntry(section, { ...form }, file.value, `${cfg.label} ${form.id}`)) {
            const e = list.value.find((x) => x.id === form.id); if (e) select(e);
          }
        }
        async function remove() { if (await deleteEntry({ section, id: form.id }, `${cfg.label} ${form.id}`)) reset(); }
        const tick = () => { scroll.value = (scroll.value + 1) % 100000; raf = requestAnimationFrame(tick); };
        onMounted(() => {
          if (section === 'backgrounds') raf = requestAnimationFrame(tick);
          if (list.value.length) select(list.value[0]);
        });
        onBeforeUnmount(() => cancelAnimationFrame(raf));
        return { store, cfg, form, isNew, file, list, current, previewSrc, canSave, scroll, select, reset, save, remove, rawUrl };
      },
      template: `
        <div class="grid grid-cols-12 gap-4">
          <aside class="col-span-12 md:col-span-4 bg-white rounded shadow p-3">
            <div class="flex justify-between items-center mb-2">
              <h3 class="font-semibold">{{ cfg.label }}列表 ({{ list.length }})</h3>
              <button @click="reset" class="px-2 rounded bg-indigo-600 text-white text-sm">＋ 新增</button>
            </div>
            <p v-if="!list.length" class="text-sm text-slate-400">尚無資料</p>
            <div class="grid grid-cols-2 gap-2">
              <div v-for="e in list" :key="e.id" @click="select(e)"
                   :class="['cursor-pointer rounded border p-1 text-xs', !isNew && e.id===form.id ? 'ring-2 ring-indigo-500' : 'hover:bg-slate-50']">
                <img :src="rawUrl(e.png, e.updatedAt, !!e.builtin)" class="checker w-full h-20 object-contain rounded" loading="lazy" />
                <div class="mt-1 truncate">{{ e.name }} <span class="text-slate-400">#{{ e.id }}</span></div>
                <div class="text-slate-400">{{ cfg.summary(e) }}</div>
              </div>
            </div>
          </aside>
          <section class="col-span-12 md:col-span-8 bg-white rounded shadow p-4 space-y-3">
            <div class="grid grid-cols-2 gap-3">
              <label class="text-sm">ID <input v-model.trim="form.id" :disabled="!isNew" class="w-full border rounded px-2 py-1 font-mono disabled:bg-slate-100" /></label>
              <label class="text-sm">名稱 <input v-model="form.name" class="w-full border rounded px-2 py-1" /></label>
              <template v-for="f in cfg.fields" :key="f.key">
                <label class="text-sm">{{ f.label }}
                  <select v-if="f.options" v-model="form[f.key]" class="w-full border rounded px-2 py-1">
                    <option v-for="o in f.options" :key="o.v" :value="o.v">{{ o.t }}</option>
                  </select>
                  <input v-else type="number" :min="f.min" :max="f.max" :step="f.step || 1" v-model.number="form[f.key]" class="w-full border rounded px-2 py-1" />
                </label>
              </template>
            </div>
            <drop-zone v-model:file="file" :hint="isNew ? '必須上傳 PNG' : '留空 = 沿用目前圖檔，或上傳新 PNG 覆寫'" />
            <div v-if="previewSrc" class="checker rounded border overflow-hidden" :style="cfg.previewStyle">
              <div v-if="cfg.parallax" class="h-full w-full"
                   :style="{ backgroundImage: 'url(' + previewSrc + ')', backgroundRepeat: 'repeat-x', backgroundSize: 'auto 100%',
                             backgroundPositionX: (-scroll * (form.parallax || 1)) + 'px' }"></div>
              <img v-else :src="previewSrc" class="h-full mx-auto object-contain" />
            </div>
            <p v-if="cfg.parallax && previewSrc" class="text-xs text-slate-500">預覽：以視差係數 {{ form.parallax }} 捲動</p>
            <div class="flex gap-2 border-t pt-3">
              <button @click="save" :disabled="!canSave" class="px-4 py-2 rounded bg-indigo-600 text-white disabled:opacity-40">{{ store.busy ? '處理中…' : '💾 儲存並建立 PR' }}</button>
              <button v-if="!isNew" @click="remove" :disabled="store.busy" class="px-3 py-2 rounded border text-red-600">刪除</button>
            </div>
          </section>
        </div>`,
    };
  }

  const BackgroundsTab = makeSimpleTab('backgrounds', {
    label: '背景', parallax: true, previewStyle: 'height: 200px',
    blank: () => ({ id: '', name: '', stage: 1, parallax: 1 }),
    summary: (e) => `第 ${e.stage} 關 · 視差 ${e.parallax}`,
    fields: [
      { key: 'stage', label: '關卡', min: 1, max: 99 },
      { key: 'parallax', label: '視差係數 (0–2)', min: 0, max: 2, step: 0.1 },
    ],
  });

  const ItemsTab = makeSimpleTab('items', {
    label: '道具', parallax: false, previewStyle: 'height: 160px',
    blank: () => ({ id: '', name: '', effect: 'heal', value: 20 }),
    summary: (e) => `${(ITEM_EFFECTS.find((x) => x.v === e.effect) || {}).t || e.effect} +${e.value}`,
    fields: [
      { key: 'effect', label: '效果', options: ITEM_EFFECTS },
      { key: 'value', label: '數值', min: 0, max: 9999 },
    ],
  });

  // ---------- AI generation tab (available in local backend mode) ----------
  const AiTab = {
    components: { ConditionEditor },
    setup() {
      const form = reactive({ prompt: '', characterId: '', name: '', actionId: 'attack', label: '', frameCount: 10, cols: 5, fps: 12, trigger: 'on_attack', condition: '' });
      const condOk = ref(true);
      let timer = 0;
      const characters = computed(() => store.manifest.characters);
      const active = computed(() => store.jobs.some((j) => ['queued', 'running', 'committing'].includes(j.status)));
      const canSubmit = computed(() => store.mode === 'backend' && form.prompt.trim() && condOk.value
        && ID_RE.test(form.characterId) && ID_RE.test(form.actionId));

      async function poll() {
        if (store.mode !== 'backend') return;
        try {
          const prev = new Map(store.jobs.map((j) => [j.id, j.status]));
          store.jobs = (await backendApi('/api/jobs')).jobs;
          for (const j of store.jobs) {
            const was = prev.get(j.id);
            if (was && was !== j.status && j.status === 'done') { recordResult(`AI ${j.params.characterId}/${j.params.actionId}`, j); loadManifest(); }
            if (was && was !== j.status && j.status === 'error') toast(`AI 任務失敗：${j.error}`, 'error');
          }
        } catch { /* ignore */ }
        timer = setTimeout(poll, active.value ? 2000 : 8000);
      }
      async function submit() {
        try {
          await backendApi('/api/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
          toast('已加入生成佇列', 'success');
          clearTimeout(timer); poll();
        } catch (e) { toast(e.message, 'error'); }
      }
      function pickChar(e) {
        const c = characters.value.find((x) => x.id === e.target.value);
        if (c) { form.characterId = c.id; form.name = c.name; }
      }
      onMounted(poll);
      onBeforeUnmount(() => clearTimeout(timer));
      const statusText = { queued: '排隊中', running: '生成中', committing: '提交 PR 中', done: '完成', error: '失敗' };
      return { store, form, condOk, characters, canSubmit, submit, pickChar, TRIGGER_LABELS, statusText };
    },
    template: `
      <div v-if="store.mode !== 'backend'" class="bg-white rounded shadow p-6 space-y-2">
        <h3 class="font-semibold text-lg">🤖 AI 動畫生成（僅本機後端模式）</h3>
        <p class="text-sm text-slate-600">目前為 <b>GitHub Pages 純前端模式</b>，瀏覽器無法直接執行 Python Stable Diffusion。</p>
        <p class="text-sm text-slate-600">你可以直接用「🧸 角色動作」分頁上傳外部 AI 生成好的 PNG 精靈表，一樣會自動轉 WebP 並建立 PR！</p>
      </div>
      <div v-else class="grid grid-cols-12 gap-4">
        <section class="col-span-12 lg:col-span-7 bg-white rounded shadow p-4 space-y-3">
          <h3 class="font-semibold">🤖 Stable Diffusion 動畫生成</h3>
          <label class="text-sm block">動作描述 (prompt)
            <textarea v-model="form.prompt" rows="3" maxlength="500" placeholder="cute red panda doing a rising uppercut, chibi, anime style"
              class="w-full border rounded px-2 py-1"></textarea></label>
          <div class="grid grid-cols-3 gap-3">
            <label class="text-sm">角色 ID
              <input v-model.trim="form.characterId" list="char-ids" @change="pickChar" class="w-full border rounded px-2 py-1 font-mono" />
              <datalist id="char-ids"><option v-for="c in characters" :key="c.id" :value="c.id">{{ c.name }}</option></datalist></label>
            <label class="text-sm">角色名稱 <input v-model="form.name" class="w-full border rounded px-2 py-1" /></label>
            <label class="text-sm">動作 ID <input v-model.trim="form.actionId" class="w-full border rounded px-2 py-1 font-mono" /></label>
            <label class="text-sm">動作名稱 <input v-model="form.label" class="w-full border rounded px-2 py-1" /></label>
            <label class="text-sm">幀數 <input type="number" min="1" max="20" v-model.number="form.frameCount" class="w-full border rounded px-2 py-1" /></label>
            <label class="text-sm">每列幀數 <input type="number" min="1" max="20" v-model.number="form.cols" class="w-full border rounded px-2 py-1" /></label>
            <label class="text-sm">FPS <input type="number" min="1" max="60" v-model.number="form.fps" class="w-full border rounded px-2 py-1" /></label>
            <label class="text-sm col-span-2">觸發時機
              <select v-model="form.trigger" class="w-full border rounded px-2 py-1">
                <option v-for="(l, k) in TRIGGER_LABELS" :key="k" :value="k">{{ l }} ({{ k }})</option>
              </select></label>
          </div>
          <div><p class="text-sm mb-1">觸發條件式</p><condition-editor v-model="form.condition" @valid="condOk=$event" /></div>
          <button @click="submit" :disabled="!canSubmit" class="px-4 py-2 rounded bg-emerald-600 text-white disabled:opacity-40">✨ 生成並建立 PR</button>
        </section>
        <section class="col-span-12 lg:col-span-5 bg-white rounded shadow p-4">
          <h3 class="font-semibold mb-2">任務佇列</h3>
          <p v-if="!store.jobs.length" class="text-sm text-slate-400">尚無任務</p>
          <div v-for="j in store.jobs" :key="j.id" class="border rounded p-2 mb-2 text-sm">
            <div class="flex justify-between"><span class="font-mono">{{ j.params.characterId }}/{{ j.params.actionId }}</span>
              <span :class="{'text-emerald-600': j.status==='done', 'text-red-600': j.status==='error', 'text-amber-600': j.status!=='done' && j.status!=='error'}">{{ statusText[j.status] || j.status }}</span></div>
            <p class="text-xs text-slate-500 truncate">{{ j.params.prompt }}</p>
            <div class="h-2 bg-slate-200 rounded mt-1 overflow-hidden">
              <div class="h-full bg-emerald-500 transition-all" :style="{ width: (j.status==='done' ? 100 : 100 * j.progress.done / Math.max(1, j.progress.total)) + '%' }"></div>
            </div>
            <p class="text-xs mt-1">{{ j.progress.done }}/{{ j.progress.total }} 幀
              <a v-if="j.pr" :href="j.pr" target="_blank" class="text-indigo-600 underline ml-2">查看 PR</a></p>
            <p v-if="j.error" class="text-xs text-red-600 break-all">{{ j.error }}</p>
          </div>
        </section>
      </div>`,
  };

  // ---------- PR history tab ----------
  const HistoryTab = {
    setup() {
      function clear() { if (confirm('清除本機 PR 紀錄？')) { store.history = []; localStorage.removeItem('editorPrHistory'); } }
      return { store, clear };
    },
    template: `
      <section class="bg-white rounded shadow p-4">
        <div class="flex justify-between mb-2"><h3 class="font-semibold">PR 紀錄（本機）</h3>
          <button v-if="store.history.length" @click="clear" class="text-sm text-red-600">清除</button></div>
        <p v-if="!store.history.length" class="text-sm text-slate-400">尚無紀錄</p>
        <table v-else class="w-full text-sm">
          <tr v-for="h in store.history" :key="h.pr" class="border-t">
            <td class="py-1">{{ h.title }}</td>
            <td class="text-slate-400 whitespace-nowrap">{{ new Date(h.at).toLocaleString() }}</td>
            <td class="text-right"><a :href="h.pr" target="_blank" class="text-indigo-600 underline">{{ h.pr.split('/').slice(-2).join(' #') }}</a></td>
          </tr>
        </table>
      </section>`,
  };

  // ---------------- Root app ----------------
  const App = {
    components: { CharactersTab, BackgroundsTab, ItemsTab, AiTab, HistoryTab },
    setup() {
      const tabs = [
        { id: 'characters', label: '🧸 角色動作', comp: 'characters-tab' },
        { id: 'backgrounds', label: '🏞️ 背景', comp: 'backgrounds-tab' },
        { id: 'items', label: '🎁 道具', comp: 'items-tab' },
        { id: 'ai', label: '🤖 AI 生成', comp: 'ai-tab' },
        { id: 'history', label: '📜 PR 紀錄', comp: 'history-tab' },
      ];
      const tab = ref(location.hash.slice(1) || 'characters');
      watch(tab, (t) => { location.hash = t; });
      const currentComp = computed(() => (tabs.find((t) => t.id === tab.value) || tabs[0]).comp);
      const statusClass = computed(() => {
        const g = store.status?.github || '';
        return g === 'ok' ? 'bg-emerald-100 text-emerald-700' : (g === 'dry-run' || g === 'readonly') ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700';
      });
      const statusLabel = computed(() => {
        if (!store.status) return '';
        if (store.mode === 'backend') return store.status.github === 'ok' ? '本機後端 · GitHub 已連線' : store.status.github;
        return store.ghToken ? 'GitHub 直連 · 可建立 PR' : '唯讀（尚未設定 Token）';
      });
      function saveToken() {
        saveGhConfig(store.ghRepo.trim(), store.ghBranch.trim() || 'main', store.ghToken.trim());
        store.showSettings = false;
        toast('已儲存 GitHub 設定於本機瀏覽器', 'success');
        loadManifest();
      }
      onMounted(detectAndLoad);
      return { store, tabs, tab, currentComp, statusClass, statusLabel, loadManifest, saveToken };
    },
    template: `
      <div class="max-w-7xl mx-auto p-4 space-y-4">
        <header class="flex flex-wrap items-center gap-3">
          <a href="./index.html" class="text-sm px-3 py-1 rounded bg-slate-200 hover:bg-slate-300">← 返回大亂鬥</a>
          <h1 class="text-2xl font-bold">SchoolFight-TV 素材編輯器</h1>
          <span v-if="store.status" :class="['text-xs px-2 py-1 rounded-full', statusClass]">
            {{ store.status.repo || store.ghRepo }} · {{ statusLabel }}</span>
          <div class="ml-auto flex gap-2">
            <button v-if="store.mode==='github'" @click="store.showSettings=!store.showSettings" class="text-sm px-3 py-1 rounded border bg-white hover:bg-slate-50">🔑 GitHub Token</button>
            <button @click="loadManifest" class="text-sm px-2 py-1 rounded border bg-white" :disabled="store.loading">{{ store.loading ? '讀取中…' : '↻ 重新讀取' }}</button>
          </div>
        </header>

        <section v-if="store.mode==='github' && store.showSettings" class="bg-white rounded shadow p-4 space-y-3 border-l-4 border-indigo-500">
          <h2 class="font-semibold">🔑 GitHub 直連設定（僅儲存在你的瀏覽器 localStorage，與遊戲設定共用）</h2>
          <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
            <label class="text-sm">Repository <input v-model.trim="store.ghRepo" class="w-full border rounded px-2 py-1 font-mono" /></label>
            <label class="text-sm">Branch <input v-model.trim="store.ghBranch" class="w-full border rounded px-2 py-1 font-mono" /></label>
            <label class="text-sm">Personal Access Token (Contents + Pull requests 寫入權限)
              <input type="password" v-model.trim="store.ghToken" placeholder="github_pat_..." class="w-full border rounded px-2 py-1 font-mono" /></label>
          </div>
          <div class="flex gap-2">
            <button @click="saveToken" class="px-4 py-1.5 rounded bg-indigo-600 text-white text-sm">儲存設定</button>
            <button @click="store.showSettings=false" class="px-3 py-1.5 rounded border text-sm">關閉</button>
          </div>
        </section>

        <nav class="flex gap-1 border-b">
          <button v-for="t in tabs" :key="t.id" @click="tab=t.id"
                  :class="['px-4 py-2 -mb-px border-b-2 text-sm', tab===t.id ? 'border-indigo-600 text-indigo-700 font-semibold' : 'border-transparent text-slate-500 hover:text-slate-800']">{{ t.label }}</button>
        </nav>
        <keep-alive><component :is="currentComp" /></keep-alive>
        <div class="fixed bottom-4 right-4 space-y-2 z-50 max-w-sm">
          <div v-for="t in store.toasts" :key="t.id"
               :class="['px-4 py-2 rounded shadow text-sm text-white', t.kind==='error' ? 'bg-red-600' : t.kind==='success' ? 'bg-emerald-600' : 'bg-slate-700']">{{ t.msg }}</div>
        </div>
      </div>`,
  };

  createApp(App).mount('#app');
})();
