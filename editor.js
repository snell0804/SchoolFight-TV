/* SchoolFight-TV 角色 / 素材編輯器（GitHub Pages 純前端 + 本機後端雙模式）
 * - 在 GitHub Pages 開啟時自動使用 GitHub REST API 直接讀寫（Token 僅存於瀏覽器 localStorage，與遊戲本體共用設定鍵）。
 * - 若由 tools/github_sync.js 提供服務，會自動偵測並啟用本機後端（含 AI Stable Diffusion 生成）。
 */
(function () {
  const { createApp, reactive, ref, computed, watch, onMounted, onBeforeUnmount } = Vue;
  const CP = window.ConditionParser;

  const CFG_KEY = 'schoolfight_cloud_sync_cfg_v1';
  const MANIFEST_PATH = 'cloud_manifest.json';
  const ID_RE = /^[a-z0-9_]{1,40}$/;

  const TRIGGER_LABELS = {
    on_idle: '待機時', on_move: '移動時', on_attack: '攻擊時', on_hurt: '受傷時',
    on_ko: '被打倒時', on_low_hp: '低血量時', on_spawn: '出場時', custom: '自訂（僅條件）',
  };
  const ITEM_EFFECTS = [
    { v: 'heal', t: '❤️ 回血' }, { v: 'power', t: '⚡ 能量' }, { v: 'score', t: '⭐ 分數' },
    { v: 'shield', t: '🛡️ 護盾' }, { v: 'speed', t: '👟 加速' },
  ];

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
    loading: false,
    busy: false,
    toasts: [],
    history: JSON.parse(localStorage.getItem('editorPrHistory') || '[]'),
    jobs: [],
  });

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
      if (Array.isArray(c.actions)) return { id: c.id, name: c.name || c.id, actions: c.actions };
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

  /** Merge built-in GameCatalog entries with cloud_manifest.json custom overrides. */
  function getMergedCharacters() {
    const builtin = (window.GameCatalog && window.GameCatalog.characters) || [];
    const customMap = new Map((store.manifest.characters || []).map((c) => [c.id, c]));
    const merged = builtin.map((bc) => {
      const cc = customMap.get(bc.id);
      if (!cc) return { ...bc, hasCustom: false };
      customMap.delete(bc.id);
      const customActs = new Map((cc.actions || []).map((a) => [a.id, { ...a, builtin: false, customized: true }]));
      const actions = bc.actions.map((ba) => {
        if (customActs.has(ba.id)) {
          const ov = customActs.get(ba.id);
          customActs.delete(ba.id);
          return ov;
        }
        return ba;
      }).concat([...customActs.values()]);
      return { ...bc, name: cc.name || bc.name, actions, hasCustom: true };
    });
    for (const cc of customMap.values()) {
      merged.push({
        id: cc.id, name: cc.name || cc.id, role: 'custom', builtin: false, hasCustom: true,
        actions: (cc.actions || []).map((a) => ({ ...a, builtin: false, customized: true })),
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

  /** Read PNG file → { pngB64, webpB64, width, height } in the browser. */
  async function encodePngAndWebp(file) {
    const buf = new Uint8Array(await file.arrayBuffer());
    if (buf.length < 24 || buf[0] !== 0x89 || buf[1] !== 0x50 || buf[2] !== 0x4e || buf[3] !== 0x47) {
      throw new Error('只接受 PNG 檔案');
    }
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    const width = dv.getUint32(16);
    const height = dv.getUint32(20);
    const pngB64 = bytesToBase64(buf);
    let webpB64 = null;
    try {
      const bmp = await createImageBitmap(file);
      const c = document.createElement('canvas');
      c.width = width; c.height = height;
      c.getContext('2d').drawImage(bmp, 0, 0);
      bmp.close();
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
      throw new Error('請先點上方「🔑 GitHub Token」貼入 Personal Access Token 才能儲存並建立 PR');
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
          if (!ID_RE.test(payload.id || '')) throw new Error('角色 ID 只能用小寫英數與底線');
          const a = payload.action || {};
          if (!ID_RE.test(a.id || '')) throw new Error('動作 ID 只能用小寫英數與底線');
          const chk = CP.validateCondition(a.condition || '');
          if (!chk.ok) throw new Error(`條件式錯誤：${chk.error}`);
          let ch = manifest.characters.find((c) => c.id === payload.id);
          if (!ch) { ch = { id: payload.id, name: payload.name || payload.id, actions: [] }; manifest.characters.push(ch); }
          if (payload.name) ch.name = String(payload.name).slice(0, 60);
          const prev = ch.actions.find((x) => x.id === a.id);
          const asset = await attach(`char_${payload.id}_${a.id}`);
          const fallbackPng = prev?.png || a.png || null;
          const fallbackWebp = prev?.webp || a.webp || null;
          if (!asset && !fallbackPng) throw new Error('新動作需要上傳 PNG 精靈表');
          const cols = Math.max(1, Math.min(20, Number(a.cols) || prev?.cols || 5));
          const rows = Math.max(1, Math.min(20, Number(a.rows) || prev?.rows || 2));
          const next = {
            id: a.id, label: String(a.label || prev?.label || a.id).slice(0, 60),
            sheetKey: a.sheetKey || `custom_${payload.id}_${a.id}`,
            png: asset?.png || fallbackPng, webp: asset?.webp || fallbackWebp,
            cols, rows, frames: Math.max(1, Math.min(cols * rows, Number(a.frames) || cols * rows)),
            fps: Math.max(1, Math.min(60, Number(a.fps) || 12)), loop: !!a.loop,
            trigger: a.trigger || 'on_attack', condition: (a.condition || '').trim(),
            priority: Number(a.priority) || 0, updatedAt: now,
          };
          ch.actions = ch.actions.filter((x) => x.id !== a.id).concat(next);
          prTitle = `Editor: update character ${payload.id}/${a.id}`;
        } else {
          if (!ID_RE.test(payload.id || '')) throw new Error('ID 只能用小寫英數與底線');
          const list = manifest[section];
          const prev = list.find((e) => e.id === payload.id);
          const asset = await attach(`${section === 'backgrounds' ? 'bg' : 'item'}_${payload.id}`);
          const fallbackPng = prev?.png || payload.png || null;
          const fallbackWebp = prev?.webp || payload.webp || null;
          if (!asset && !fallbackPng) throw new Error('新項目需要上傳 PNG');
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
      const playing = ref(true);
      const frame = ref(0);
      const grid = ref(false);
      const info = ref('');
      const img = new Image();
      img.crossOrigin = 'anonymous';
      let raf = 0; let last = 0; let ok = false;
      const total = computed(() => Math.max(1, Math.min(props.frames || props.cols * props.rows, props.cols * props.rows)));

      function draw() {
        const c = canvas.value; if (!c) return;
        const ctx = c.getContext('2d');
        ctx.clearRect(0, 0, c.width, c.height);
        if (!ok) return;
        const fw = img.width / props.cols; const fh = img.height / props.rows;
        const f = frame.value % total.value;
        const sx = (f % props.cols) * fw; const sy = Math.floor(f / props.cols) * fh;
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
        if (playing.value && ok && t - last >= 1000 / Math.max(1, props.fps)) {
          last = t; frame.value = (frame.value + 1) % total.value;
        }
        draw();
      }
      function load() {
        ok = false; info.value = '';
        if (!props.src) return;
        img.onload = () => {
          ok = true; frame.value = 0;
          info.value = `${img.width}×${img.height}px · 每格 ${(img.width / props.cols).toFixed(1)}×${(img.height / props.rows).toFixed(1)}`;
        };
        img.onerror = () => { info.value = '無法載入圖片'; };
        img.src = props.src;
      }
      watch(() => [props.src, props.cols, props.rows], load);
      onMounted(() => { load(); raf = requestAnimationFrame(loop); });
      onBeforeUnmount(() => cancelAnimationFrame(raf));
      return { canvas, playing, frame, grid, info, total };
    },
    template: `
      <div class="space-y-2">
        <canvas ref="canvas" :width="size" :height="size" class="checker rounded border pixel block mx-auto"></canvas>
        <div v-if="src" class="flex items-center gap-2 text-sm">
          <button class="px-2 py-1 rounded bg-slate-200 hover:bg-slate-300" @click="playing=!playing">{{ playing ? '⏸' : '▶' }}</button>
          <input type="range" min="0" :max="total-1" v-model.number="frame" @input="playing=false" class="flex-1" />
          <span class="w-14 text-right tabular-nums">{{ frame+1 }}/{{ total }}</span>
          <label class="flex items-center gap-1"><input type="checkbox" v-model="grid" />框</label>
        </div>
        <p v-if="info" class="text-xs text-slate-500">{{ info }}</p>
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
        if (f.type !== 'image/png') { toast('只接受 PNG 檔案', 'error'); return; }
        if (f.size > 8 * 1024 * 1024) { toast('檔案超過 8MB', 'error'); return; }
        emit('update:file', f);
      }
      return { over, input, take };
    },
    template: `
      <div @click="input.click()" @dragover.prevent="over=true" @dragleave="over=false"
           @drop.prevent="over=false; take($event.dataTransfer.files[0])"
           :class="['border-2 border-dashed rounded p-4 text-center cursor-pointer text-sm transition',
                    over ? 'border-indigo-500 bg-indigo-50' : 'border-slate-300 hover:border-indigo-400']">
        <input ref="input" type="file" accept="image/png" class="hidden" @change="take($event.target.files[0]); $event.target.value=''" />
        <div v-if="file">📄 {{ file.name }} <span class="text-slate-400">({{ (file.size/1024).toFixed(0) }} KB)</span>
          <button class="ml-2 text-red-500" @click.stop="$emit('update:file', null)">✕</button></div>
        <div v-else class="text-slate-500">拖曳 PNG 到這裡，或點擊選擇<br><span class="text-xs">{{ hint }}</span></div>
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

  // ---------- Characters tab ----------
  const CharactersTab = {
    components: { SpritePreview, DropZone, ConditionEditor },
    setup() {
      const selectedId = ref(null);
      const selectedActionId = ref(null);
      const isNewChar = ref(false);
      const charForm = reactive({ id: '', name: '' });
      const blankAction = () => ({ id: '', label: '', cols: 5, rows: 2, frames: 10, fps: 12, loop: false, trigger: 'on_attack', condition: '', priority: 0, png: null, webp: null, sheetKey: null });
      const actionForm = reactive(blankAction());
      const isNewAction = ref(true);
      const file = ref(null);
      const localUrl = ref('');
      const condOk = ref(true);
      const filter = ref('');
      const roleFilter = ref('all'); // 'all' | 'hero' | 'boss' | 'monster' | 'custom'

      const allCharacters = computed(() => getMergedCharacters());
      const characters = computed(() => allCharacters.value.filter((c) => {
        if (roleFilter.value === 'custom' && !c.hasCustom && c.builtin) return false;
        if (['hero', 'boss', 'monster'].includes(roleFilter.value) && c.role !== roleFilter.value) return false;
        if (filter.value && !(c.id + ' ' + c.name).toLowerCase().includes(filter.value.toLowerCase())) return false;
        return true;
      }));
      const current = computed(() => allCharacters.value.find((c) => c.id === selectedId.value));
      const currentAction = computed(() => current.value?.actions.find((a) => a.id === selectedActionId.value));
      const previewSrc = computed(() => {
        if (localUrl.value) return localUrl.value;
        if (currentAction.value && !isNewAction.value) {
          return rawUrl(currentAction.value.png || currentAction.value.webp, currentAction.value.updatedAt, !!currentAction.value.builtin);
        }
        return '';
      });

      watch(file, (f) => { if (localUrl.value) URL.revokeObjectURL(localUrl.value); localUrl.value = f ? URL.createObjectURL(f) : ''; });

      function selectChar(c) {
        isNewChar.value = false; selectedId.value = c.id; Object.assign(charForm, { id: c.id, name: c.name });
        if (c.actions.length) selectAction(c.actions[0]); else newAction();
      }
      function newChar() {
        isNewChar.value = true; selectedId.value = null; Object.assign(charForm, { id: '', name: '' }); newAction();
      }
      function selectAction(a) {
        isNewAction.value = false; selectedActionId.value = a.id; file.value = null;
        Object.assign(actionForm, blankAction(), JSON.parse(JSON.stringify(a)));
      }
      function newAction() {
        isNewAction.value = true; selectedActionId.value = null; file.value = null; Object.assign(actionForm, blankAction());
      }
      watch(() => [actionForm.cols, actionForm.rows], ([c, r]) => {
        if (actionForm.frames > c * r || isNewAction.value) actionForm.frames = c * r;
      });

      onMounted(() => {
        if (!selectedId.value && !isNewChar.value && allCharacters.value.length) {
          selectChar(allCharacters.value[0]);
        }
      });

      const canSave = computed(() => !store.busy && condOk.value && ID_RE.test(charForm.id)
        && ID_RE.test(actionForm.id) && (file.value || !isNewAction.value));

      async function save() {
        const payload = { id: charForm.id, name: charForm.name || charForm.id, action: { ...actionForm } };
        const ok = await submitEntry('characters', payload, file.value, `角色 ${charForm.id} / 動作 ${actionForm.id}`);
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
        file, condOk, filter, roleFilter, roleTabs, previewSrc, canSave, TRIGGER_LABELS,
        selectChar, newChar, selectAction, newAction, save, removeAction, removeChar };
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
          <div class="grid grid-cols-2 gap-3">
            <label class="text-sm">角色 ID <input v-model.trim="charForm.id" :disabled="!isNewChar && !!selectedId" placeholder="red_panda"
              class="w-full border rounded px-2 py-1 font-mono disabled:bg-slate-100" /></label>
            <label class="text-sm">顯示名稱 <input v-model="charForm.name" placeholder="紅熊貓" class="w-full border rounded px-2 py-1" /></label>
          </div>

          <div v-if="current" class="flex flex-wrap gap-1.5 items-center">
            <span class="text-sm text-slate-500">動畫 ({{ current.actions.length }})：</span>
            <button v-for="a in current.actions" :key="a.id" @click="selectAction(a)"
                    :class="['px-3 py-1 rounded-full text-xs border transition', a.id===selectedActionId ? 'bg-indigo-600 text-white border-indigo-600' : 'hover:bg-slate-100']">
              {{ a.label || a.id }}
              <span v-if="a.customized" class="ml-1 opacity-90">✨</span>
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
                <label class="text-sm">欄 <input type="number" min="1" max="20" v-model.number="actionForm.cols" class="w-full border rounded px-1" /></label>
                <label class="text-sm">列 <input type="number" min="1" max="20" v-model.number="actionForm.rows" class="w-full border rounded px-1" /></label>
                <label class="text-sm">幀數 <input type="number" min="1" :max="actionForm.cols*actionForm.rows" v-model.number="actionForm.frames" class="w-full border rounded px-1" /></label>
                <label class="text-sm">FPS <input type="number" min="1" max="60" v-model.number="actionForm.fps" class="w-full border rounded px-1" /></label>
                <label class="text-sm">優先度 <input type="number" min="-100" max="100" v-model.number="actionForm.priority" class="w-full border rounded px-1" /></label>
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
              <drop-zone v-model:file="file" :hint="isNewAction ? '新動作必須上傳精靈表 PNG' : '留空 = 沿用目前圖檔，或上傳新 PNG 覆寫'" />
            </div>
            <div class="col-span-12 lg:col-span-5">
              <sprite-preview :src="previewSrc" :cols="actionForm.cols" :rows="actionForm.rows" :frames="actionForm.frames" :fps="actionForm.fps" :size="260" />
              <p v-if="currentAction && !isNewAction" class="text-xs text-slate-400 mt-2 font-mono break-all">
                <span :class="['inline-block px-1.5 py-0.5 rounded mr-1 font-sans', currentAction.builtin ? 'bg-slate-200 text-slate-600' : 'bg-emerald-100 text-emerald-700']">{{ currentAction.builtin ? '內建動畫' : '雲端自訂' }}</span>
                {{ currentAction.sheetKey }}<br>{{ currentAction.png }}
              </p>
            </div>
          </div>

          <div class="flex gap-2 border-t pt-3">
            <button @click="save" :disabled="!canSave" class="px-4 py-2 rounded bg-indigo-600 text-white disabled:opacity-40">
              {{ store.busy ? '處理中…' : '💾 儲存並建立 PR' }}</button>
            <button v-if="!isNewAction && currentAction && !currentAction.builtin" @click="removeAction" :disabled="store.busy" class="px-3 py-2 rounded border text-red-600">刪除自訂動作</button>
            <button v-if="current && !current.builtin" @click="removeChar" :disabled="store.busy" class="px-3 py-2 rounded border text-red-600 ml-auto">刪除自訂角色</button>
          </div>
        </section>
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
