// cloud_manifest_loader.js
// Fetches cloud_manifest.json at game startup, caches assets in IndexedDB,
// injects custom character sheets / backgrounds / items into SpriteBank,
// and evaluates trigger + condition expressions for enemies in real time.

(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CloudManifestLoader = api;
})(typeof self !== 'undefined' ? self : this, function (root) {
  const DB_NAME = 'SchoolFightCloudCacheDB_v1';
  const STORE = 'blobs';

  // ---------- IndexedDB blob cache ----------
  function openDB() {
    return new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') return reject(new Error('No IndexedDB'));
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) {
          req.result.createObjectStore(STORE, { keyPath: 'key' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function cacheGet(key) {
    try {
      const db = await openDB();
      return await new Promise((resolve) => {
        const tx = db.transaction(STORE, 'readonly');
        const req = tx.objectStore(STORE).get(key);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => resolve(null);
      });
    } catch { return null; }
  }

  async function cachePut(key, version, blob) {
    try {
      const db = await openDB();
      await new Promise((resolve) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put({ key, version, blob, savedAt: Date.now() });
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      });
    } catch { /* ignore quota / private mode */ }
  }

  function loadImageFromBlob(blob) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
      img.src = url;
    });
  }

  async function fetchCachedImage(cacheKey, primaryUrl, fallbackUrl, version) {
    const ver = String(version || '1');
    const cached = await cacheGet(cacheKey);
    if (cached && cached.version === ver && cached.blob) {
      try { return await loadImageFromBlob(cached.blob); } catch { /* re-fetch */ }
    }
    const urls = [primaryUrl, fallbackUrl].filter(Boolean);
    for (const u of urls) {
      try {
        const sep = u.includes('?') ? '&' : '?';
        const res = await fetch(`${u}${sep}v=${encodeURIComponent(ver)}`);
        if (!res.ok) continue;
        const blob = await res.blob();
        await cachePut(cacheKey, ver, blob);
        return await loadImageFromBlob(blob);
      } catch { /* try fallback */ }
    }
    return null;
  }

  // ---------- Manifest normalization ----------
  function normalizeManifest(m) {
    const out = { version: 1, characters: [], backgrounds: [], items: [] };
    if (!m || typeof m !== 'object') return out;
    out.characters = (m.characters || []).map((c) => {
      if (Array.isArray(c.actions)) return { id: c.id, name: c.name || c.id, actions: c.actions };
      return {
        id: c.id, name: c.name || c.id,
        actions: c.sheetKey ? [{
          id: 'attack', sheetKey: c.sheetKey, png: c.png, webp: c.webp,
          cols: 5, rows: 2, frames: 10, fps: 14, loop: false,
          trigger: 'on_attack', condition: c.condition || '', priority: 0, updatedAt: c.createdAt,
        }] : [],
      };
    });
    out.backgrounds = Array.isArray(m.backgrounds) ? m.backgrounds : [];
    out.items = Array.isArray(m.items) ? m.items : [];
    return out;
  }

  /**
   * Fetch cloud_manifest.json and inject all custom character sheets, backgrounds,
   * and items into SpriteBank. Never throws so the game always boots cleanly.
   */
  async function applyToGame(spriteBank, manifestUrl = './cloud_manifest.json') {
    if (!spriteBank) return null;
    spriteBank.customActionsByChar = spriteBank.customActionsByChar || {};
    spriteBank.actionFx = spriteBank.actionFx || {};
    spriteBank.cloudBackgrounds = spriteBank.cloudBackgrounds || [];
    spriteBank.cloudItems = spriteBank.cloudItems || [];

    let raw = null;
    try {
      const res = await fetch(`${manifestUrl}?t=${Date.now()}`, { cache: 'no-store' });
      if (!res.ok) return null;
      raw = await res.json();
    } catch {
      return null;
    }

    const manifest = normalizeManifest(raw);
    spriteBank.cloudManifest = manifest;

    const tasks = [];

    // 1. Character custom actions
    for (const ch of manifest.characters) {
      const sorted = [...(ch.actions || [])].sort((a, b) => (Number(b.priority) || 0) - (Number(a.priority) || 0));
      spriteBank.customActionsByChar[ch.id] = sorted;
      for (const act of sorted) {
        if (act.fx) {
          if (act.sheetKey && !spriteBank.actionFx[act.sheetKey]) spriteBank.actionFx[act.sheetKey] = act.fx;
          if (act.id && !spriteBank.actionFx[act.id]) spriteBank.actionFx[act.id] = act.fx;
        }
        if (!act.sheetKey || (!act.png && !act.webp)) continue;
        tasks.push((async () => {
          const img = await fetchCachedImage(`sheet:${act.sheetKey}`, act.webp, act.png, act.updatedAt);
          if (!img) return;
          const cols = Math.max(1, Number(act.cols) || 5);
          const rows = Math.max(1, Number(act.rows) || 2);
          const cellW = img.width / cols;
          const cellH = img.height / rows;
          spriteBank.sheets[act.sheetKey] = {
            img,
            cols,
            rows,
            cellW,
            cellH,
            anchorX: typeof act.anchorX === 'number' ? act.anchorX : cellW * 0.5,
            anchorY: typeof act.anchorY === 'number' ? act.anchorY : cellH * 0.91,
            frameCount: Math.max(1, Math.min(cols * rows, Number(act.frames) || cols * rows)),
            custom: true,
          };
        })());
      }
    }

    // 2. Backgrounds
    for (const bg of manifest.backgrounds) {
      if (!bg.id || (!bg.png && !bg.webp)) continue;
      spriteBank.cloudBackgrounds.push(bg);
      tasks.push((async () => {
        const img = await fetchCachedImage(`bg:${bg.id}`, bg.webp, bg.png, bg.updatedAt);
        if (img && spriteBank.bgImages) spriteBank.bgImages[`custom_${bg.id}`] = img;
      })());
    }

    // 3. Items
    for (const item of manifest.items) {
      if (!item.id || (!item.png && !item.webp)) continue;
      spriteBank.cloudItems.push(item);
      tasks.push((async () => {
        const img = await fetchCachedImage(`item:${item.id}`, item.webp, item.png, item.updatedAt);
        if (img && spriteBank.bgImages) spriteBank.bgImages[`custom_item_${item.id}`] = img;
      })());
    }

    await Promise.all(tasks);
    spriteBank.tintedCache = {};
    return manifest;
  }

  // ---------- Runtime trigger + condition matching ----------
  function triggerMatches(trigger, enemy) {
    const st = enemy.state;
    switch (trigger) {
      case 'on_idle': return (st === 'approach' && !enemy.isMoving) || st === 'idle';
      case 'on_move': return (st === 'approach' && !!enemy.isMoving) || st === 'move';
      case 'on_attack': return st === 'attack' || st === 'windup';
      case 'on_hurt': return st === 'hurt';
      case 'on_ko': return st === 'knocked' || st === 'dead';
      case 'on_low_hp': return enemy.hp > 0 && enemy.maxHp > 0 && (enemy.hp / enemy.maxHp) <= 0.3;
      case 'on_spawn': return (enemy.spawnAge || 0) < 0.8;
      case 'custom': return true;
      default: return false;
    }
  }

  /**
   * Pick the highest-priority custom action whose trigger and condition match `enemy`.
   * Checks character IDs matching enemy.type, cfg.customPrefix, cfg.spritePrefix, or '*' wildcard.
   */
  function pickCustomAction(enemy, spriteBank) {
    const map = spriteBank && spriteBank.customActionsByChar;
    if (!map || !enemy) return null;
    const keys = [
      enemy.type,
      enemy.cfg && enemy.cfg.customPrefix,
      enemy.cfg && enemy.cfg.spritePrefix,
      '*',
    ].filter(Boolean);

    const evalCond = root.ConditionParser && root.ConditionParser.evalCondition;
    const seen = new Set();
    for (const k of keys) {
      if (seen.has(k)) continue;
      seen.add(k);
      const list = map[k];
      if (!list || !list.length) continue;
      for (const act of list) {
        if (!act.sheetKey || !spriteBank.sheets[act.sheetKey]) continue;
        if (!triggerMatches(act.trigger, enemy)) continue;
        if (act.condition && evalCond && !evalCond(act.condition, enemy)) continue;
        return act;
      }
    }
    return null;
  }

  return { applyToGame, pickCustomAction, triggerMatches, normalizeManifest };
});
