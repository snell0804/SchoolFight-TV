/* ============================================================================
 * 海星國小 大亂鬥 (SchoolFight: Starfish Elementary Brawl)
 * 2.5D Belt-Scrolling Beat 'Em Up Engine (Streets of Rage / Warriors of Fate)
 * Native Resolution: 1024 x 512 | Character Scale: 1:1 from uploaded 5x2 sheets
 * ============================================================================ */

(function () {
  'use strict';

  const CANVAS_W = 1024;
  const CANVAS_H = 512;
  const STAGE_W = 3600;

  // 2.5D Walkable Street Depth Plane (Z axis rendered as screen Y)
  const Z_MIN = 344;
  const Z_MAX = 492;
  const Z_HIT_MELEE = 38;
  const Z_HIT_BEAM = 50;

  const canvas = document.getElementById('gameCanvas');
  const ctx = canvas.getContext('2d');
  const statusReadout = document.getElementById('statusReadout');

  // ==========================================================================
  // 1. RETRO ARCADE WEB AUDIO ENGINE (SFX + FM-SYNTH BGM)
  // ==========================================================================
  class SoundEngine {
    constructor() {
      this.ctx = null;
      this.sfxEnabled = true;
      this.bgmEnabled = true;
      this.bgmTimer = null;
      this.bgmStep = 0;
      this.bossMode = false;
    }

    init() {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (AC) this.ctx = new AC();
      }
      if (this.ctx && this.ctx.state === 'suspended') {
        this.ctx.resume().catch(() => {});
      }
      if (this.bgmEnabled && !this.bgmTimer) {
        this.startBgm();
      }
    }

    tone(freq, freqEnd, dur, type = 'square', vol = 0.12, delay = 0) {
      if (!this.sfxEnabled || !this.ctx) return;
      const t = this.ctx.currentTime + delay;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(Math.max(20, freq), t);
      if (freqEnd && freqEnd !== freq) {
        osc.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), t + dur);
      }
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.linearRampToValueAtTime(vol, t + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(t);
      osc.stop(t + dur + 0.02);
    }

    noise(dur, vol = 0.14, hpFreq = 800, delay = 0) {
      if (!this.sfxEnabled || !this.ctx) return;
      const t = this.ctx.currentTime + delay;
      const sampleCount = Math.floor(this.ctx.sampleRate * dur);
      const buf = this.ctx.createBuffer(1, sampleCount, this.ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < sampleCount; i++) data[i] = Math.random() * 2 - 1;
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(hpFreq, t);
      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(vol, t);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      src.connect(filter);
      filter.connect(gain);
      gain.connect(this.ctx.destination);
      src.start(t);
      src.stop(t + dur + 0.02);
    }

    playSwing(stage = 1) {
      this.noise(0.09, 0.09, 1400 + stage * 400);
      this.tone(420 + stage * 110, 170, 0.1, 'triangle', 0.08);
    }

    playHit(heavy = false) {
      if (heavy) {
        this.noise(0.16, 0.24, 650);
        this.tone(180, 42, 0.18, 'sawtooth', 0.2);
        this.tone(520, 160, 0.12, 'square', 0.12);
      } else {
        this.noise(0.08, 0.18, 1200);
        this.tone(240, 75, 0.09, 'square', 0.14);
      }
    }

    playPlayerHurt() {
      this.noise(0.14, 0.18, 500);
      this.tone(310, 95, 0.18, 'sawtooth', 0.16);
    }

    playJump() {
      this.tone(220, 560, 0.12, 'triangle', 0.1);
    }

    playDash() {
      this.noise(0.1, 0.1, 2200);
      this.tone(320, 680, 0.09, 'sine', 0.08);
    }

    playCharge() {
      this.tone(160, 740, 0.36, 'sawtooth', 0.12);
      this.tone(240, 1100, 0.36, 'triangle', 0.09, 0.04);
    }

    playCannonPulse(idx = 0) {
      const pitch = 520 + (idx % 5) * 85;
      this.tone(pitch, 130, 0.085, 'sawtooth', 0.13);
      this.noise(0.06, 0.12, 1800);
    }

    playEnemyKO() {
      this.tone(280, 55, 0.28, 'sawtooth', 0.14);
      this.noise(0.18, 0.12, 420, 0.05);
    }

    playCrateBreak() {
      this.noise(0.16, 0.2, 900);
      this.tone(150, 52, 0.14, 'square', 0.15);
    }

    playPickup(type) {
      if (type === 'food') {
        this.tone(523, 523, 0.08, 'triangle', 0.12, 0);
        this.tone(659, 659, 0.08, 'triangle', 0.12, 0.07);
        this.tone(784, 1046, 0.16, 'triangle', 0.13, 0.14);
      } else if (type === 'crystal') {
        this.tone(660, 990, 0.1, 'sine', 0.12, 0);
        this.tone(990, 1320, 0.16, 'sine', 0.12, 0.08);
      } else {
        this.tone(880, 1320, 0.1, 'square', 0.08, 0);
      }
    }

    playGo() {
      this.tone(523, 523, 0.09, 'square', 0.1, 0);
      this.tone(659, 659, 0.09, 'square', 0.1, 0.09);
      this.tone(784, 784, 0.2, 'square', 0.11, 0.18);
    }

    playBossWarn() {
      for (let i = 0; i < 3; i++) {
        this.tone(440, 220, 0.18, 'sawtooth', 0.14, i * 0.28);
      }
    }

    playVictory() {
      const notes = [523, 659, 784, 1046, 784, 1046];
      notes.forEach((n, i) => {
        this.tone(n, n, i === notes.length - 1 ? 0.36 : 0.11, 'square', 0.1, i * 0.12);
      });
    }

    startBgm() {
      if (this.bgmTimer) return;
      // Classic 16-bit Streets of Rage style driving minor bassline + synth percussion
      const streetBass = [
        110, 0, 110, 130.8, 146.8, 0, 130.8, 110,
        98, 0, 98, 110, 130.8, 146.8, 164.8, 146.8,
        87.3, 0, 87.3, 98, 110, 0, 130.8, 110,
        98, 110, 130.8, 0, 164.8, 146.8, 130.8, 110,
      ];
      const bossBass = [
        92.5, 92.5, 110, 92.5, 123.5, 92.5, 138.6, 123.5,
        82.4, 82.4, 98, 82.4, 110, 98, 123.5, 110,
      ];
      const streetLead = [
        440, 0, 0, 523.2, 587.3, 0, 523.2, 0,
        493.9, 0, 440, 0, 392, 0, 440, 0,
        349.2, 0, 440, 0, 523.2, 0, 587.3, 0,
        659.2, 0, 587.3, 523.2, 493.9, 0, 440, 0,
      ];

      this.bgmTimer = setInterval(() => {
        if (!this.bgmEnabled || !this.ctx || this.ctx.state !== 'running') return;
        if (game.state !== 'playing') return;

        const step = this.bgmStep++;
        const t = this.ctx.currentTime;
        const bassSeq = this.bossMode ? bossBass : streetBass;
        const bFreq = bassSeq[step % bassSeq.length];

        if (bFreq > 0) {
          const osc = this.ctx.createOscillator();
          const g = this.ctx.createGain();
          osc.type = 'sawtooth';
          const filter = this.ctx.createBiquadFilter();
          filter.type = 'lowpass';
          filter.frequency.setValueAtTime(this.bossMode ? 650 : 520, t);
          osc.frequency.setValueAtTime(bFreq, t);
          g.gain.setValueAtTime(0.055, t);
          g.gain.exponentialRampToValueAtTime(0.0001, t + 0.13);
          osc.connect(filter);
          filter.connect(g);
          g.connect(this.ctx.destination);
          osc.start(t);
          osc.stop(t + 0.14);
        }

        // Kick on 0, 4, 8, 12; Snare on 2, 6, 10, 14
        const m = step % 4;
        if (m === 0) {
          const osc = this.ctx.createOscillator();
          const g = this.ctx.createGain();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(130, t);
          osc.frequency.exponentialRampToValueAtTime(38, t + 0.09);
          g.gain.setValueAtTime(0.09, t);
          g.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);
          osc.connect(g);
          g.connect(this.ctx.destination);
          osc.start(t);
          osc.stop(t + 0.11);
        } else if (m === 2) {
          // Soft synth snare
          const sc = Math.floor(this.ctx.sampleRate * 0.05);
          const buf = this.ctx.createBuffer(1, sc, this.ctx.sampleRate);
          const d = buf.getChannelData(0);
          for (let i = 0; i < sc; i++) d[i] = Math.random() * 2 - 1;
          const src = this.ctx.createBufferSource();
          src.buffer = buf;
          const g = this.ctx.createGain();
          g.gain.setValueAtTime(0.035, t);
          g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
          src.connect(g);
          g.connect(this.ctx.destination);
          src.start(t);
        }

        // Occasional lead melody
        if (!this.bossMode && step >= 16) {
          const lFreq = streetLead[step % streetLead.length];
          if (lFreq > 0) {
            const osc = this.ctx.createOscillator();
            const g = this.ctx.createGain();
            osc.type = 'square';
            osc.frequency.setValueAtTime(lFreq, t);
            g.gain.setValueAtTime(0.024, t);
            g.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
            osc.connect(g);
            g.connect(this.ctx.destination);
            osc.start(t);
            osc.stop(t + 0.15);
          }
        }
      }, 122); // ~123 BPM 16th-note groove
    }
  }

  const sfx = new SoundEngine();

  // ==========================================================================
  // 2. CHARACTER ACTION STUDIO CONFIG & MULTI-FRAME SPRITE BANK (300x264)
  // ==========================================================================
  const STORAGE_KEY = 'schoolfight_studio_v13';

  const HERO_ROSTER = [
    {
      id: 'kuromi',
      name: '呆呆伶',
      hudName: '呆呆伶',
      badge: '😈 Star Fish 魔杖使',
      subtitle: '徒手三連拳 · 寒冰重擊 · ↑+重攻 龍捲旋風腳 · 能量砲十連發',
      accent: '#f43f8e',
      accentLight: '#f9a8d4',
      accentDark: '#581c87',
      stats: { power: 4, speed: 4, range: 5 },
      walkSpeed: 225,
      runSpeed: 365,
      specialType: 'beam',
      specialLabel: '能量砲',
      specialShout: '能量砲十連發!!',
      specialSub: 'MEGA CANNON BLAST!!',
      heavyShout: '月牙天沖!!',
      heavySub: 'GETSUGA TENSHO!!',
      dashLightShout: '浪子踢球!!',
      dashLightSub: 'ROGUE SHOOT!!',
      dashHeavyShout: '星杖衝刺斬!!',
      dashHeavySub: 'STAR SLASH!!',
      tornadoShout: '龍捲旋風腳!!',
      tornadoSub: 'TORNADO HURRICANE KICK!!',
      sparkColor: '#e879f9',
      heavySparkColor: '#38bdf8',
      sheets: {
        idle: 'idle',
        walk: 'walk',
        run: 'run',
        dash: 'dash',
        lightAttack: 'lightAttack',
        attack: 'attack',
        dashLightAttack: 'dashLightAttack',
        dashAttack: 'dashAttack',
        tornadoKick: 'tornadoKick',
        special: 'special',
        hurt: 'hurt',
        victory: 'victory',
      },
    },
    {
      id: 'redpanda',
      name: '超級帆',
      hudName: '超級帆',
      badge: '🦊 烈焰拳鬥士',
      subtitle: '五連閃電拳 · 升龍拳(浮空) · ↑+重攻 烈焰龍捲腳 · 百拳連擊',
      accent: '#f97316',
      accentLight: '#fde047',
      accentDark: '#7c2d12',
      stats: { power: 5, speed: 5, range: 4 },
      walkSpeed: 248,
      runSpeed: 405,
      specialType: 'flurry',
      specialLabel: '百拳連擊',
      specialShout: '赤焰百拳連擊!!',
      specialSub: '100-FIST FLAME RUSH!!',
      heavyShout: '升龍拳!!',
      heavySub: 'SHORYUKEN!!',
      dashLightShout: '閃電踢球!!',
      dashLightSub: 'THUNDER SHOOT!!',
      dashHeavyShout: '赤焰衝刺撞擊!!',
      dashHeavySub: 'BLAZING TACKLE!!',
      tornadoShout: '烈焰龍捲旋風腳!!',
      tornadoSub: 'BLAZING TORNADO KICK!!',
      sparkColor: '#facc15',
      heavySparkColor: '#fde047',
      sheets: {
        idle: 'rp_idle',
        walk: 'rp_walk',
        run: 'rp_run',
        dash: 'rp_dash',
        lightAttack: 'rp_lightAttack',
        attack: 'rp_attack',
        dashLightAttack: 'rp_dashLightAttack',
        dashAttack: 'rp_dashAttack',
        tornadoKick: 'rp_tornadoKick',
        special: 'rp_special',
        hurt: 'rp_hurt',
        victory: 'rp_victory',
      },
      fallbacks: {
        dash: 'rp_run',
        hurt: 'rp_idle',
      },
    },
    {
      id: 'adailing',
      name: '阿呆伶',
      hudName: '阿呆伶',
      badge: '🎒 海星小學生',
      subtitle: '海星三連拍 · 海星飛星斬 · 旋風踢 · 全校星光砲',
      accent: '#10b981',
      accentLight: '#6ee7b7',
      accentDark: '#065f46',
      stats: { power: 4, speed: 5, range: 5 },
      walkSpeed: 245,
      runSpeed: 398,
      specialType: 'beam',
      specialLabel: '星光波動砲',
      specialShout: '海星全校星光砲!!',
      specialSub: 'STARFISH NOVA CANNON!!',
      heavyShout: '海星飛星斬!!',
      heavySub: 'STARFISH CRESCENT!!',
      dashLightShout: '操場黃金抽射!!',
      dashLightSub: 'GOLDEN VOLLEY!!',
      dashHeavyShout: '翠綠流星衝刺!!',
      dashHeavySub: 'EMERALD METEOR!!',
      tornadoShout: '海星旋風踢!!',
      tornadoSub: 'STARFISH CYCLONE!!',
      sparkColor: '#34d399',
      heavySparkColor: '#fde047',
      sheets: {
        idle: 'ad_idle',
        walk: 'ad_walk',
        run: 'ad_run',
        dash: 'ad_dash',
        lightAttack: 'ad_lightAttack',
        attack: 'ad_attack',
        dashLightAttack: 'ad_dashLightAttack',
        dashAttack: 'ad_dashAttack',
        tornadoKick: 'ad_tornadoKick',
        special: 'ad_special',
        hurt: 'ad_hurt',
        victory: 'ad_victory',
      },
      fallbacks: {
        walk: 'ad_idle',
        run: 'ad_idle',
        dash: 'ad_idle',
        lightAttack: 'ad_idle',
        attack: 'ad_idle',
        dashLightAttack: 'ad_idle',
        dashAttack: 'ad_idle',
        tornadoKick: 'ad_idle',
        special: 'ad_idle',
        hurt: 'ad_idle',
        victory: 'ad_idle',
      },
    },
  ];

  function getSelectedHero() {
    return HERO_ROSTER.find((h) => h.id === game.selectedHeroId) || HERO_ROSTER[0];
  }

  const DEFAULT_SHEETS_DEF = [
    { key: 'idle', file: 'assets/idle_sheet.webp', cols: 5, rows: 2, anchorX: 136, anchorY: 242 },
    { key: 'walk', file: 'assets/walk_sheet.webp', cols: 5, rows: 2, anchorX: 136, anchorY: 242 },
    { key: 'run', file: 'assets/run_sheet.webp', cols: 5, rows: 2, anchorX: 136, anchorY: 242 },
    { key: 'dash', file: 'assets/dash_sheet.webp', cols: 5, rows: 2, anchorX: 136, anchorY: 242 },
    { key: 'lightAttack', file: 'assets/lightAttack_sheet.webp', cols: 5, rows: 2, anchorX: 136, anchorY: 242 },
    { key: 'attack', file: 'assets/attack_sheet.webp', cols: 10, rows: 1, anchorX: 210, anchorY: 304 },
    { key: 'dashLightAttack', file: 'assets/dashLightAttack_sheet.webp', cols: 5, rows: 2, anchorX: 136, anchorY: 242 },
    { key: 'dashAttack', file: 'assets/dashAttack_sheet.webp', cols: 5, rows: 2, anchorX: 136, anchorY: 242 },
    { key: 'tornadoKick', file: 'assets/tornadoKick_sheet.webp', cols: 5, rows: 2, anchorX: 136, anchorY: 242 },
    { key: 'special', file: 'assets/special_sheet.webp', cols: 5, rows: 2, anchorX: 136, anchorY: 242 },
    { key: 'hurt', file: 'assets/hurt_sheet.webp', cols: 5, rows: 2, anchorX: 136, anchorY: 242 },
    { key: 'victory', file: 'assets/victory_sheet.webp', cols: 5, rows: 2, anchorX: 136, anchorY: 242 },
    // Hero 2: 超級帆 (10-Frame Hand-Drawn HD Sprite Sheets — 100% Distinct Heavy / Dash-Light / Dash-Heavy!)
    { key: 'rp_idle', file: 'assets/rp_idle_sheet.webp', cols: 5, rows: 2, anchorX: 136, anchorY: 242 },
    { key: 'rp_walk', file: 'assets/rp_walk_sheet.webp', cols: 5, rows: 2, anchorX: 136, anchorY: 242 },
    { key: 'rp_run', file: 'assets/rp_run_sheet.webp', cols: 5, rows: 2, anchorX: 136, anchorY: 242 },
    { key: 'rp_dash', file: 'assets/rp_dash_sheet.webp', cols: 5, rows: 2, anchorX: 136, anchorY: 242 },
    { key: 'rp_lightAttack', file: 'assets/rp_lightAttack_sheet.webp', cols: 5, rows: 2, anchorX: 136, anchorY: 242 },
    { key: 'rp_attack', file: 'assets/rp_attack_sheet.webp', cols: 5, rows: 2, anchorX: 136, anchorY: 242 },
    { key: 'rp_dashLightAttack', file: 'assets/rp_dashLightAttack_sheet.webp', cols: 5, rows: 2, anchorX: 136, anchorY: 242 },
    { key: 'rp_dashAttack', file: 'assets/rp_dashAttack_sheet.webp', cols: 5, rows: 2, anchorX: 136, anchorY: 242 },
    { key: 'rp_tornadoKick', file: 'assets/rp_tornadoKick_sheet.webp', cols: 5, rows: 2, anchorX: 136, anchorY: 242 },
    { key: 'rp_special', file: 'assets/rp_special_sheet.webp', cols: 5, rows: 2, anchorX: 136, anchorY: 242 },
    { key: 'rp_victory', file: 'assets/rp_victory_sheet.webp', cols: 5, rows: 2, anchorX: 136, anchorY: 242 },
    { key: 'ad_idle', file: 'assets/ad_idle_sheet.webp', cols: 5, rows: 2, anchorX: 150, anchorY: 242 },
    { key: 'ad_walk', file: 'assets/ad_walk_sheet.webp', cols: 5, rows: 2, anchorX: 150, anchorY: 242 },
    { key: 'ad_run', file: 'assets/ad_run_sheet.webp', cols: 5, rows: 2, anchorX: 150, anchorY: 242 },
    { key: 'ad_dash', file: 'assets/ad_dash_sheet.webp', cols: 5, rows: 2, anchorX: 150, anchorY: 242 },
    { key: 'ad_attack', file: 'assets/ad_attack_sheet.webp', cols: 10, rows: 1, anchorX: 210, anchorY: 304 },
    { key: 'ad_dashLightAttack', file: 'assets/ad_dashLightAttack_sheet.webp', cols: 5, rows: 2, anchorX: 150, anchorY: 242 },
    { key: 'ad_dashAttack', file: 'assets/ad_dashAttack_sheet.webp', cols: 10, rows: 1, anchorX: 210, anchorY: 304 },
    { key: 'ad_tornadoKick', file: 'assets/ad_tornadoKick_sheet.webp', cols: 11, rows: 1, anchorX: 210, anchorY: 304 },
    // Wave 3 Brand-New Unique Monsters + Donghua Martial Grandmaster Final Boss (2x Hero Size!)
    { key: 'enemy_kangaroo_move', file: 'assets/enemy_kangaroo_move_sheet.webp', cols: 5, rows: 2, anchorX: 150, anchorY: 236 },
    { key: 'enemy_kangaroo_attack', file: 'assets/enemy_kangaroo_attack_sheet.webp', cols: 5, rows: 2, anchorX: 150, anchorY: 236 },
    { key: 'enemy_kangaroo_hurt', file: 'assets/enemy_kangaroo_hurt_sheet.webp', cols: 5, rows: 2, anchorX: 150, anchorY: 236 },
    { key: 'enemy_kangaroo_ko', file: 'assets/enemy_kangaroo_ko_sheet.webp', cols: 5, rows: 2, anchorX: 150, anchorY: 236 },
    { key: 'enemy_zebra_move', file: 'assets/enemy_zebra_move_sheet.webp', cols: 10, rows: 1, anchorX: 210, anchorY: 304 },
    { key: 'enemy_zebra_attack', file: 'assets/enemy_zebra_attack_sheet.webp', cols: 10, rows: 1, anchorX: 210, anchorY: 304 },
    { key: 'enemy_zebra_hurt', file: 'assets/enemy_zebra_hurt_sheet.webp', cols: 10, rows: 1, anchorX: 210, anchorY: 304 },
    { key: 'enemy_zebra_ko', file: 'assets/enemy_zebra_ko_sheet.webp', cols: 10, rows: 1, anchorX: 210, anchorY: 304 },
    { key: 'enemy_koala_move', file: 'assets/enemy_koala_move_sheet.webp', cols: 10, rows: 1, anchorX: 210, anchorY: 304 },
    { key: 'enemy_koala_attack', file: 'assets/enemy_koala_attack_sheet.webp', cols: 10, rows: 1, anchorX: 210, anchorY: 304 },
    { key: 'enemy_koala_hurt', file: 'assets/enemy_koala_hurt_sheet.webp', cols: 10, rows: 1, anchorX: 210, anchorY: 304 },
    { key: 'enemy_koala_ko', file: 'assets/enemy_koala_ko_sheet.webp', cols: 10, rows: 1, anchorX: 210, anchorY: 304 },
    { key: 'enemy_capybara_move', file: 'assets/enemy_capybara_move_sheet.webp', cols: 10, rows: 1, anchorX: 210, anchorY: 304 },
    { key: 'enemy_capybara_attack', file: 'assets/enemy_capybara_attack_sheet.webp', cols: 10, rows: 1, anchorX: 210, anchorY: 304 },
    { key: 'enemy_capybara_hurt', file: 'assets/enemy_capybara_hurt_sheet.webp', cols: 10, rows: 1, anchorX: 210, anchorY: 304 },
    { key: 'enemy_capybara_ko', file: 'assets/enemy_capybara_ko_sheet.webp', cols: 10, rows: 1, anchorX: 210, anchorY: 304 },
    { key: 'enemy_fat_tiger_move', file: 'assets/enemy_fat_tiger_move_sheet.webp', cols: 5, rows: 2, anchorX: 150, anchorY: 242 },
    { key: 'enemy_fat_tiger_attack', file: 'assets/enemy_fat_tiger_attack_sheet.webp', cols: 5, rows: 2, anchorX: 150, anchorY: 242 },
    { key: 'enemy_fat_tiger_hurt', file: 'assets/enemy_fat_tiger_hurt_sheet.webp', cols: 5, rows: 2, anchorX: 150, anchorY: 242 },
    { key: 'enemy_fat_tiger_ko', file: 'assets/enemy_fat_tiger_ko_sheet.webp', cols: 5, rows: 2, anchorX: 150, anchorY: 242 },
    { key: 'enemy_cactus_move', file: 'assets/enemy_cactus_move_sheet.webp', cols: 5, rows: 2, anchorX: 150, anchorY: 236 },
    { key: 'enemy_cactus_attack', file: 'assets/enemy_cactus_attack_sheet.webp', cols: 5, rows: 2, anchorX: 150, anchorY: 236 },
    { key: 'enemy_cactus_hurt', file: 'assets/enemy_cactus_hurt_sheet.webp', cols: 5, rows: 2, anchorX: 150, anchorY: 236 },
    { key: 'enemy_cactus_ko', file: 'assets/enemy_cactus_ko_sheet.webp', cols: 5, rows: 2, anchorX: 150, anchorY: 236 },
    { key: 'enemy_wizard_ghost_move', file: 'assets/enemy_wizard_ghost_move_sheet.webp', cols: 5, rows: 4, anchorX: 150, anchorY: 236 },
    { key: 'enemy_wizard_ghost_attack', file: 'assets/enemy_wizard_ghost_attack_sheet.webp', cols: 5, rows: 4, anchorX: 150, anchorY: 236 },
    { key: 'enemy_wizard_ghost_hurt', file: 'assets/enemy_wizard_ghost_hurt_sheet.webp', cols: 5, rows: 2, anchorX: 150, anchorY: 236 },
    { key: 'enemy_wizard_ghost_ko', file: 'assets/enemy_wizard_ghost_ko_sheet.webp', cols: 5, rows: 2, anchorX: 150, anchorY: 236 },
    { key: 'enemy_donghua_boss_move', file: 'assets/enemy_donghua_boss_move_sheet.webp', cols: 5, rows: 2, anchorX: 150, anchorY: 242 },
    { key: 'enemy_donghua_boss_attack', file: 'assets/enemy_donghua_boss_attack_sheet.webp', cols: 5, rows: 2, anchorX: 150, anchorY: 242 },
    { key: 'enemy_donghua_boss_hurt', file: 'assets/enemy_donghua_boss_hurt_sheet.webp', cols: 5, rows: 2, anchorX: 150, anchorY: 242 },
    { key: 'enemy_donghua_boss_ko', file: 'assets/enemy_donghua_boss_ko_sheet.webp', cols: 5, rows: 2, anchorX: 150, anchorY: 242 },
    // 斑馬怪 (Zebra Monster) & 袋鼠怪 (Kangaroo Monster) — built from the uploaded design sheets
    { key: 'enemy_zebra_rush_move', file: 'assets/enemy_zebra_rush_move_sheet.webp', cols: 5, rows: 2, anchorX: 150, anchorY: 236 },
    { key: 'enemy_zebra_rush_attack', file: 'assets/enemy_zebra_rush_attack_sheet.webp', cols: 5, rows: 2, anchorX: 150, anchorY: 236 },
    { key: 'enemy_zebra_rush_hurt', file: 'assets/enemy_zebra_rush_hurt_sheet.webp', cols: 5, rows: 2, anchorX: 150, anchorY: 236 },
    { key: 'enemy_zebra_rush_ko', file: 'assets/enemy_zebra_rush_ko_sheet.webp', cols: 5, rows: 2, anchorX: 150, anchorY: 236 },
    { key: 'enemy_joey_kangaroo_move', file: 'assets/enemy_joey_kangaroo_move_sheet.webp', cols: 5, rows: 2, anchorX: 150, anchorY: 236 },
    { key: 'enemy_joey_kangaroo_attack', file: 'assets/enemy_joey_kangaroo_attack_sheet.webp', cols: 5, rows: 2, anchorX: 150, anchorY: 236 },
    { key: 'enemy_joey_kangaroo_hurt', file: 'assets/enemy_joey_kangaroo_hurt_sheet.webp', cols: 5, rows: 2, anchorX: 150, anchorY: 236 },
    { key: 'enemy_joey_kangaroo_ko', file: 'assets/enemy_joey_kangaroo_ko_sheet.webp', cols: 5, rows: 2, anchorX: 150, anchorY: 236 },
    // Wave 2 Monsters: Full 10-Frame Move + Attack + Hurt + KO Sheets
    { key: 'enemy_pengking_move', file: 'assets/enemy_pengking_move_sheet.webp', cols: 5, rows: 2, anchorX: 150, anchorY: 236 },
    { key: 'enemy_pengking_attack', file: 'assets/enemy_pengking_attack_sheet.webp', cols: 5, rows: 2, anchorX: 150, anchorY: 236 },
    { key: 'enemy_pengking_hurt', file: 'assets/enemy_pengking_hurt_sheet.webp', cols: 5, rows: 2, anchorX: 150, anchorY: 236 },
    { key: 'enemy_pengking_ko', file: 'assets/enemy_pengking_ko_sheet.webp', cols: 5, rows: 2, anchorX: 150, anchorY: 236 },
    { key: 'enemy_pengice_move', file: 'assets/enemy_pengice_move_sheet.webp', cols: 5, rows: 2, anchorX: 150, anchorY: 236 },
    { key: 'enemy_pengice_attack', file: 'assets/enemy_pengice_attack_sheet.webp', cols: 5, rows: 2, anchorX: 150, anchorY: 236 },
    { key: 'enemy_pengice_hurt', file: 'assets/enemy_pengice_hurt_sheet.webp', cols: 5, rows: 2, anchorX: 150, anchorY: 236 },
    { key: 'enemy_pengice_ko', file: 'assets/enemy_pengice_ko_sheet.webp', cols: 5, rows: 2, anchorX: 150, anchorY: 236 },
    { key: 'enemy_rabbit_move', file: 'assets/enemy_rabbit_move_sheet.webp', cols: 5, rows: 2, anchorX: 150, anchorY: 236 },
    { key: 'enemy_rabbit_attack', file: 'assets/enemy_rabbit_attack_sheet.webp', cols: 5, rows: 2, anchorX: 150, anchorY: 236 },
    { key: 'enemy_rabbit_hurt', file: 'assets/enemy_rabbit_hurt_sheet.webp', cols: 5, rows: 2, anchorX: 150, anchorY: 236 },
    { key: 'enemy_rabbit_ko', file: 'assets/enemy_rabbit_ko_sheet.webp', cols: 5, rows: 2, anchorX: 150, anchorY: 236 },
    { key: 'enemy_ghost_move', file: 'assets/enemy_ghost_move_sheet.webp', cols: 5, rows: 2, anchorX: 150, anchorY: 236 },
    { key: 'enemy_ghost_attack', file: 'assets/enemy_ghost_attack_sheet.webp', cols: 5, rows: 2, anchorX: 150, anchorY: 236 },
    { key: 'enemy_ghost_hurt', file: 'assets/enemy_ghost_hurt_sheet.webp', cols: 5, rows: 2, anchorX: 150, anchorY: 236 },
    { key: 'enemy_ghost_ko', file: 'assets/enemy_ghost_ko_sheet.webp', cols: 5, rows: 2, anchorX: 150, anchorY: 236 },
    { key: 'enemy_sheep_move', file: 'assets/enemy_sheep_move_sheet.webp', cols: 10, rows: 1, anchorX: 210, anchorY: 304 },
    { key: 'enemy_sheep_attack', file: 'assets/enemy_sheep_attack_sheet.webp', cols: 10, rows: 1, anchorX: 210, anchorY: 304 },
    { key: 'enemy_sheep_hurt', file: 'assets/enemy_sheep_hurt_sheet.webp', cols: 10, rows: 1, anchorX: 210, anchorY: 304 },
    { key: 'enemy_sheep_ko', file: 'assets/enemy_sheep_ko_sheet.webp', cols: 10, rows: 1, anchorX: 210, anchorY: 304 },
    // Classic Monsters: Full 10-Frame Hand-Drawn HD Sprite Sheets (Pig, Slime, Mushroom, Pufferfish)
    { key: 'enemy_pig_move', file: 'assets/enemy_pig_move_sheet.webp', cols: 10, rows: 1, anchorX: 210, anchorY: 304 },
    { key: 'enemy_pig_attack', file: 'assets/enemy_pig_attack_sheet.webp', cols: 10, rows: 1, anchorX: 210, anchorY: 304 },
    { key: 'enemy_pig_hurt', file: 'assets/enemy_pig_hurt_sheet.webp', cols: 10, rows: 1, anchorX: 210, anchorY: 304 },
    { key: 'enemy_pig_ko', file: 'assets/enemy_pig_ko_sheet.webp', cols: 10, rows: 1, anchorX: 210, anchorY: 304 },
    { key: 'enemy_slime_idle', file: 'assets/enemy_slime_idle_sheet.webp', cols: 5, rows: 2, anchorX: 150, anchorY: 236 },
    { key: 'enemy_slime_move', file: 'assets/enemy_slime_move_sheet.webp', cols: 5, rows: 2, anchorX: 150, anchorY: 236 },
    { key: 'enemy_slime_attack', file: 'assets/enemy_slime_attack_sheet.webp', cols: 5, rows: 2, anchorX: 150, anchorY: 236 },
    { key: 'enemy_slime_angry', file: 'assets/enemy_slime_angry_sheet.webp', cols: 5, rows: 2, anchorX: 150, anchorY: 236 },
    { key: 'enemy_slime_ko', file: 'assets/enemy_slime_ko_sheet.webp', cols: 5, rows: 2, anchorX: 150, anchorY: 236 },
    { key: 'enemy_mushroom_move', file: 'assets/enemy_mushroom_move_sheet.webp', cols: 5, rows: 2, anchorX: 150, anchorY: 236 },
    { key: 'enemy_mushroom_attack', file: 'assets/enemy_mushroom_attack_sheet.webp', cols: 5, rows: 2, anchorX: 150, anchorY: 236 },
    { key: 'enemy_mushroom_ko', file: 'assets/enemy_mushroom_ko_sheet.webp', cols: 5, rows: 2, anchorX: 150, anchorY: 236 },
    { key: 'enemy_puffer_move', file: 'assets/enemy_puffer_move_sheet.webp', cols: 5, rows: 2, anchorX: 150, anchorY: 236 },
    { key: 'enemy_puffer_attack', file: 'assets/enemy_puffer_attack_sheet.webp', cols: 5, rows: 2, anchorX: 150, anchorY: 236 },
    { key: 'enemy_puffer_ko', file: 'assets/enemy_puffer_ko_sheet.webp', cols: 5, rows: 2, anchorX: 150, anchorY: 236 },
    // Water-Type & Cosmic Starfish Enemy Sheets
    { key: 'enemy_star_move', file: 'assets/enemy_star_move_sheet.webp', cols: 5, rows: 2, anchorX: 150, anchorY: 236 },
    { key: 'enemy_star_attack', file: 'assets/enemy_star_attack_sheet.webp', cols: 5, rows: 2, anchorX: 150, anchorY: 236 },
    { key: 'enemy_star_ko', file: 'assets/enemy_star_ko_sheet.webp', cols: 5, rows: 2, anchorX: 150, anchorY: 236 },
  ];

  function createDefaultHeroActions() {
    return [
      { id: 'idle', label: '待機動畫 (Idle)', triggerDesc: '靜止自動循環', sheetKey: 'idle', fallbackSheet: null, fps: 8.5, cols: 5, rows: 2, key: null, altKeys: [], rebindable: false },
      { id: 'walk', label: '走路動畫 (Walk)', triggerDesc: '獨立 10 幀直立走路（一般 WASD / 方向鍵）', sheetKey: 'walk', fallbackSheet: null, fps: 11, cols: 5, rows: 2, key: null, altKeys: [], rebindable: false },
      { id: 'run', label: '跑步動畫 (Run)', triggerDesc: '連按兩次 AA / DD / ←← / →→', sheetKey: 'run', fallbackSheet: null, fps: 17, cols: 5, rows: 2, key: null, altKeys: [], rebindable: false },
      { id: 'dash', label: '瞬間衝刺・閃身步 (Dash)', triggerDesc: '喊出「閃身步」並瞬間突進一大段距離', sheetKey: 'dash', fallbackSheet: 'run', fps: 25, cols: 5, rows: 2, key: 'ShiftLeft', altKeys: ['ShiftRight'], rebindable: true },
      { id: 'lightAttack', label: '輕攻擊・揮拳連擊 (Light)', triggerDesc: '徒手三段拳擊（直拳→勾拳→上勾拳）', sheetKey: 'lightAttack', fallbackSheet: 'attack', fps: 17, cols: 5, rows: 2, key: 'Numpad4', altKeys: ['KeyJ', 'KeyZ'], rebindable: true },
      { id: 'heavyAttack', label: '重攻擊・月牙天沖 (Heavy)', triggerDesc: '獨立 10 連幀！揮出冰藍月牙斬擊並釋放貫穿月牙天沖劍氣波', sheetKey: 'attack', fallbackSheet: null, fps: 16, cols: 10, rows: 1, frameCount: 10, key: 'Numpad5', altKeys: ['KeyU', 'KeyC'], rebindable: true },
      { id: 'dashLightAttack', label: '衝刺輕攻擊・浪子踢球 (Dash Light)', triggerDesc: '獨立 10 幀！跑步中 按 輕攻擊 發動，踢出能量足球', sheetKey: 'dashLightAttack', fallbackSheet: null, fps: 17, cols: 5, rows: 2, key: null, altKeys: [], rebindable: false },
      { id: 'dashAttack', label: '衝刺重攻擊・星杖衝刺斬 (Dash Heavy)', triggerDesc: '獨立 10 幀！跑步中 按 重攻擊 發動星光衝刺斬', sheetKey: 'dashAttack', fallbackSheet: null, fps: 18, cols: 5, rows: 2, key: null, altKeys: [], rebindable: false },
      { id: 'tornadoKick', label: '特殊招式・龍捲旋風腳 (Tornado Kick)', triggerDesc: '按住 ↑ 再按 重攻擊（W+Num5 / 手把 ↑+重攻）發動！多段旋風擊飛浮空可空中追打', sheetKey: 'tornadoKick', fallbackSheet: 'dashAttack', fps: 15, cols: 5, rows: 2, key: null, altKeys: [], rebindable: false },
      { id: 'special', label: '能量砲十連發 (Special)', triggerDesc: '霸體集氣・全螢幕十連擊光砲＋美漫衝擊幀', sheetKey: 'special', fallbackSheet: null, fps: 12, cols: 5, rows: 2, key: 'Numpad0', altKeys: ['KeyL', 'KeyX'], rebindable: true },
      { id: 'jump', label: '跳躍 (Jump)', triggerDesc: '原地／移動跳躍（空中可揮杖追打）', sheetKey: 'jump', fallbackSheet: 'run', fps: 12, cols: 5, rows: 2, key: 'Space', altKeys: ['KeyK'], rebindable: true },
      { id: 'hurt', label: '受傷／受擊 (Hurt)', triggerDesc: '高解析 10 幀受傷硬直、踉蹌與回復', sheetKey: 'hurt', fallbackSheet: null, fps: 15, cols: 5, rows: 2, key: null, altKeys: [], rebindable: false },
      { id: 'victory', label: '戰鬥勝利動作 (Victory)', triggerDesc: '過關結算專屬 10 幀魔杖星光歡慶勝利動畫', sheetKey: 'victory', fallbackSheet: 'idle', fps: 10, cols: 5, rows: 2, key: null, altKeys: [], rebindable: false },
    ];
  }

  function createDefaultRedPandaActions() {
    return [
      { id: 'rp_idle', label: '待機動畫 (Idle)', triggerDesc: '10 幀呼吸、眨眼與條紋尾擺動', sheetKey: 'rp_idle', fallbackSheet: null, fps: 8.5, cols: 5, rows: 2, key: null, altKeys: [], rebindable: false },
      { id: 'rp_walk', label: '走路動畫 (Walk)', triggerDesc: '獨立 10 幀直立健步走（WASD / 方向鍵）', sheetKey: 'rp_walk', fallbackSheet: null, fps: 12, cols: 5, rows: 2, key: null, altKeys: [], rebindable: false },
      { id: 'rp_run', label: '奔跑動畫 (Run)', triggerDesc: '連按兩次 AA / DD / ←← / →→', sheetKey: 'rp_run', fallbackSheet: null, fps: 17, cols: 5, rows: 2, key: null, altKeys: [], rebindable: false },
      { id: 'rp_dash', label: '瞬間衝刺・蒼藍音爆閃身步 (Dash)', triggerDesc: '10 幀極速蒼藍音爆破風瞬間突進（Shift 觸發）', sheetKey: 'rp_dash', fallbackSheet: null, fps: 24, cols: 5, rows: 2, key: null, altKeys: [], rebindable: false },
      { id: 'rp_lightAttack', label: '輕攻擊・五連閃電連擊 (Light)', triggerDesc: '金色閃電高速連拳（共用輕攻鍵）', sheetKey: 'rp_lightAttack', fallbackSheet: null, fps: 18, cols: 5, rows: 2, key: null, altKeys: [], rebindable: false },
      { id: 'rp_attack', label: '重攻擊・升龍拳 (Heavy)', triggerDesc: '獨立 10 幀！發招大喊「升龍拳」躍起黃金能量上鉤拳，把敵人高高打飛至空中（可接空中追打）', sheetKey: 'rp_attack', fallbackSheet: null, fps: 16, cols: 5, rows: 2, key: null, altKeys: [], rebindable: false },
      { id: 'rp_dashLightAttack', label: '衝刺輕攻擊・閃電踢球 (Dash Light)', triggerDesc: '獨立 10 連幀！跑步中 按 輕攻鍵 聚雷成形抽射閃電足球', sheetKey: 'rp_dashLightAttack', fallbackSheet: null, fps: 17, cols: 5, rows: 2, frameCount: 10, key: null, altKeys: [], rebindable: false },
      { id: 'rp_dashAttack', label: '衝刺重攻擊・赤焰衝刺撞擊 (Dash Heavy)', triggerDesc: '獨立 10 幀！跑步中 按 重攻鍵 發動赤焰高速撞擊', sheetKey: 'rp_dashAttack', fallbackSheet: null, fps: 18, cols: 5, rows: 2, key: null, altKeys: [], rebindable: false },
      { id: 'rp_tornadoKick', label: '特殊招式・烈焰龍捲旋風腳 (Tornado Kick)', triggerDesc: '按住 ↑ 再按 重攻擊（W+Num5 / 手把 ↑+重攻）發動！烈焰旋風打浮空可空中追打', sheetKey: 'rp_tornadoKick', fallbackSheet: 'rp_dashAttack', fps: 15, cols: 5, rows: 2, key: null, altKeys: [], rebindable: false },
      { id: 'rp_special', label: '必殺技・赤焰百拳連擊 (Special)', triggerDesc: '霸體狂暴 10 連擊烈焰百烈拳（共用必殺鍵）', sheetKey: 'rp_special', fallbackSheet: null, fps: 14, cols: 5, rows: 2, key: null, altKeys: [], rebindable: false },
      { id: 'rp_hurt', label: '受傷／受擊 (Hurt)', triggerDesc: '可上傳獨立 10 幀受傷精靈表', sheetKey: 'rp_hurt', fallbackSheet: 'rp_idle', fps: 14, cols: 5, rows: 2, key: null, altKeys: [], rebindable: false },
      { id: 'rp_victory', label: '戰鬥勝利動作 (Victory)', triggerDesc: '過關結算專屬 10 幀金星慶祝勝利動畫', sheetKey: 'rp_victory', fallbackSheet: 'rp_idle', fps: 10, cols: 5, rows: 2, key: null, altKeys: [], rebindable: false },
    ];
  }

  let BASE_ENEMY_SNAPSHOT = null;

  function createEnemyCharProfile(id, name, prefix, atkADesc, atkBDesc, hasHurt = false, opts = null) {
    const fallbackPrefix = (opts && opts.fallbackPrefix) || null;
    const actions = [
      { id: `${prefix}_move`, label: '移動動畫 (Move)', triggerDesc: '連續幀移動巡邏循環', sheetKey: `${prefix}_move`, fallbackSheet: fallbackPrefix ? `${fallbackPrefix}_move` : null, fps: 12, cols: 5, rows: 2, key: null, altKeys: [], rebindable: false },
      { id: `${prefix}_attack`, label: atkBDesc ? '雙模式攻擊 (Attack A+B)' : '攻擊動畫 (Attack)', triggerDesc: atkBDesc ? `前半幀：${atkADesc} ｜ 後半幀：${atkBDesc}` : atkADesc, sheetKey: `${prefix}_attack`, fallbackSheet: fallbackPrefix ? `${fallbackPrefix}_attack` : null, fps: 14, cols: 5, rows: 2, key: null, altKeys: [], rebindable: false },
    ];
    if (hasHurt) {
      actions.push({ id: `${prefix}_hurt`, label: '受傷動畫 (Hurt)', triggerDesc: '受擊硬直、踉蹌與回復動作', sheetKey: `${prefix}_hurt`, fallbackSheet: fallbackPrefix ? `${fallbackPrefix}_hurt` : `${prefix}_ko`, fps: 14, cols: 5, rows: 2, key: null, altKeys: [], rebindable: false });
    }
    actions.push({ id: `${prefix}_ko`, label: hasHurt ? '被打敗動畫 (KO)' : '受擊與被打倒 (Hurt / KO)', triggerDesc: '受擊飛退 → 翻滾墜地 → 暈眩倒地', sheetKey: `${prefix}_ko`, fallbackSheet: fallbackPrefix ? `${fallbackPrefix}_ko` : null, fps: 12, cols: 5, rows: 2, key: null, altKeys: [], rebindable: false });
    return {
      id,
      name,
      role: (opts && opts.role) || 'monster',
      enemyKey: (opts && opts.enemyKey) || id.replace(/^enemy_/, ''),
      builtinEnemy: true,
      actions,
    };
  }

  function createDefaultAdailingActions() {
    return [
      { id: 'ad_idle', label: '待機動畫 (Idle)', triggerDesc: '海星國小制服元氣待機呼吸', sheetKey: 'ad_idle', fallbackSheet: null, fps: 8.5, cols: 5, rows: 2, key: null, altKeys: [], rebindable: false },
      { id: 'ad_walk', label: '走路動畫 (Walk)', triggerDesc: '輕快上學步伐走路（WASD / 方向鍵）', sheetKey: 'ad_walk', fallbackSheet: 'ad_idle', fps: 12, cols: 5, rows: 2, key: null, altKeys: [], rebindable: false },
      { id: 'ad_run', label: '奔跑動畫 (Run)', triggerDesc: '操場百米衝刺奔跑', sheetKey: 'ad_run', fallbackSheet: 'ad_idle', fps: 17, cols: 5, rows: 2, key: null, altKeys: [], rebindable: false },
      { id: 'ad_dash', label: '課間衝刺・疾風步 (Dash)', triggerDesc: '翠綠清風瞬間突進閃避', sheetKey: 'ad_dash', fallbackSheet: 'ad_idle', fps: 24, cols: 5, rows: 2, key: null, altKeys: [], rebindable: false },
      { id: 'ad_lightAttack', label: '輕攻擊・海星三連拍 (Light)', triggerDesc: '元氣三連擊（直拍→反拍→跳拍）', sheetKey: 'ad_lightAttack', fallbackSheet: 'ad_idle', fps: 17, cols: 5, rows: 2, key: null, altKeys: [], rebindable: false },
      { id: 'ad_attack', label: '重攻擊・海星字典泰山壓頂 (Heavy)', triggerDesc: '高舉精裝大字典猛砸地面，爆出震地衝擊波重擊周圍敵人', sheetKey: 'ad_attack', fallbackSheet: 'ad_idle', fps: 15, cols: 10, rows: 1, frameCount: 10, key: null, altKeys: [], rebindable: false },
      { id: 'ad_dashLightAttack', label: '衝刺輕攻擊・飛書砸擊 (Dash Light)', triggerDesc: '跑步中按輕攻擲出旋轉精裝課本遠程爆擊', sheetKey: 'ad_dashLightAttack', fallbackSheet: 'ad_idle', fps: 17, cols: 5, rows: 2, frameCount: 10, key: null, altKeys: [], rebindable: false },
      { id: 'ad_dashAttack', label: '衝刺重攻擊・海星倒掛流星踢 (Dash Heavy)', triggerDesc: '跑步中按重攻騰空 360° 空翻倒掛金鉤重擊', sheetKey: 'ad_dashAttack', fallbackSheet: 'ad_idle', fps: 15, cols: 10, rows: 1, frameCount: 10, key: null, altKeys: [], rebindable: false },
      { id: 'ad_tornadoKick', label: '特殊招式・海星旋風踢 (Tornado Kick)', triggerDesc: '↑+重攻發動 11 連幀海星旋風踢將敵人浮空', sheetKey: 'ad_tornadoKick', fallbackSheet: 'ad_idle', fps: 16, cols: 11, rows: 1, frameCount: 11, key: null, altKeys: [], rebindable: false },
      { id: 'ad_special', label: '必殺技・海星全校星光砲 (Special)', triggerDesc: '霸體集氣・全螢幕翠綠星光波動砲十連擊', sheetKey: 'ad_special', fallbackSheet: 'ad_idle', fps: 12, cols: 5, rows: 2, key: null, altKeys: [], rebindable: false },
      { id: 'ad_hurt', label: '受傷／受擊 (Hurt)', triggerDesc: '受擊踉蹌與回復', sheetKey: 'ad_hurt', fallbackSheet: 'ad_idle', fps: 15, cols: 5, rows: 2, key: null, altKeys: [], rebindable: false },
      { id: 'ad_victory', label: '戰鬥勝利動作 (Victory)', triggerDesc: '海星國小過關比YA歡慶勝利', sheetKey: 'ad_victory', fallbackSheet: 'ad_idle', fps: 10, cols: 5, rows: 2, key: null, altKeys: [], rebindable: false },
    ];
  }

  function createDefaultCharacters() {
    return [
      { id: 'kuromi', name: '😈 呆呆伶（主角 1）', role: 'hero', heroId: 'kuromi', actions: createDefaultHeroActions() },
      { id: 'redpanda', name: '🦊 超級帆（主角 2）', role: 'hero', heroId: 'redpanda', actions: createDefaultRedPandaActions() },
      { id: 'adailing', name: '🎒 阿呆伶（主角 3）', role: 'hero', heroId: 'adailing', actions: createDefaultAdailingActions() },
      createEnemyCharProfile('enemy_donghua_boss', '🥋 冬花武聖大宗師（冬花 FINAL BOSS）', 'enemy_donghua_boss', '「武」字黃金正拳＋太極震地氣勁', '三連黃金氣功波＋流星飛躍碎地斬', true, { role: 'boss', enemyKey: 'donghua_boss' }),
      createEnemyCharProfile('enemy_star_boss', '⭐ 宇宙海星大霸王（關卡 BOSS）', 'enemy_star_boss', '巨型迴旋霸體衝撞', '三向扇形宇宙星彈齊射', false, { role: 'boss', enemyKey: 'boss', fallbackPrefix: 'enemy_star' }),
      createEnemyCharProfile('enemy_zebra_rush', '🦓 暴衝斑馬怪（設定稿・5色變色）', 'enemy_zebra_rush', '轉身後腿雙蹄反踢（近身震退）', '蓄力蹬蹄破風頭槌猛衝（5色：墨白/灰/棕/白金/藍）', true, { enemyKey: 'zebra_rush' }),
      createEnemyCharProfile('enemy_joey_kangaroo', '🦘 育兒袋鼠怪（設定稿・小袋鼠回力球・5色）', 'enemy_joey_kangaroo', '衝天翻滾墜地重踩震波 (AOE)', '投擲育兒袋小袋鼠回力球（飛出再折返・5色變色）', true, { enemyKey: 'joey_kangaroo' }),
      createEnemyCharProfile('enemy_kangaroo', '🥊 拳擊袋鼠（彈跳拳擊怪）', 'enemy_kangaroo', '極速三連刺拳連擊', '彈簧飛躍重勾拳衝刺', true, { enemyKey: 'kangaroo' }),
      createEnemyCharProfile('enemy_zebra', '🛹 滑板斑馬（龐克滑板怪）', 'enemy_zebra', '霓虹滑板極速衝刺斬', '巨型粉紅泡泡糖波浪炸彈', true, { enemyKey: 'zebra' }),
      createEnemyCharProfile('enemy_koala', '🎧 電競無尾熊（賽博DJ怪）', 'enemy_koala', '霓虹耳機重低音震盪環 (AOE)', '全息電玩青藍衝擊波', true, { enemyKey: 'koala' }),
      createEnemyCharProfile('enemy_capybara', '🍊 佛系水豚君（霸體坦克怪）', 'enemy_capybara', '佛系肚皮震地壓頂衝擊', '淡定吐草飛葉三連扇', true, { enemyKey: 'capybara' }),
      createEnemyCharProfile('enemy_fat_tiger', '🐯 胖虎（飛撲重壓虎貓怪）', 'enemy_fat_tiger', '飛撲雙爪重壓震地（10連幀流暢撲擊）', null, true, { enemyKey: 'fat_tiger' }),
      createEnemyCharProfile('enemy_cactus', '🌵 針刺仙人掌（條紋針刺怪）', 'enemy_cactus', '旋風縮球萬針爆衝斬', '巨型仙人掌棒＋三向金針齊射', true, { enemyKey: 'cactus' }),
      createEnemyCharProfile('enemy_wizard_ghost', '🧙‍♂️ 星空巫師幽靈（星辰法師怪）', 'enemy_wizard_ghost', '星辰爆裂新星震波 (AOE)', '黑洞傳送門流星雨彈幕', true, { enemyKey: 'wizard_ghost' }),
      createEnemyCharProfile('enemy_pengking', '👑 王者企鵝（海洋敵人）', 'enemy_pengking', '王者滑冰飛撲猛撞（含蓄力金光與急煞）', null, true, { enemyKey: 'penguin_king' }),
      createEnemyCharProfile('enemy_pengice', '❄️ 冰雪企鵝（海洋敵人）', 'enemy_pengice', '寒冰滑衝＋冰錐爆發震波', null, true, { enemyKey: 'penguin_ice' }),
      createEnemyCharProfile('enemy_rabbit', '🐰 兔兔怪（5色共用模組）', 'enemy_rabbit', '極速跳躍撲咬突進（支援雪白/粉櫻/奶茶/芋紫/薄荷 5 色）', null, true, { enemyKey: 'rabbit' }),
      createEnemyCharProfile('enemy_ghost', '👻 幽靈怪（5色共用模組）', 'enemy_ghost', '飄浮鬼火彈發射（支援蒼白/冰藍/紫焰/螢光綠/櫻粉 5 色）', null, true, { enemyKey: 'ghost' }),
      createEnemyCharProfile('enemy_sheep', '🐑 綿羊怪（5色共用模組）', 'enemy_sheep', '暴躁綿羊彎角衝刺猛撞（支援雲白/粉莓/黃金/天藍/薄荷 5 色）', null, true, { enemyKey: 'sheep' }),
      createEnemyCharProfile('enemy_pig', '🐗 暴怒豬豬怪（敵人）', 'enemy_pig', '近身衝刺攻擊：蹬蹄蓄力 → 躍起狂奔 → 極速猛撞 → 急煞', null, false, { enemyKey: 'pig' }),
      {
        id: 'enemy_slime',
        name: '💧 藍色水滴史萊姆（敵人）',
        role: 'monster',
        enemyKey: 'slime',
        builtinEnemy: true,
        actions: [
          { id: 'enemy_slime_idle', label: '夢幻待機 (Idle)', triggerDesc: '打盹水泡待機循環', sheetKey: 'enemy_slime_idle', fallbackSheet: null, fps: 8, cols: 5, rows: 2, key: null, altKeys: [], rebindable: false },
          { id: 'enemy_slime_move', label: '跳躍奔跑 (Move)', triggerDesc: '彈跳水花奔跑循環', sheetKey: 'enemy_slime_move', fallbackSheet: null, fps: 13, cols: 5, rows: 2, key: null, altKeys: [], rebindable: false },
          { id: 'enemy_slime_angry', label: '憤怒反應／蓄力 (Angry)', triggerDesc: '驚嚇「！」→ 冒煙生氣起手預告', sheetKey: 'enemy_slime_angry', fallbackSheet: null, fps: 14, cols: 5, rows: 2, key: null, altKeys: [], rebindable: false },
          { id: 'enemy_slime_attack', label: '果凍衝刺撞擊 (Attack)', triggerDesc: '高速水花衝刺 → 爆擊撞擊 → 煞車', sheetKey: 'enemy_slime_attack', fallbackSheet: null, fps: 16, cols: 5, rows: 2, key: null, altKeys: [], rebindable: false },
          { id: 'enemy_slime_ko', label: '受擊與融化倒地 (Hurt / KO)', triggerDesc: '受擊翻滾 → 墜地濺水 → 暈眩融化（倒地分裂）', sheetKey: 'enemy_slime_ko', fallbackSheet: null, fps: 12, cols: 5, rows: 2, key: null, altKeys: [], rebindable: false },
        ],
      },
      createEnemyCharProfile('enemy_slime_mini', '💧 分裂小史萊姆（衍生小怪）', 'enemy_slime_mini', '迷你果凍跳躍撞擊', null, false, { enemyKey: 'slime_mini', fallbackPrefix: 'enemy_slime' }),
      createEnemyCharProfile('enemy_mushroom', '🍄 蘑菇怪（敵人）', 'enemy_mushroom', '蓄力金光 → 飛躍頭頂 → 重砸爆發孢子彈', null, false, { enemyKey: 'mushroom' }),
      createEnemyCharProfile('enemy_puffer', '🐡 河豚怪（敵人）', 'enemy_puffer', '吸氣膨脹霸體 → 尖刺水花衝刺 → 閃電撞擊', null, false, { enemyKey: 'puffer' }),
      createEnemyCharProfile('enemy_star', '⭐ 宇宙海星（一般敵人）', 'enemy_star', '高速迴旋衝撞', '寶石念力星彈', false, { enemyKey: 'star' }),
    ];
  }

  const StudioState = {
    activeCharId: 'kuromi',
    characters: createDefaultCharacters(),
    combatParams: {}, // charId -> { scale, hp, superArmor, armorHits, flinchOnHit, hitstunMult, knockbackMode, speedMult, dmgMult }
    viewMode: 'list', // 'list' (default tabular pro view) | 'grid'
    categoryFilter: 'all', // 'all' | 'hero' | 'boss' | 'monster' | 'custom'
    searchQuery: '',
    specExpanded: false,
    previewVariants: {}, // charId -> variant index
    rebindingActionId: null,
    previewStates: {}, // actionId -> { playing: true, frame: 0 }

    getHero() {
      return this.characters[0];
    },

    getActiveChar() {
      return this.characters.find((c) => c.id === this.activeCharId) || this.characters[0];
    },

    getAction(actionId) {
      for (const ch of this.characters) {
        const found = ch.actions.find((a) => a.id === actionId);
        if (found) return found;
      }
      return null;
    },

    getFps(actionId, fallback = 14) {
      const a = this.getAction(actionId);
      return a ? a.fps : fallback;
    },

    getDefaultCombatParams(charId) {
      const ch = this.characters.find((c) => c.id === charId);
      if (!ch || ch.role === 'hero') {
        return {
          scale: 1.0,
          hp: 140,
          superArmor: 'none', // 'none' | 'attack' | 'hits' | 'always'
          armorHits: 3,
          flinchOnHit: true,
          hitstunMult: 1.0,
          knockbackMode: 'normal', // 'normal' | 'resist' | 'immune'
          speedMult: 1.0,
          dmgMult: 1.0,
        };
      }
      const snap = (BASE_ENEMY_SNAPSHOT && ch.enemyKey && BASE_ENEMY_SNAPSHOT[ch.enemyKey]) || null;
      return {
        scale: snap ? snap.scale : 1.0,
        hp: snap ? snap.hp : 120,
        superArmor: snap && snap.armor ? 'attack' : 'none',
        armorHits: ch.role === 'boss' ? 4 : 3,
        flinchOnHit: true,
        hitstunMult: 1.0,
        knockbackMode: 'normal',
        speedMult: 1.0,
        dmgMult: 1.0,
      };
    },

    getCombatParams(charId) {
      const def = this.getDefaultCombatParams(charId);
      const ov = this.combatParams[charId];
      if (!ov) return def;
      return {
        scale: typeof ov.scale === 'number' ? Math.max(0.35, Math.min(3.5, ov.scale)) : def.scale,
        hp: typeof ov.hp === 'number' ? Math.max(10, Math.min(9999, Math.round(ov.hp))) : def.hp,
        superArmor: ['none', 'attack', 'hits', 'always'].includes(ov.superArmor) ? ov.superArmor : def.superArmor,
        armorHits: typeof ov.armorHits === 'number' ? Math.max(1, Math.min(30, Math.round(ov.armorHits))) : def.armorHits,
        flinchOnHit: typeof ov.flinchOnHit === 'boolean' ? ov.flinchOnHit : def.flinchOnHit,
        hitstunMult: typeof ov.hitstunMult === 'number' ? Math.max(0.2, Math.min(2.5, ov.hitstunMult)) : def.hitstunMult,
        knockbackMode: ['normal', 'resist', 'immune'].includes(ov.knockbackMode) ? ov.knockbackMode : def.knockbackMode,
        speedMult: typeof ov.speedMult === 'number' ? Math.max(0.3, Math.min(2.5, ov.speedMult)) : def.speedMult,
        dmgMult: typeof ov.dmgMult === 'number' ? Math.max(0.3, Math.min(3.0, ov.dmgMult)) : def.dmgMult,
      };
    },

    isCombatParamsModified(charId) {
      const ov = this.combatParams[charId];
      if (!ov) return false;
      const def = this.getDefaultCombatParams(charId);
      const cur = this.getCombatParams(charId);
      return (
        Math.abs(cur.scale - def.scale) > 0.005 ||
        cur.hp !== def.hp ||
        cur.superArmor !== def.superArmor ||
        (cur.superArmor === 'hits' && cur.armorHits !== def.armorHits) ||
        cur.flinchOnHit !== def.flinchOnHit ||
        Math.abs(cur.hitstunMult - def.hitstunMult) > 0.01 ||
        cur.knockbackMode !== def.knockbackMode ||
        Math.abs(cur.speedMult - def.speedMult) > 0.01 ||
        Math.abs(cur.dmgMult - def.dmgMult) > 0.01
      );
    },

    setCombatParams(charId, patch) {
      const cur = this.getCombatParams(charId);
      this.combatParams[charId] = { ...cur, ...patch };
      this.syncAllCombatParamsToRuntime();
      this.save();
    },

    resetCombatParams(charId) {
      delete this.combatParams[charId];
      this.syncAllCombatParamsToRuntime();
      this.save();
    },

    applyCombatParamsMap(paramsMap) {
      if (!paramsMap || typeof paramsMap !== 'object') return;
      for (const [cid, val] of Object.entries(paramsMap)) {
        if (val && typeof val === 'object') {
          this.combatParams[cid] = { ...this.getDefaultCombatParams(cid), ...val };
        }
      }
      this.syncAllCombatParamsToRuntime();
    },

    syncAllCombatParamsToRuntime() {
      if (!BASE_ENEMY_SNAPSHOT || typeof ENEMY_CONFIGS === 'undefined') return;
      for (const ch of this.characters) {
        if (ch.role === 'hero' && ch.heroId) {
          const hpCfg = this.getCombatParams(ch.id);
          if (typeof game !== 'undefined' && game && game.player && game.player.hero && game.player.hero.id === ch.heroId) {
            const oldMax = game.player.maxHp || 140;
            if (oldMax !== hpCfg.hp) {
              const ratio = oldMax > 0 ? (game.player.hp / oldMax) : 1;
              game.player.maxHp = hpCfg.hp;
              game.player.hp = Math.max(1, Math.round(hpCfg.hp * ratio));
              game.player.displayHp = game.player.hp;
            }
          }
          continue;
        }
        if (!ch.enemyKey || !ENEMY_CONFIGS[ch.enemyKey] || !BASE_ENEMY_SNAPSHOT[ch.enemyKey]) continue;
        const base = BASE_ENEMY_SNAPSHOT[ch.enemyKey];
        const cfg = ENEMY_CONFIGS[ch.enemyKey];
        const p = this.getCombatParams(ch.id);

        cfg.scale = p.scale;
        cfg.hp = p.hp;
        cfg.speedX = Math.max(30, Math.round(base.speedX * p.speedMult));
        cfg.speedZ = Math.max(24, Math.round(base.speedZ * p.speedMult));
        cfg.dmg = Math.max(1, Math.round(base.dmg * p.dmgMult));
        cfg.reach = Math.max(60, Math.round(base.reach * Math.max(0.65, Math.sqrt(p.scale / Math.max(0.4, base.scale)))));
        cfg.armor = p.superArmor !== 'none';
        cfg.superArmor = p.superArmor;
        cfg.armorHits = p.armorHits;
        cfg.flinchOnHit = p.flinchOnHit;
        cfg.hitstunMult = p.hitstunMult;
        cfg.knockbackMode = p.knockbackMode;

        // Immediately sync any alive enemies of this type on the stage!
        if (typeof game !== 'undefined' && game && Array.isArray(game.enemies)) {
          for (const e of game.enemies) {
            if (e.dead || e.type !== ch.enemyKey) continue;
            const waveMult = e.waveHpMult || 1;
            const targetMax = Math.max(1, Math.round(p.hp * waveMult));
            if (e.maxHp !== targetMax) {
              const ratio = e.maxHp > 0 ? (e.hp / e.maxHp) : 1;
              e.maxHp = targetMax;
              e.hp = Math.max(1, Math.round(targetMax * ratio));
            }
            if (p.superArmor === 'hits') {
              e.armorShieldCount = p.armorHits;
            }
          }
        }
      }
    },

    save() {
      try {
        const allOverrides = {};
        for (const ch of this.characters) {
          allOverrides[ch.id] = ch.actions.map((a) => ({
            id: a.id,
            label: a.label,
            fps: a.fps,
            key: a.key,
            cols: a.cols,
            rows: a.rows,
            frameCount: a.frameCount || (a.cols * a.rows),
            custom: !!a.custom,
            sheetKey: a.sheetKey,
            triggerDesc: a.triggerDesc,
          }));
        }
        const savedParams = {};
        for (const ch of this.characters) {
          if (this.isCombatParamsModified(ch.id)) {
            savedParams[ch.id] = this.getCombatParams(ch.id);
          }
        }
        const data = {
          allOverrides,
          combatParams: savedParams,
          viewMode: this.viewMode,
          extraChars: this.characters.filter((c) => c.role !== 'hero' && !c.builtinEnemy).map((c) => ({
            id: c.id,
            name: c.name,
            role: 'custom',
            actions: c.actions.map((a) => ({ ...a })),
          })),
        };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      } catch (_) {}
    },

    applyManifestMap(overridesMap) {
      if (!overridesMap || typeof overridesMap !== 'object') return;
      for (const ch of this.characters) {
        const list = overridesMap[ch.id];
        if (!Array.isArray(list)) continue;
        for (const ov of list) {
          const existing = ch.actions.find((a) => a.id === ov.id);
          if (existing) {
            if (typeof ov.fps === 'number') existing.fps = ov.fps;
            if (existing.rebindable && ov.key) existing.key = ov.key;
            if (ov.cols) existing.cols = ov.cols;
            if (ov.rows) existing.rows = ov.rows;
            if (ov.frameCount) existing.frameCount = ov.frameCount;
          } else if (ov.custom) {
            ch.actions.push({
              id: ov.id,
              label: ov.label,
              triggerDesc: ov.triggerDesc || '自訂動作',
              sheetKey: ov.sheetKey || ov.id,
              fallbackSheet: null,
              fps: ov.fps || 14,
              cols: ov.cols || 5,
              rows: ov.rows || 2,
              frameCount: ov.frameCount || ((ov.cols || 5) * (ov.rows || 2)),
              key: ov.key || null,
              altKeys: [],
              rebindable: ch.id === 'kuromi',
              custom: true,
            });
          }
        }
      }
    },

    load() {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) {
          this.syncAllCombatParamsToRuntime();
          return;
        }
        const data = JSON.parse(raw);
        if (data.viewMode === 'list' || data.viewMode === 'grid') {
          this.viewMode = data.viewMode;
        }
        if (Array.isArray(data.extraChars)) {
          for (const ec of data.extraChars) {
            if (!this.characters.some((c) => c.id === ec.id)) {
              this.characters.push({ ...ec, role: ec.role || 'custom' });
            }
          }
        }
        if (data.allOverrides) {
          this.applyManifestMap(data.allOverrides);
        } else if (Array.isArray(data.heroOverrides)) {
          this.applyManifestMap({ kuromi: data.heroOverrides });
        }
        if (data.combatParams) {
          this.applyCombatParamsMap(data.combatParams);
        } else {
          this.syncAllCombatParamsToRuntime();
        }
      } catch (_) {
        this.syncAllCombatParamsToRuntime();
      }
    },

    resetDefaults() {
      this.characters = createDefaultCharacters();
      this.combatParams = {};
      this.activeCharId = 'kuromi';
      this.rebindingActionId = null;
      this.syncAllCombatParamsToRuntime();
      try { localStorage.removeItem(STORAGE_KEY); } catch (_) {}
      CustomSpriteDB.clearAll().catch(() => {});
    },
  };

  // ==========================================================================
  // PERSISTENT BROWSER INDEXEDDB + DIRECT GITHUB CLOUD OVERWRITE ENGINE
  // ==========================================================================
  const CustomSpriteDB = {
    dbName: 'SchoolFightCustomSpritesDB_v1',
    storeName: 'sheets',
    open() {
      return new Promise((resolve, reject) => {
        if (typeof indexedDB === 'undefined') return reject(new Error('No IndexedDB'));
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
      try {
        const db = await this.open();
        return await new Promise((resolve, reject) => {
          const tx = db.transaction(this.storeName, 'readwrite');
          tx.objectStore(this.storeName).put({ sheetKey, ...record });
          tx.oncomplete = () => { db.close(); resolve(true); };
          tx.onerror = () => { db.close(); reject(tx.error); };
        });
      } catch (_) {
        return false;
      }
    },
    async deleteSheet(sheetKey) {
      try {
        const db = await this.open();
        return await new Promise((resolve) => {
          const tx = db.transaction(this.storeName, 'readwrite');
          tx.objectStore(this.storeName).delete(sheetKey);
          tx.oncomplete = () => { db.close(); resolve(true); };
          tx.onerror = () => { db.close(); resolve(false); };
        });
      } catch (_) {
        return false;
      }
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
      } catch (_) {
        return [];
      }
    },
    async clearAll() {
      try {
        const db = await this.open();
        return await new Promise((resolve) => {
          const tx = db.transaction(this.storeName, 'readwrite');
          tx.objectStore(this.storeName).clear();
          tx.oncomplete = () => { db.close(); resolve(true); };
          tx.onerror = () => { db.close(); resolve(false); };
        });
      } catch (_) {
        return false;
      }
    },
  };

  const CloudSyncManager = {
    cfgKey: 'schoolfight_cloud_sync_cfg_v1',
    repo: 'snell0804/SchoolFight-TV',
    branch: 'main',
    token: '',
    autoUpload: false,
    smartAutoGrid: true,

    loadConfig() {
      try {
        const raw = localStorage.getItem(this.cfgKey);
        if (!raw) return;
        const c = JSON.parse(raw);
        if (c.repo) this.repo = c.repo;
        if (c.branch) this.branch = c.branch;
        if (typeof c.token === 'string') this.token = c.token;
        if (typeof c.autoUpload === 'boolean') this.autoUpload = c.autoUpload;
        if (typeof c.smartAutoGrid === 'boolean') this.smartAutoGrid = c.smartAutoGrid;
      } catch (_) {}
    },

    saveConfig() {
      try {
        localStorage.setItem(this.cfgKey, JSON.stringify({
          repo: this.repo,
          branch: this.branch,
          token: this.token,
          autoUpload: this.autoUpload,
          smartAutoGrid: this.smartAutoGrid,
        }));
      } catch (_) {}
    },

    async ghPutFile(repoPath, base64Content, commitMsg) {
      if (!this.token || !this.token.trim()) {
        throw new Error('請先在上方「☁️ 雲端直連覆寫設定」填入您的 GitHub Token（僅存於您的瀏覽器本機）');
      }
      const cleanRepo = (this.repo || 'snell0804/SchoolFight-TV').trim();
      const branch = (this.branch || 'main').trim();
      const apiUrl = `https://api.github.com/repos/${cleanRepo}/contents/${repoPath}`;
      const headers = {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${this.token.trim()}`,
      };

      let sha = null;
      const getRes = await fetch(`${apiUrl}?ref=${encodeURIComponent(branch)}&_t=${Date.now()}`, { headers });
      if (getRes.ok) {
        const cur = await getRes.json();
        sha = cur.sha || null;
      } else if (getRes.status !== 404) {
        const errTxt = await getRes.text();
        throw new Error(`讀取雲端檔案失敗 (${getRes.status}): ${errTxt.slice(0, 120)}`);
      }

      const body = {
        message: commitMsg,
        content: base64Content,
        branch,
      };
      if (sha) body.sha = sha;

      const putRes = await fetch(apiUrl, {
        method: 'PUT',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!putRes.ok) {
        const errTxt = await putRes.text();
        throw new Error(`雲端覆寫失敗 (${putRes.status}): ${errTxt.slice(0, 140)}`);
      }
      return await putRes.json();
    },

    buildCloudManifestObject(updatedSheetsMap = {}) {
      const sheetsMeta = { ...updatedSheetsMap };
      const allOverrides = {};
      const combatParams = {};
      for (const ch of StudioState.characters) {
        if (StudioState.isCombatParamsModified(ch.id)) {
          combatParams[ch.id] = StudioState.getCombatParams(ch.id);
        }
        allOverrides[ch.id] = ch.actions.map((a) => {
          const sh = SpriteBank.sheets[a.sheetKey];
          if (sh && sh.custom) {
            sheetsMeta[a.sheetKey] = {
              file: `assets/${a.sheetKey}_sheet.webp`,
              cols: sh.cols,
              rows: sh.rows,
              frameCount: sh.frameCount,
              anchorX: sh.anchorX,
              anchorY: sh.anchorY,
              updatedAt: sheetsMeta[a.sheetKey]?.updatedAt || Date.now(),
            };
          }
          return {
            id: a.id,
            label: a.label,
            fps: a.fps,
            key: a.key,
            cols: sh ? sh.cols : a.cols,
            rows: sh ? sh.rows : a.rows,
            frameCount: sh ? sh.frameCount : (a.frameCount || a.cols * a.rows),
            custom: !!a.custom,
            sheetKey: a.sheetKey,
            triggerDesc: a.triggerDesc,
          };
        });
      }
      return {
        format: 'schoolfight_cloud_manifest_v1',
        updatedAt: Date.now(),
        sheets: sheetsMeta,
        allOverrides,
        combatParams,
      };
    },

    async syncManifestOnly(commitNote = 'combat params & action config') {
      let existingManifestSheets = {};
      try {
        const r = await fetch(`assets/cloud_manifest.json?_t=${Date.now()}`);
        if (r.ok) {
          const mj = await r.json();
          if (mj && mj.sheets) existingManifestSheets = mj.sheets;
        }
      } catch (_) {}
      const manifestObj = this.buildCloudManifestObject(existingManifestSheets);
      const manifestB64 = btoa(unescape(encodeURIComponent(JSON.stringify(manifestObj, null, 2))));
      await this.ghPutFile('assets/cloud_manifest.json', manifestB64, `chore(manifest): sync ${commitNote} via Studio`);
    },

    async uploadSheetToCloud(sheetKey, actLabel = '') {
      const sheet = SpriteBank.sheets[sheetKey];
      if (!sheet || !sheet.img) throw new Error('找不到此動作精靈表');

      const c = document.createElement('canvas');
      c.width = sheet.img.width;
      c.height = sheet.img.height;
      c.getContext('2d').drawImage(sheet.img, 0, 0);

      // Export crisp lossless/high-quality WebP matching GitHub Pages asset path!
      let dataUrl = c.toDataURL('image/webp', 0.92);
      let ext = 'webp';
      if (!dataUrl.startsWith('data:image/webp')) {
        dataUrl = c.toDataURL('image/png');
        ext = 'png';
      }
      const b64 = dataUrl.split(',')[1];
      const targetPath = `assets/${sheetKey}_sheet.${ext}`;
      await this.ghPutFile(targetPath, b64, `chore(sprite): update ${sheetKey} (${sheet.cols}x${sheet.rows}, ${sheet.frameCount}f) ${actLabel} via Gear Studio`);

      // Also merge & push assets/cloud_manifest.json so 20~30 frame grid, FPS & monster params sync across all devices/TV!
      let existingManifestSheets = {};
      try {
        const r = await fetch(`assets/cloud_manifest.json?_t=${Date.now()}`);
        if (r.ok) {
          const mj = await r.json();
          if (mj && mj.sheets) existingManifestSheets = mj.sheets;
        }
      } catch (_) {}
      existingManifestSheets[sheetKey] = {
        file: targetPath,
        cols: sheet.cols,
        rows: sheet.rows,
        frameCount: sheet.frameCount,
        anchorX: sheet.anchorX,
        anchorY: sheet.anchorY,
        updatedAt: Date.now(),
      };
      const manifestObj = this.buildCloudManifestObject(existingManifestSheets);
      const manifestB64 = btoa(unescape(encodeURIComponent(JSON.stringify(manifestObj, null, 2))));
      await this.ghPutFile('assets/cloud_manifest.json', manifestB64, `chore(manifest): sync ${sheetKey} (${sheet.frameCount}f) config`);
      return targetPath;
    },
  };
  CloudSyncManager.loadConfig();

  function formatKeyCode(code) {
    if (!code) return '未設定';
    if (code.startsWith('Numpad')) return 'Num' + code.slice(6);
    if (code.startsWith('Key')) return code.slice(3);
    if (code.startsWith('Digit')) return code.slice(5);
    if (code === 'ShiftLeft' || code === 'ShiftRight') return 'Shift';
    if (code === 'Space') return 'Space';
    if (code === 'ArrowUp') return '↑';
    if (code === 'ArrowDown') return '↓';
    if (code === 'ArrowLeft') return '←';
    if (code === 'ArrowRight') return '→';
    return code;
  }

  const SpriteBank = {
    sheets: {},
    bgImages: {},
    ready: false,
    portraitCanvas: null,
    portraits: {},

    getFrameCount(sheetKey, fallback = 10) {
      const sh = this.sheets[sheetKey];
      return (sh && sh.frameCount >= 1) ? sh.frameCount : fallback;
    },

    async reloadBuiltinSheet(sheetKey) {
      await CustomSpriteDB.deleteSheet(sheetKey);
      const def = DEFAULT_SHEETS_DEF.find((d) => d.key === sheetKey);
      if (!def) {
        delete this.sheets[sheetKey];
        this.tintedCache = {};
        return null;
      }
      const embedded = window.EMBEDDED_SPRITES || {};
      const src = embedded[def.key] || def.file;
      if (!src) {
        delete this.sheets[sheetKey];
        this.tintedCache = {};
        return null;
      }
      try {
        const img = await this.loadImage(src);
        this.sheets[def.key] = {
          img,
          cols: def.cols,
          rows: def.rows,
          cellW: img.width / def.cols,
          cellH: img.height / def.rows,
          anchorX: def.anchorX,
          anchorY: def.anchorY,
          frameCount: def.cols * def.rows,
          custom: false,
        };
        this.tintedCache = {};
        if (sheetKey === 'idle' || sheetKey === 'rp_idle') this.buildPortrait();
        return this.sheets[def.key];
      } catch (_) {
        delete this.sheets[sheetKey];
        return null;
      }
    },

    async loadAll() {
      // 1. Optional Cloud Manifest from GitHub Pages (applies cloud-overwritten 20~30f sheets, FPS & monster params!)
      let cloudManifest = null;
      if (!window.EMBEDDED_SPRITES && (location.protocol === 'http:' || location.protocol === 'https:')) {
        try {
          const res = await fetch(`assets/cloud_manifest.json?_t=${Date.now()}`, { cache: 'no-store' });
          if (res.ok) {
            cloudManifest = await res.json();
            if (cloudManifest && cloudManifest.allOverrides) {
              StudioState.applyManifestMap(cloudManifest.allOverrides);
            }
            if (cloudManifest && cloudManifest.combatParams) {
              StudioState.applyCombatParamsMap(cloudManifest.combatParams);
            }
          }
        } catch (_) {}
      }

      // 2. Local browser overrides (FPS, keybinds, custom actions & combat params)
      StudioState.load();

      const embedded = window.EMBEDDED_SPRITES || {};
      const cloudSheets = (cloudManifest && cloudManifest.sheets) || {};

      const promises = DEFAULT_SHEETS_DEF.map(async (def) => {
        const cm = cloudSheets[def.key];
        const src = cm
          ? `${cm.file}?v=${cm.updatedAt || 1}`
          : (embedded[def.key] || def.file);
        if (!src) return;
        let img;
        try {
          img = await this.loadImage(src);
        } catch (_) {
          return;
        }
        const cols = (cm && cm.cols) || def.cols;
        const rows = (cm && cm.rows) || def.rows;
        const fc = (cm && cm.frameCount) || (cols * rows);
        this.sheets[def.key] = {
          img,
          cols,
          rows,
          cellW: img.width / cols,
          cellH: img.height / rows,
          anchorX: (cm && typeof cm.anchorX === 'number') ? cm.anchorX : def.anchorX,
          anchorY: (cm && typeof cm.anchorY === 'number') ? cm.anchorY : def.anchorY,
          frameCount: fc,
          custom: !!cm,
        };
      });

      // Also load any custom cloud-added sheets not in DEFAULT_SHEETS_DEF
      for (const [sKey, cm] of Object.entries(cloudSheets)) {
        if (!DEFAULT_SHEETS_DEF.some((d) => d.key === sKey) && cm && cm.file) {
          promises.push((async () => {
            try {
              const img = await this.loadImage(`${cm.file}?v=${cm.updatedAt || 1}`);
              const cols = cm.cols || 5;
              const rows = cm.rows || 2;
              this.sheets[sKey] = {
                img,
                cols,
                rows,
                cellW: img.width / cols,
                cellH: img.height / rows,
                anchorX: typeof cm.anchorX === 'number' ? cm.anchorX : 136,
                anchorY: typeof cm.anchorY === 'number' ? cm.anchorY : 242,
                frameCount: cm.frameCount || (cols * rows),
                custom: true,
              };
            } catch (_) {}
          })());
        }
      }

      // Load Sanrio-illustrated street panoramas + 10-frame Kids Rice Cooker supply boxes & pickups
      const bgDef = [
        { key: 'starfish', embedKey: 'bg_starfish_street', file: 'assets/bg_starfish_street.webp' },
        { key: 'aqiang', embedKey: 'bg_aqiang_street', file: 'assets/bg_aqiang_street.webp' },
        { key: 'cooker_hp', embedKey: 'prop_cooker_sheet', file: 'assets/prop_cooker_sheet.webp' },
        { key: 'cooker_mp', embedKey: 'prop_cooker_mp_sheet', file: 'assets/prop_cooker_mp_sheet.webp' },
        { key: 'foods', embedKey: 'item_foods_sheet', file: 'assets/item_foods_sheet.webp' },
        { key: 'mana', embedKey: 'item_mana_bottle', file: 'assets/item_mana_bottle.webp' },
        { key: 'stage_map', embedKey: 'stage_map_bg', file: 'assets/stage_map_bg.webp' },
      ];
      for (const b of bgDef) {
        promises.push((async () => {
          try {
            const src = embedded[b.embedKey] || b.file;
            this.bgImages[b.key] = await this.loadImage(src);
          } catch (_) {
            this.bgImages[b.key] = null;
          }
        })());
      }
      await Promise.all(promises);

      // 3. Restore any locally uploaded PNG sheets from IndexedDB (persists across page reloads!)
      const savedCustom = await CustomSpriteDB.getAllSheets();
      for (const rec of savedCustom) {
        if (!rec || !rec.dataUrl || !rec.sheetKey) continue;
        try {
          const img = await this.loadImage(rec.dataUrl);
          const cols = rec.cols || 5;
          const rows = rec.rows || 2;
          this.sheets[rec.sheetKey] = {
            img,
            cols,
            rows,
            cellW: img.width / cols,
            cellH: img.height / rows,
            anchorX: typeof rec.anchorX === 'number' ? rec.anchorX : 136,
            anchorY: typeof rec.anchorY === 'number' ? rec.anchorY : 242,
            frameCount: rec.frameCount || (cols * rows),
            custom: true,
          };
          const studioAct = StudioState.getAction(rec.sheetKey);
          if (studioAct) {
            if (typeof rec.fps === 'number' && rec.fps > 0) studioAct.fps = rec.fps;
            studioAct.cols = cols;
            studioAct.rows = rows;
            studioAct.frameCount = rec.frameCount || (cols * rows);
          }
          if (rec.fx) {
            this.actionFx = this.actionFx || {};
            this.actionFx[rec.sheetKey] = rec.fx;
            if (rec.actionId) this.actionFx[rec.actionId] = rec.fx;
          }
          this.tintedCache = {};
        } catch (_) {}
      }

      // 4. Load custom character actions, backgrounds & items from cloud_manifest.json (IndexedDB cached)
      if (window.CloudManifestLoader) {
        await window.CloudManifestLoader.applyToGame(this);
      }

      this.buildPortrait();
      this.ready = true;
      renderControlsLegend();
      renderGearStudio();
    },

    loadImage(src) {
      return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = src;
      });
    },

    buildPortrait() {
      const makeHead = (sheet, sx, sy, sw, sh) => {
        if (!sheet) return null;
        const pc = document.createElement('canvas');
        pc.width = 64;
        pc.height = 64;
        const pctx = pc.getContext('2d');
        pctx.drawImage(sheet.img, sx, sy, sw, sh, 0, 0, 64, 64);
        return pc;
      };
      this.portraits.kuromi = makeHead(this.sheets.idle || this.sheets.special || this.sheets.run, 56, 36, 162, 162);
      this.portraits.redpanda = makeHead(this.sheets.rp_idle || this.sheets.rp_run, 72, 66, 152, 152);
      this.portraits.adailing = makeHead(this.sheets.ad_idle, 72, 48, 156, 156);
      this.portraitCanvas = this.portraits.kuromi;
    },

    /**
     * SMART SPRITE SHEET PROCESSOR v2 (10 ~ 60+ Frames, Zero Clipping, Auto Scale & Auto Bg Removal!):
     * 1. Ignores screenshot rounded corners & finds true dominant background color (dark, white, card, green, or alpha).
     * 2. Optional 2D projection-valley Auto-Grid Detector (detects 5x2=10, 5x4=20, 5x6=30, 6x5=30, etc.!).
     * 3. Smart Y-row + X-column valley splits (±28% search window) so wide explosions/weapons NEVER get sliced!
     * 4. Flood-fill + interior pocket background removal + 1px anti-aliased edge feathering.
     * 5. UNIFORM AUTO-SCALING into 300x264 cells (clamped with safety margin) so high-res uploads NEVER overflow or slice!
     */
    processUploadedSheet(img, cols = 10, rows = 1, frameCount = null, opts = null) {
      const rawW = img.width;
      const rawH = img.height;
      const maxDim = 8400; // Supports wide 10~20 col x 1 row HD strips without downscaling!
      const preScale = Math.max(rawW, rawH) > maxDim ? (maxDim / Math.max(rawW, rawH)) : 1;
      const sw = Math.max(16, Math.round(rawW * preScale));
      const sh = Math.max(16, Math.round(rawH * preScale));
      const isEnemy = !!(opts && opts.isEnemy);
      const isBoss = !!(opts && opts.isBoss);
      const autoDetect = !!(opts && opts.autoDetect);

      // Generous wide-action cell canvas (420x340) so big slashes/jumps/kicks never clip at cell edges!
      const outCellW = 420;
      const outCellH = 340;
      const targetCx = 210;
      const targetFootY = 304;
      const targetBodyH = isBoss ? 186 : (isEnemy ? 156 : 186);

      const srcCanvas = document.createElement('canvas');
      srcCanvas.width = sw;
      srcCanvas.height = sh;
      const sctx = srcCanvas.getContext('2d');
      sctx.imageSmoothingEnabled = true;
      sctx.imageSmoothingQuality = 'high';
      sctx.drawImage(img, 0, 0, sw, sh);
      const fullImg = sctx.getImageData(0, 0, sw, sh);
      const fullData = fullImg.data;

      // Step 1: Sample inset border pixels (skipping outer 6% rounded screenshot corners!)
      const insetX = Math.max(4, Math.floor(sw * 0.06));
      const insetY = Math.max(4, Math.floor(sh * 0.06));
      let transVotes = 0, totalVotes = 0;
      const buckets = new Map();
      const samplePixel = (x, y) => {
        const idx = (y * sw + x) * 4;
        totalVotes++;
        if (fullData[idx + 3] < 24) {
          transVotes++;
          return;
        }
        const qr = fullData[idx] >> 3;
        const qg = fullData[idx + 1] >> 3;
        const qb = fullData[idx + 2] >> 3;
        const key = (qr << 10) | (qg << 5) | qb;
        let b = buckets.get(key);
        if (!b) { b = { count: 0, sr: 0, sg: 0, sb: 0 }; buckets.set(key, b); }
        b.count++;
        b.sr += fullData[idx];
        b.sg += fullData[idx + 1];
        b.sb += fullData[idx + 2];
      };
      for (let x = insetX; x < sw - insetX; x += 2) {
        samplePixel(x, 1);
        samplePixel(x, Math.min(sh - 1, 3));
        samplePixel(x, sh - 2);
      }
      for (let y = insetY; y < sh - insetY; y += 2) {
        samplePixel(1, y);
        samplePixel(sw - 2, y);
      }

      const alreadyTransparent = transVotes > totalVotes * 0.42;
      let bgR = 16, bgG = 20, bgB = 32;
      if (!alreadyTransparent && buckets.size > 0) {
        let best = null;
        for (const b of buckets.values()) {
          if (!best || b.count > best.count) best = b;
        }
        bgR = best.sr / best.count;
        bgG = best.sg / best.count;
        bgB = best.sb / best.count;
      }
      const bgLum = 0.299 * bgR + 0.587 * bgG + 0.114 * bgB;

      // Strip rounded white/light screenshot corners automatically when background is dark!
      if (!alreadyTransparent && bgLum < 90) {
        const cornerR = Math.max(18, Math.floor(Math.min(sw, sh) * 0.08));
        const corners = [[0, 0], [sw - 1, 0], [0, sh - 1], [sw - 1, sh - 1]];
        for (const [cx0, cy0] of corners) {
          const xStart = cx0 === 0 ? 0 : sw - cornerR;
          const xEnd = cx0 === 0 ? cornerR : sw;
          const yStart = cy0 === 0 ? 0 : sh - cornerR;
          const yEnd = cy0 === 0 ? cornerR : sh;
          for (let y = yStart; y < yEnd; y++) {
            for (let x = xStart; x < xEnd; x++) {
              const idx = (y * sw + x) * 4;
              if (fullData[idx] > 200 && fullData[idx + 1] > 200 && fullData[idx + 2] > 200) {
                fullData[idx] = Math.round(bgR);
                fullData[idx + 1] = Math.round(bgG);
                fullData[idx + 2] = Math.round(bgB);
              }
            }
          }
        }
        sctx.putImageData(fullImg, 0, 0);
      }

      const isFgAt = (idx) => {
        if (fullData[idx + 3] < 24) return false;
        if (alreadyTransparent) return true;
        const dr = fullData[idx] - bgR;
        const dg = fullData[idx + 1] - bgG;
        const db = fullData[idx + 2] - bgB;
        return (dr * dr + dg * dg + db * db) > (22 * 22);
      };

      // Step 2: Optional Smart 2D Periodic Peak-Valley Auto-Grid Detection (supports 10, 12, 15, 16, 20, 24, 25, 30, 60+ frames!)
      let effCols = Math.max(1, parseInt(cols, 10) || 5);
      let effRows = Math.max(1, parseInt(rows, 10) || 2);

      if (autoDetect) {
        const fgMask = new Uint8Array(sw * sh);
        const rowProfile = new Int32Array(sh);
        for (let y = 0; y < sh; y++) {
          let rc = 0;
          const rowOff = y * sw;
          for (let x = 0; x < sw; x++) {
            if (isFgAt((rowOff + x) * 4)) {
              fgMask[rowOff + x] = 1;
              rc++;
            }
          }
          rowProfile[y] = rc;
        }

        const bandAvg = (arr, len, center, halfW) => {
          const lo = Math.max(0, Math.floor(center - halfW));
          const hi = Math.min(len - 1, Math.floor(center + halfW));
          if (hi < lo) return 0;
          let s = 0;
          for (let i = lo; i <= hi; i++) s += arr[i];
          return s / (hi - lo + 1);
        };

        const minValley = (arr, len, nom, win) => {
          const lo = Math.max(0, Math.floor(nom - win));
          const hi = Math.min(len - 1, Math.floor(nom + win));
          let best = 1e12;
          for (let i = lo; i <= hi; i++) {
            const a = Math.max(0, i - 1);
            const b = Math.min(len - 1, i + 1);
            let s = 0;
            for (let k = a; k <= b; k++) s += arr[k];
            const v = s / (b - a + 1);
            if (v < best) best = v;
          }
          return best;
        };

        // 2a. Score candidate row counts R in 1..14
        let bestR = effRows, bestRScore = -1e9;
        for (let R = 1; R <= 14; R++) {
          const cellH = sh / R;
          if (cellH < 40) break;
          let minCenter = 1e12, sumCenter = 0;
          for (let r = 0; r < R; r++) {
            const cv = bandAvg(rowProfile, sh, (r + 0.5) * cellH, Math.max(1, cellH * 0.08));
            if (cv < minCenter) minCenter = cv;
            sumCenter += cv;
          }
          if (minCenter < sw * 0.018) continue;
          const meanC = sumCenter / R;
          let score;
          if (R === 1) {
            score = 0.25 + (R === effRows ? 0.02 : 0);
          } else {
            let maxV = 0, sumV = 0;
            for (let r = 1; r < R; r++) {
              const v = minValley(rowProfile, sh, r * cellH, cellH * 0.12);
              if (v > maxV) maxV = v;
              sumV += v;
            }
            const meanV = sumV / (R - 1);
            if (maxV > meanC * 0.42) continue;
            const contrast = (meanC - meanV) / Math.max(1, meanC);
            score = contrast - (maxV / Math.max(1, meanC)) * 0.40 + Math.min(0.42, R * 0.04) + (R === effRows ? 0.02 : 0);
          }
          if (score > bestRScore) {
            bestRScore = score;
            bestR = R;
          }
        }
        effRows = bestR;

        // 2b. Score candidate column counts C in 1..18 using per-row horizontal profiles (never confused by cross-row effects!)
        const rowH = sh / effRows;
        const perRowCols = [];
        for (let r = 0; r < effRows; r++) {
          const y0 = Math.floor(r * rowH);
          const y1 = Math.floor((r + 1) * rowH);
          const cp = new Int32Array(sw);
          for (let y = y0; y < y1; y++) {
            const rowOff = y * sw;
            for (let x = 0; x < sw; x++) cp[x] += fgMask[rowOff + x];
          }
          perRowCols.push(cp);
        }

        let bestC = effCols, bestCScore = -1e9;
        for (let C = 1; C <= 18; C++) {
          const cellW = sw / C;
          if (cellW < 40) break;
          const aspect = cellW / rowH;
          if (C > 1 && (aspect < 0.36 || aspect > 2.65)) continue;
          if (C === 1) {
            const sc1 = 0.24 + (aspect >= 0.6 && aspect <= 1.6 ? 0.05 : 0);
            if (sc1 > bestCScore) { bestCScore = sc1; bestC = 1; }
            continue;
          }
          let sumMc = 0, sumMv = 0, validRows = 0;
          const allValleys = [];
          let valid = true;
          for (let r = 0; r < effRows; r++) {
            const cp = perRowCols[r];
            let rowTotal = 0;
            for (let x = 0; x < sw; x++) rowTotal += cp[x];
            if (rowTotal < rowH * sw * 0.01) continue;
            let nonEmptyCount = 0, sumRowC = 0;
            for (let c = 0; c < C; c++) {
              const cv = bandAvg(cp, sw, (c + 0.5) * cellW, Math.max(1, cellW * 0.08));
              if (cv >= rowH * 0.03) {
                nonEmptyCount++;
                sumRowC += cv;
              }
            }
            if (r < effRows - 1 && nonEmptyCount < C) { valid = false; break; }
            if (nonEmptyCount === 0) continue;
            const mc = sumRowC / nonEmptyCount;
            let sumV = 0;
            for (let c = 1; c < C; c++) {
              // Wider ±22% valley search (matches Step 4's ±28% split) so uneven margins or wide slashes still find the true gap
              const v = minValley(cp, sw, c * cellW, cellW * 0.22);
              sumV += v;
              allValleys.push(v);
            }
            sumMc += mc;
            sumMv += sumV / (C - 1);
            validRows++;
          }
          if (!valid || validRows === 0) continue;
          const mcAll = sumMc / validRows;
          const mvAll = sumMv / validRows;
          allValleys.sort((a, b) => a - b);
          const p85V = allValleys[Math.min(allValleys.length - 1, Math.floor(allValleys.length * 0.85))] || 0;
          if (mvAll > mcAll * 0.45 || p85V > mcAll * 0.65) continue;
          const contrast = (mcAll - mvAll) / Math.max(1, mcAll);
          const aspectBonus = -Math.abs(aspect - 1.10) * 0.06;
          const score = contrast - (p85V / Math.max(1, mcAll)) * 0.30 + Math.min(0.45, C * 0.038) + aspectBonus + (C === effCols ? 0.02 : 0);
          if (score > bestCScore) {
            bestCScore = score;
            bestC = C;
          }
        }
        effCols = bestC;
      }

      // Step 3: Smart Y-Row Valley Splits (±26% search around nominal row borders!)
      const rowCounts = new Int32Array(sh);
      for (let y = 0; y < sh; y++) {
        let cnt = 0;
        for (let x = 0; x < sw; x++) {
          if (isFgAt((y * sw + x) * 4)) cnt++;
        }
        rowCounts[y] = cnt;
      }
      const ySplits = [0];
      const nomRowH = sh / effRows;
      for (let r = 1; r < effRows; r++) {
        const nomY = Math.round(r * nomRowH);
        const winY = Math.max(12, Math.floor(nomRowH * 0.26));
        const loY = Math.max(ySplits[ySplits.length - 1] + Math.floor(nomRowH * 0.45), nomY - winY);
        const hiY = Math.min(sh - Math.floor(nomRowH * 0.45), nomY + winY);
        let bestY = nomY, bestScore = 1e12;
        for (let sy = loY; sy <= hiY; sy++) {
          const wsum = (rowCounts[Math.max(0, sy - 1)] + rowCounts[sy] * 2 + rowCounts[Math.min(sh - 1, sy + 1)]);
          const sc = wsum * 100 + Math.abs(sy - nomY) * 0.15;
          if (sc < bestScore) { bestScore = sc; bestY = sy; }
        }
        ySplits.push(bestY);
      }
      ySplits.push(sh);

      // Step 4: Extract & Clean Every Cell (Smart X-Valley Splits + Flood Bg Removal)
      const cleanedCells = [];
      const nomColW = sw / effCols;

      for (let r = 0; r < effRows; r++) {
        const y0 = ySplits[r];
        const y1 = ySplits[r + 1];
        const colCounts = new Int32Array(sw);
        for (let x = 0; x < sw; x++) {
          let cnt = 0;
          for (let y = y0; y < y1; y++) {
            if (isFgAt((y * sw + x) * 4)) cnt++;
          }
          colCounts[x] = cnt;
        }

        const xSplits = [0];
        const winX = Math.max(16, Math.floor(nomColW * 0.28));
        for (let k = 1; k < effCols; k++) {
          const nomX = Math.round(k * nomColW);
          const loX = Math.max(xSplits[xSplits.length - 1] + Math.floor(nomColW * 0.42), nomX - winX);
          const hiX = Math.min(sw - Math.floor(nomColW * 0.42), nomX + winX);
          let bestX = nomX, bestVal = 1e12;
          for (let sx = loX; sx <= hiX; sx++) {
            const wsum = colCounts[Math.max(0, sx - 1)] + colCounts[sx] * 2 + colCounts[Math.min(sw - 1, sx + 1)];
            const score = wsum * 100 + Math.abs(sx - nomX) * 0.14;
            if (score < bestVal) { bestVal = score; bestX = sx; }
          }
          xSplits.push(bestX);
        }
        xSplits.push(sw);

        for (let c = 0; c < effCols; c++) {
          const x0 = xSplits[c];
          const cw = Math.max(1, xSplits[c + 1] - x0);
          const ch = Math.max(1, y1 - y0);

          const tmp = document.createElement('canvas');
          tmp.width = cw;
          tmp.height = ch;
          const tctx = tmp.getContext('2d');
          tctx.drawImage(srcCanvas, x0, y0, cw, ch, 0, 0, cw, ch);
          const id = tctx.getImageData(0, 0, cw, ch);
          const d = id.data;

          if (!alreadyTransparent) {
            const visited = new Uint8Array(cw * ch);
            const isBg = new Uint8Array(cw * ch);
            const queue = new Int32Array(cw * ch);
            let head = 0, tail = 0;
            const dist = (i) => Math.hypot(d[i] - bgR, d[i + 1] - bgG, d[i + 2] - bgB);
            const thresh = bgLum > 200 ? 24 : 22.5;
            const enqueue = (x, y) => {
              const p = y * cw + x;
              if (visited[p]) return;
              const idx = p * 4;
              // Protect pure-black cartoon ink outlines when removing dark backgrounds
              if (bgLum < 80 && d[idx] < 14 && d[idx + 1] < 14 && d[idx + 2] < 19 && (d[idx + 2] - d[idx]) < 6) return;
              // Protect pure-white body highlights when removing light sky-blue card backgrounds
              if (bgLum > 200 && (bgB - bgR) >= 8 && d[idx] > 246 && (d[idx + 2] - d[idx]) <= 3) return;
              if (dist(idx) < thresh) {
                visited[p] = 1;
                isBg[p] = 1;
                queue[tail++] = p;
              }
            };
            for (let x = 0; x < cw; x++) { enqueue(x, 0); enqueue(x, ch - 1); }
            for (let y = 0; y < ch; y++) { enqueue(0, y); enqueue(cw - 1, y); }
            while (head < tail) {
              const p = queue[head++];
              const x = p % cw;
              const y = (p - x) / cw;
              if (x > 0) enqueue(x - 1, y);
              if (x < cw - 1) enqueue(x + 1, y);
              if (y > 0) enqueue(x, y - 1);
              if (y < ch - 1) enqueue(x, y + 1);
            }
            for (let p = 0; p < cw * ch; p++) {
              const idx = p * 4;
              if (isBg[p]) {
                d[idx + 3] = 0;
              } else if (bgLum < 80 && dist(idx) < 12.5 && (d[idx + 2] - d[idx]) >= 5) {
                // Enclosed dark-navy pocket inside weapon/slash loops
                isBg[p] = 1;
                d[idx + 3] = 0;
              }
            }
            // 1px soft edge feathering against background halo
            for (let y = 1; y < ch - 1; y++) {
              for (let x = 1; x < cw - 1; x++) {
                const p = y * cw + x;
                if (isBg[p]) continue;
                if (isBg[p - 1] || isBg[p + 1] || isBg[p - cw] || isBg[p + cw]) {
                  const idx = p * 4;
                  const dd = dist(idx);
                  if (dd < 30) {
                    d[idx + 3] = Math.max(0, Math.min(255, Math.round(((dd - 14) / 16) * 255)));
                  }
                }
              }
            }
            tctx.putImageData(id, 0, 0);
          }

          let minX = cw, maxX = -1, minY = ch, maxY = -1, solidPixels = 0;
          let coreMinX = cw, coreMaxX = -1;
          for (let y = 0; y < ch; y++) {
            for (let x = 0; x < cw; x++) {
              const idx = (y * cw + x) * 4;
              if (d[idx + 3] > 60) {
                solidPixels++;
                if (x < minX) minX = x;
                if (x > maxX) maxX = x;
                if (y < minY) minY = y;
                if (y > maxY) maxY = y;
                if (d[idx + 3] > 180 && y > ch * 0.22) {
                  if (x < coreMinX) coreMinX = x;
                  if (x > coreMaxX) coreMaxX = x;
                }
              }
            }
          }

          if (maxX >= minX && solidPixels >= 24) {
            cleanedCells.push({
              canvas: tmp,
              empty: false,
              minX, minY,
              w: maxX - minX + 1,
              h: maxY - minY + 1,
              coreCx: coreMaxX >= coreMinX ? ((coreMinX + coreMaxX) / 2 - minX) : ((maxX - minX + 1) / 2),
            });
          } else {
            cleanedCells.push({ canvas: tmp, empty: true, minX: 0, minY: 0, w: 1, h: 1, coreCx: 0.5 });
          }
        }
      }

      // Step 5: Compute Uniform Character Scale (from Frame 0 / median height) + Zero-Clipping Fit into 300x264!
      const nonEmpty = cleanedCells.filter((c) => !c.empty);
      let refH = nonEmpty.length > 0 ? nonEmpty[0].h : targetBodyH;
      if (nonEmpty.length >= 3) {
        const sortedH = nonEmpty.slice(0, Math.min(5, nonEmpty.length)).map((c) => c.h).sort((a, b) => a - b);
        refH = sortedH[0] > sortedH[Math.floor(sortedH.length / 2)] * 0.65 ? nonEmpty[0].h : sortedH[Math.floor(sortedH.length / 2)];
      }
      const baseScale = targetBodyH / Math.max(1, refH);

      const outCanvas = document.createElement('canvas');
      outCanvas.width = outCellW * effCols;
      outCanvas.height = outCellH * effRows;
      const octx = outCanvas.getContext('2d');
      octx.imageSmoothingEnabled = true;
      octx.imageSmoothingQuality = 'high';

      let lastNonEmptyIdx = -1;
      for (let idx = 0; idx < cleanedCells.length; idx++) {
        const cell = cleanedCells[idx];
        if (cell.empty) continue;
        lastNonEmptyIdx = idx;

        const c = idx % effCols;
        const r = Math.floor(idx / effCols);

        // Uniform scale, clamped strictly so wide explosions/slashes NEVER exceed 300x264 cell bounds!
        const maxAllowedW = outCellW - 12;
        const maxAllowedH = targetFootY - 6;
        const curScale = Math.min(baseScale, maxAllowedW / cell.w, maxAllowedH / cell.h);

        const dw = Math.max(1, Math.round(cell.w * curScale));
        const dh = Math.max(1, Math.round(cell.h * curScale));
        const scaledCoreCx = cell.coreCx * curScale;

        let dx = Math.round(targetCx - scaledCoreCx);
        let dy = Math.round(targetFootY - dh);
        dx = Math.max(4, Math.min(outCellW - dw - 4, dx));
        dy = Math.max(4, Math.min(outCellH - dh - 4, dy));

        octx.drawImage(
          cell.canvas,
          cell.minX, cell.minY, cell.w, cell.h,
          c * outCellW + dx, r * outCellH + dy, dw, dh
        );
      }

      const maxFrames = effCols * effRows;
      const detectedFrames = lastNonEmptyIdx >= 0 ? (lastNonEmptyIdx + 1) : maxFrames;
      const effCount = (!autoDetect && typeof frameCount === 'number' && frameCount >= 1)
        ? Math.min(maxFrames, Math.floor(frameCount))
        : detectedFrames;

      return {
        img: outCanvas,
        cols: effCols,
        rows: effRows,
        cellW: outCellW,
        cellH: outCellH,
        anchorX: targetCx,
        anchorY: targetFootY,
        frameCount: effCount,
        custom: true,
      };
    },

    createExactSheet(img, cols, rows, frameCount, anchorX = 136, anchorY = 242) {
      const c = Math.max(1, parseInt(cols, 10) || 5);
      const r = Math.max(1, parseInt(rows, 10) || 2);
      const maxF = c * r;
      const fc = (typeof frameCount === 'number' && frameCount >= 1) ? Math.min(maxF, Math.floor(frameCount)) : maxF;
      return {
        img,
        cols: c,
        rows: r,
        cellW: img.width / c,
        cellH: img.height / r,
        anchorX,
        anchorY,
        frameCount: fc,
        custom: true,
      };
    },

    exportSheetToDataUrl(sheet) {
      if (!sheet || !sheet.img) return null;
      const c = document.createElement('canvas');
      c.width = sheet.img.width;
      c.height = sheet.img.height;
      const cctx = c.getContext('2d');
      cctx.drawImage(sheet.img, 0, 0);
      return c.toDataURL('image/png');
    },

    tintedCache: {},

    getTintedSheet(sheetKey, variant) {
      const base = this.sheets[sheetKey];
      if (!base || !variant || variant.id === 'white' || !variant.rgb) return base;
      const cacheKey = `${sheetKey}__${variant.id}`;
      const cached = this.tintedCache[cacheKey];
      if (cached && cached._srcImg === base.img) return cached;

      try {
        const w = base.img.width;
        const h = base.img.height;
        const c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        const cctx = c.getContext('2d');
        cctx.drawImage(base.img, 0, 0);
        const imgData = cctx.getImageData(0, 0, w, h);
        const d = imgData.data;
        const [tr, tg, tb] = variant.rgb;
        const mode = variant.mode || 'fur';
        const auraRgb = variant.auraRgb || null;

        for (let i = 0; i < d.length; i += 4) {
          const a = d[i + 3];
          if (a < 10) continue;
          const r = d[i], g = d[i + 1], b = d[i + 2];
          const lum = 0.299 * r + 0.587 * g + 0.114 * b;
          // Preserve crisp dark cartoon ink outlines!
          if (lum < (mode === 'zebra' ? 40 : 66)) continue;

          const maxC = Math.max(r, g, b);
          const minC = Math.min(r, g, b);
          const sat = maxC > 0 ? (maxC - minC) / maxC : 0;

          if (mode === 'ghost') {
            if (r > 205 && g > 155 && b < 110) continue;
            if (r > 180 && g < 115 && b < 145) continue;
            if (sat > 0.30 && b > r && auraRgb) {
              const k = Math.min(1, lum / 230);
              d[i] = Math.min(255, Math.round(auraRgb[0] * (0.45 + 0.55 * k)));
              d[i + 1] = Math.min(255, Math.round(auraRgb[1] * (0.45 + 0.55 * k)));
              d[i + 2] = Math.min(255, Math.round(auraRgb[2] * (0.45 + 0.55 * k)));
            } else if (lum >= 110) {
              const t = Math.min(1, lum / 245);
              if (variant.dark) {
                d[i] = Math.round(tr * (0.52 + 0.65 * t));
                d[i + 1] = Math.round(tg * (0.52 + 0.65 * t));
                d[i + 2] = Math.round(tb * (0.52 + 0.65 * t));
              } else {
                d[i] = Math.min(255, Math.round((r * 0.22 + tr * 0.78) * (0.72 + 0.28 * t)));
                d[i + 1] = Math.min(255, Math.round((g * 0.22 + tg * 0.78) * (0.72 + 0.28 * t)));
                d[i + 2] = Math.min(255, Math.round((b * 0.22 + tb * 0.78) * (0.72 + 0.28 * t)));
              }
            }
          } else if (mode === 'zebra') {
            // 5-color Zebra variants (墨白 / 灰 / 棕 / 白金 / 藍)
            if (r > 215 && g > 165 && b < 110) continue;
            if (b > r + 40 && g > 130) continue;
            if (r > 180 && (r - g) > 32) continue;
            if (lum < 128 && sat < 0.26 && variant.stripeRgb) {
              const st = Math.min(1, lum / 120);
              d[i] = Math.min(255, Math.round(variant.stripeRgb[0] * (0.48 + 0.65 * st)));
              d[i + 1] = Math.min(255, Math.round(variant.stripeRgb[1] * (0.48 + 0.65 * st)));
              d[i + 2] = Math.min(255, Math.round(variant.stripeRgb[2] * (0.48 + 0.65 * st)));
            } else if (lum >= 155 && sat < 0.22) {
              const t = Math.min(1, lum / 248);
              d[i] = Math.min(255, Math.round(tr * (0.72 + 0.28 * t)));
              d[i + 1] = Math.min(255, Math.round(tg * (0.72 + 0.28 * t)));
              d[i + 2] = Math.min(255, Math.round(tb * (0.72 + 0.28 * t)));
            }
          } else if (mode === 'kangaroo') {
            // 5-color Kangaroo variants (棕色 / 灰色 / 粉紅 / 白色 / 藍色)
            if (r > 232 && g > 192 && b < 95) continue;
            if (b > r + 30) continue;
            if (r > 195 && (r - g) > 65 && b > 125) continue;
            if (r > b + 28 && g > 72 && lum >= 92 && sat >= 0.24) {
              const t = Math.min(1.12, lum / 185);
              d[i] = Math.min(255, Math.round(tr * (0.52 + 0.48 * t)));
              d[i + 1] = Math.min(255, Math.round(tg * (0.52 + 0.48 * t)));
              d[i + 2] = Math.min(255, Math.round(tb * (0.52 + 0.48 * t)));
            }
          } else {
            // Fur / Wool mode (Rabbit & Sheep)
            if (r > 195 && g > 155 && b < 95) continue;
            if (b > r + 42 && g > 130) continue;
            if (r > 165 && g < 105 && b < 115) continue;
            if (mode === 'sheep' && r > 85 && g > 48 && b < 95 && (r - b) > 32 && lum < 175) continue;
            if (mode === 'rabbit' && r > 185 && (r - g) > 28 && (r - b) > 12 && g < 185) continue;

            if (lum >= 122 && sat < 0.36) {
              const t = Math.min(1, lum / 248);
              if (variant.dark) {
                d[i] = Math.round(tr * (0.48 + 0.68 * t));
                d[i + 1] = Math.round(tg * (0.48 + 0.68 * t));
                d[i + 2] = Math.round(tb * (0.48 + 0.68 * t));
              } else {
                d[i] = Math.min(255, Math.round(tr * (0.62 + 0.38 * t)));
                d[i + 1] = Math.min(255, Math.round(tg * (0.62 + 0.38 * t)));
                d[i + 2] = Math.min(255, Math.round(tb * (0.62 + 0.38 * t)));
              }
            }
          }
        }
        cctx.putImageData(imgData, 0, 0);
        const tinted = { ...base, img: c, _srcImg: base.img };
        this.tintedCache[cacheKey] = tinted;
        return tinted;
      } catch (_) {
        return base;
      }
    },

    drawFrame(ctx, sheetKey, frameIndex, x, y, facing = 1, scale = 1, flashWhite = false, variant = null) {
      const sheet = variant ? this.getTintedSheet(sheetKey, variant) : this.sheets[sheetKey];
      if (!sheet) return;
      const idx = ((Math.floor(frameIndex) % sheet.frameCount) + sheet.frameCount) % sheet.frameCount;
      const col = idx % sheet.cols;
      const row = Math.floor(idx / sheet.cols);
      const sx = col * sheet.cellW;
      const sy = row * sheet.cellH;

      ctx.save();
      ctx.translate(Math.round(x), Math.round(y));
      ctx.scale(facing * scale, scale);
      if (flashWhite) {
        ctx.filter = 'brightness(2.4) contrast(1.2)';
      }
      ctx.drawImage(
        sheet.img,
        sx, sy, sheet.cellW, sheet.cellH,
        -sheet.anchorX, -sheet.anchorY, sheet.cellW, sheet.cellH
      );
      ctx.restore();
    },
  };

  // ==========================================================================
  // 3. INPUT CONTROLLER (Walk / Double-Tap Run / Rebindable Action Keys)
  // ==========================================================================
  const keys = {};
  const justPressed = {};
  let lastTapDir = 0;
  let lastTapTime = 0;
  let doubleTapRunTrigger = 0;

  function isActionJustPressed(actionId) {
    if (typeof GamepadManager !== 'undefined' && GamepadManager.isActionJustPressed(actionId)) return true;
    const act = StudioState.getAction(actionId);
    if (!act) return false;
    if (act.key && justPressed[act.key]) return true;
    if (act.altKeys) {
      for (const ak of act.altKeys) {
        if (justPressed[ak]) return true;
      }
    }
    return false;
  }

  function setKeyDown(code) {
    sfx.init();
    if (!keys[code]) {
      justPressed[code] = true;
      const now = performance.now();
      // Double-tap AA or DD (or Left/Right arrows) enters RUN state!
      if (code === 'ArrowRight' || code === 'KeyD') {
        if (lastTapDir === 1 && now - lastTapTime < 290) {
          doubleTapRunTrigger = 1;
          lastTapDir = 0;
        } else {
          lastTapDir = 1;
          lastTapTime = now;
        }
      } else if (code === 'ArrowLeft' || code === 'KeyA') {
        if (lastTapDir === -1 && now - lastTapTime < 290) {
          doubleTapRunTrigger = -1;
          lastTapDir = 0;
        } else {
          lastTapDir = -1;
          lastTapTime = now;
        }
      }
    }
    keys[code] = true;
  }

  function setKeyUp(code) {
    keys[code] = false;
  }

  window.addEventListener('keydown', (e) => {
    // Ignore typing inside Gear Studio text/number inputs!
    const tag = document.activeElement && document.activeElement.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;

    // Key Rebinding mode inside Gear Settings Studio!
    if (StudioState.rebindingActionId) {
      e.preventDefault();
      if (e.code !== 'Escape') {
        const char = StudioState.getActiveChar();
        const act = char.actions.find((a) => a.id === StudioState.rebindingActionId);
        if (act) {
          act.key = e.code;
          StudioState.save();
        }
      }
      StudioState.rebindingActionId = null;
      renderControlsLegend();
      renderGearStudio();
      return;
    }

    // Cancel Gamepad rebind listening with Escape
    if (typeof GamepadManager !== 'undefined' && GamepadManager.rebindingId) {
      if (e.code === 'Escape') {
        e.preventDefault();
        GamepadManager.rebindingId = null;
        renderGamepadSettings();
      }
      return;
    }

    const prevent = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Numpad0', 'Numpad4', 'Numpad5'];
    if (prevent.includes(e.code)) e.preventDefault();

    if (e.code === 'KeyP' || e.code === 'Escape' || e.code === 'Backspace' || e.code === 'MediaPlayPause' || e.key === 'GoBack') {
      if (game.state === 'playing') game.state = 'paused';
      else if (game.state === 'paused') game.state = 'playing';
      return;
    }

    if (game.state === 'title') {
      if (e.code === 'ArrowLeft' || e.code === 'KeyA') {
        const idx = HERO_ROSTER.findIndex((h) => h.id === game.selectedHeroId);
        game.selectedHeroId = HERO_ROSTER[(idx - 1 + HERO_ROSTER.length) % HERO_ROSTER.length].id;
        sfx.init();
        sfx.playPickup('coin');
        return;
      }
      if (e.code === 'ArrowRight' || e.code === 'KeyD') {
        const idx = HERO_ROSTER.findIndex((h) => h.id === game.selectedHeroId);
        game.selectedHeroId = HERO_ROSTER[(idx + 1) % HERO_ROSTER.length].id;
        sfx.init();
        sfx.playPickup('coin');
        return;
      }
      if (e.code === 'Digit1' || e.code === 'Digit2' || e.code === 'Digit3') {
        const targetIdx = e.code === 'Digit1' ? 0 : (e.code === 'Digit2' ? 1 : 2);
        if (HERO_ROSTER[targetIdx] && game.selectedHeroId !== HERO_ROSTER[targetIdx].id) {
          game.selectedHeroId = HERO_ROSTER[targetIdx].id;
          sfx.init();
          sfx.playPickup('coin');
        }
        return;
      }
      if (e.code === 'ArrowUp' || e.code === 'KeyW') {
        game.selectedStageIndex = (game.selectedStageIndex + STAGES.length - 1) % STAGES.length;
        game.stageIndex = game.selectedStageIndex;
        sfx.init();
        sfx.playPickup('coin');
        return;
      }
      if (e.code === 'ArrowDown' || e.code === 'KeyS') {
        game.selectedStageIndex = (game.selectedStageIndex + 1) % STAGES.length;
        game.stageIndex = game.selectedStageIndex;
        sfx.init();
        sfx.playPickup('coin');
        return;
      }
      if (e.code === 'Enter' || e.code === 'Space' || e.code === 'Numpad4' || e.code === 'Numpad5' || e.code === 'Numpad0' || e.code === 'KeyJ' || e.code === 'KeyZ') {
        startNewGame(game.selectedStageIndex);
        return;
      }
      return;
    }
    if (game.state === 'stageclear' && (e.code === 'Enter' || e.code === 'Space' || e.code === 'Numpad4' || e.code === 'KeyJ')) {
      advanceToNextStage();
      return;
    }
    if ((game.state === 'gameover' || game.state === 'victory') && (e.code === 'Enter' || e.code === 'Space' || e.code === 'KeyR' || e.code === 'Numpad4')) {
      startNewGame(game.state === 'victory' ? 0 : game.stageIndex);
      return;
    }

    setKeyDown(e.code);
  });

  window.addEventListener('keyup', (e) => setKeyUp(e.code));

  const SELECT_UI = {
    cards: [
      { id: 'kuromi', x: 24, y: 424, w: 184, h: 72 },
      { id: 'redpanda', x: 218, y: 424, w: 184, h: 72 },
      { id: 'adailing', x: 412, y: 424, w: 184, h: 72 },
    ],
    stagePills: [
      { idx: 0, x: 108, y: 204, w: 176, h: 150, pinX: 196, pinY: 262, cardX: 112, cardY: 318, heroX: 196, heroY: 312 },
      { idx: 1, x: 316, y: 100, w: 176, h: 162, pinX: 404, pinY: 164, cardX: 320, cardY: 222, heroX: 404, heroY: 218 },
      { idx: 2, x: 562, y: 112, w: 180, h: 166, pinX: 652, pinY: 178, cardX: 566, cardY: 236, heroX: 652, heroY: 232 },
      { idx: 3, x: 774, y: 150, w: 180, h: 158, pinX: 864, pinY: 212, cardX: 778, cardY: 268, heroX: 864, heroY: 264 },
    ],
    startBtn: { x: 616, y: 424, w: 384, h: 72 },
  };

  function canvasCoords(e) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * CANVAS_W,
      y: ((e.clientY - rect.top) / rect.height) * CANVAS_H,
    };
  }

  canvas.addEventListener('mousemove', (e) => {
    if (game.state !== 'title') {
      game.hoverHeroId = null;
      return;
    }
    const pt = canvasCoords(e);
    let hovered = null;
    for (const c of SELECT_UI.cards) {
      if (pt.x >= c.x && pt.x <= c.x + c.w && pt.y >= c.y && pt.y <= c.y + c.h) {
        hovered = c.id;
      }
    }
    game.hoverHeroId = hovered;
    const overStage = SELECT_UI.stagePills.some((p) => pt.x >= p.x && pt.x <= p.x + p.w && pt.y >= p.y && pt.y <= p.y + p.h);
    const sb = SELECT_UI.startBtn;
    const overStart = pt.x >= sb.x && pt.x <= sb.x + sb.w && pt.y >= sb.y && pt.y <= sb.y + sb.h;
    canvas.style.cursor = (hovered || overStage || overStart) ? 'pointer' : 'default';
  });

  canvas.addEventListener('mousedown', (e) => {
    sfx.init();
    canvas.focus();
    if (game.state === 'title') {
      const pt = canvasCoords(e);
      for (const c of SELECT_UI.cards) {
        if (pt.x >= c.x && pt.x <= c.x + c.w && pt.y >= c.y && pt.y <= c.y + c.h) {
          if (game.selectedHeroId === c.id) {
            startNewGame(game.selectedStageIndex);
          } else {
            game.selectedHeroId = c.id;
            sfx.playPickup('coin');
          }
          return;
        }
      }
      for (const sp of SELECT_UI.stagePills) {
        if (pt.x >= sp.x && pt.x <= sp.x + sp.w && pt.y >= sp.y && pt.y <= sp.y + sp.h) {
          game.selectedStageIndex = sp.idx;
          game.stageIndex = sp.idx;
          sfx.playPickup('coin');
          return;
        }
      }
      const sb = SELECT_UI.startBtn;
      if (pt.x >= sb.x && pt.x <= sb.x + sb.w && pt.y >= sb.y && pt.y <= sb.y + sb.h) {
        startNewGame(game.selectedStageIndex);
        return;
      }
      return;
    }
    if (game.state === 'stageclear') {
      advanceToNextStage();
      return;
    }
    if (game.state === 'gameover' || game.state === 'victory') {
      startNewGame(game.state === 'victory' ? 0 : game.stageIndex);
      return;
    }
    const lightKey = (StudioState.getAction('lightAttack') && StudioState.getAction('lightAttack').key) || 'Numpad4';
    const heavyKey = (StudioState.getAction('heavyAttack') && StudioState.getAction('heavyAttack').key) || 'Numpad5';
    const spKey = (StudioState.getAction('special') && StudioState.getAction('special').key) || 'Numpad0';
    if (e.button === 0) setKeyDown(lightKey);
    if (e.button === 1) { e.preventDefault(); setKeyDown(heavyKey); }
    if (e.button === 2) setKeyDown(spKey);
  });
  canvas.addEventListener('mouseup', (e) => {
    const lightKey = (StudioState.getAction('lightAttack') && StudioState.getAction('lightAttack').key) || 'Numpad4';
    const heavyKey = (StudioState.getAction('heavyAttack') && StudioState.getAction('heavyAttack').key) || 'Numpad5';
    const spKey = (StudioState.getAction('special') && StudioState.getAction('special').key) || 'Numpad0';
    if (e.button === 0) setKeyUp(lightKey);
    if (e.button === 1) setKeyUp(heavyKey);
    if (e.button === 2) setKeyUp(spKey);
  });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  // Virtual touch buttons (supports both raw data-key and rebindable data-action)
  document.querySelectorAll('[data-key], [data-action]').forEach((btn) => {
    const resolveCode = () => {
      const actId = btn.getAttribute('data-action');
      if (actId) {
        const act = StudioState.getAction(actId);
        return (act && act.key) || 'Numpad4';
      }
      return btn.getAttribute('data-key');
    };
    const down = (e) => {
      e.preventDefault();
      btn.classList.add('pressed');
      if (game.state === 'title') {
        startNewGame(game.selectedStageIndex);
        return;
      }
      if (game.state === 'stageclear') {
        advanceToNextStage();
        return;
      }
      setKeyDown(resolveCode());
    };
    const up = (e) => {
      e.preventDefault();
      btn.classList.remove('pressed');
      setKeyUp(resolveCode());
    };
    btn.addEventListener('pointerdown', down);
    btn.addEventListener('pointerup', up);
    btn.addEventListener('pointerleave', up);
    btn.addEventListener('pointercancel', up);
  });

  // ==========================================================================
  // 4. GAME STATE, 3 SCHOOL STAGES, WAVES, ENTITIES & COMBAT
  // ==========================================================================
  const ALL_RANDOM_MONSTER_POOL = [
    'fat_tiger', 'zebra_rush', 'joey_kangaroo',
    'kangaroo', 'zebra', 'koala', 'capybara', 'cactus', 'wizard_ghost',
    'penguin_king', 'penguin_ice', 'rabbit', 'ghost', 'sheep',
    'pig', 'slime', 'mushroom', 'puffer', 'star',
  ];

  const STAGES = [
    {
      id: 1,
      key: 'starfish',
      name: 'STAGE 1 · Star Fish 國小',
      shortName: 'Star Fish 國小',
      themeBadge: '🌊 海洋與奇幻軍團',
      icon: '⭐',
      accent: '#38bdf8',
      bossWarnName: 'Star Fish 國小 宇宙海星體育股長 登場！',
      clearTitle: 'STAGE 1 CLEAR!! 制霸 Star Fish 國小！',
      signs: [
        { x: 180, y: 122, w: 168, h: 40, text: 'Star Fish 國小', color: '#38bdf8' },
        { x: 640, y: 120, w: 142, h: 38, text: '主教學大樓', color: '#facc15' },
        { x: 1180, y: 124, w: 148, h: 40, text: '綠藤椰林道', color: '#22c55e' },
        { x: 1680, y: 120, w: 148, h: 40, text: '紅磚壁畫牆', color: '#f43f8e' },
        { x: 2200, y: 122, w: 152, h: 40, text: '陽光木棧道', color: '#38bdf8' },
        { x: 2740, y: 120, w: 156, h: 40, text: '紅頂大涼亭', color: '#f59e0b' },
        { x: 3240, y: 124, w: 164, h: 40, text: '銀龍地標 BOSS', color: '#f43f5e' },
      ],
      zones: [
        {
          id: 1,
          name: 'Star Fish 國小 · 海洋校門口',
          triggerX: 280,
          lockCamX: 0,
          spawns: [
            { type: 'fat_tiger', side: 1, z: 418, delay: 0.15 },
            { type: 'zebra_rush', side: 1, z: 394, delay: 0.45 },
            { type: 'joey_kangaroo', side: 1, z: 452, delay: 0.95 },
            { type: 'penguin_ice', side: -1, z: 422, delay: 1.55 },
            { type: 'penguin_king', side: 1, z: 406, delay: 2.35 },
          ],
        },
        {
          id: 2,
          name: 'Star Fish 國小 · 水族福利社走廊',
          triggerX: 1360,
          lockCamX: 1080,
          spawns: [
            { type: 'puffer', side: 1, z: 404, delay: 0.2 },
            { type: 'wizard_ghost', side: 1, z: 456, delay: 0.65 },
            { type: 'joey_kangaroo', side: -1, z: 388, delay: 1.5 },
            { type: 'capybara', side: -1, z: 448, delay: 2.3 },
            { type: 'slime', side: 1, z: 416, delay: 3.1 },
          ],
        },
        {
          id: 3,
          name: 'Star Fish 國小 · 海洋大操場 BOSS 戰',
          triggerX: 2760,
          lockCamX: STAGE_W - CANVAS_W,
          isBoss: true,
          spawns: [
            { type: 'boss', side: 1, z: 425, delay: 1.1, customName: '⭐ Star Fish 國小 宇宙海星體育股長', hpMult: 0.72 },
            { type: 'zebra_rush', side: -1, z: 385, delay: 3.6 },
            { type: 'wizard_ghost', side: 1, z: 465, delay: 7.4 },
            { type: 'penguin_ice', side: -1, z: 432, delay: 11.2 },
          ],
        },
      ],
    },
    {
      id: 2,
      key: 'aqiang',
      name: 'STAGE 2 · 阿強國小',
      shortName: '阿強國小',
      themeBadge: '🎲 新怪大亂鬥（育兒袋鼠・暴衝斑馬・無尾熊・水豚・仙人掌）',
      icon: '🔥',
      accent: '#f97316',
      bossWarnName: '阿強國小 暴走鐵拳教官 降臨！',
      clearTitle: 'STAGE 2 CLEAR!! 制霸阿強國小！',
      signs: [
        { x: 220, y: 142, w: 164, h: 44, text: '阿強國小', color: '#f97316' },
        { x: 640, y: 128, w: 148, h: 38, text: '小吃部街角', color: '#ef4444' },
        { x: 1180, y: 144, w: 156, h: 42, text: '彩虹圍欄道', color: '#facc15' },
        { x: 1660, y: 132, w: 154, h: 40, text: '阿強國小大門', color: '#fb923c' },
        { x: 2180, y: 138, w: 164, h: 42, text: '永興街角口', color: '#f43f5e' },
        { x: 2760, y: 128, w: 174, h: 44, text: '美術館廣場', color: '#f97316' },
        { x: 3250, y: 142, w: 150, h: 40, text: '強者對決', color: '#ef4444' },
      ],
      zones: [
        {
          id: 1,
          name: '阿強國小 · 永興路新怪大亂鬥',
          triggerX: 280,
          lockCamX: 0,
          spawns: [
            { type: 'joey_kangaroo', side: 1, z: 398, delay: 0.15 },
            { type: 'zebra_rush', side: 1, z: 458, delay: 0.50 },
            { type: 'koala', side: -1, z: 390, delay: 1.35 },
            { type: 'zebra', side: 1, z: 446, delay: 2.15 },
          ],
        },
        {
          id: 2,
          name: '阿強國小 · 彩虹校門廣場',
          triggerX: 1360,
          lockCamX: 1080,
          spawns: [
            { type: 'cactus', side: 1, z: 392, delay: 0.2 },
            { type: 'zebra_rush', side: 1, z: 454, delay: 0.65 },
            { type: 'kangaroo', side: -1, z: 422, delay: 1.45 },
            { type: 'random', pool: ALL_RANDOM_MONSTER_POOL, side: 1, z: 402, delay: 2.3 },
            { type: 'random', pool: ALL_RANDOM_MONSTER_POOL, side: -1, z: 462, delay: 3.1 },
          ],
        },
        {
          id: 3,
          name: '阿強國小 · 美術館廣場 BOSS 戰',
          triggerX: 2760,
          lockCamX: STAGE_W - CANVAS_W,
          isBoss: true,
          spawns: [
            { type: 'boss', side: 1, z: 425, delay: 1.1, customName: '🔥 阿強國小 暴走鐵拳教官', hpMult: 0.9 },
            { type: 'joey_kangaroo', side: -1, z: 382, delay: 3.5 },
            { type: 'cactus', side: 1, z: 468, delay: 7.2 },
            { type: 'random', pool: ALL_RANDOM_MONSTER_POOL, side: -1, z: 430, delay: 11.0 },
          ],
        },
      ],
    },
    {
      id: 3,
      key: 'donghua',
      name: 'STAGE 3 · 冬花國小',
      shortName: '冬花國小',
      themeBadge: '🥋 武聖終極決戰（2倍巨型宗師 BOSS）',
      icon: '❄️',
      accent: '#c084fc',
      bossWarnName: '🥋 冬花國小 武聖大宗師 霸氣降臨！',
      clearTitle: 'ALL CLEAR!! 稱霸三校大亂鬥！',
      signs: [
        { x: 220, y: 142, w: 164, h: 44, text: '冬花國小', color: '#c084fc' },
        { x: 640, y: 128, w: 152, h: 38, text: '草原牧場園', color: '#4ade80' },
        { x: 1180, y: 144, w: 154, h: 42, text: '雪見音樂廳', color: '#f472b6' },
        { x: 1660, y: 132, w: 154, h: 40, text: '可愛動物區', color: '#67e8f9' },
        { x: 2180, y: 138, w: 164, h: 42, text: '冬花大禮堂', color: '#a855f7' },
        { x: 2760, y: 128, w: 174, h: 44, text: '武道宗師殿', color: '#facc15' },
        { x: 3250, y: 142, w: 156, h: 40, text: 'FINAL BOSS', color: '#facc15' },
      ],
      zones: [
        {
          id: 1,
          name: '冬花國小 · 草原動物雪廊',
          triggerX: 280,
          lockCamX: 0,
          spawns: [
            { type: 'zebra_rush', side: 1, z: 390, delay: 0.15 },
            { type: 'joey_kangaroo', side: 1, z: 454, delay: 0.5 },
            { type: 'sheep', side: -1, z: 420, delay: 1.3 },
            { type: 'koala', side: 1, z: 402, delay: 2.1 },
          ],
        },
        {
          id: 2,
          name: '冬花國小 · 草原中庭花園',
          triggerX: 1360,
          lockCamX: 1080,
          spawns: [
            { type: 'zebra', side: 1, z: 398, delay: 0.2 },
            { type: 'capybara', side: -1, z: 454, delay: 0.6 },
            { type: 'joey_kangaroo', side: 1, z: 430, delay: 1.35 },
            { type: 'wizard_ghost', side: -1, z: 386, delay: 2.1 },
            { type: 'zebra_rush', side: 1, z: 462, delay: 2.9 },
          ],
        },
        {
          id: 3,
          name: '冬花國小 · 武聖大宗師終極決戰',
          triggerX: 2760,
          lockCamX: 3584 - 1024,
          isBoss: true,
          spawns: [
            { type: 'donghua_boss', side: 1, z: 428, delay: 1.2, customName: '🥋 冬花武聖大宗師', hpMult: 1.0 },
            { type: 'joey_kangaroo', side: -1, z: 382, delay: 4.5 },
            { type: 'zebra_rush', side: 1, z: 466, delay: 8.5 },
            { type: 'cactus', side: -1, z: 422, delay: 12.5 },
          ],
        },
      ],
    },
    {
      id: 4,
      key: 'training',
      isTraining: true,
      name: '🥋 自由訓練場 · 招式與怪物測試室',
      shortName: '訓練場',
      icon: '🥋',
      accent: '#22d3ee',
      subtitle: '不主動出怪 · 無限氣力 · 隨時召喚怪物測試所有招式與動畫',
      zones: [],
    },
  ];

  function getCurrentStage() {
    return STAGES[Math.max(0, Math.min(game.stageIndex, STAGES.length - 1))];
  }

  function getCurrentZones() {
    return getCurrentStage().zones;
  }

  const game = {
    state: 'loading', // loading | title | playing | paused | stageclear | gameover | victory
    selectedHeroId: 'kuromi',
    hoverHeroId: null,
    selectedStageIndex: 0,
    stageIndex: 0,
    trainingDummyMode: true,
    trainingInfiniteHp: true,
    time: 0,
    camX: 0,
    camMinX: 0,
    camMaxX: STAGE_W - CANVAS_W,
    zoneIndex: 0,
    zoneActive: false,
    zoneCleared: false,
    pendingSpawns: [],
    zoneTimer: 0,
    goBannerTimer: 0,
    bossWarningTimer: 0,
    hitstop: 0,
    shakeTime: 0,
    shakeAmp: 0,
    score: 0,
    combo: 0,
    comboTimer: 0,
    maxCombo: 0,
    koCount: 0,
    lastHitEnemy: null,
    lastHitTimer: 0,
    player: null,
    enemies: [],
    props: [],
    pickups: [],
    particles: [],
    floatTexts: [],
    afterimages: [],
    comicBubbles: [],
    projectiles: [],
    impactFrame: null,
    beamEffect: null,
  };

  function addShake(amp, dur = 0.16) {
    game.shakeAmp = Math.max(game.shakeAmp, amp);
    game.shakeTime = Math.max(game.shakeTime, dur);
  }

  function addFloatText(x, y, text, color = '#fff', size = 20) {
    game.floatTexts.push({ x, y, vy: -72, text, color, size, life: 0.78, maxLife: 0.78 });
  }

  // --------------------------------------------------------------------------
  // AMERICAN COMIC-BOOK ACTION BUBBLES & IMPACT FRAMES ENGINE
  // --------------------------------------------------------------------------
  function spawnComicBubble(x, y, text, opts = {}) {
    const style = opts.style || 'burst'; // burst | shout | super
    const spikes = style === 'super' ? 20 : (style === 'shout' ? 14 : 12);
    const seed = Math.random() * 100;
    const radii = [];
    for (let i = 0; i < spikes * 2; i++) {
      const isOuter = i % 2 === 0;
      const jitter = 0.86 + ((Math.sin(seed + i * 3.7) * 0.5 + 0.5) * 0.30);
      radii.push((isOuter ? 1.0 : 0.62) * jitter);
    }
    game.comicBubbles.push({
      x,
      y,
      text,
      subText: opts.subText || '',
      style,
      fillA: opts.fillA || '#fde047',
      fillB: opts.fillB || '#f97316',
      textColor: opts.textColor || '#ffffff',
      rx: opts.rx || (style === 'super' ? 145 : style === 'shout' ? 92 : 60),
      ry: opts.ry || (style === 'super' ? 68 : style === 'shout' ? 44 : 38),
      tilt: opts.tilt !== undefined ? opts.tilt : (Math.random() - 0.5) * 0.28,
      tailDir: opts.tailDir || 0,
      screenSpace: !!opts.screenSpace,
      radii,
      life: opts.dur || (style === 'super' ? 0.85 : style === 'shout' ? 0.66 : 0.46),
      maxLife: opts.dur || (style === 'super' ? 0.85 : style === 'shout' ? 0.66 : 0.46),
      age: 0,
    });
    if (game.comicBubbles.length > 10) game.comicBubbles.shift();
  }

  function triggerImpactFrame(tint = '#ffffff', dur = 0.065) {
    game.impactFrame = { tint, life: dur, maxLife: dur };
  }

  function getActionFx(actionId) {
    if (!actionId || !SpriteBank.actionFx) return null;
    return SpriteBank.actionFx[actionId] || null;
  }

  function triggerActionFx(actor, actionId, defaults = {}) {
    const fx = getActionFx(actionId);
    // 1. Screen Shake
    if (fx) {
      if (fx.shakeEnabled) addShake(Number(fx.shakeAmp) || 7, Number(fx.shakeDur) || 0.16);
    } else if (defaults.shakeAmp) {
      addShake(defaults.shakeAmp, defaults.shakeDur || 0.16);
    }
    // 2. Impact Flash
    if (fx && fx.flashEnabled) {
      triggerImpactFrame(fx.flashColor || '#fde047', Number(fx.flashDur) || 0.06);
    }
    // 3. Burst Particles
    if (fx && fx.particlesEnabled) {
      spawnParticles(actor.x + actor.facing * 20, actor.z - 42, fx.particleColor || '#38bdf8', Math.max(4, Math.min(40, Number(fx.particleCount) || 14)), 240, 6);
    } else if (defaults.particles) {
      spawnParticles(actor.x + actor.facing * 20, actor.z - 24, defaults.particles.color, defaults.particles.count || 12, 230, 6);
    }
    // 4. Comic Dialogue Bubble
    const showBubble = fx ? !!fx.bubbleEnabled : !!defaults.text;
    if (showBubble) {
      const text = (fx && fx.bubbleText && fx.bubbleText.trim()) || defaults.text || '';
      if (text) {
        const style = (fx && fx.bubbleStyle) || defaults.style || 'shout';
        spawnComicBubble(
          defaults.x !== undefined ? defaults.x : (actor.x - actor.facing * 18),
          defaults.y !== undefined ? defaults.y : (actor.z - 198),
          text,
          {
            style,
            subText: fx ? (fx.bubbleSubText || '') : (defaults.subText || ''),
            fillA: (fx && fx.bubbleFillA) || defaults.fillA || '#fde047',
            fillB: (fx && fx.bubbleFillB) || defaults.fillB || '#f97316',
            textColor: (fx && fx.bubbleTextColor) || defaults.textColor || '#ffffff',
            rx: style === 'super' ? 142 : (defaults.rx || 98),
            ry: style === 'super' ? 56 : (defaults.ry || 44),
            tailDir: defaults.tailDir !== undefined ? defaults.tailDir : -actor.facing,
            dur: (fx && Number(fx.bubbleDur)) || defaults.dur || 0.66,
          }
        );
      }
    }
  }

  function drawComicBubble(ctx, b) {
    const t = b.age / b.maxLife;
    // Elastic comic pop-in spring (0.25 -> 1.22 -> 1.0), crisp exit fade
    let scale = 1;
    if (t < 0.14) {
      const p = t / 0.14;
      scale = 0.25 + p * 0.97;
    } else if (t < 0.28) {
      const p = (t - 0.14) / 0.14;
      scale = 1.22 - p * 0.22;
    }
    const alpha = t > 0.72 ? Math.max(0, (1 - t) / 0.28) : 1;

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(Math.round(b.x), Math.round(b.y - b.age * (b.style === 'burst' ? 28 : 16)));
    if (b.style !== 'classic') ctx.rotate(b.tilt);
    ctx.scale(scale, scale);

    const n = b.radii.length;
    const traceBubble = (ox, oy) => {
      ctx.beginPath();
      if (b.style === 'classic') {
        const x = -b.rx + ox, y = -b.ry + oy, bw = b.rx * 2, bh = b.ry * 2, rad = 22;
        ctx.moveTo(x + rad, y);
        ctx.lineTo(x + bw - rad, y); ctx.quadraticCurveTo(x + bw, y, x + bw, y + rad);
        ctx.lineTo(x + bw, y + bh - rad); ctx.quadraticCurveTo(x + bw, y + bh, x + bw - rad, y + bh);
        ctx.lineTo(x + rad, y + bh); ctx.quadraticCurveTo(x, y + bh, x, y + bh - rad);
        ctx.lineTo(x, y + rad); ctx.quadraticCurveTo(x, y, x + rad, y);
      } else {
        for (let i = 0; i < n; i++) {
          const ang = (i / n) * Math.PI * 2;
          const r = b.radii[i];
          const px = Math.cos(ang) * b.rx * r + ox;
          const py = Math.sin(ang) * b.ry * r + oy;
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
      }
      ctx.closePath();
    };

    // Bold offset black comic ink drop shadow
    ctx.fillStyle = '#090710';
    traceBubble(5, 6);
    ctx.fill();

    // Optional speech pointer tail for shout & classic bubbles
    if (b.style === 'shout' || b.style === 'classic') {
      ctx.beginPath();
      const tx = b.tailDir >= 0 ? -b.rx * 0.28 : b.rx * 0.28;
      ctx.moveTo(tx - 10, b.ry * 0.45);
      ctx.lineTo(tx + (b.tailDir >= 0 ? -18 : 18), b.ry * 1.18);
      ctx.lineTo(tx + 14, b.ry * 0.45);
      ctx.closePath();
      ctx.fillStyle = b.fillB;
      ctx.fill();
      ctx.lineWidth = 4;
      ctx.strokeStyle = '#090710';
      ctx.stroke();
    }

    // Vibrant Comic Starburst Fill
    const grad = ctx.createLinearGradient(0, -b.ry, 0, b.ry);
    grad.addColorStop(0, b.fillA);
    grad.addColorStop(1, b.fillB);
    ctx.fillStyle = grad;
    traceBubble(0, 0);
    ctx.fill();

    // Subtle Ben-Day Comic Halftone Dots inside bubble!
    ctx.save();
    ctx.clip();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.22)';
    for (let hx = -b.rx; hx <= b.rx; hx += 12) {
      for (let hy = -b.ry; hy <= b.ry; hy += 12) {
        if ((Math.floor(hx / 12) + Math.floor(hy / 12)) % 2 === 0 && hy > -b.ry * 0.2) {
          ctx.beginPath();
          ctx.arc(hx, hy, 2.4, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
    ctx.restore();

    // Crisp thick comic ink outline
    ctx.lineWidth = b.style === 'super' ? 5.5 : 4.2;
    ctx.lineJoin = 'miter';
    ctx.strokeStyle = '#090710';
    traceBubble(0, 0);
    ctx.stroke();

    // Inner bright rim accent
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = 'rgba(255,255,255,0.65)';
    ctx.save();
    ctx.scale(0.88, 0.88);
    traceBubble(0, 0);
    ctx.stroke();
    ctx.restore();

    // Bold Slanted Comic Lettering
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const fontSize = b.style === 'super' ? 30 : (b.style === 'shout' || b.style === 'classic' ? 23 : 22);
    ctx.font = `900 ${b.style === 'classic' ? '' : 'italic '}${fontSize}px "Noto Sans TC", Impact, sans-serif`;
    const textY = b.subText ? -6 : 1;
    if (b.style !== 'classic' || (b.textColor || '#ffffff').toLowerCase() === '#ffffff') {
      ctx.lineWidth = 6;
      ctx.strokeStyle = '#090710';
      ctx.strokeText(b.text, 0, textY);
    }
    ctx.fillStyle = b.textColor;
    ctx.fillText(b.text, 0, textY);

    if (b.subText) {
      ctx.font = `900 italic ${b.style === 'super' ? 14 : 11}px Impact, sans-serif`;
      ctx.lineWidth = 3.5;
      ctx.strokeStyle = '#090710';
      ctx.strokeText(b.subText, 0, 17);
      ctx.fillStyle = '#fef08a';
      ctx.fillText(b.subText, 0, 17);
    }

    ctx.restore();
  }

  function drawImpactFrameOverlay(ctx) {
    const imp = game.impactFrame;
    if (!imp || imp.life <= 0) return;
    const ratio = imp.life / imp.maxLife;
    ctx.save();
    // High-contrast graphic flash pulse
    ctx.globalAlpha = ratio * 0.28;
    ctx.fillStyle = imp.tint;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    // Classic anime / comic-book radial speed lines framing the edges!
    ctx.globalAlpha = ratio * 0.82;
    const cx = CANVAS_W * 0.5;
    const cy = CANVAS_H * 0.52;
    const lineCount = 34;
    for (let i = 0; i < lineCount; i++) {
      const ang = (i / lineCount) * Math.PI * 2 + (imp.life * 8);
      const innerR = 260 + (i % 3) * 58;
      const outerR = 680;
      ctx.fillStyle = i % 2 === 0 ? '#090710' : '#ffffff';
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(ang) * innerR, cy + Math.sin(ang) * innerR);
      ctx.lineTo(cx + Math.cos(ang - 0.025) * outerR, cy + Math.sin(ang - 0.025) * outerR);
      ctx.lineTo(cx + Math.cos(ang + 0.025) * outerR, cy + Math.sin(ang + 0.025) * outerR);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  // --------------------------------------------------------------------------
  // GOTHIC ENERGY SOCCER BALL PROJECTILE (浪子踢球!)
  // --------------------------------------------------------------------------
  class SoccerBall {
    constructor(x, z, facing, style = 'gothic') {
      this.x = x;
      this.z = z;
      this.facing = facing;
      this.style = style; // 'gothic' (Kuromi) | 'lightning' (Red Panda) | 'book' (Adailing Textbook Throw!)
      this.vx = facing * (style === 'book' ? 740 : 760);
      this.jumpY = style === 'book' ? 84 : (style === 'lightning' ? 42 : 24);
      this.vy = style === 'book' ? 140 : 180;
      this.rot = 0;
      this.age = 0;
      this.life = 1.05;
      this.hitsLeft = 4;
      this.hitIds = new Set();
      this.dead = false;
    }

    update(dt) {
      this.age += dt;
      this.life -= dt;
      if (this.life <= 0) { this.dead = true; return; }
      this.x += this.vx * dt;
      this.rot += this.facing * (this.style === 'book' ? 18 : 26) * dt;

      const isLightning = this.style === 'lightning';
      const isBook = this.style === 'book';

      // Energetic bounce along the street!
      this.jumpY += this.vy * dt;
      this.vy -= (isBook ? 620 : 1200) * dt;
      if (this.jumpY < 16) {
        this.jumpY = 16;
        this.vy = Math.abs(this.vy) * 0.62;
        if (this.vy < 140) this.vy = 190;
        spawnParticles(this.x, this.z, isBook ? '#34d399' : (isLightning ? '#38bdf8' : '#e879f9'), 5, 130, 4);
      }

      // Trail sparks matching hero's kick/throw style
      if (Math.random() < 0.8) {
        game.particles.push({
          x: this.x - this.facing * 14,
          y: this.z - this.jumpY + (Math.random() - 0.5) * 16,
          vx: -this.facing * 120,
          vy: (Math.random() - 0.5) * 48,
          size: 4.5 + Math.random() * 4,
          color: isBook
            ? (Math.random() < 0.5 ? '#fde047' : '#38bdf8')
            : (isLightning
              ? (Math.random() < 0.55 ? '#67e8f9' : '#fde047')
              : (Math.random() < 0.5 ? '#f472b6' : '#facc15')),
          life: 0.16,
          maxLife: 0.16,
          gravity: 0,
        });
      }

      // Hit enemies along the Z-lane
      for (const e of game.enemies) {
        if (e.dead || this.hitIds.has(e.id)) continue;
        if (Math.abs(e.x - this.x) < 58 && Math.abs(e.z - this.z) <= 44) {
          this.hitIds.add(e.id);
          this.hitsLeft--;
          const word = isBook ? '📚 知識爆擊!!' : (isLightning ? '⚡ GOAL!!' : 'GOAL!!');
          e.takeHit(28, this.facing, true, 320, isBook ? '#34d399' : (isLightning ? '#38bdf8' : '#facc15'), word);
          sfx.playHit(true);
          game.hitstop = 0.048;
          addShake(8, 0.16);
          if (this.hitsLeft <= 0) {
            this.dead = true;
            spawnParticles(this.x, this.z - this.jumpY, isBook ? '#34d399' : (isLightning ? '#38bdf8' : '#f472b6'), 16, 280, 7);
            if (isLightning || isBook) spawnParticles(this.x, this.z - this.jumpY, '#fde047', 10, 240, 5);
            return;
          }
        }
      }
      for (const prop of game.props) {
        if (prop.broken || this.hitIds.has(prop.id)) continue;
        if (Math.abs(prop.x - this.x) < 50 && Math.abs(prop.z - this.z) <= 42) {
          this.hitIds.add(prop.id);
          prop.hit(40);
        }
      }
      if (this.x < game.camX - 100 || this.x > game.camX + CANVAS_W + 100) {
        this.dead = true;
      }
    }

    draw(ctx) {
      // Ground shadow
      ctx.save();
      ctx.fillStyle = 'rgba(8, 5, 18, 0.45)';
      ctx.beginPath();
      ctx.ellipse(this.x, this.z + 2, 22, 7, 0, 0, Math.PI * 2);
      ctx.fill();

      const by = this.z - this.jumpY;

      if (this.style === 'book') {
        // Adailing's spinning colorful hardcover school textbook (matches ad_dashLightAttack!)
        const tailLen = 88;
        const tail = ctx.createLinearGradient(this.x, by, this.x - this.facing * tailLen, by);
        tail.addColorStop(0, 'rgba(52, 211, 153, 0.72)');
        tail.addColorStop(0.5, 'rgba(250, 204, 21, 0.42)');
        tail.addColorStop(1, 'rgba(56, 189, 248, 0)');
        ctx.fillStyle = tail;
        ctx.beginPath();
        ctx.moveTo(this.x, by - 16);
        ctx.lineTo(this.x - this.facing * tailLen, by);
        ctx.lineTo(this.x, by + 16);
        ctx.closePath();
        ctx.fill();

        ctx.translate(Math.round(this.x), Math.round(by));
        ctx.rotate(this.rot);
        // Book pages thickness edge
        ctx.fillStyle = '#f8fafc';
        ctx.strokeStyle = '#1e293b';
        ctx.lineWidth = 2.6;
        ctx.beginPath();
        ctx.roundRect(-20, -14, 40, 32, 4);
        ctx.fill();
        ctx.stroke();
        // Blue hardcover front with orange/yellow diagonal stripes (matching sprite!)
        ctx.fillStyle = '#38bdf8';
        ctx.beginPath();
        ctx.roundRect(-22, -18, 40, 30, 4);
        ctx.fill();
        ctx.fillStyle = '#f97316';
        ctx.fillRect(-10, -16, 12, 26);
        ctx.fillStyle = '#facc15';
        ctx.fillRect(4, -16, 10, 26);
        // Spine & crisp outline
        ctx.fillStyle = '#0284c7';
        ctx.fillRect(-22, -18, 7, 30);
        ctx.strokeStyle = '#1e293b';
        ctx.lineWidth = 2.8;
        ctx.beginPath();
        ctx.roundRect(-22, -18, 40, 30, 4);
        ctx.stroke();
        ctx.restore();
        return;
      }

      if (this.style === 'lightning') {
        // Red Panda's Golden-White Lightning Soccer Ball (matches rp_dashLightAttack sprite!)
        const tailLen = 112;
        const tail = ctx.createLinearGradient(this.x, by, this.x - this.facing * tailLen, by);
        tail.addColorStop(0, 'rgba(103, 232, 249, 0.92)');
        tail.addColorStop(0.35, 'rgba(56, 189, 248, 0.65)');
        tail.addColorStop(0.7, 'rgba(250, 204, 21, 0.35)');
        tail.addColorStop(1, 'rgba(56, 189, 248, 0)');
        ctx.fillStyle = tail;
        ctx.beginPath();
        ctx.moveTo(this.x, by - 22);
        ctx.lineTo(this.x - this.facing * tailLen, by);
        ctx.lineTo(this.x, by + 22);
        ctx.closePath();
        ctx.fill();

        // Crackling cyan & gold lightning bolts along the comet tail
        const phase = Math.floor(this.age * 24);
        for (let b = 0; b < 2; b++) {
          ctx.beginPath();
          const yOff = b === 0 ? -11 : 11;
          ctx.moveTo(this.x - this.facing * 8, by + yOff);
          for (let s = 1; s <= 4; s++) {
            const tx = this.x - this.facing * (8 + s * 22);
            const jag = (((phase + s * 3 + b * 7) % 3) - 1) * (10 - s * 1.4);
            ctx.lineTo(tx, by + yOff * (1 - s * 0.22) + jag);
          }
          ctx.strokeStyle = b === 0 ? '#67e8f9' : '#fde047';
          ctx.lineWidth = b === 0 ? 3 : 2.2;
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';
          ctx.stroke();
        }

        // Radiant cyan electric aura halo around the ball
        const halo = ctx.createRadialGradient(this.x, by, 14, this.x, by, 34);
        halo.addColorStop(0, 'rgba(103, 232, 249, 0.72)');
        halo.addColorStop(0.55, 'rgba(34, 211, 238, 0.36)');
        halo.addColorStop(1, 'rgba(34, 211, 238, 0)');
        ctx.fillStyle = halo;
        ctx.beginPath();
        ctx.arc(this.x, by, 34, 0, Math.PI * 2);
        ctx.fill();

        // Spinning Golden-White Soccer Ball
        const r = 20;
        ctx.translate(Math.round(this.x), Math.round(by));
        ctx.rotate(this.rot);

        const bodyGrad = ctx.createRadialGradient(-5, -5, 3, 0, 0, r);
        bodyGrad.addColorStop(0, '#ffffff');
        bodyGrad.addColorStop(0.6, '#fef9c3');
        bodyGrad.addColorStop(1, '#fde047');
        ctx.fillStyle = bodyGrad;
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.fill();

        // Clip inside ball for clean golden pentagon panels & seam lines
        ctx.save();
        ctx.beginPath();
        ctx.arc(0, 0, r - 1, 0, Math.PI * 2);
        ctx.clip();

        // Golden seam lines from center to outer pentagons
        ctx.strokeStyle = '#d97706';
        ctx.lineWidth = 1.6;
        for (let i = 0; i < 5; i++) {
          const a = (i / 5) * Math.PI * 2 - Math.PI / 2;
          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
          ctx.stroke();
        }

        const drawPentagon = (cx, cy, pr, rotOff) => {
          ctx.beginPath();
          for (let k = 0; k < 5; k++) {
            const a = (k / 5) * Math.PI * 2 + rotOff;
            const px = cx + Math.cos(a) * pr;
            const py = cy + Math.sin(a) * pr;
            if (k === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
          }
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
        };

        // Center golden pentagon + 5 surrounding golden pentagons
        ctx.fillStyle = '#f59e0b';
        ctx.strokeStyle = '#b45309';
        ctx.lineWidth = 1.3;
        drawPentagon(0, 0, 6.8, -Math.PI / 2);
        for (let i = 0; i < 5; i++) {
          const a = (i / 5) * Math.PI * 2 - Math.PI / 2;
          drawPentagon(Math.cos(a) * 16.5, Math.sin(a) * 16.5, 6.2, a + Math.PI);
        }
        ctx.restore();

        // Crisp golden outer border + cyan electric rim sheen
        ctx.lineWidth = 3.2;
        ctx.strokeStyle = '#d97706';
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.stroke();

        ctx.lineWidth = 1.6;
        ctx.strokeStyle = 'rgba(103, 232, 249, 0.85)';
        ctx.beginPath();
        ctx.arc(0, 0, r + 2.2, 0, Math.PI * 2);
        ctx.stroke();

        ctx.restore();
        return;
      }

      // Blazing purple gothic energy comet tail (Kuromi)
      const tail = ctx.createLinearGradient(this.x, by, this.x - this.facing * 95, by);
      tail.addColorStop(0, 'rgba(244, 114, 182, 0.9)');
      tail.addColorStop(0.5, 'rgba(168, 85, 247, 0.5)');
      tail.addColorStop(1, 'rgba(168, 85, 247, 0)');
      ctx.fillStyle = tail;
      ctx.beginPath();
      ctx.moveTo(this.x, by - 20);
      ctx.lineTo(this.x - this.facing * 95, by);
      ctx.lineTo(this.x, by + 20);
      ctx.closePath();
      ctx.fill();

      // Spinning Gothic Energy Soccer Ball
      ctx.translate(Math.round(this.x), Math.round(by));
      ctx.rotate(this.rot);
      ctx.lineWidth = 4;
      ctx.strokeStyle = '#0d0b14';
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(0, 0, 19, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      // Purple gothic pentagons
      ctx.fillStyle = '#9333ea';
      ctx.beginPath();
      ctx.arc(0, 0, 7, 0, Math.PI * 2);
      ctx.fill();
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        ctx.beginPath();
        ctx.arc(Math.cos(a) * 14, Math.sin(a) * 14, 4.5, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  // --------------------------------------------------------------------------
  // KUROMI GETSUGA TENSHO CRESCENT WAVE PROJECTILE (月牙天沖!!)
  // --------------------------------------------------------------------------
  class GetsugaWave {
    constructor(x, z, facing) {
      this.x = x;
      this.z = z;
      this.facing = facing;
      this.vx = facing * 660;
      this.life = 0.56;
      this.maxLife = 0.56;
      this.age = 0;
      this.hitsLeft = 5;
      this.hitIds = new Set();
      this.dead = false;
    }

    update(dt) {
      this.age += dt;
      this.life -= dt;
      if (this.life <= 0) { this.dead = true; return; }
      this.x += this.vx * dt;

      if (Math.random() < 0.85) {
        game.particles.push({
          x: this.x - this.facing * 12,
          y: this.z - 86 + (Math.random() - 0.5) * 96,
          vx: -this.facing * 120,
          vy: (Math.random() - 0.5) * 45,
          size: 4 + Math.random() * 4.5,
          color: Math.random() < 0.55 ? '#67e8f9' : '#ffffff',
          life: 0.18,
          maxLife: 0.18,
          gravity: 0,
        });
      }

      for (const e of game.enemies) {
        if (e.dead || this.hitIds.has(e.id)) continue;
        if (Math.abs(e.x - this.x) < 68 && Math.abs(e.z - this.z) <= 52) {
          this.hitIds.add(e.id);
          this.hitsLeft--;
          e.takeHit(34, this.facing, true, 350, '#67e8f9', '月牙天沖!!');
          sfx.playHit(true);
          game.hitstop = 0.04;
          addShake(7, 0.14);
          spawnParticles(e.x, e.z - 68, '#67e8f9', 10, 240, 5.5);
          if (this.hitsLeft <= 0) {
            this.dead = true;
            return;
          }
        }
      }
      for (const prop of game.props) {
        if (prop.broken || this.hitIds.has(prop.id)) continue;
        if (Math.abs(prop.x - this.x) < 60 && Math.abs(prop.z - this.z) <= 48) {
          this.hitIds.add(prop.id);
          prop.hit(45);
        }
      }
      if (this.x < game.camX - 120 || this.x > game.camX + CANVAS_W + 120) {
        this.dead = true;
      }
    }

    draw(ctx) {
      const t = this.life / this.maxLife;
      const alpha = Math.min(1, t * 2.4);
      const cy = this.z - 88;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(Math.round(this.x), Math.round(cy));
      ctx.scale(this.facing, 1);

      // Soft cyan energy trail
      const trail = ctx.createLinearGradient(16, 0, -92, 0);
      trail.addColorStop(0, 'rgba(103, 232, 249, 0.72)');
      trail.addColorStop(0.55, 'rgba(56, 189, 248, 0.35)');
      trail.addColorStop(1, 'rgba(56, 189, 248, 0)');
      ctx.fillStyle = trail;
      ctx.beginPath();
      ctx.moveTo(10, -76);
      ctx.quadraticCurveTo(48, 0, 10, 76);
      ctx.lineTo(-92, 34);
      ctx.lineTo(-92, -34);
      ctx.closePath();
      ctx.fill();

      // Outer icy-cyan glowing crescent blade
      ctx.shadowColor = '#38bdf8';
      ctx.shadowBlur = 18;
      ctx.fillStyle = '#38bdf8';
      ctx.beginPath();
      ctx.moveTo(-22, -82);
      ctx.quadraticCurveTo(64, 0, -22, 82);
      ctx.quadraticCurveTo(18, 0, -22, -82);
      ctx.closePath();
      ctx.fill();

      // Bright cyan-white inner crescent core
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#e0f2fe';
      ctx.beginPath();
      ctx.moveTo(-14, -74);
      ctx.quadraticCurveTo(54, 0, -14, 74);
      ctx.quadraticCurveTo(22, 0, -14, -74);
      ctx.closePath();
      ctx.fill();

      // Pure white razor edge highlight
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.moveTo(-4, -62);
      ctx.quadraticCurveTo(44, 0, -4, 62);
      ctx.quadraticCurveTo(26, 0, -4, -62);
      ctx.closePath();
      ctx.fill();

      // 4-point anime star glints on the crescent tips
      const drawStar = (sx, sy, sr) => {
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2;
          const r = i % 2 === 0 ? sr : sr * 0.28;
          const px = sx + Math.cos(a) * r;
          const py = sy + Math.sin(a) * r;
          if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.fill();
      };
      drawStar(22, -46, 11);
      drawStar(28, 38, 9);
      ctx.restore();
    }
  }

  // Enemy Ranged Attack Projectiles (Star, Water, Spore, Ghost Orb + 6 New Signature Projectiles!)
  class EnemyProjectile {
    constructor(x, z, facing, kind = 'star', dmg = 14, vz = 0, color = null, owner = null) {
      this.id = nextEntityId++;
      this.x = x;
      this.z = z;
      this.baseJumpY = kind === 'martial_chi' ? 78 : (kind === 'joey_boomerang' ? 72 : 66);
      this.jumpY = this.baseJumpY;
      this.facing = facing;
      this.owner = owner || null;
      this.returning = false;
      this.kind = kind; // star | water | spore | ghost_orb | bubblegum | holo_wave | zen_leaf | cactus_needle | cosmic_meteor | martial_chi | joey_boomerang
      this.color = color || (
        kind === 'bubblegum' ? '#f472b6'
          : (kind === 'holo_wave' ? '#38bdf8'
            : (kind === 'zen_leaf' ? '#4ade80'
              : (kind === 'cactus_needle' ? '#facc15'
                : (kind === 'cosmic_meteor' ? '#a855f7'
                  : (kind === 'joey_boomerang' ? '#fbbf24'
                    : (kind === 'martial_chi' ? '#facc15' : (kind === 'ghost_orb' ? '#c084fc' : null)))))))
      );
      this.dmg = dmg;
      const spdMap = {
        star: 445,
        water: 405,
        spore: 340,
        ghost_orb: 360,
        bubblegum: 295,
        holo_wave: 485,
        zen_leaf: 350,
        cactus_needle: 510,
        cosmic_meteor: 455,
        martial_chi: 525,
        joey_boomerang: 495,
      };
      this.vx = facing * (spdMap[kind] || 405);
      this.vz = vz;
      this.rot = 0;
      this.age = 0;
      this.life = kind === 'spore' ? 1.55 : (kind === 'bubblegum' ? 1.85 : (kind === 'joey_boomerang' ? 1.72 : 2.15));
      this.dead = false;
    }

    update(dt) {
      this.age += dt;
      this.life -= dt;
      if (this.life <= 0) {
        if (this.kind === 'bubblegum') {
          spawnParticles(this.x, this.z - this.jumpY, '#f472b6', 14, 190, 6);
        }
        this.dead = true;
        return;
      }

      if (this.kind === 'joey_boomerang') {
        // Baby Kangaroo Boomerang: decelerates to apex (~0.56s), then curves back to parent pouch!
        this.vx -= this.facing * 880 * dt;
        this.jumpY = this.baseJumpY + Math.sin(this.age * 11) * 16;
        if (this.age > 0.56) {
          this.returning = true;
          if (this.owner && !this.owner.dead) {
            const dzOwner = this.owner.z - this.z;
            this.z += Math.max(-130, Math.min(130, dzOwner * 3.5)) * dt;
            if (Math.hypot(this.owner.x - this.x, this.owner.z - this.z) < 42) {
              spawnParticles(this.owner.x, this.owner.z - 64, '#fde047', 6, 110, 4);
              this.dead = true;
              return;
            }
          }
        }
      }

      this.x += this.vx * dt;
      this.z = Math.max(Z_MIN, Math.min(Z_MAX, this.z + this.vz * dt));
      if (this.kind === 'bubblegum') {
        // Wavy floating bubblegum bob!
        this.jumpY = this.baseJumpY + Math.sin(this.age * 9) * 20;
      }
      this.rot += this.facing * dt * (this.kind === 'joey_boomerang' ? 20 : (this.kind === 'star' || this.kind === 'zen_leaf' ? 14 : (this.kind === 'spore' ? 10 : 9)));

      const pCol = this.color || (this.kind === 'star' ? '#fb7185' : (this.kind === 'spore' ? '#fb923c' : '#38bdf8'));
      if (Math.random() < 0.55) {
        spawnParticles(this.x - this.facing * 12, this.z - this.jumpY, pCol, 1, 75, 4);
      }

      const hitR = this.kind === 'martial_chi' ? 58 : (this.kind === 'bubblegum' ? 46 : 42);
      const p = game.player;
      if (
        p &&
        Math.abs(p.x - this.x) < hitR &&
        Math.abs(p.z - this.z) <= (this.kind === 'martial_chi' ? 38 : 30) &&
        p.jumpY < (this.kind === 'martial_chi' ? 88 : 58)
      ) {
        const knockDir = this.vx >= 0 ? 1 : -1;
        p.takeDamage(this.dmg, knockDir, this.kind === 'martial_chi' || this.kind === 'bubblegum');
        spawnSlashSparks(this.x, this.z - this.jumpY, knockDir, pCol);
        if (this.kind === 'bubblegum') {
          spawnParticles(this.x, this.z - this.jumpY, '#f472b6', 16, 210, 6);
        }
        if (this.kind !== 'joey_boomerang') {
          this.dead = true;
          return;
        }
        // Joey boomerang bounces right back to parent pouch after bonking hero!
        this.vx = -this.facing * 420;
        this.age = Math.max(this.age, 0.62);
      }

      if (this.x < game.camX - 160 || this.x > game.camX + CANVAS_W + 160) {
        this.dead = true;
      }
    }

    draw(ctx) {
      if (this.dead) return;
      ctx.save();

      // Ground shadow
      ctx.fillStyle = 'rgba(8, 5, 18, 0.4)';
      ctx.beginPath();
      ctx.ellipse(this.x, this.z + 2, this.kind === 'martial_chi' ? 28 : 18, 6, 0, 0, Math.PI * 2);
      ctx.fill();

      const py = this.z - this.jumpY;

      if (this.kind === 'joey_boomerang') {
        // Spinning Curled-Up Baby Kangaroo Joey Boomerang (小袋鼠回力球!)
        ctx.translate(Math.round(this.x), Math.round(py));
        ctx.strokeStyle = 'rgba(253, 224, 71, 0.65)';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(0, 0, 24, this.rot, this.rot + Math.PI * 1.35);
        ctx.stroke();

        ctx.rotate(this.rot);
        const coatCol = this.color || '#e09148';
        // Cute kangaroo ears
        ctx.fillStyle = coatCol;
        ctx.strokeStyle = '#3b1d0f';
        ctx.lineWidth = 2.6;
        for (const ex of [-7, 6]) {
          ctx.beginPath();
          ctx.ellipse(ex, -19, 5, 11, ex < 0 ? -0.22 : 0.22, 0, Math.PI * 2);
          ctx.fill(); ctx.stroke();
          ctx.fillStyle = '#fda4af';
          ctx.beginPath();
          ctx.ellipse(ex, -18, 2.5, 6.5, ex < 0 ? -0.22 : 0.22, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = coatCol;
        }
        // Round curled baby body
        ctx.beginPath();
        ctx.arc(0, 0, 16, 0, Math.PI * 2);
        ctx.fill(); ctx.stroke();
        // Cream belly patch
        ctx.fillStyle = '#fde6c4';
        ctx.beginPath();
        ctx.ellipse(2, 4, 10, 8, 0, 0, Math.PI * 2);
        ctx.fill();
        // Determined baby eyes & blush
        ctx.fillStyle = '#1e120c';
        ctx.beginPath(); ctx.arc(-4, -3, 2.3, 0, Math.PI * 2); ctx.arc(5, -3, 2.3, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#fb7185';
        ctx.beginPath(); ctx.arc(-8, 1, 2.6, 0, Math.PI * 2); ctx.arc(9, 1, 2.6, 0, Math.PI * 2); ctx.fill();
      } else if (this.kind === 'martial_chi') {
        // Giant Golden-Ink Tai-Chi Crescent Energy Wave (冬花武聖大宗師 黃金氣功波!)
        ctx.translate(Math.round(this.x), Math.round(py));
        ctx.scale(this.facing, 1);
        const aura = ctx.createRadialGradient(0, 0, 8, 0, 0, 56);
        aura.addColorStop(0, 'rgba(254, 249, 195, 0.92)');
        aura.addColorStop(0.55, 'rgba(250, 204, 21, 0.55)');
        aura.addColorStop(1, 'rgba(234, 88, 12, 0)');
        ctx.fillStyle = aura;
        ctx.beginPath(); ctx.arc(0, 0, 56, 0, Math.PI * 2); ctx.fill();

        const cg = ctx.createLinearGradient(-22, -48, 30, 48);
        cg.addColorStop(0, '#fef9c3');
        cg.addColorStop(0.5, '#facc15');
        cg.addColorStop(1, '#ea580c');
        ctx.fillStyle = cg;
        ctx.strokeStyle = '#1a1026';
        ctx.lineWidth = 3.5;
        ctx.beginPath();
        ctx.moveTo(-18, -48);
        ctx.quadraticCurveTo(42, 0, -18, 48);
        ctx.quadraticCurveTo(14, 0, -18, -48);
        ctx.closePath();
        ctx.fill(); ctx.stroke();

        // Calligraphy 「武」 stamp floating in center of wave!
        ctx.fillStyle = '#1a1026';
        ctx.font = '900 22px "Noto Sans TC", serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('武', 6, 0);
      } else if (this.kind === 'bubblegum') {
        // Giant Glossy Pink Bubblegum Bomb (龐克滑板斑馬 泡泡糖炸彈!)
        const pulse = 1 + Math.sin(this.age * 16) * 0.10;
        ctx.translate(Math.round(this.x), Math.round(py));
        const g = ctx.createRadialGradient(-6, -6, 3, 0, 0, 22 * pulse);
        g.addColorStop(0, '#fbcfe8');
        g.addColorStop(0.55, '#f472b6');
        g.addColorStop(1, '#db2777');
        ctx.fillStyle = g;
        ctx.strokeStyle = '#3a2449';
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(0, 0, 19 * pulse, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,0.78)';
        ctx.beginPath(); ctx.ellipse(-6, -6, 6, 3.5, -0.5, 0, Math.PI * 2); ctx.fill();
      } else if (this.kind === 'holo_wave') {
        // Piercing Cyan-Purple Holographic Digital Wave (電競無尾熊 全息衝擊波!)
        ctx.translate(Math.round(this.x), Math.round(py));
        ctx.scale(this.facing, 1);
        ctx.strokeStyle = '#c084fc';
        ctx.lineWidth = 8;
        ctx.beginPath(); ctx.arc(-10, 0, 26, -0.95, 0.95); ctx.stroke();
        ctx.strokeStyle = '#38bdf8';
        ctx.lineWidth = 5;
        ctx.beginPath(); ctx.arc(-4, 0, 28, -0.9, 0.9); ctx.stroke();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2.2;
        ctx.beginPath(); ctx.arc(0, 0, 26, -0.75, 0.75); ctx.stroke();
      } else if (this.kind === 'zen_leaf') {
        // Spinning Emerald Zen Grass Leaf Blade (佛系水豚君 淡定飛葉!)
        ctx.translate(Math.round(this.x), Math.round(py));
        ctx.rotate(this.rot);
        ctx.fillStyle = '#4ade80';
        ctx.strokeStyle = '#14532d';
        ctx.lineWidth = 2.6;
        ctx.beginPath();
        ctx.ellipse(0, 0, 17, 7.5, 0, 0, Math.PI * 2);
        ctx.fill(); ctx.stroke();
        ctx.strokeStyle = '#dcfce7';
        ctx.lineWidth = 1.6;
        ctx.beginPath(); ctx.moveTo(-12, 0); ctx.lineTo(12, 0); ctx.stroke();
      } else if (this.kind === 'cactus_needle') {
        // High-Speed Golden Cactus Spike (針刺仙人掌 萬針齊射!)
        ctx.translate(Math.round(this.x), Math.round(py));
        ctx.scale(this.facing, 1);
        ctx.fillStyle = '#fef08a';
        ctx.strokeStyle = '#365314';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(22, 0);
        ctx.lineTo(-14, -7);
        ctx.lineTo(-8, 0);
        ctx.lineTo(-14, 7);
        ctx.closePath();
        ctx.fill(); ctx.stroke();
      } else if (this.kind === 'cosmic_meteor') {
        // Blazing Cosmic Shooting Meteor Star (星空巫師幽靈 流星雨彈幕!)
        const trail = ctx.createLinearGradient(this.x, py, this.x - this.facing * 90, py);
        trail.addColorStop(0, '#38bdf8');
        trail.addColorStop(0.45, 'rgba(168, 85, 247, 0.75)');
        trail.addColorStop(1, 'rgba(88, 28, 135, 0)');
        ctx.fillStyle = trail;
        ctx.beginPath();
        ctx.moveTo(this.x, py - 13);
        ctx.lineTo(this.x - this.facing * 90, py);
        ctx.lineTo(this.x, py + 13);
        ctx.closePath();
        ctx.fill();
        ctx.translate(Math.round(this.x), Math.round(py));
        ctx.rotate(this.rot);
        ctx.fillStyle = '#fef08a';
        ctx.strokeStyle = '#312e81';
        ctx.lineWidth = 2.6;
        ctx.beginPath();
        for (let i = 0; i < 10; i++) {
          const r = i % 2 === 0 ? 15 : 6.5;
          const a = (i * Math.PI) / 5;
          if (i === 0) ctx.moveTo(Math.cos(a)*r, Math.sin(a)*r);
          else ctx.lineTo(Math.cos(a)*r, Math.sin(a)*r);
        }
        ctx.closePath();
        ctx.fill(); ctx.stroke();
      } else if (this.kind === 'ghost_orb') {
        // Spectral Ghost Will-o'-Wisp Fireball (鬼火彈!)
        const orbCol = this.color || '#c084fc';
        const trail = ctx.createLinearGradient(this.x, py, this.x - this.facing * 82, py);
        trail.addColorStop(0, orbCol);
        trail.addColorStop(0.55, 'rgba(168, 85, 247, 0.42)');
        trail.addColorStop(1, 'rgba(168, 85, 247, 0)');
        ctx.fillStyle = trail;
        ctx.beginPath();
        ctx.moveTo(this.x, py - 16);
        ctx.quadraticCurveTo(this.x - this.facing * 42, py - 10 + Math.sin(game.time * 24) * 6, this.x - this.facing * 82, py);
        ctx.quadraticCurveTo(this.x - this.facing * 42, py + 10 + Math.cos(game.time * 24) * 6, this.x, py + 16);
        ctx.closePath();
        ctx.fill();

        ctx.translate(Math.round(this.x), Math.round(py));
        const glow = ctx.createRadialGradient(0, 0, 3, 0, 0, 26);
        glow.addColorStop(0, '#ffffff');
        glow.addColorStop(0.45, orbCol);
        glow.addColorStop(1, 'rgba(88, 28, 135, 0)');
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(0, 0, 26, 0, Math.PI * 2);
        ctx.fill();

        ctx.lineWidth = 3;
        ctx.strokeStyle = '#1e1035';
        ctx.fillStyle = orbCol;
        ctx.beginPath();
        ctx.arc(0, 0, 14, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(this.facing * 3, -3, 5.5, 0, Math.PI * 2);
        ctx.fill();
      } else if (this.kind === 'spore') {
        // Spinning Mini Red-Spotted Mushroom Spore Projectile!
        const trail = ctx.createLinearGradient(this.x, py, this.x - this.facing * 60, py);
        trail.addColorStop(0, 'rgba(249, 115, 22, 0.85)');
        trail.addColorStop(0.55, 'rgba(251, 191, 36, 0.4)');
        trail.addColorStop(1, 'rgba(249, 115, 22, 0)');
        ctx.fillStyle = trail;
        ctx.beginPath();
        ctx.moveTo(this.x, py - 12);
        ctx.lineTo(this.x - this.facing * 60, py);
        ctx.lineTo(this.x, py + 12);
        ctx.closePath();
        ctx.fill();

        ctx.translate(Math.round(this.x), Math.round(py));
        ctx.rotate(this.rot);
        ctx.lineWidth = 3;
        ctx.strokeStyle = '#3b1c0a';
        // Cream stem
        ctx.fillStyle = '#fef3c7';
        ctx.beginPath();
        ctx.roundRect(-6, 1, 12, 10, 4);
        ctx.fill();
        ctx.stroke();
        // Red spotted cap
        ctx.fillStyle = '#ef4444';
        ctx.beginPath();
        ctx.arc(0, 1, 14, Math.PI, 0, false);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#fef3c7';
        ctx.beginPath();
        ctx.arc(-5, -5, 3, 0, Math.PI * 2);
        ctx.arc(5, -6, 2.6, 0, Math.PI * 2);
        ctx.fill();
      } else if (this.kind === 'star') {
        // Cosmic psychic trail
        const trail = ctx.createLinearGradient(this.x, py, this.x - this.facing * 72, py);
        trail.addColorStop(0, 'rgba(244, 63, 94, 0.85)');
        trail.addColorStop(0.5, 'rgba(250, 204, 21, 0.45)');
        trail.addColorStop(1, 'rgba(168, 85, 247, 0)');
        ctx.fillStyle = trail;
        ctx.beginPath();
        ctx.moveTo(this.x, py - 14);
        ctx.lineTo(this.x - this.facing * 72, py);
        ctx.lineTo(this.x, py + 14);
        ctx.closePath();
        ctx.fill();

        // Spinning 5-point crimson-gold cosmic star
        ctx.translate(Math.round(this.x), Math.round(py));
        ctx.rotate(this.rot);
        ctx.lineWidth = 3.5;
        ctx.strokeStyle = '#0d0b14';
        ctx.fillStyle = '#facc15';
        ctx.beginPath();
        for (let i = 0; i < 10; i++) {
          const r = i % 2 === 0 ? 20 : 9;
          const a = (i * Math.PI) / 5 - Math.PI / 2;
          const sx = Math.cos(a) * r;
          const sy = Math.sin(a) * r;
          if (i === 0) ctx.moveTo(sx, sy);
          else ctx.lineTo(sx, sy);
        }
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        // Glowing crimson core gem
        ctx.fillStyle = '#f43f5e';
        ctx.beginPath();
        ctx.arc(0, 0, 6.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(-2, -2, 2.2, 0, Math.PI * 2);
        ctx.fill();
      } else {
        // Aqua Hydro Bubble Bolt with stream tail
        const trail = ctx.createLinearGradient(this.x, py, this.x - this.facing * 78, py);
        trail.addColorStop(0, 'rgba(56, 189, 248, 0.9)');
        trail.addColorStop(0.55, 'rgba(14, 165, 233, 0.45)');
        trail.addColorStop(1, 'rgba(56, 189, 248, 0)');
        ctx.fillStyle = trail;
        ctx.beginPath();
        ctx.moveTo(this.x, py - 15);
        ctx.lineTo(this.x - this.facing * 78, py);
        ctx.lineTo(this.x, py + 15);
        ctx.closePath();
        ctx.fill();

        ctx.translate(Math.round(this.x), Math.round(py));
        ctx.scale(this.facing, 1);
        ctx.lineWidth = 3.5;
        ctx.strokeStyle = '#0d0b14';
        const g = ctx.createRadialGradient(-4, -5, 2, 0, 0, 18);
        g.addColorStop(0, '#e0f2fe');
        g.addColorStop(0.5, '#38bdf8');
        g.addColorStop(1, '#0284c7');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.ellipse(0, 0, 19, 14, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        // Crisp water bubble specular shine
        ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
        ctx.beginPath();
        ctx.ellipse(-5, -5, 6, 3.5, -0.35, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.restore();
    }
  }

  function spawnParticles(x, y, color, count = 10, speed = 220, size = 6) {
    for (let i = 0; i < count; i++) {
      const ang = Math.random() * Math.PI * 2;
      const sp = (0.35 + Math.random() * 0.85) * speed;
      game.particles.push({
        x, y,
        vx: Math.cos(ang) * sp,
        vy: Math.sin(ang) * sp - 40,
        size: size * (0.6 + Math.random() * 0.8),
        color,
        life: 0.25 + Math.random() * 0.28,
        maxLife: 0.52,
        gravity: 360,
      });
    }
  }

  function spawnSlashSparks(x, y, facing, color = '#f472b6') {
    for (let i = 0; i < 14; i++) {
      const ang = (Math.random() - 0.5) * 1.6 + (facing === 1 ? 0 : Math.PI);
      const sp = 160 + Math.random() * 340;
      game.particles.push({
        x, y,
        vx: Math.cos(ang) * sp,
        vy: Math.sin(ang) * sp,
        size: 4 + Math.random() * 6,
        color: i % 3 === 0 ? '#ffffff' : color,
        life: 0.18 + Math.random() * 0.22,
        maxLife: 0.4,
        gravity: 120,
        star: i % 4 === 0,
      });
    }
  }

  // --------------------------------------------------------------------------
  // PLAYER CLASS (1:1 Native Sprite Scale, Full Multi-Frame Animations)
  // --------------------------------------------------------------------------
  class Player {
    constructor() {
      this.hero = getSelectedHero();
      this.x = 180;
      this.z = 428;
      this.jumpY = 0;
      this.vz = 0;
      this.vy = 0;
      this.vx = 0;
      this.facing = 1;

      const initP = StudioState.getCombatParams(this.hero.id);
      this.hp = initP.hp || 140;
      this.maxHp = initP.hp || 140;
      this.displayHp = this.maxHp;
      this.energy = 100; // Start full so user can fire Special right away!
      this.maxEnergy = 100;
      this.lives = 3;
      this.armorShieldCount = initP.armorHits || 3;

      this.state = 'idle'; // idle | walk | run | dash | jump | light1 | light2 | heavy | dashAttack | airAttack | special | custom | hurt
      this.animTimer = 0;
      this.frame = 0;
      this.stateTime = 0;
      this.isRunning = false;
      this.activeCustomAction = null;

      this.comboQueued = null; // null | 'light' | 'heavy'
      this.hitIds = new Set();
      this.hitIdsStage2 = new Set();
      this.invuln = 0;
      this.hurtFlash = 0;
      this.dustTimer = 0;
      this.dashCd = 0;

      // Special 10-hit tracking
      this.cannonTicks = 0;
      this.cannonTickTimer = 0;
    }

    getCombatCfg() {
      return StudioState.getCombatParams(this.hero ? this.hero.id : 'kuromi');
    }

    resolveSheet(slot) {
      const h = this.hero || HERO_ROSTER[0];
      const primary = h.sheets && h.sheets[slot];
      if (primary && SpriteBank.sheets[primary]) return primary;
      const fb = h.fallbacks && h.fallbacks[slot];
      if (fb && SpriteBank.sheets[fb]) return fb;
      if (SpriteBank.sheets[slot]) return slot;
      return (h.sheets && h.sheets.idle) || 'idle';
    }

    startLightAttack(step = 1) {
      this.isRunning = false;
      this.state = step === 1 ? 'light1' : (step === 2 ? 'light2' : 'light3');
      this.stateTime = 0;
      this.comboQueued = null;
      this.hitIds.clear();
      this.frame = step === 1 ? 0 : (step === 2 ? 3 : 6);
      sfx.playSwing(step);
      this.x += this.facing * (step === 3 ? 12 : 7);
      if (step === 1) {
        triggerActionFx(this, this.hero.id === 'redpanda' ? 'rp_lightAttack' : 'lightAttack', {});
      }
    }

    startHeavyAttack() {
      const isRp = this.hero.id === 'redpanda';
      const isAd = this.hero.id === 'adailing';
      this.isRunning = false;
      this.state = 'heavy';
      this.stateTime = 0;
      this.jumpY = 0;
      this.vy = 0;
      this.comboQueued = null;
      this.getsugaLaunched = false;
      this.hitIds.clear();
      this.frame = 0;
      sfx.playSwing(3);
      this.x += this.facing * 18;
      triggerActionFx(this, isRp ? 'rp_attack' : (isAd ? 'ad_attack' : 'heavyAttack'), {
        x: this.x - this.facing * 18,
        y: this.z - (isRp ? 206 : 196),
        text: isAd ? '字典壓頂!!' : this.hero.heavyShout,
        subText: isAd ? 'DICTIONARY SLAM!' : this.hero.heavySub,
        style: 'shout',
        fillA: isRp ? '#fde047' : (isAd ? '#fef08a' : '#67e8f9'),
        fillB: isRp ? '#ea580c' : (isAd ? '#16a34a' : '#2563eb'),
        rx: isRp ? 98 : 102,
        ry: 44,
        dur: isRp ? 0.78 : 0.66,
        particles: isRp ? { color: '#fde047', count: 12 } : (isAd ? { color: '#fef08a', count: 12 } : { color: '#67e8f9', count: 10 }),
      });
    }

    /**
     * 衝刺輕攻擊：浪子踢球 / 閃電踢球 (Dash Light Attack — Running + Light Attack!)
     */
    startDashLightAttack() {
      const isRp = this.hero.id === 'redpanda';
      this.isRunning = false;
      this.state = 'dashLightAttack';
      this.stateTime = 0;
      this.frame = 0;
      this.ballLaunched = false;
      this.hitIds.clear();
      sfx.playSwing(2);
      triggerActionFx(this, isRp ? 'rp_dashLightAttack' : 'dashLightAttack', {
        x: this.x - this.facing * 20,
        y: this.z - 198,
        text: this.hero.dashLightShout,
        subText: this.hero.dashLightSub,
        style: 'shout',
        fillA: isRp ? '#67e8f9' : this.hero.accentLight,
        fillB: isRp ? '#2563eb' : this.hero.accentDark,
        rx: 96,
        ry: 44,
      });
    }

    /**
     * 衝刺重攻擊：星杖衝刺斬 / 赤焰衝刺撞擊 (Dash Heavy Attack — Running + Heavy Attack!)
     */
    startDashAttack() {
      const isRp = this.hero.id === 'redpanda';
      this.isRunning = false;
      this.state = 'dashAttack';
      this.stateTime = 0;
      this.frame = 0;
      this.dashImpactDone = false;
      this.hitIds.clear();
      this.hitIdsStage2.clear();
      sfx.playSwing(3);
      triggerActionFx(this, isRp ? 'rp_dashAttack' : 'dashAttack', {
        x: this.x - this.facing * 20,
        y: this.z - 198,
        text: this.hero.dashHeavyShout,
        subText: this.hero.dashHeavySub,
        style: 'shout',
        fillA: '#fde047',
        fillB: this.hero.accent,
        rx: 108,
        ry: 46,
      });
    }

    /**
     * 特殊招式：龍捲旋風腳 (Tornado Hurricane Kick — Fast ↓ then ↑!)
     * Multi-hit rising cyclone kick that launches enemies high into the air for follow-up juggles!
     */
    startTornadoKick() {
      const isRp = this.hero.id === 'redpanda';
      this.isRunning = false;
      this.state = 'tornadoKick';
      this.stateTime = 0;
      this.frame = 0;
      this.tornadoCd = 0.55;
      this.invuln = Math.max(this.invuln, 0.38);
      this.hitIds.clear();
      this.hitIdsStage2.clear();
      this.hitIdsStage3 = new Set();
      sfx.playSwing(3);
      if (typeof GamepadManager !== 'undefined') GamepadManager.rumble(0.45, 0.35, 180);
      const colA = isRp ? '#fde047' : '#e879f9';
      const colB = isRp ? '#ea580c' : '#7e22ce';
      triggerActionFx(this, isRp ? 'rp_tornadoKick' : 'tornadoKick', {
        x: this.x - this.facing * 12,
        y: this.z - 210,
        text: this.hero.tornadoShout || '龍捲旋風腳!!',
        subText: this.hero.tornadoSub || 'TORNADO HURRICANE KICK!!',
        style: 'shout',
        fillA: colA,
        fillB: colB,
        rx: 122,
        ry: 48,
        dur: 0.72,
        particles: { color: colA, count: 14 },
      });
    }

    startDash(dir) {
      if (this.dashCd > 0) return;
      if (dir !== 0) this.facing = dir;
      const isRp = this.hero.id === 'redpanda';
      this.isRunning = false;
      this.state = 'dash';
      this.stateTime = 0;
      this.frame = 0;
      this.dashCd = 0.48;
      this.invuln = Math.max(this.invuln, 0.28);
      this.hitIds.clear();
      sfx.playDash();
      if (typeof GamepadManager !== 'undefined') GamepadManager.rumble(0.15, 0.25, 75);
      // Shout 「閃身步!!」 in a crisp American comic action callout bubble!
      triggerActionFx(this, isRp ? 'rp_dash' : 'dash', {
        x: this.x - this.facing * 18,
        y: this.z - 186,
        text: '閃身步!!',
        subText: 'FLASH STEP!',
        style: 'shout',
        fillA: '#67e8f9',
        fillB: '#6366f1',
        rx: 84,
        ry: 40,
        dur: 0.56,
      });
    }

    startCustomAction(act) {
      this.isRunning = false;
      this.state = 'custom';
      this.activeCustomAction = act;
      this.stateTime = 0;
      this.frame = 0;
      this.hitIds.clear();
      sfx.playSwing(2);
      if (act) triggerActionFx(this, act.sheetKey || act.id, {});
    }

    startSpecial() {
      if (this.energy < 40) {
        addFloatText(this.x, this.z - 165, '能量不足!', '#fbbf24', 18);
        return;
      }
      const isRp = this.hero.id === 'redpanda';
      this.isRunning = false;
      this.energy = Math.max(0, this.energy - 50);
      this.state = 'special';
      this.stateTime = 0;
      this.frame = 0;
      this.invuln = 1.48;
      this.cannonTicks = 0;
      this.cannonTickTimer = 0;
      this.cannonImpactDone = false;
      this.hitIds.clear();
      sfx.playCharge();
      if (typeof GamepadManager !== 'undefined') GamepadManager.rumble(0.75, 0.5, 260);
      triggerActionFx(this, isRp ? 'rp_special' : 'special', {
        x: this.x + this.facing * 40,
        y: this.z - 210,
        text: this.hero.specialShout,
        subText: this.hero.specialSub,
        style: 'super',
        fillA: '#fde047',
        fillB: isRp ? '#ea580c' : '#e11d48',
        rx: 142,
        ry: 56,
        dur: 0.92,
        shakeAmp: 6,
        shakeDur: 0.25,
      });
    }

    takeDamage(dmg, knockDir, heavy = false) {
      if (this.invuln > 0 || this.state === 'special' || this.state === 'dash') return;
      const pCfg = this.getCombatCfg();
      this.hp = Math.max(0, this.hp - dmg);
      this.energy = Math.min(this.maxEnergy, this.energy + 8);
      this.hurtFlash = 0.22;
      this.invuln = heavy ? 1.15 : 0.72;

      const isAttacking = ['light1', 'light2', 'light3', 'heavy', 'dashLightAttack', 'dashAttack', 'tornadoKick', 'airAttack', 'custom'].includes(this.state);
      let armored = false;
      if (this.hp > 0) {
        if (pCfg.superArmor === 'always') {
          armored = true;
        } else if (pCfg.superArmor === 'attack' && isAttacking) {
          armored = true;
        } else if (pCfg.superArmor === 'hits') {
          if (this.armorShieldCount > 1) {
            this.armorShieldCount--;
            armored = true;
          } else {
            this.armorShieldCount = pCfg.armorHits || 3;
          }
        }
      }

      if (!armored && pCfg.flinchOnHit !== false) {
        this.isRunning = false;
        this.state = 'hurt';
        this.stateTime = 0;
        if (pCfg.knockbackMode !== 'immune') {
          this.vx = knockDir * (heavy ? 260 : 140) * (pCfg.knockbackMode === 'resist' ? 0.45 : 1);
          if (heavy && pCfg.knockbackMode === 'normal') {
            this.vy = 260;
          }
        }
        game.combo = 0;
      } else if (armored && this.hp > 0) {
        addFloatText(this.x, this.z - 168, '🛡 霸體!', '#fde047', 18);
      }

      sfx.playPlayerHurt();
      addShake(heavy ? 10 : 6, 0.2);
      if (typeof GamepadManager !== 'undefined') GamepadManager.rumble(heavy ? 0.72 : 0.35, 0.42, heavy ? 180 : 100);
      addFloatText(this.x, this.z - 140, `-${dmg}`, '#ff4d6d', 22);
      spawnParticles(this.x, this.z - 80, '#ff4d6d', 10, 220, 6);

      if (this.hp <= 0) {
        this.lives--;
        if (this.lives > 0) {
          this.hp = this.maxHp;
          this.displayHp = this.maxHp;
          this.energy = this.maxEnergy;
          this.armorShieldCount = pCfg.armorHits || 3;
          this.invuln = 2.2;
          addFloatText(this.x, this.z - 190, `1UP 復活! 剩餘生命 ${this.lives}`, '#4ade80', 22);
          spawnParticles(this.x, this.z - 90, '#f472b6', 24, 300, 7);
        } else {
          game.state = 'gameover';
        }
      }
    }

    update(dt) {
      this.displayHp += (this.hp - this.displayHp) * Math.min(1, dt * 8);
      this.energy = Math.min(this.maxEnergy, this.energy + dt * 2.8);
      if (this.invuln > 0) this.invuln -= dt;
      if (this.hurtFlash > 0) this.hurtFlash -= dt;
      if (this.dashCd > 0) this.dashCd -= dt;
      if (this.tornadoCd > 0) this.tornadoCd -= dt;

      const kbMoveX = (keys.ArrowRight || keys.KeyD ? 1 : 0) - (keys.ArrowLeft || keys.KeyA ? 1 : 0);
      const kbMoveZ = (keys.ArrowDown || keys.KeyS ? 1 : 0) - (keys.ArrowUp || keys.KeyW ? 1 : 0);
      const gpMoveX = (typeof GamepadManager !== 'undefined') ? GamepadManager.moveX : 0;
      const gpMoveZ = (typeof GamepadManager !== 'undefined') ? GamepadManager.moveZ : 0;
      const moveX = Math.max(-1, Math.min(1, kbMoveX + gpMoveX));
      const moveZ = Math.max(-1, Math.min(1, kbMoveZ + gpMoveZ));
      const wantLight = isActionJustPressed('lightAttack');
      const wantHeavy = isActionJustPressed('heavyAttack');
      const wantSpecial = isActionJustPressed('special');
      const wantJump = isActionJustPressed('jump');
      const wantDash = isActionJustPressed('dash');
      // Both heroes trigger 龍捲旋風腳 via Up + Heavy Attack (↑ + 重攻擊)!
      const wantTornado = wantHeavy && (moveZ < -0.35);

      // Check double-tap AA / DD (or Gamepad Hold-to-Run LB/L1!) -> enter Running mode!
      if (doubleTapRunTrigger !== 0) {
        this.isRunning = true;
        this.facing = doubleTapRunTrigger;
        doubleTapRunTrigger = 0;
      } else if (typeof GamepadManager !== 'undefined' && GamepadManager.runHeld && Math.abs(moveX) > 0.25) {
        this.isRunning = true;
      }

      // Check custom user-added actions
      let triggeredCustom = null;
      for (const act of StudioState.getHero().actions) {
        if (act.custom && act.key && justPressed[act.key] && SpriteBank.sheets[act.sheetKey]) {
          triggeredCustom = act;
          break;
        }
      }

      // Vertical Jump Physics (skip gravity override during tornadoKick & Red Panda Shoryuken rising flight curves)
      const inShoryukenArc = this.state === 'heavy' && this.hero.id === 'redpanda';
      if (this.state !== 'tornadoKick' && !inShoryukenArc && (this.jumpY > 0 || this.vy > 0)) {
        this.jumpY += this.vy * dt;
        this.vy -= 1350 * dt;
        if (this.jumpY <= 0) {
          this.jumpY = 0;
          this.vy = 0;
          spawnParticles(this.x, this.z, '#cbd5e1', 5, 80, 4);
          if (this.state === 'jump' || this.state === 'airAttack') {
            this.state = 'idle';
          }
        }
      }

      // --- STATE MACHINE ---
      if (this.state === 'hurt') {
        this.stateTime += dt;
        const hurtSheet = SpriteBank.sheets[this.resolveSheet('hurt')];
        const fc = hurtSheet ? hurtSheet.frameCount : 10;
        const fps = StudioState.getFps(this.hero.id === 'redpanda' ? 'rp_hurt' : 'hurt', 15);
        const totalDur = (fc / fps) * (this.getCombatCfg().hitstunMult || 1.0);
        this.frame = Math.min(fc - 1, Math.floor((this.stateTime / totalDur) * fc));
        this.x += this.vx * dt;
        this.vx *= Math.pow(this.stateTime < totalDur * 0.5 ? 0.08 : 0.01, dt);
        if (this.stateTime >= totalDur && this.jumpY === 0) {
          this.state = 'idle';
          this.animTimer = 0;
        }
      } else if (this.state === 'special') {
        this.updateSpecial(dt);
      } else if (this.state === 'tornadoKick') {
        this.updateTornadoKick(dt, wantSpecial);
      } else if (this.state === 'dash') {
        this.updateDash(dt, wantLight, wantHeavy, wantSpecial, wantTornado);
      } else if (this.state === 'dashLightAttack') {
        this.updateDashLightAttack(dt, wantSpecial);
      } else if (this.state === 'dashAttack') {
        this.updateDashAttack(dt, wantSpecial);
      } else if (this.state === 'custom') {
        this.updateCustomAction(dt);
      } else if (this.state === 'light1' || this.state === 'light2' || this.state === 'light3' || this.state === 'heavy') {
        if (wantTornado && this.jumpY === 0 && (!this.tornadoCd || this.tornadoCd <= 0)) {
          this.startTornadoKick();
        } else {
          this.updateMeleeCombo(dt, wantLight, wantHeavy, wantSpecial);
        }
      } else if (this.state === 'airAttack') {
        this.stateTime += dt;
        this.x += moveX * 260 * dt;
        this.z += moveZ * 120 * dt;
        const atkFc = SpriteBank.getFrameCount(this.resolveSheet('attack'), 10);
        this.frame = this.stateTime < 0.12 ? Math.floor(atkFc * 0.3) : Math.floor(atkFc * 0.5);
        if (this.stateTime >= 0.05 && this.stateTime <= 0.22) {
          this.performMeleeHitbox(135, 22, false, 150);
        }
        if (this.stateTime >= 0.28 && this.jumpY > 0) {
          this.state = 'jump';
        }
      } else {
        // Free Movement (idle / walk / run / jump)
        if (wantSpecial && this.jumpY === 0) {
          this.startSpecial();
        } else if (wantTornado && this.jumpY === 0 && (!this.tornadoCd || this.tornadoCd <= 0)) {
          this.startTornadoKick();
        } else if (wantDash && this.jumpY === 0 && this.dashCd <= 0) {
          this.startDash(moveX !== 0 ? moveX : this.facing);
        } else if (triggeredCustom && this.jumpY === 0) {
          this.startCustomAction(triggeredCustom);
        } else if (wantHeavy) {
          if (this.jumpY > 0) {
            this.state = 'airAttack';
            this.stateTime = 0;
            this.hitIds.clear();
            sfx.playSwing(3);
          } else if (this.isRunning || this.state === 'run') {
            this.startDashAttack();
          } else {
            this.startHeavyAttack();
          }
        } else if (wantLight) {
          if (this.jumpY > 0) {
            this.state = 'airAttack';
            this.stateTime = 0;
            this.hitIds.clear();
            sfx.playSwing(2);
          } else if (this.isRunning || this.state === 'run') {
            this.startDashLightAttack();
          } else {
            this.startLightAttack(1);
          }
        } else {
          if (wantJump && this.jumpY === 0) {
            this.vy = 540;
            this.jumpY = 1;
            this.state = 'jump';
            sfx.playJump();
            spawnParticles(this.x, this.z, '#e2e8f0', 6, 110, 4);
          }

          if (moveX !== 0) this.facing = moveX;

          const isMoving = moveX !== 0 || moveZ !== 0;
          if (!isMoving) {
            this.isRunning = false;
          }

          const spdMult = this.getCombatCfg().speedMult || 1.0;
          const speedX = (this.isRunning ? (this.hero.runSpeed || 395) : (this.hero.walkSpeed || 215)) * spdMult;
          const speedZ = (this.isRunning ? 225 : 155) * spdMult;

          const diag = (moveX !== 0 && moveZ !== 0) ? 0.86 : 1;
          this.x += moveX * speedX * diag * dt;
          this.z += moveZ * speedZ * diag * dt;

          if (this.jumpY > 0) {
            this.state = 'jump';
            this.frame = this.vy > 0 ? 3 : 4;
          } else if (isMoving && this.isRunning) {
            this.state = 'run';
            const fps = StudioState.getFps(this.hero.id === 'redpanda' ? 'rp_run' : 'run', 17);
            this.animTimer += dt * fps;
            const runSheet = SpriteBank.sheets[this.resolveSheet('run')];
            this.frame = Math.floor(this.animTimer) % (runSheet ? runSheet.frameCount : 10);

            this.dustTimer -= dt;
            if (this.dustTimer <= 0) {
              this.dustTimer = 0.11;
              game.particles.push({
                x: this.x - this.facing * 28,
                y: this.z - 4,
                vx: -this.facing * (45 + Math.random() * 55),
                vy: -20 - Math.random() * 20,
                size: 5.5,
                color: 'rgba(232,225,245,0.6)',
                life: 0.24,
                maxLife: 0.24,
                gravity: -20,
              });
            }
          } else if (isMoving) {
            this.state = 'walk';
            const fps = StudioState.getFps(this.hero.id === 'redpanda' ? 'rp_walk' : 'walk', 11);
            this.animTimer += dt * fps;
            const walkSheet = SpriteBank.sheets[this.resolveSheet('walk')];
            this.frame = Math.floor(this.animTimer) % (walkSheet ? walkSheet.frameCount : 10);
          } else {
            this.state = 'idle';
            const fps = StudioState.getFps(this.hero.id === 'redpanda' ? 'rp_idle' : 'idle', 8.5);
            this.animTimer += dt * fps;
            const idleSheet = SpriteBank.sheets[this.resolveSheet('idle')];
            this.frame = Math.floor(this.animTimer) % (idleSheet ? idleSheet.frameCount : 10);
          }
        }
      }

      // Clamp to current belt-scrolling camera lock & Z depth plane
      const minX = game.camMinX + 54;
      const maxX = Math.min(STAGE_W - 54, game.camMaxX + CANVAS_W - 54);
      this.x = Math.max(minX, Math.min(maxX, this.x));
      this.z = Math.max(Z_MIN, Math.min(Z_MAX, this.z));
    }

    /**
     * Multi-frame Instant Burst Dash (閃身步!) — dynamically scales to 10, 20, or 30+ frames!
     */
    updateDash(dt, wantLight, wantHeavy, wantSpecial, wantTornado = false) {
      this.stateTime += dt;
      const sheetKey = this.resolveSheet('dash');
      const fc = SpriteBank.getFrameCount(sheetKey, 10);
      const fps = StudioState.getFps(this.hero.id === 'redpanda' ? 'rp_dash' : 'dash', 25);
      const totalDur = Math.max(0.32, fc / fps);
      const progress = Math.min(0.999, this.stateTime / totalDur);
      this.frame = Math.floor(progress * fc);

      let speed = 0;
      if (progress < 0.2) speed = 260;
      else if (progress < 0.3) speed = 920;
      else if (progress < 0.4) speed = 1380;
      else if (progress < 0.5) speed = 1650;
      else if (progress < 0.6) speed = 1320;
      else if (progress < 0.7) speed = 740;
      else if (progress < 0.8) speed = 320;
      else if (progress < 0.9) speed = 120;
      else speed = 0;

      this.x += this.facing * speed * dt;

      if (progress >= 0.3 && progress <= 0.7 && Math.random() < 0.65) {
        game.afterimages.push({
          sheetKey,
          frame: this.frame,
          x: this.x,
          y: this.z - this.jumpY,
          facing: this.facing,
          life: 0.14,
          maxLife: 0.14,
        });
      }

      if (progress >= 0.7) {
        if (wantSpecial) { this.startSpecial(); return; }
        if (wantTornado && (!this.tornadoCd || this.tornadoCd <= 0)) { this.startTornadoKick(); return; }
        if (wantHeavy) { this.startDashAttack(); return; }
        if (wantLight) { this.startDashLightAttack(); return; }
      }

      if (this.stateTime >= totalDur) {
        this.state = 'idle';
        this.animTimer = 0;
      }
    }

    /**
     * Multi-frame Rogue Soccer Kick (浪子踢球 / 閃電踢球) — supports 10 ~ 60+ frames!
     */
    updateDashLightAttack(dt, wantSpecial) {
      this.stateTime += dt;
      const isRp = this.hero.id === 'redpanda';
      const fc = SpriteBank.getFrameCount(this.resolveSheet('dashLightAttack'), 10);
      const fps = StudioState.getFps(isRp ? 'rp_dashLightAttack' : 'dashLightAttack', 17);
      const totalDur = Math.max(0.45, fc / fps);
      const progress = Math.min(0.999, this.stateTime / totalDur);
      this.frame = Math.floor(progress * fc);

      if (wantSpecial && progress >= 0.7) {
        this.startSpecial();
        return;
      }

      let speed = 0;
      if (progress < 0.12) speed = 310;
      else if (progress < 0.24) speed = 200;
      else if (progress < 0.35) speed = 110;
      else if (progress < 0.55) speed = 80;
      else if (progress >= 0.62 && progress < 0.8) speed = 90;
      this.x += this.facing * speed * dt;

      if (progress >= 0.28 && progress <= 0.42) {
        this.performMeleeHitbox(148, 22, false, 180);
      }

      const isAd = this.hero.id === 'adailing';
      const launchAt = (isRp || isAd) ? 0.50 : 0.40;
      if (progress >= launchAt && !this.ballLaunched) {
        this.ballLaunched = true;
        const actId = isRp ? 'rp_dashLightAttack' : (isAd ? 'ad_dashLightAttack' : 'dashLightAttack');
        const actFx = getActionFx(actId);
        const ballStyle = isRp ? 'lightning' : (isAd ? 'book' : 'gothic');
        game.projectiles.push(new SoccerBall(this.x + this.facing * 68, this.z, this.facing, ballStyle));
        sfx.playHit(true);
        if (!actFx) {
          addShake(7, 0.14);
          triggerImpactFrame(isRp ? '#fde047' : (isAd ? '#34d399' : '#f0abfc'), 0.055);
        } else {
          if (actFx.shakeEnabled) addShake(Number(actFx.shakeAmp) || 7, Number(actFx.shakeDur) || 0.14);
          if (actFx.flashEnabled) triggerImpactFrame(actFx.flashColor || '#fde047', Number(actFx.flashDur) || 0.055);
        }
      }

      if (this.stateTime >= totalDur) {
        this.state = 'idle';
        this.animTimer = 0;
      }
    }

    /**
     * Multi-frame Dash Heavy Attack (星杖衝刺斬 / 赤焰衝刺撞擊) — supports 10 ~ 60+ frames!
     */
    updateDashAttack(dt, wantSpecial) {
      this.stateTime += dt;
      const fc = SpriteBank.getFrameCount(this.resolveSheet('dashAttack'), 10);
      const fps = StudioState.getFps(this.hero.id === 'redpanda' ? 'rp_dashAttack' : 'dashAttack', 18);
      const totalDur = Math.max(0.45, fc / fps);
      const progress = Math.min(0.999, this.stateTime / totalDur);
      this.frame = Math.floor(progress * fc);

      if (wantSpecial && progress >= 0.7) {
        this.startSpecial();
        return;
      }

      let speed = 0;
      if (progress < 0.2) speed = 320;
      else if (progress < 0.4) speed = 480;
      else if (progress < 0.52) speed = 560;
      else if (progress < 0.62) speed = 400;
      else if (progress < 0.72) speed = 260;
      else if (progress < 0.82) speed = 120;
      else speed = 0;

      this.x += this.facing * speed * dt;

      if (progress >= 0.28 && progress < 0.48) {
        this.performMeleeHitbox(164, 22, false, 140, this.hitIds);
      }
      if (progress >= 0.48 && !this.dashImpactDone) {
        this.dashImpactDone = true;
        triggerImpactFrame('#fde047', 0.06);
      }
      if (progress >= 0.48 && progress <= 0.72) {
        this.performMeleeHitbox(192, 38, true, 360, this.hitIdsStage2);
      }

      if (this.stateTime >= totalDur) {
        this.state = 'idle';
        this.animTimer = 0;
      }
    }

    updateCustomAction(dt) {
      this.stateTime += dt;
      const act = this.activeCustomAction;
      const sheet = act && SpriteBank.sheets[act.sheetKey];
      if (!act || !sheet) {
        this.state = 'idle';
        return;
      }
      const fps = act.fps || 14;
      const totalDur = sheet.frameCount / fps;
      this.frame = Math.min(sheet.frameCount - 1, Math.floor(this.stateTime * fps));
      if (this.frame >= Math.floor(sheet.frameCount * 0.35) && this.frame <= Math.floor(sheet.frameCount * 0.65)) {
        this.performMeleeHitbox(155, 28, true, 240);
      }
      if (this.stateTime >= totalDur) {
        this.state = 'idle';
        this.activeCustomAction = null;
      }
    }

    updateMeleeCombo(dt, wantLight, wantHeavy, wantSpecial) {
      this.stateTime += dt;
      if (wantSpecial) {
        this.jumpY = 0;
        this.startSpecial();
        return;
      }
      if (this.stateTime > 0.05) {
        if (wantHeavy) this.comboQueued = 'heavy';
        else if (wantLight && !this.comboQueued) this.comboQueued = 'light';
      }

      const isRp = this.hero.id === 'redpanda';
      const lightFc = SpriteBank.getFrameCount(this.resolveSheet('lightAttack'), 10);
      const heavyFc = SpriteBank.getFrameCount(this.resolveSheet('attack'), 10);
      const lightFps = StudioState.getFps(isRp ? 'rp_lightAttack' : 'lightAttack', 17);
      const heavyFps = StudioState.getFps(isRp ? 'rp_attack' : 'heavyAttack', isRp ? 16 : 14);

      const s1End = Math.max(1, Math.round(lightFc * 0.3));
      const s2End = Math.max(s1End + 1, Math.round(lightFc * 0.6));

      if (this.state === 'light1') {
        const len = s1End;
        const dur = len / lightFps;
        const prog = Math.min(0.999, this.stateTime / dur);
        this.frame = Math.floor(prog * len);
        if (prog >= 0.55) {
          this.performMeleeHitbox(134, 14, false, 80);
        }
        if (this.stateTime >= dur) {
          if (this.comboQueued === 'heavy') this.startHeavyAttack();
          else if (this.comboQueued === 'light') this.startLightAttack(2);
          else this.state = 'idle';
        }
      } else if (this.state === 'light2') {
        const len = Math.max(1, s2End - s1End);
        const dur = len / lightFps;
        const prog = Math.min(0.999, this.stateTime / dur);
        this.frame = s1End + Math.floor(prog * len);
        if (prog >= 0.35) {
          this.performMeleeHitbox(148, 20, false, 125);
        }
        if (this.stateTime >= dur) {
          if (this.comboQueued === 'heavy') this.startHeavyAttack();
          else if (this.comboQueued === 'light') this.startLightAttack(3);
          else this.state = 'idle';
        }
      } else if (this.state === 'light3') {
        const len = Math.max(1, lightFc - s2End);
        const dur = len / Math.max(10, lightFps * 0.85);
        const prog = Math.min(0.999, this.stateTime / dur);
        this.frame = s2End + Math.floor(prog * len);
        if (prog >= 0.25 && prog <= 0.65) {
          this.performMeleeHitbox(156, 28, true, 240);
        }
        if (this.stateTime >= dur) {
          if (this.comboQueued === 'heavy') this.startHeavyAttack();
          else this.state = 'idle';
        }
      } else if (this.state === 'heavy') {
        if (isRp) {
          // 🦊 RED PANDA HEAVY ATTACK: 升龍拳 (SHORYUKEN — Rising Dragon Energy Uppercut + High Air Launch!)
          const dur = Math.max(0.48, heavyFc / heavyFps);
          const prog = Math.min(0.999, this.stateTime / dur);
          this.frame = Math.min(heavyFc - 1, Math.floor(prog * heavyFc));

          // Rising Shoryuken flight arc across uppercut frames (22%..78%) + golden energy sparks!
          if (prog >= 0.22 && prog <= 0.78) {
            const arcT = (prog - 0.22) / 0.56;
            this.jumpY = Math.sin(arcT * Math.PI) * 58;
            this.x += this.facing * (prog < 0.52 ? 175 : 65) * dt;
            if (Math.random() < 0.72) {
              spawnParticles(
                this.x + this.facing * 48 + (Math.random() - 0.5) * 28,
                this.z - this.jumpY - 64 - Math.random() * 58,
                Math.random() < 0.55 ? '#fde047' : '#fb923c',
                2,
                195,
                5.5
              );
            }
          } else {
            this.jumpY = 0;
          }

          // Active Rising Dragon Uppercut hitbox: launches hit enemies HIGH into the sky (▲ 浮空!!)
          if (prog >= 0.26 && prog <= 0.68) {
            this.performMeleeHitbox(176, 44, true, 84, this.hitIds, {
              wideBack: 42,
              launchAir: true,
              launchVy: 595,
              customWord: '升龍拳!!',
            });
          }

          if (this.stateTime >= dur) {
            this.jumpY = 0;
            this.state = 'idle';
          }
        } else if (this.hero.id === 'adailing') {
          // 🎒 ADAILING HEAVY ATTACK: 海星字典泰山壓頂 (10-frame Dictionary Overhead Slam — F1-F5 lift, F6 dive, F7 BOOM slam!)
          this.jumpY = 0;
          const adFps = StudioState.getFps('ad_attack', 15);
          const dur = Math.max(0.56, heavyFc / adFps);
          const prog = Math.min(0.999, this.stateTime / dur);
          this.frame = Math.min(heavyFc - 1, Math.floor(prog * heavyFc));
          // Forward dive lunge on F6 (prog 0.48..0.62)
          if (prog >= 0.48 && prog <= 0.62) {
            this.x += this.facing * 210 * dt;
          }
          // Ground-slam shockwave & wide AOE hitbox synced to F7 impact (prog 0.58..0.76)
          if (prog >= 0.58 && prog <= 0.76) {
            this.performMeleeHitbox(212, 48, true, 410, this.hitIds, {
              wideBack: 56,
              launchAir: true,
              customWord: '字典壓頂!!',
            });
          }
          if (prog >= 0.60 && !this.getsugaLaunched) {
            this.getsugaLaunched = true;
            const slamX = this.x + this.facing * 56;
            const actFx = getActionFx('ad_attack');
            sfx.playHit(true);
            spawnParticles(slamX, this.z - 8, '#fde047', 18, 320, 7);
            spawnParticles(slamX, this.z - 6, '#ffffff', 12, 260, 6);
            if (!actFx) {
              addShake(11, 0.22);
              triggerImpactFrame('#fde047', 0.06);
            } else {
              if (actFx.shakeEnabled) addShake(Number(actFx.shakeAmp) || 11, Number(actFx.shakeDur) || 0.22);
              if (actFx.flashEnabled) triggerImpactFrame(actFx.flashColor || '#fde047', Number(actFx.flashDur) || 0.06);
            }
          }
          if (this.stateTime >= dur) {
            this.jumpY = 0;
            this.state = 'idle';
          }
        } else {
          // 😈 KUROMI HEAVY ATTACK: 月牙天沖 (10-frame Getsuga Tensho — strictly ground-locked!)
          this.jumpY = 0;
          const dur = Math.max(0.50, heavyFc / heavyFps);
          const prog = Math.min(0.999, this.stateTime / dur);
          this.frame = Math.min(heavyFc - 1, Math.floor(prog * heavyFc));
          // Slight forward lunge during the crescent slash (F4-F6)
          if (prog >= 0.30 && prog <= 0.58) {
            this.x += this.facing * 135 * dt;
          }
          // Active crescent slash melee hitbox precisely synced to F4-F6 (30%..65%)
          if (prog >= 0.30 && prog <= 0.65) {
            this.performMeleeHitbox(192, 44, true, 360, this.hitIds, {
              wideBack: 28,
              customWord: '月牙斬!!',
            });
          }
          // Launch piercing Getsuga Tensho crescent energy wave on F5 (prog >= 0.42)!
          if (prog >= 0.42 && !this.getsugaLaunched) {
            this.getsugaLaunched = true;
            const actFx = getActionFx('heavyAttack');
            game.projectiles.push(new GetsugaWave(this.x + this.facing * 72, this.z, this.facing));
            sfx.playSwing(3);
            if (!actFx) {
              addShake(8, 0.16);
              triggerImpactFrame('#67e8f9', 0.055);
            } else {
              if (actFx.shakeEnabled) addShake(Number(actFx.shakeAmp) || 8, Number(actFx.shakeDur) || 0.16);
              if (actFx.flashEnabled) triggerImpactFrame(actFx.flashColor || '#67e8f9', Number(actFx.flashDur) || 0.055);
            }
          }
          if (this.stateTime >= dur) {
            this.jumpY = 0;
            this.state = 'idle';
          }
        }
      }
    }

    updateSpecial(dt) {
      this.stateTime += dt;

      // RED PANDA SPECIAL: 赤焰百拳連擊 (Blazing 100-Fist Rush!)
      if (this.hero.specialType === 'flurry') {
        const totalDur = 1.32;
        if (this.stateTime < 0.22) {
          this.frame = Math.min(2, Math.floor((this.stateTime / 0.22) * 3));
        } else if (this.stateTime < 1.12) {
          const rushElapsed = this.stateTime - 0.22;
          if (!this.cannonImpactDone) {
            this.cannonImpactDone = true;
            triggerImpactFrame('#fb923c', 0.085);
          }
          const rushSeq = [3, 4, 5, 6, 7, 5, 6, 7, 8];
          this.frame = rushSeq[Math.min(rushSeq.length - 1, Math.floor((rushElapsed / 0.90) * rushSeq.length))];

          // Forward blazing surge + fire afterimages!
          this.x += this.facing * 235 * dt;
          if (Math.random() < 0.45) {
            game.afterimages.push({
              sheetKey: this.resolveSheet('special'),
              frame: this.frame,
              x: this.x,
              y: this.z - this.jumpY,
              facing: this.facing,
              life: 0.16,
              maxLife: 0.16,
            });
          }
          if (Math.random() < 0.8) {
            spawnParticles(this.x + this.facing * 68, this.z - 64 + (Math.random() - 0.5) * 34, Math.random() < 0.5 ? '#fb923c' : '#fde047', 2, 240, 6);
          }

          this.cannonTickTimer -= dt;
          if (this.cannonTicks < 10 && this.cannonTickTimer <= 0) {
            this.cannonTicks++;
            this.cannonTickTimer = 0.082;
            const isFinalShot = this.cannonTicks === 10;
            sfx.playCannonPulse(this.cannonTicks);
            addShake(isFinalShot ? 12 : 5, isFinalShot ? 0.24 : 0.08);
            if (isFinalShot) {
              triggerImpactFrame('#fef08a', 0.075);
              spawnParticles(this.x + this.facing * 95, this.z - 70, '#fb923c', 22, 320, 8);
            }

            for (const e of game.enemies) {
              if (e.dead) continue;
              const dx = (e.x - this.x) * this.facing;
              if (dx >= -36 && dx <= 290 && Math.abs(e.z - this.z) <= Z_HIT_BEAM + 14) {
                e.takeHit(
                  isFinalShot ? 28 : 13,
                  this.facing,
                  isFinalShot,
                  isFinalShot ? 420 : 48,
                  isFinalShot ? '#fde047' : '#fb923c'
                );
              }
            }
            for (const prop of game.props) {
              if (prop.broken) continue;
              const dx = (prop.x - this.x) * this.facing;
              if (dx >= -25 && dx <= 270 && Math.abs(prop.z - this.z) <= Z_HIT_BEAM + 10) {
                prop.hit(28);
              }
            }
          }
        } else if (this.stateTime < totalDur) {
          this.frame = 9;
        } else {
          this.state = 'idle';
        }
        return;
      }

      // KUROMI SPECIAL: 能量砲十連發 (10-Shot Gothic Energy Cannon!)
      if (this.stateTime < 0.08) {
        this.frame = 0;
      } else if (this.stateTime < 0.16) {
        this.frame = 1;
      } else if (this.stateTime < 0.27) {
        this.frame = 2;
      } else if (this.stateTime < 0.38) {
        this.frame = 3;
        if (!this.hitIds.has('aura')) {
          this.hitIds.add('aura');
          spawnParticles(this.x, this.z - 80, '#fb923c', 18, 260, 7);
          for (const e of game.enemies) {
            if (!e.dead && Math.abs(e.x - this.x) < 115 && Math.abs(e.z - this.z) < 55) {
              const dir = e.x >= this.x ? 1 : -1;
              e.takeHit(10, dir, false, 150, '#fb923c');
            }
          }
        }
      } else if (this.stateTime < 0.48) {
        this.frame = 4;
      } else if (this.stateTime < 1.26) {
        const beamElapsed = this.stateTime - 0.48;
        if (!this.cannonImpactDone) {
          this.cannonImpactDone = true;
          triggerImpactFrame('#f472b6', 0.085);
        }
        const beamSeq = [5, 6, 7, 6, 7, 8];
        this.frame = beamSeq[Math.min(beamSeq.length - 1, Math.floor((beamElapsed / 0.78) * beamSeq.length))];

        game.beamEffect = {
          x: this.x + this.facing * 62,
          y: this.z - 56,
          z: this.z + 1,
          facing: this.facing,
          progress: beamElapsed / 0.78,
          pulse: Math.sin(beamElapsed * 75) * 0.5 + 0.5,
        };

        this.cannonTickTimer -= dt;
        if (this.cannonTicks < 10 && this.cannonTickTimer <= 0) {
          this.cannonTicks++;
          this.cannonTickTimer = 0.072;
          const isFinalShot = this.cannonTicks === 10;
          sfx.playCannonPulse(this.cannonTicks);
          addShake(isFinalShot ? 11 : 4.5, isFinalShot ? 0.22 : 0.08);

          for (const e of game.enemies) {
            if (e.dead) continue;
            const dx = (e.x - this.x) * this.facing;
            if (dx >= -25 && dx <= 760 && Math.abs(e.z - this.z) <= Z_HIT_BEAM) {
              e.takeHit(isFinalShot ? 24 : 11, this.facing, isFinalShot, isFinalShot ? 380 : 42, '#f0abfc');
            }
          }
          for (const prop of game.props) {
            if (prop.broken) continue;
            const dx = (prop.x - this.x) * this.facing;
            if (dx >= -20 && dx <= 740 && Math.abs(prop.z - this.z) <= Z_HIT_BEAM) {
              prop.hit(25);
            }
          }
        }
      } else if (this.stateTime < 1.48) {
        this.frame = 9;
        game.beamEffect = null;
      } else {
        game.beamEffect = null;
        this.state = 'idle';
      }
    }

    updateTornadoKick(dt, wantSpecial) {
      if (wantSpecial && this.energy >= 40 && this.stateTime > 0.2) {
        this.jumpY = 0;
        this.startSpecial();
        return;
      }
      this.stateTime += dt;
      const sheetKey = this.resolveSheet('tornadoKick');
      const sheet = SpriteBank.sheets[sheetKey];
      const fc = sheet ? sheet.frameCount : 10;
      const actId = this.hero.id === 'redpanda' ? 'rp_tornadoKick' : 'tornadoKick';
      const fps = StudioState.getFps(actId, 15);
      const totalDur = Math.max(0.58, fc / fps);
      const prog = Math.min(1, this.stateTime / totalDur);
      this.frame = Math.min(fc - 1, Math.floor(prog * fc));

      // Forward cyclone drift & smooth mid-air lift curve during tornado spin (20%..80%)
      if (prog >= 0.14 && prog <= 0.82) {
        this.x += this.facing * 170 * dt;
        const arcT = (prog - 0.14) / 0.68;
        this.jumpY = Math.sin(arcT * Math.PI) * 56;
        if (Math.random() < 0.65) {
          const pCol = this.hero.id === 'redpanda' ? '#fb923c' : '#c084fc';
          spawnParticles(this.x + (Math.random() - 0.5) * 64, this.z - this.jumpY - 40 - Math.random() * 70, pCol, 2, 170, 5);
        }
      } else {
        this.jumpY = 0;
      }

      // Multi-hit rising tornado sweeps: Hit 1 (lift) -> Hit 2 (spin) -> Hit 3 (HIGH AIR LAUNCH!)
      if (prog >= 0.24 && prog <= 0.42) {
        this.performMeleeHitbox(155, 16, false, 60, this.hitIds, {
          wideBack: 70,
          launchAir: true,
          launchVy: 420,
          customWord: 'WHIRL!',
        });
      }
      if (prog >= 0.44 && prog <= 0.62) {
        this.performMeleeHitbox(165, 18, false, 70, this.hitIdsStage2, {
          wideBack: 80,
          launchAir: true,
          launchVy: 485,
          customWord: 'SPIN!!',
        });
      }
      if (prog >= 0.60 && prog <= 0.78) {
        this.performMeleeHitbox(178, 26, true, 88, this.hitIdsStage3, {
          wideBack: 85,
          launchAir: true,
          launchVy: 575,
          customWord: 'LAUNCH!!',
        });
      }

      if (this.stateTime >= totalDur) {
        this.jumpY = 0;
        this.state = 'idle';
        this.animTimer = 0;
      }
    }

    performMeleeHitbox(reach, dmg, heavy, knockForce, hitSet = this.hitIds, opts = null) {
      let hitAny = false;
      const pCfg = this.getCombatCfg();
      const effDmg = Math.max(1, Math.round(dmg * (pCfg.dmgMult || 1)));
      const effReach = reach * Math.max(0.75, pCfg.scale || 1);
      const sparkCol = heavy ? (this.hero.heavySparkColor || '#facc15') : (this.hero.sparkColor || '#e879f9');
      const minDx = -(opts && opts.wideBack ? opts.wideBack : 30) * Math.max(0.8, pCfg.scale || 1);
      for (const e of game.enemies) {
        if (e.dead || hitSet.has(e.id)) continue;
        const dx = (e.x - this.x) * this.facing;
        const sizePadX = Math.max(0, ((e.cfg.scale || 1) - 1) * 44);
        const sizePadZ = Math.max(0, ((e.cfg.scale || 1) - 1) * 18);
        if (dx >= (minDx - sizePadX * 0.4) && dx <= (effReach + sizePadX) && Math.abs(e.z - this.z) <= Z_HIT_MELEE + 12 + sizePadZ) {
          hitSet.add(e.id);
          e.takeHit(effDmg, this.facing, heavy, knockForce, sparkCol, opts && opts.customWord ? opts.customWord : null, opts);
          this.energy = Math.min(this.maxEnergy, this.energy + (heavy ? 12 : 7));
          hitAny = true;
        }
      }
      for (const prop of game.props) {
        if (prop.broken || hitSet.has(prop.id)) continue;
        const dx = (prop.x - this.x) * this.facing;
        if (dx >= minDx && dx <= effReach && Math.abs(prop.z - this.z) <= Z_HIT_MELEE) {
          hitSet.add(prop.id);
          prop.hit(effDmg);
          hitAny = true;
        }
      }
      if (hitAny) {
        sfx.playHit(heavy);
        game.hitstop = heavy ? 0.068 : 0.032;
        addShake(heavy ? 10 : 4, heavy ? 0.2 : 0.09);
        if (typeof GamepadManager !== 'undefined') GamepadManager.rumble(heavy ? 0.58 : 0.2, heavy ? 0.45 : 0.16, heavy ? 145 : 65);
      }
    }

    draw(ctx) {
      const pCfg = this.getCombatCfg();
      const pScale = pCfg.scale || 1.0;
      const shadowScale = Math.max(0.45, 1 - this.jumpY / 260) * pScale;
      ctx.save();
      ctx.fillStyle = 'rgba(8, 5, 18, 0.52)';
      ctx.beginPath();
      ctx.ellipse(this.x, this.z + 2, 54 * shadowScale, 15 * shadowScale, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      if (this.invuln > 0 && this.state !== 'special' && this.state !== 'dash' && this.state !== 'tornadoKick' && this.state !== 'hurt' && Math.floor(this.invuln * 18) % 2 === 0) {
        ctx.save();
        ctx.globalAlpha = 0.45;
      } else {
        ctx.save();
      }

      let sheetKey = this.resolveSheet('idle');
      let frameToDraw = this.frame;

      if (this.state === 'idle') {
        sheetKey = this.resolveSheet('idle');
      } else if (this.state === 'walk') {
        sheetKey = this.resolveSheet('walk');
      } else if (this.state === 'run') {
        sheetKey = this.resolveSheet('run');
      } else if (this.state === 'dash') {
        sheetKey = this.resolveSheet('dash');
      } else if (this.state === 'dashLightAttack') {
        sheetKey = this.resolveSheet('dashLightAttack');
      } else if (this.state === 'dashAttack') {
        sheetKey = this.resolveSheet('dashAttack');
      } else if (this.state === 'tornadoKick') {
        sheetKey = this.resolveSheet('tornadoKick');
      } else if (this.state === 'custom' && this.activeCustomAction) {
        sheetKey = this.activeCustomAction.sheetKey;
      } else if (this.state === 'jump') {
        if (this.hero.id === 'kuromi' && SpriteBank.sheets.jump) {
          sheetKey = 'jump';
          frameToDraw = this.vy > 0 ? 2 : 6;
        } else {
          sheetKey = this.resolveSheet('run');
          frameToDraw = this.vy > 0 ? 3 : 4;
        }
      } else if (this.state === 'light1' || this.state === 'light2' || this.state === 'light3') {
        sheetKey = this.resolveSheet('lightAttack');
      } else if (this.state === 'heavy' || this.state === 'airAttack') {
        sheetKey = this.resolveSheet('attack');
      } else if (this.state === 'special') {
        sheetKey = this.resolveSheet('special');
      } else if (this.state === 'hurt') {
        sheetKey = this.resolveSheet('hurt');
      }

      const drawY = this.z - this.jumpY;

      // Render Hero at configured scale (default 1.0 native 300x264)!
      SpriteBank.drawFrame(ctx, sheetKey, frameToDraw, this.x, drawY, this.facing, pScale, this.hurtFlash > 0);
      ctx.restore();
    }
  }

  // --------------------------------------------------------------------------
  // ENEMIES (HD Multi-Frame Sprite Sheets: Move, Dual-Style Attack A+B, KO)
  // --------------------------------------------------------------------------
  let nextEntityId = 1;

  const ENEMY_CONFIGS = {
    donghua_boss: {
      name: '🥋 冬花武聖大宗師',
      spritePrefix: 'enemy_donghua_boss',
      attackMode: 'donghua_boss',
      hasHurt: true,
      projKind: 'martial_chi',
      hp: 760,
      speedX: 148,
      speedZ: 96,
      reach: 215,
      dmg: 26,
      score: 4500,
      scale: 2.02, // 2x Hero Size — Towering Final Boss!
      windup: 0.46,
      attackDur: 0.82,
      cooldown: 1.05,
      armor: true,
      isBoss: true,
    },
    zebra_rush: {
      name: '斑馬怪',
      spritePrefix: 'enemy_zebra_rush',
      attackMode: 'dual_unique',
      hasHurt: true,
      hp: 132,
      speedX: 258,
      speedZ: 126,
      reach: 146,
      dmg: 18,
      score: 520,
      scale: 1.06,
      windup: 0.36,
      attackDur: 0.66,
      cooldown: 1.02,
      armor: false,
      rangedChance: 0.68,
      colorVariants: [
        { id: 'white', label: '墨白', rgb: [252, 252, 255], stripeRgb: [46, 52, 64], mode: 'zebra' },
        { id: 'grey', label: '鐵灰', rgb: [212, 220, 232], stripeRgb: [71, 85, 105], mode: 'zebra' },
        { id: 'brown', label: '赤棕', rgb: [248, 234, 214], stripeRgb: [120, 62, 34], mode: 'zebra' },
        { id: 'gold', label: '白金', rgb: [255, 246, 208], stripeRgb: [196, 138, 42], mode: 'zebra' },
        { id: 'blue', label: '冰藍', rgb: [224, 244, 255], stripeRgb: [29, 98, 184], mode: 'zebra' },
      ],
    },
    joey_kangaroo: {
      name: '袋鼠怪',
      spritePrefix: 'enemy_joey_kangaroo',
      attackMode: 'dual_unique',
      hasHurt: true,
      projKind: 'joey_boomerang',
      hp: 138,
      speedX: 205,
      speedZ: 132,
      reach: 148,
      dmg: 18,
      score: 540,
      scale: 1.08,
      windup: 0.38,
      attackDur: 0.70,
      cooldown: 1.06,
      armor: false,
      rangedChance: 0.62,
      colorVariants: [
        { id: 'white', label: '琥珀棕', rgb: [224, 145, 72], boomColor: '#e09148', mode: 'kangaroo' },
        { id: 'grey', label: '銀灰', rgb: [168, 178, 194], boomColor: '#94a3b8', mode: 'kangaroo' },
        { id: 'pink', label: '草莓粉', rgb: [251, 146, 188], boomColor: '#f472b6', mode: 'kangaroo' },
        { id: 'cream', label: '雪奶白', rgb: [252, 238, 212], boomColor: '#fde68a', mode: 'kangaroo' },
        { id: 'blue', label: '晴空藍', rgb: [132, 188, 248], boomColor: '#60a5fa', mode: 'kangaroo' },
      ],
    },
    kangaroo: {
      name: '🥊 拳擊袋鼠',
      spritePrefix: 'enemy_kangaroo',
      attackMode: 'dual_unique',
      hasHurt: true,
      hp: 128,
      speedX: 210,
      speedZ: 122,
      reach: 138,
      dmg: 16,
      score: 480,
      scale: 1.04,
      windup: 0.34,
      attackDur: 0.62,
      cooldown: 0.96,
      armor: false,
      rangedChance: 0.52,
    },
    zebra: {
      name: '🛹 滑板斑馬',
      spritePrefix: 'enemy_zebra',
      attackMode: 'dual_unique',
      hasHurt: true,
      projKind: 'bubblegum',
      hp: 120,
      speedX: 245,
      speedZ: 134,
      reach: 142,
      dmg: 17,
      score: 500,
      scale: 1.04,
      windup: 0.36,
      attackDur: 0.64,
      cooldown: 1.02,
      armor: false,
      rangedChance: 0.58,
    },
    koala: {
      name: '🎧 電競無尾熊',
      spritePrefix: 'enemy_koala',
      attackMode: 'dual_unique',
      hasHurt: true,
      projKind: 'holo_wave',
      hp: 118,
      speedX: 158,
      speedZ: 116,
      reach: 146,
      dmg: 15,
      score: 520,
      scale: 1.02,
      windup: 0.42,
      attackDur: 0.66,
      cooldown: 1.12,
      armor: false,
      rangedChance: 0.72,
    },
    capybara: {
      name: '🍊 佛系水豚君',
      spritePrefix: 'enemy_capybara',
      attackMode: 'dual_unique',
      hasHurt: true,
      projKind: 'zen_leaf',
      hp: 182,
      speedX: 118,
      speedZ: 88,
      reach: 152,
      dmg: 21,
      score: 560,
      scale: 1.08,
      windup: 0.48,
      attackDur: 0.72,
      cooldown: 1.24,
      armor: true,
      rangedChance: 0.50,
    },
    fat_tiger: {
      name: '🐯 胖虎',
      spritePrefix: 'enemy_fat_tiger',
      attackMode: 'melee',
      hasHurt: true,
      hp: 155,
      speedX: 126,
      speedZ: 94,
      reach: 148,
      dmg: 18,
      score: 520,
      scale: 1.04,
      windup: 0.42,
      attackDur: 0.72,
      cooldown: 1.15,
      armor: false,
    },
    cactus: {
      name: '🌵 針刺仙人掌',
      spritePrefix: 'enemy_cactus',
      attackMode: 'dual_unique',
      hasHurt: true,
      projKind: 'cactus_needle',
      hp: 134,
      speedX: 186,
      speedZ: 112,
      reach: 146,
      dmg: 18,
      score: 520,
      scale: 1.05,
      windup: 0.38,
      attackDur: 0.66,
      cooldown: 1.05,
      armor: false,
      rangedChance: 0.55,
    },
    wizard_ghost: {
      name: '🧙‍♂️ 星空巫師幽靈',
      spritePrefix: 'enemy_wizard_ghost',
      attackMode: 'dual_unique',
      hasHurt: true,
      projKind: 'cosmic_meteor',
      hp: 126,
      speedX: 168,
      speedZ: 120,
      reach: 152,
      dmg: 18,
      score: 560,
      scale: 1.06,
      windup: 0.44,
      attackDur: 0.70,
      cooldown: 1.18,
      armor: false,
      rangedChance: 0.74,
    },
    penguin_king: {
      name: '王者企鵝',
      spritePrefix: 'enemy_pengking',
      attackMode: 'full10',
      hasHurt: true,
      hp: 155,
      speedX: 162,
      speedZ: 100,
      reach: 138,
      dmg: 20,
      score: 520,
      scale: 1.08,
      windup: 0.44,
      attackDur: 0.68,
      cooldown: 1.2,
      armor: true,
    },
    penguin_ice: {
      name: '冰雪企鵝',
      spritePrefix: 'enemy_pengice',
      attackMode: 'full10',
      hasHurt: true,
      projKind: 'water',
      hp: 122,
      speedX: 178,
      speedZ: 108,
      reach: 134,
      dmg: 16,
      score: 430,
      scale: 1.02,
      windup: 0.42,
      attackDur: 0.68,
      cooldown: 1.15,
      armor: false,
    },
    rabbit: {
      name: '兔兔怪',
      spritePrefix: 'enemy_rabbit',
      attackMode: 'full10',
      hasHurt: true,
      hp: 96,
      speedX: 222,
      speedZ: 128,
      reach: 118,
      dmg: 14,
      score: 360,
      scale: 0.98,
      windup: 0.34,
      attackDur: 0.56,
      cooldown: 0.92,
      armor: false,
      colorVariants: [
        { id: 'white', label: '雪白', rgb: [255, 250, 248], mode: 'rabbit' },
        { id: 'pink', label: '粉櫻', rgb: [255, 186, 214], mode: 'rabbit' },
        { id: 'milktea', label: '奶茶', rgb: [250, 218, 162], mode: 'rabbit' },
        { id: 'lavender', label: '芋紫', rgb: [218, 188, 255], mode: 'rabbit' },
        { id: 'mint', label: '薄荷', rgb: [176, 244, 212], mode: 'rabbit' },
      ],
    },
    ghost: {
      name: '幽靈怪',
      spritePrefix: 'enemy_ghost',
      attackMode: 'full10',
      hasHurt: true,
      projKind: 'ghost_orb',
      hp: 112,
      speedX: 158,
      speedZ: 114,
      reach: 124,
      dmg: 16,
      score: 440,
      scale: 1.02,
      windup: 0.46,
      attackDur: 0.7,
      cooldown: 1.3,
      armor: false,
      colorVariants: [
        { id: 'white', label: '蒼白', rgb: [248, 250, 255], auraRgb: [96, 165, 250], orbColor: '#c084fc', mode: 'ghost' },
        { id: 'iceblue', label: '冰藍', rgb: [174, 236, 255], auraRgb: [56, 189, 248], orbColor: '#38bdf8', mode: 'ghost' },
        { id: 'purple', label: '紫焰', rgb: [224, 192, 255], auraRgb: [192, 132, 252], orbColor: '#c084fc', mode: 'ghost' },
        { id: 'green', label: '螢光綠', rgb: [178, 248, 212], auraRgb: [52, 211, 153], orbColor: '#4ade80', mode: 'ghost' },
        { id: 'pink', label: '櫻粉', rgb: [255, 202, 228], auraRgb: [244, 114, 182], orbColor: '#f472b6', mode: 'ghost' },
      ],
    },
    sheep: {
      name: '綿羊怪',
      spritePrefix: 'enemy_sheep',
      attackMode: 'full10',
      hasHurt: true,
      hp: 132,
      speedX: 176,
      speedZ: 102,
      reach: 134,
      dmg: 18,
      score: 450,
      scale: 1.04,
      windup: 0.42,
      attackDur: 0.66,
      cooldown: 1.12,
      armor: false,
      colorVariants: [
        { id: 'white', label: '雲白', rgb: [255, 248, 236], mode: 'sheep' },
        { id: 'pink', label: '粉莓', rgb: [255, 192, 216], mode: 'sheep' },
        { id: 'gold', label: '黃金', rgb: [255, 226, 122], mode: 'sheep' },
        { id: 'blue', label: '天藍', rgb: [168, 224, 255], mode: 'sheep' },
        { id: 'mint', label: '薄荷', rgb: [178, 246, 208], mode: 'sheep' },
      ],
    },
    pig: {
      name: '暴怒豬豬怪',
      spritePrefix: 'enemy_pig',
      attackMode: 'full10',
      hp: 118,
      speedX: 192,
      speedZ: 108,
      reach: 132,
      dmg: 18,
      score: 440,
      scale: 1.04,
      windup: 0.42,
      attackDur: 0.66,
      cooldown: 1.15,
      armor: false,
    },
    slime: {
      name: '藍色水滴史萊姆',
      spritePrefix: 'enemy_slime',
      attackMode: 'full10',
      windupSheet: 'enemy_slime_angry',
      idleSheet: 'enemy_slime_idle',
      canSplit: true,
      hp: 95,
      speedX: 162,
      speedZ: 102,
      reach: 122,
      dmg: 13,
      score: 300,
      scale: 1.04,
      windup: 0.46,
      attackDur: 0.62,
      cooldown: 1.05,
      armor: false,
    },
    slime_mini: {
      name: '分裂小史萊姆',
      spritePrefix: 'enemy_slime',
      attackMode: 'full10',
      windupSheet: 'enemy_slime_angry',
      idleSheet: 'enemy_slime_idle',
      canSplit: false,
      hp: 45,
      speedX: 192,
      speedZ: 118,
      reach: 96,
      dmg: 9,
      score: 160,
      scale: 0.68,
      windup: 0.36,
      attackDur: 0.56,
      cooldown: 0.9,
      armor: false,
    },
    mushroom: {
      name: '森林蘑菇怪',
      spritePrefix: 'enemy_mushroom',
      attackMode: 'full10',
      projKind: 'spore',
      hp: 125,
      speedX: 148,
      speedZ: 96,
      reach: 126,
      dmg: 17,
      score: 420,
      scale: 1.04,
      windup: 0.44,
      attackDur: 0.72,
      cooldown: 1.22,
      armor: false,
    },
    puffer: {
      name: '尖刺河豚怪',
      spritePrefix: 'enemy_puffer',
      attackMode: 'full10',
      projKind: 'water',
      spikyCounter: true,
      hp: 140,
      speedX: 168,
      speedZ: 104,
      reach: 130,
      dmg: 18,
      score: 480,
      scale: 1.04,
      windup: 0.48,
      attackDur: 0.68,
      cooldown: 1.25,
      armor: true,
    },
    star: {
      name: '宇宙海星侵略者',
      spritePrefix: 'enemy_star',
      projKind: 'star',
      hp: 105,
      speedX: 175,
      speedZ: 110,
      reach: 118,
      dmg: 15,
      score: 380,
      scale: 0.96,
      windup: 0.44,
      cooldown: 1.2,
      rangedChance: 0.68,
      armor: false,
    },
    boss: {
      name: '宇宙海星大霸王・BOSS',
      spritePrefix: 'enemy_star',
      customPrefix: 'enemy_star_boss',
      projKind: 'star',
      hp: 640,
      speedX: 160,
      speedZ: 110,
      reach: 148,
      dmg: 24,
      score: 3000,
      scale: 1.38,
      windup: 0.46,
      cooldown: 1.12,
      rangedChance: 0.72,
      armor: true,
      isBoss: true,
    },
  };
  ENEMY_CONFIGS.slime_mini.customPrefix = 'enemy_slime_mini';

  BASE_ENEMY_SNAPSHOT = {};
  for (const [eKey, eVal] of Object.entries(ENEMY_CONFIGS)) {
    BASE_ENEMY_SNAPSHOT[eKey] = {
      hp: eVal.hp,
      scale: eVal.scale,
      speedX: eVal.speedX,
      speedZ: eVal.speedZ,
      dmg: eVal.dmg,
      reach: eVal.reach,
      armor: !!eVal.armor,
    };
  }
  StudioState.syncAllCombatParamsToRuntime();

  class Enemy {
    constructor(type, x, z, opts = null) {
      const cfg = ENEMY_CONFIGS[type] || ENEMY_CONFIGS.slime;
      this.id = nextEntityId++;
      this.type = type;
      this.cfg = cfg;
      // Pick color variant for shared-module monsters (Rabbit / Ghost / Sheep / Zebra / Kangaroo)
      this.variant = null;
      if (cfg.colorVariants && cfg.colorVariants.length > 0) {
        if (opts && opts.variantId) {
          this.variant = cfg.colorVariants.find((v) => v.id === opts.variantId) || cfg.colorVariants[0];
        } else {
          this.variant = cfg.colorVariants[Math.floor(Math.random() * cfg.colorVariants.length)];
        }
      }
      this.name = (opts && opts.customName)
        ? opts.customName
        : (this.variant ? `${this.variant.label}${cfg.name}` : cfg.name);
      this.x = x;
      this.z = z;
      this.jumpY = 0;
      this.vx = 0;
      this.vy = 0;
      this.facing = (typeof game !== 'undefined' && game && game.player && x > game.player.x) ? -1 : 1;

      this.waveHpMult = (opts && opts.hpMult) ? opts.hpMult : 1;
      const scaledHp = Math.max(1, Math.round(cfg.hp * this.waveHpMult));
      this.hp = scaledHp;
      this.maxHp = scaledHp;
      this.armorShieldCount = cfg.armorHits || 3;
      this.armorToastCd = 0;
      this.state = 'approach'; // approach | windup | attack | hurt | knocked | dead
      this.attackStyle = 'A'; // 'A' = melee rush/spin, 'B' = ranged shot (for dual5x2)
      this.stateTime = 0;
      this.animTime = Math.random() * 10;
      this.frame = 0;
      this.isMoving = true;
      this.attackCd = 0.55 + Math.random() * 0.55;
      this.hurtFlash = 0;
      this.didHitPlayer = false;
      this.projFired = false;
      this.dead = false;
      this.deadFade = 1.0;
      this.strafeSide = Math.random() < 0.5 ? -1 : 1;
      this.strafeOffsetZ = (Math.random() - 0.5) * 26;
      this.dashVel = 0;
      this.isLaunched = false;
      this.airJuggleCount = 0;
      this.enteredScreen = false;
      this.wallBounceCd = 0;
    }

    resolveEnemySheet(slot, fallbackSlot = null) {
      const cp = this.cfg.customPrefix;
      if (cp && SpriteBank.sheets[`${cp}_${slot}`]) return `${cp}_${slot}`;
      const sp = this.cfg.spritePrefix;
      if (SpriteBank.sheets[`${sp}_${slot}`]) return `${sp}_${slot}`;
      if (fallbackSlot) {
        if (cp && SpriteBank.sheets[`${cp}_${fallbackSlot}`]) return `${cp}_${fallbackSlot}`;
        if (SpriteBank.sheets[`${sp}_${fallbackSlot}`]) return `${sp}_${fallbackSlot}`;
      }
      return `${sp}_${slot}`;
    }

    takeHit(dmg, dir, heavy, knockForce, sparkColor = '#f472b6', customComicWord = null, opts = null) {
      if (this.dead) return;
      const launchAir = !!(opts && opts.launchAir);
      const wasAirborne = this.jumpY > 8 || (this.isLaunched && this.vy > 20);
      const isAirJuggle = wasAirborne && !launchAir;
      const finalDmg = isAirJuggle ? Math.round(dmg * 1.2) : dmg;

      const armorMode = this.cfg.superArmor || (this.cfg.armor ? 'attack' : 'none');
      const flinchOnHit = this.cfg.flinchOnHit !== false;
      const kbMode = this.cfg.knockbackMode || 'normal';

      this.hp = Math.max(0, this.hp - finalDmg);
      this.hurtFlash = 0.14;
      game.lastHitEnemy = this;
      game.lastHitTimer = 3.5;

      // Combo & Score (bonus points for Air Juggle follow-up hits!)
      game.combo++;
      game.comboTimer = 2.6;
      if (game.combo > game.maxCombo) game.maxCombo = game.combo;
      game.score += finalDmg * 5 + game.combo * 10 + (isAirJuggle ? 80 : 0);

      const hitY = this.z - this.jumpY - 125 * this.cfg.scale;
      addFloatText(
        this.x + (Math.random() - 0.5) * 24,
        hitY,
        isAirJuggle ? `${finalDmg} 追打!` : `${finalDmg}`,
        isAirJuggle ? '#67e8f9' : (heavy || launchAir ? '#fde047' : '#ffffff'),
        heavy || isAirJuggle ? 24 : 19
      );
      spawnSlashSparks(this.x - dir * 18, this.z - this.jumpY - 80 * this.cfg.scale, dir, isAirJuggle ? '#67e8f9' : sparkColor);

      // American Comic-Book Hit Impact Bubble
      const lightWords = ['POW!', 'BAM!', 'WHAM!', 'BOP!', 'ZAP!'];
      const heavyWords = ['SMASH!!', 'CRUSH!!', 'BOOM!!', 'WHACK!!'];
      const shouldPopBubble = customComicWord || isAirJuggle || heavy || this.hp <= 0 || game.comicBubbles.length < 3 || (game.combo % 2 === 1);
      if (shouldPopBubble) {
        const isKo = this.hp <= 0;
        const word = isKo
          ? (this.cfg.canSplit ? 'SPLIT!!' : 'K.O.!!')
          : (customComicWord || (isAirJuggle ? 'JUGGLE!!' : (heavy ? heavyWords[Math.floor(Math.random() * heavyWords.length)] : lightWords[Math.floor(Math.random() * lightWords.length)])));
        spawnComicBubble(
          this.x + (Math.random() - 0.5) * 44,
          this.z - this.jumpY - 102 * this.cfg.scale + (Math.random() - 0.5) * 24,
          word,
          {
            style: 'burst',
            fillA: isKo ? (this.cfg.canSplit ? '#38bdf8' : '#fef08a') : (isAirJuggle ? '#67e8f9' : (heavy ? '#fb923c' : '#fde047')),
            fillB: isKo ? (this.cfg.canSplit ? '#2563eb' : '#e11d48') : (isAirJuggle ? '#7c3aed' : (heavy ? '#db2777' : '#f97316')),
            rx: isKo ? 78 : (heavy || isAirJuggle ? 70 : 54),
            ry: isKo ? 46 : (heavy || isAirJuggle ? 42 : 33),
            dur: isKo ? 0.68 : (heavy || isAirJuggle ? 0.52 : 0.38),
          }
        );
      }
      if (heavy || launchAir || this.hp <= 0) {
        triggerImpactFrame(this.hp <= 0 ? '#fef08a' : (launchAir ? '#e879f9' : '#ffffff'), this.hp <= 0 ? 0.07 : 0.045);
      }

      if (getCurrentStage().isTraining && game.trainingInfiniteHp && this.hp <= 0 && !(opts && opts.forceKill)) {
        this.hp = Math.max(1, this.maxHp);
      }

      if (this.hp <= 0) {
        this.dead = true;
        this.state = 'dead';
        this.facing = -dir;
        this.stateTime = 0;
        this.frame = 0;
        this.vx = dir * 290;
        this.vy = Math.max(this.vy, 340);
        this.jumpY = Math.max(this.jumpY, 2);
        game.koCount++;
        game.score += this.cfg.score;
        sfx.playEnemyKO();
        addFloatText(this.x, this.z - this.jumpY - 155 * this.cfg.scale, `+${this.cfg.score}`, '#facc15', 20);

        if (this.cfg.canSplit) {
          spawnParticles(this.x, this.z - 50, '#38bdf8', 16, 240, 7);
          for (const side of [-1, 1]) {
            const mini = new Enemy('slime_mini', this.x + side * 34, Math.max(Z_MIN, Math.min(Z_MAX, this.z + side * 14)));
            mini.vx = side * 190;
            mini.vy = 280;
            mini.jumpY = 8;
            mini.attackCd = 0.75;
            game.enemies.push(mini);
          }
        }

        if (this.type === 'bruiser' || this.type === 'puffer' || Math.random() < 0.25) {
          game.pickups.push(new Pickup(this.x, this.z, (this.type === 'bruiser' || this.type === 'puffer') ? 'crystal' : 'coin'));
        }
        return;
      }

      // 1. SUPER ARMOR MODES ('always' | 'hits' | 'attack')
      if (armorMode === 'always') {
        if (this.armorToastCd <= 0) {
          addFloatText(this.x, hitY - 22, '🛡 金霸體!', '#fde047', 17);
          this.armorToastCd = 0.32;
        }
        spawnParticles(this.x, this.z - 65 * this.cfg.scale, '#facc15', 5, 130, 4);
        if (kbMode !== 'immune') this.vx = dir * 18;
        return;
      }

      if (armorMode === 'hits') {
        if (this.armorShieldCount > 1) {
          this.armorShieldCount--;
          addFloatText(this.x, hitY - 22, `🛡 霸體 (${this.armorShieldCount})`, '#38bdf8', 17);
          spawnParticles(this.x, this.z - 65 * this.cfg.scale, '#38bdf8', 6, 150, 4);
          if (kbMode !== 'immune') this.vx = dir * 22;
          return;
        } else if (this.armorShieldCount === 1) {
          this.armorShieldCount = 0;
          addFloatText(this.x, hitY - 28, '💥 破防!!', '#facc15', 22);
          spawnParticles(this.x, this.z - 70 * this.cfg.scale, '#facc15', 14, 240, 6);
        }
      } else if (armorMode === 'attack') {
        const inAttackPhase = (this.state === 'attack' || this.state === 'windup');
        if (inAttackPhase && !wasAirborne && ((!heavy && !launchAir) || kbMode === 'immune')) {
          if (this.armorToastCd <= 0) {
            addFloatText(this.x, hitY - 22, '🛡 出招霸體', '#fde047', 16);
            this.armorToastCd = 0.35;
          }
          if (kbMode !== 'immune') this.vx = dir * 35;
          return;
        }
      }

      if (this.cfg.spikyCounter && !heavy && !launchAir && !wasAirborne && this.state === 'approach' && this.attackCd <= 0.4 && Math.random() < 0.45) {
        this.state = 'windup';
        this.stateTime = 0;
        this.attackStyle = 'A';
        spawnParticles(this.x, this.z - 65, '#facc15', 8, 160, 5);
        return;
      }

      // 2. FLINCH ON HIT ("受攻擊是否硬直") + KNOCKBACK RESISTANCE ("擊退/浮空抗性")
      if (!flinchOnHit) {
        // 受擊不硬直：動作不中斷，若允許微退則僅輕微位移，或若非抗擊飛且遭升龍浮空則依抗性處理
        if (kbMode === 'immune' || (!launchAir && !heavy)) {
          if (kbMode !== 'immune') this.x += dir * 4;
          return;
        }
        if (kbMode === 'resist') {
          this.vx = dir * Math.min(90, (knockForce || 80) * 0.35);
          return;
        }
      }

      this.facing = -dir;
      const canLaunch = kbMode === 'normal';
      const kbScale = kbMode === 'immune' ? 0 : (kbMode === 'resist' ? 0.42 : 1.0);

      if (launchAir && canLaunch) {
        addFloatText(this.x, hitY - 26, '▲ 浮空!!', '#e879f9', 20);
        this.state = 'knocked';
        this.isLaunched = true;
        this.stateTime = 0;
        this.frame = 2;
        this.vx = dir * Math.min(knockForce || 80, 95);
        this.vy = Math.max(this.vy, (opts && opts.launchVy) || 540);
        this.jumpY = Math.max(this.jumpY, 10);
      } else if (wasAirborne && canLaunch) {
        this.airJuggleCount++;
        const decay = Math.max(0.45, 1 - this.airJuggleCount * 0.13);
        this.state = 'knocked';
        this.isLaunched = true;
        this.stateTime = 0;
        this.frame = 2;
        this.vx = dir * (heavy ? Math.min(knockForce, 175) : 72);
        this.vy = Math.max(this.vy, (heavy ? 430 : 350) * decay);
        this.jumpY = Math.max(this.jumpY, 12);
      } else if (heavy && canLaunch) {
        this.state = 'knocked';
        this.isLaunched = false;
        this.stateTime = 0;
        this.frame = 2;
        this.vx = dir * knockForce;
        this.vy = 320;
        this.jumpY = 2;
      } else if (flinchOnHit) {
        this.state = 'hurt';
        this.stateTime = 0;
        this.frame = 0;
        this.vx = dir * (knockForce || 90) * kbScale;
      }
    }

    update(dt) {
      this.animTime += dt;
      this.spawnAge = (this.spawnAge || 0) + dt;
      if (this.hurtFlash > 0) this.hurtFlash -= dt;
      if (this.attackCd > 0) this.attackCd -= dt;
      if (this.armorToastCd > 0) this.armorToastCd -= dt;

      // Evaluate cloud_manifest.json custom trigger + condition actions
      if (window.CloudManifestLoader) {
        const matched = window.CloudManifestLoader.pickCustomAction(this, SpriteBank);
        if (matched) {
          if (!this._customAction || this._customAction.sheetKey !== matched.sheetKey) {
            this._customAction = matched;
            this._customFrame = 0;
          } else {
            const cSheet = SpriteBank.sheets[matched.sheetKey];
            const cFc = cSheet ? cSheet.frameCount : (matched.frames || 10);
            const nextF = (this._customFrame || 0) + dt * (matched.fps || 12);
            this._customFrame = matched.loop ? (nextF % cFc) : Math.min(cFc - 1, nextF);
          }
        } else {
          this._customAction = null;
        }
      }

      const moveSheet = this.resolveEnemySheet('move');
      const atkSheet = this.resolveEnemySheet('attack');
      const hurtSheet = this.resolveEnemySheet('hurt');
      const koSheet = this.resolveEnemySheet('ko');
      const prefix = this.cfg.customPrefix || this.cfg.spritePrefix;
      const moveFps = StudioState.getAction(`${prefix}_move`)?.fps || StudioState.getAction(`${this.cfg.spritePrefix}_move`)?.fps || 12;
      const koFps = StudioState.getAction(`${prefix}_ko`)?.fps || StudioState.getAction(`${this.cfg.spritePrefix}_ko`)?.fps || 12;
      const moveFc = SpriteBank.getFrameCount(moveSheet, 10);
      const atkFc = SpriteBank.getFrameCount(atkSheet, 10);
      const hurtFc = SpriteBank.getFrameCount(hurtSheet, 10);
      const koFc = SpriteBank.getFrameCount(koSheet, 10);
      const halfFc = Math.max(2, Math.floor(atkFc / 2));

      // Airborne & knockback physics (slightly floatier apex gravity when launched for juicy air juggles!)
      if (this.jumpY > 0 || this.vy > 0) {
        this.jumpY += this.vy * dt;
        const grav = (this.isLaunched && this.vy < 140) ? 940 : 1250;
        this.vy -= grav * dt;
        this.x += this.vx * dt;
        if (this.jumpY <= 0) {
          this.jumpY = 0;
          this.isLaunched = false;
          this.airJuggleCount = 0;
          if (Math.abs(this.vy) > 150) {
            // Classic Streets of Rage ground bounce!
            this.vy = Math.abs(this.vy) * 0.36;
            this.vx *= 0.55;
            spawnParticles(this.x, this.z, '#cbd5e1', 7, 130, 5);
          } else {
            this.vy = 0;
            this.vx = 0;
          }
        }
      }

      if (this.state === 'dead') {
        this.stateTime += dt;
        this.frame = Math.min(koFc - 1, Math.floor(this.stateTime * koFps));
        this.applyScreenWallBounds(dt);
        if (this.jumpY === 0 && this.stateTime > Math.max(1.05, (koFc / koFps) * 0.9)) {
          this.deadFade -= dt * 1.4;
        }
        return;
      }

      const p = game.player;
      const dx = p.x - this.x;
      const dz = p.z - this.z;

      if (this.state === 'hurt') {
        this.stateTime += dt;
        const hurtDur = (this.cfg.hasHurt ? 0.36 : 0.28) * (this.cfg.hitstunMult || 1.0);
        if (this.cfg.hasHurt && SpriteBank.sheets[hurtSheet]) {
          this.frame = Math.min(hurtFc - 1, Math.floor((this.stateTime / hurtDur) * hurtFc));
        } else {
          this.frame = this.stateTime < hurtDur * 0.5 ? 0 : 1;
        }
        this.x += this.vx * dt;
        this.vx *= Math.pow(0.02, dt);
        if (this.stateTime >= hurtDur) {
          this.state = 'approach';
          this.armorShieldCount = this.cfg.armorHits || 3;
          this.attackCd = Math.max(this.attackCd, 0.35);
        }
      } else if (this.state === 'knocked') {
        this.stateTime += dt;
        const knockDur = 0.72 * Math.max(0.6, Math.min(1.8, this.cfg.hitstunMult || 1.0));
        const knockStart = Math.min(koFc - 1, Math.floor(koFc * 0.2));
        const knockSpan = Math.max(1, Math.floor(koFc * 0.6));
        this.frame = Math.min(koFc - 2, knockStart + Math.floor((this.stateTime / knockDur) * knockSpan));
        if (this.jumpY === 0 && this.stateTime >= knockDur) {
          this.state = 'approach';
          this.armorShieldCount = this.cfg.armorHits || 3;
          this.attackCd = 0.55;
        }
      } else if (this.state === 'windup') {
        this.stateTime += dt;
        // Zebra Rush Mode A turns its back so its hind hooves point directly at the hero!
        if (this.type === 'zebra_rush' && this.attackStyle === 'A') {
          this.facing = dx >= 0 ? -1 : 1;
        } else {
          this.facing = dx >= 0 ? 1 : -1;
        }
        const enraged = this.cfg.isBoss && this.hp < this.maxHp * 0.5;
        const dur = enraged ? this.cfg.windup * 0.76 : this.cfg.windup;
        const prog = Math.min(0.99, this.stateTime / dur);

        if (this.cfg.attackMode === 'full10') {
          if (this.cfg.windupSheet) {
            const wFc = SpriteBank.getFrameCount(this.cfg.windupSheet, 10);
            this.frame = Math.min(wFc - 1, Math.floor(prog * wFc));
          } else {
            const wSpan = Math.max(2, Math.floor(atkFc * (this.type === 'puffer' ? 0.4 : 0.3)));
            this.frame = Math.min(wSpan - 1, Math.floor(prog * wSpan));
          }
        } else if (this.cfg.attackMode === 'donghua_boss') {
          const wSpan = Math.max(2, Math.floor(atkFc * 0.3));
          this.frame = Math.min(wSpan - 1, Math.floor(prog * wSpan));
          if (Math.random() < 0.45) {
            spawnParticles(this.x + (Math.random() - 0.5) * 90, this.z - 60 - Math.random() * 120, '#facc15', 1, 90, 6);
          }
        } else {
          const wSpan = Math.max(1, Math.floor(halfFc * 0.4));
          this.frame = this.attackStyle === 'A'
            ? Math.floor(prog * wSpan)
            : halfFc + Math.floor(prog * wSpan);
        }

        if (this.stateTime >= dur) {
          this.state = 'attack';
          this.stateTime = 0;
          this.didHitPlayer = false;
          this.didHitPlayer2 = false;
          this.projFired = false;

          if (this.cfg.attackMode === 'donghua_boss') {
            const move = this.bossMove || 'wu_punch';
            if (move === 'wu_punch') {
              this.dashVel = this.facing * 650;
              spawnComicBubble(this.x, this.z - 290, '武・破空正拳!!', { accent: '#facc15', sub: 'GOLDEN WU FIST!!', style: 'super' });
              spawnParticles(this.x - this.facing * 40, this.z - 45, '#facc15', 18, 260, 8);
            } else if (move === 'taichi_nova') {
              this.dashVel = 0;
              spawnComicBubble(this.x, this.z - 290, '太極氣勁震地!!', { accent: '#fde047', sub: 'TAI-CHI NOVA!!', style: 'super' });
              spawnParticles(this.x, this.z - 80, '#fef08a', 20, 280, 8);
            } else if (move === 'chi_wave') {
              this.dashVel = -this.facing * 60;
              spawnComicBubble(this.x, this.z - 290, '武聖三連氣功波!!', { accent: '#fb923c', sub: 'MARTIAL CHI WAVE!!', style: 'super' });
            } else {
              this.dashVel = this.facing * 390;
              this.vy = 450;
              this.jumpY = 6;
              spawnComicBubble(this.x, this.z - 290, '宗師流星碎地斬!!', { accent: '#f97316', sub: 'GRANDMASTER SLAM!!', style: 'super' });
              spawnParticles(this.x, this.z - 20, '#facc15', 16, 230, 7);
            }
            sfx.playSwing(3);
          } else if (this.cfg.attackMode === 'dual_unique') {
            if (this.type === 'zebra_rush') {
              if (this.attackStyle === 'A') {
                // Mode A: Turn-around Double Hind-Leg Back Kick toward hero!
                const towardPlayer = dx >= 0 ? 1 : -1;
                this.facing = -towardPlayer;
                this.dashVel = towardPlayer * 145;
                spawnParticles(this.x + towardPlayer * 28, this.z - 22, '#fef08a', 10, 170, 5);
              } else {
                // Mode B: Blazing Stampede Headbutt Rush!
                this.facing = dx >= 0 ? 1 : -1;
                this.dashVel = this.facing * 675;
                spawnParticles(this.x - this.facing * 26, this.z - 16, '#38bdf8', 14, 225, 6);
              }
            } else if (this.type === 'joey_kangaroo') {
              if (this.attackStyle === 'A') {
                // Mode A: Sky-High Somersault Ground-Pound Meteor Stomp!
                this.dashVel = this.facing * 320;
                this.vy = 445;
                this.jumpY = 6;
                spawnParticles(this.x, this.z - 12, '#fde68a', 12, 185, 6);
              } else {
                // Mode B: Pouch Baby Joey Boomerang Toss!
                this.dashVel = -this.facing * 45;
              }
            } else if (this.type === 'kangaroo') {
              if (this.attackStyle === 'A') {
                this.dashVel = this.facing * 260;
              } else {
                this.dashVel = this.facing * 470;
                this.vy = 340;
                this.jumpY = 4;
                spawnParticles(this.x, this.z - 12, '#facc15', 10, 180, 6);
              }
            } else if (this.type === 'zebra') {
              if (this.attackStyle === 'A') {
                this.dashVel = this.facing * 610;
                spawnParticles(this.x - this.facing * 24, this.z - 14, '#f472b6', 12, 210, 6);
              } else {
                this.dashVel = -this.facing * 75;
              }
            } else if (this.type === 'koala') {
              this.dashVel = this.attackStyle === 'A' ? 0 : -this.facing * 50;
            } else if (this.type === 'capybara') {
              if (this.attackStyle === 'A') {
                this.dashVel = this.facing * 240;
                this.vy = 310;
                this.jumpY = 4;
              } else {
                this.dashVel = 0;
              }
            } else if (this.type === 'cactus') {
              if (this.attackStyle === 'A') {
                this.dashVel = this.facing * 560;
                spawnParticles(this.x - this.facing * 20, this.z - 32, '#bef264', 12, 200, 6);
              } else {
                this.dashVel = -this.facing * 60;
              }
            } else if (this.type === 'wizard_ghost') {
              this.dashVel = this.attackStyle === 'A' ? 0 : -this.facing * 70;
            }
            sfx.playSwing(this.attackStyle === 'A' ? 2 : 1);
          } else if (this.cfg.attackMode === 'full10') {
            if (this.type === 'pig' || this.type === 'sheep') {
              this.dashVel = this.facing * (this.type === 'sheep' ? 560 : 590);
              spawnParticles(this.x - this.facing * 26, this.z - 16, '#fde68a', 12, 200, 6);
            } else if (this.type === 'penguin_king') {
              this.dashVel = this.facing * 540;
              spawnParticles(this.x - this.facing * 24, this.z - 14, '#facc15', 12, 190, 6);
            } else if (this.type === 'penguin_ice') {
              this.dashVel = this.facing * 510;
              spawnParticles(this.x - this.facing * 20, this.z - 22, '#67e8f9', 12, 195, 6);
            } else if (this.type === 'rabbit') {
              this.dashVel = this.facing * 570;
              this.vy = 240;
              this.jumpY = 2;
              spawnParticles(this.x - this.facing * 18, this.z - 12, '#f9a8d4', 8, 160, 5);
            } else if (this.type === 'ghost') {
              this.dashVel = -this.facing * 65;
              const orbCol = (this.variant && this.variant.orbColor) || '#c084fc';
              spawnParticles(this.x + this.facing * 20, this.z - 64, orbCol, 10, 150, 5);
            } else if (this.type === 'slime' || this.type === 'slime_mini') {
              this.dashVel = this.facing * (this.type === 'slime_mini' ? 460 : 500);
              spawnParticles(this.x - this.facing * 20, this.z - 25, '#38bdf8', 8, 170, 5);
            } else if (this.type === 'puffer') {
              this.dashVel = this.facing * 520;
              spawnParticles(this.x - this.facing * 24, this.z - 45, '#38bdf8', 10, 190, 5);
            } else if (this.type === 'mushroom') {
              this.dashVel = this.facing * 320;
              this.vy = 290;
              this.jumpY = 2;
              spawnParticles(this.x, this.z - 12, '#fde68a', 7, 140, 5);
            }
            sfx.playSwing((this.type === 'puffer' || this.type === 'mushroom' || this.type === 'pig' || this.type === 'penguin_king' || this.type === 'sheep') ? 2 : 1);
          } else {
            if (this.attackStyle === 'A') {
              const rushSpeed = (this.type === 'star' || this.type === 'boss') ? 430 : 190;
              this.dashVel = this.facing * rushSpeed;
            } else {
              this.dashVel = -this.facing * 45;
            }
            sfx.playSwing(this.cfg.isBoss ? 3 : (this.attackStyle === 'B' ? 2 : 1));
          }
        }
      } else if (this.state === 'attack') {
        this.stateTime += dt;
        this.x += this.dashVel * dt;
        this.dashVel *= Math.pow(0.08, dt);

        if (this.cfg.attackMode === 'donghua_boss') {
          const dur = this.cfg.attackDur || 0.82;
          const prog = Math.min(0.99, this.stateTime / dur);
          const enraged = this.hp < this.maxHp * 0.5;
          const move = this.bossMove || 'wu_punch';
          const wSpan = Math.max(2, Math.floor(atkFc * 0.3));
          this.frame = Math.min(atkFc - 1, wSpan + Math.floor(prog * Math.max(1, atkFc - wSpan)));

          if (move === 'wu_punch') {
            if (prog >= 0.14 && prog <= 0.55 && Math.random() < 0.7) {
              spawnParticles(this.x + this.facing * 60, this.z - 110, '#facc15', 3, 220, 7);
            }
            if (!this.didHitPlayer && prog >= 0.14 && prog <= 0.55) {
              const hitDx = (p.x - this.x) * this.facing;
              if (hitDx >= -40 && hitDx <= 235 && Math.abs(p.z - this.z) <= 50 && p.jumpY < 110) {
                this.didHitPlayer = true;
                addShake(10, 0.22);
                triggerImpactFrame('#fde047', 0.06);
                p.takeDamage(this.cfg.dmg, this.facing, true);
              }
            }
          } else if (move === 'taichi_nova') {
            if (!this.projFired && prog >= 0.28) {
              this.projFired = true;
              addShake(11, 0.24);
              spawnParticles(this.x, this.z - 70, '#fef08a', 26, 320, 8);
              spawnParticles(this.x, this.z - 40, '#1e293b', 16, 260, 7);
              if (Math.hypot(p.x - this.x, (p.z - this.z) * 2.1) <= 215 && p.jumpY < 90) {
                p.takeDamage(this.cfg.dmg, p.x >= this.x ? 1 : -1, true);
              }
            }
          } else if (move === 'chi_wave') {
            if (!this.projFired && prog >= 0.28) {
              this.projFired = true;
              const px = this.x + this.facing * 92;
              const fanVz = enraged ? [-86, -42, 0, 42, 86] : [-58, 0, 58];
              for (const vz of fanVz) {
                game.projectiles.push(new EnemyProjectile(px, this.z, this.facing, 'martial_chi', 22, vz));
              }
              addShake(7, 0.16);
              spawnParticles(px, this.z - 80, '#facc15', 18, 250, 7);
            }
          } else if (move === 'meteor_slam') {
            if (!this.projFired && this.jumpY <= 4 && this.stateTime > 0.22) {
              this.projFired = true;
              addShake(13, 0.28);
              triggerImpactFrame('#fb923c', 0.065);
              spawnParticles(this.x, this.z - 16, '#facc15', 28, 340, 8);
              spawnParticles(this.x, this.z - 12, '#cbd5e1', 18, 260, 7);
              if (Math.hypot(p.x - this.x, (p.z - this.z) * 2.0) <= 205 && p.jumpY < 72) {
                p.takeDamage(this.cfg.dmg + 4, p.x >= this.x ? 1 : -1, true);
              }
              game.projectiles.push(new EnemyProjectile(this.x + 56, this.z, 1, 'martial_chi', 18, 0));
              game.projectiles.push(new EnemyProjectile(this.x - 56, this.z, -1, 'martial_chi', 18, 0));
            }
          }

          if (this.stateTime >= dur) {
            this.state = 'approach';
            this.attackCd = enraged ? 0.78 : this.cfg.cooldown;
            if (Math.random() < 0.5) this.strafeSide *= -1;
          }
        } else if (this.cfg.attackMode === 'dual_unique') {
          const dur = this.cfg.attackDur || 0.64;
          const prog = Math.min(0.99, this.stateTime / dur);
          const wSpan = Math.max(1, Math.floor(halfFc * 0.4));
          const actSpanA = Math.max(1, halfFc - wSpan);
          const actSpanB = Math.max(1, atkFc - (halfFc + wSpan));
          this.frame = this.attackStyle === 'A'
            ? Math.min(halfFc - 1, wSpan + Math.floor(prog * actSpanA))
            : Math.min(atkFc - 1, halfFc + wSpan + Math.floor(prog * actSpanB));

          if (this.type === 'zebra_rush') {
            if (this.attackStyle === 'A') {
              // Mode A: Double Hind-Leg Back Kick (kicks in -this.facing direction!)
              const kickDir = -this.facing;
              const hitDx = (p.x - this.x) * kickDir;
              if (!this.didHitPlayer && prog >= 0.08 && prog <= 0.72) {
                if (hitDx >= -24 && hitDx <= this.cfg.reach + 20 && Math.abs(p.z - this.z) <= 38 && p.jumpY < 64) {
                  this.didHitPlayer = true;
                  addShake(7, 0.16);
                  p.takeDamage(this.cfg.dmg, kickDir, true);
                }
              }
            } else {
              // Mode B: Blazing Stampede Headbutt Charge!
              if (Math.random() < 0.7) {
                spawnParticles(this.x - this.facing * 32, this.z - 16, '#e2e8f0', 2, 165, 5);
              }
              if (!this.didHitPlayer && prog >= 0.12 && prog <= 0.85) {
                const hitDx = (p.x - this.x) * this.facing;
                if (hitDx >= -26 && hitDx <= this.cfg.reach + 22 && Math.abs(p.z - this.z) <= 38 && p.jumpY < 62) {
                  this.didHitPlayer = true;
                  addShake(8, 0.18);
                  p.takeDamage(this.cfg.dmg + 3, this.facing, true);
                }
              }
            }
          } else if (this.type === 'joey_kangaroo') {
            if (this.attackStyle === 'A') {
              // Mode A: Sky-High Somersault Ground-Pound Meteor Stomp AOE on landing!
              if (!this.projFired && this.jumpY <= 5 && this.stateTime > 0.22) {
                this.projFired = true;
                addShake(9, 0.20);
                spawnParticles(this.x, this.z - 12, '#facc15', 20, 260, 7);
                spawnParticles(this.x, this.z - 10, '#f5f5f4', 14, 210, 6);
                if (Math.hypot(p.x - this.x, (p.z - this.z) * 2.0) <= 165 && p.jumpY < 60) {
                  p.takeDamage(this.cfg.dmg + 2, p.x >= this.x ? 1 : -1, true);
                }
              }
            } else if (!this.projFired && prog >= 0.18) {
              // Mode B: Launch Spinning Baby Joey Boomerang (flies out then returns to pouch!)
              this.projFired = true;
              const px = this.x + this.facing * 52;
              const boomCol = (this.variant && this.variant.boomColor) || '#e09148';
              game.projectiles.push(new EnemyProjectile(px, this.z, this.facing, 'joey_boomerang', this.cfg.dmg - 2, 0, boomCol, this));
              spawnParticles(px, this.z - 68, '#fde047', 10, 175, 5);
            }
          } else if (this.type === 'kangaroo') {
            if (this.attackStyle === 'A') {
              const hitDx = (p.x - this.x) * this.facing;
              if (!this.didHitPlayer && prog < 0.45 && hitDx >= -18 && hitDx <= this.cfg.reach && Math.abs(p.z - this.z) <= 34 && p.jumpY < 60) {
                this.didHitPlayer = true;
                p.takeDamage(Math.round(this.cfg.dmg * 0.65), this.facing, false);
              }
              if (!this.didHitPlayer2 && prog >= 0.55 && hitDx >= -18 && hitDx <= this.cfg.reach + 14 && Math.abs(p.z - this.z) <= 34 && p.jumpY < 60) {
                this.didHitPlayer2 = true;
                p.takeDamage(this.cfg.dmg, this.facing, true);
              }
            } else if (!this.didHitPlayer && prog >= 0.15 && prog <= 0.78) {
              const hitDx = (p.x - this.x) * this.facing;
              if (hitDx >= -24 && hitDx <= this.cfg.reach + 24 && Math.abs(p.z - this.z) <= 38 && p.jumpY < 85) {
                this.didHitPlayer = true;
                p.takeDamage(this.cfg.dmg + 4, this.facing, true);
              }
            }
          } else if (this.type === 'zebra') {
            if (this.attackStyle === 'A') {
              if (Math.random() < 0.65) spawnParticles(this.x - this.facing * 24, this.z - 16, '#f472b6', 2, 160, 5);
              if (!this.didHitPlayer && prog >= 0.1 && prog <= 0.72) {
                const hitDx = (p.x - this.x) * this.facing;
                if (hitDx >= -24 && hitDx <= this.cfg.reach + 14 && Math.abs(p.z - this.z) <= 36 && p.jumpY < 60) {
                  this.didHitPlayer = true;
                  p.takeDamage(this.cfg.dmg, this.facing, true);
                }
              }
            } else if (!this.projFired && prog >= 0.15) {
              this.projFired = true;
              const px = this.x + this.facing * 48;
              game.projectiles.push(new EnemyProjectile(px, this.z, this.facing, 'bubblegum', this.cfg.dmg, 0));
              spawnParticles(px, this.z - 64, '#f472b6', 12, 175, 5);
            }
          } else if (this.type === 'koala') {
            if (this.attackStyle === 'A') {
              if (!this.projFired && prog >= 0.15) {
                this.projFired = true;
                addShake(6, 0.16);
                spawnParticles(this.x, this.z - 55, '#c084fc', 18, 240, 6);
                spawnParticles(this.x, this.z - 55, '#38bdf8', 12, 220, 5);
                if (Math.hypot(p.x - this.x, (p.z - this.z) * 2.1) <= 155 && p.jumpY < 72) {
                  p.takeDamage(this.cfg.dmg + 2, p.x >= this.x ? 1 : -1, true);
                }
              }
            } else if (!this.projFired && prog >= 0.15) {
              this.projFired = true;
              const px = this.x + this.facing * 48;
              game.projectiles.push(new EnemyProjectile(px, this.z, this.facing, 'holo_wave', this.cfg.dmg, -26));
              game.projectiles.push(new EnemyProjectile(px, this.z, this.facing, 'holo_wave', this.cfg.dmg, 26));
              spawnParticles(px, this.z - 66, '#38bdf8', 10, 170, 5);
            }
          } else if (this.type === 'capybara') {
            if (this.attackStyle === 'A') {
              if (!this.projFired && this.jumpY <= 4 && this.stateTime > 0.16) {
                this.projFired = true;
                addShake(8, 0.18);
                spawnParticles(this.x, this.z - 12, '#facc15', 18, 250, 7);
                if (Math.hypot(p.x - this.x, (p.z - this.z) * 2.0) <= 160 && p.jumpY < 56) {
                  p.takeDamage(this.cfg.dmg, p.x >= this.x ? 1 : -1, true);
                }
              }
            } else if (!this.projFired && prog >= 0.15) {
              this.projFired = true;
              const px = this.x + this.facing * 44;
              for (const vz of [-46, 0, 46]) {
                game.projectiles.push(new EnemyProjectile(px, this.z, this.facing, 'zen_leaf', 13, vz));
              }
              spawnParticles(px, this.z - 62, '#4ade80', 10, 160, 5);
            }
          } else if (this.type === 'cactus') {
            if (this.attackStyle === 'A') {
              if (Math.random() < 0.6) spawnParticles(this.x, this.z - 34, '#facc15', 2, 170, 5);
              if (!this.didHitPlayer && prog >= 0.2 && prog <= 0.85) {
                const hitDx = (p.x - this.x) * this.facing;
                if (hitDx >= -24 && hitDx <= this.cfg.reach + 16 && Math.abs(p.z - this.z) <= 38 && p.jumpY < 62) {
                  this.didHitPlayer = true;
                  p.takeDamage(this.cfg.dmg, this.facing, true);
                }
              }
            } else if (!this.projFired && prog >= 0.15) {
              this.projFired = true;
              const px = this.x + this.facing * 48;
              for (const vz of [-48, 0, 48]) {
                game.projectiles.push(new EnemyProjectile(px, this.z, this.facing, 'cactus_needle', 14, vz));
              }
              spawnParticles(px, this.z - 58, '#bef264', 12, 180, 5);
            }
          } else if (this.type === 'wizard_ghost') {
            if (this.attackStyle === 'A') {
              if (!this.projFired && prog >= 0.15) {
                this.projFired = true;
                addShake(6, 0.16);
                spawnParticles(this.x, this.z - 60, '#fef08a', 18, 250, 6);
                spawnParticles(this.x, this.z - 60, '#a855f7', 14, 220, 6);
                if (Math.hypot(p.x - this.x, (p.z - this.z) * 2.0) <= 155 && p.jumpY < 76) {
                  p.takeDamage(this.cfg.dmg, p.x >= this.x ? 1 : -1, true);
                }
              }
            } else if (!this.projFired && prog >= 0.15) {
              this.projFired = true;
              const px = this.x + this.facing * 52;
              game.projectiles.push(new EnemyProjectile(px, this.z, this.facing, 'cosmic_meteor', this.cfg.dmg, -34));
              game.projectiles.push(new EnemyProjectile(px, this.z, this.facing, 'cosmic_meteor', this.cfg.dmg, 34));
              spawnParticles(px, this.z - 68, '#a855f7', 14, 190, 6);
            }
          }

          if (this.stateTime >= dur) {
            this.state = 'approach';
            this.attackCd = this.cfg.cooldown;
            if (Math.random() < 0.5) this.strafeSide *= -1;
          }
        } else if (this.cfg.attackMode === 'full10') {
          const dur = this.cfg.attackDur || 0.64;
          const prog = Math.min(0.99, this.stateTime / dur);

          if (this.type === 'pig' || this.type === 'sheep' || this.type === 'penguin_king') {
            // Heavy close-range ramming dash (frames 3 -> 9)
            this.frame = Math.min(9, 3 + Math.floor(prog * 7));
            if (this.frame >= 4 && this.frame <= 6 && Math.random() < 0.55) {
              spawnParticles(this.x - this.facing * 30, this.z - 14, this.type === 'penguin_king' ? '#fde047' : '#e2e8f0', 2, 130, 5);
            }
            if (!this.didHitPlayer && this.frame >= 4 && this.frame <= 7) {
              const hitDx = (p.x - this.x) * this.facing;
              if (hitDx >= -24 && hitDx <= this.cfg.reach && Math.abs(p.z - this.z) <= 36 && p.jumpY < 58) {
                this.didHitPlayer = true;
                p.takeDamage(this.cfg.dmg, this.facing, true);
              }
            }
          } else if (this.type === 'penguin_ice') {
            // Frost belly-slide + icy crystal burst at frame 5!
            this.frame = Math.min(9, 3 + Math.floor(prog * 7));
            if (this.frame >= 4 && this.frame <= 6 && Math.random() < 0.65) {
              spawnParticles(this.x - this.facing * 24, this.z - 22, '#bae6fd', 2, 145, 5);
            }
            if (!this.didHitPlayer && this.frame >= 4 && this.frame <= 7) {
              const hitDx = (p.x - this.x) * this.facing;
              if (hitDx >= -28 && hitDx <= this.cfg.reach && Math.abs(p.z - this.z) <= 38 && p.jumpY < 60) {
                this.didHitPlayer = true;
                p.takeDamage(this.cfg.dmg, this.facing, true);
              }
            }
            if (!this.projFired && this.frame >= 5) {
              this.projFired = true;
              spawnParticles(this.x + this.facing * 28, this.z - 36, '#38bdf8', 10, 175, 5);
              game.projectiles.push(new EnemyProjectile(this.x + this.facing * 44, this.z, this.facing, 'water', 12, 0));
            }
          } else if (this.type === 'rabbit') {
            // High-speed agile bunny pounce!
            this.frame = Math.min(9, 3 + Math.floor(prog * 7));
            if (!this.didHitPlayer && this.frame >= 4 && this.frame <= 7) {
              const hitDx = (p.x - this.x) * this.facing;
              if (hitDx >= -22 && hitDx <= this.cfg.reach && Math.abs(p.z - this.z) <= 34 && p.jumpY < 64) {
                this.didHitPlayer = true;
                p.takeDamage(this.cfg.dmg, this.facing, false);
              }
            }
          } else if (this.type === 'ghost') {
            // Floating specter blasts a variant-colored Ghost Will-o'-Wisp Fireball!
            this.frame = Math.min(9, 3 + Math.floor(prog * 7));
            if (!this.projFired && this.frame >= 5) {
              this.projFired = true;
              const orbCol = (this.variant && this.variant.orbColor) || '#c084fc';
              const px = this.x + this.facing * 48 * this.cfg.scale;
              game.projectiles.push(new EnemyProjectile(px, this.z, this.facing, 'ghost_orb', this.cfg.dmg, 0, orbCol));
              spawnParticles(px, this.z - 64, orbCol, 10, 160, 5);
            }
            if (!this.didHitPlayer && this.frame >= 5 && this.frame <= 7) {
              const hitDx = (p.x - this.x) * this.facing;
              if (hitDx >= -20 && hitDx <= this.cfg.reach && Math.abs(p.z - this.z) <= 34 && p.jumpY < 64) {
                this.didHitPlayer = true;
                p.takeDamage(Math.round(this.cfg.dmg * 0.8), this.facing, false);
              }
            }
          } else if (this.type === 'slime' || this.type === 'slime_mini') {
            // Full 10-frame jelly dash ram (0 -> 9)
            this.frame = Math.min(9, Math.floor(prog * 10));
            if (!this.didHitPlayer && this.frame >= 3 && this.frame <= 7) {
              const hitDx = (p.x - this.x) * this.facing;
              if (hitDx >= -24 && hitDx <= this.cfg.reach && Math.abs(p.z - this.z) <= 34 && p.jumpY < 54) {
                this.didHitPlayer = true;
                p.takeDamage(this.cfg.dmg, this.facing, false);
              }
            }
          } else if (this.type === 'puffer') {
            // Spiky aqua dash (frames 4 -> 9)
            this.frame = Math.min(9, 4 + Math.floor(prog * 6));
            if (!this.didHitPlayer && this.frame >= 4 && this.frame <= 7) {
              const hitDx = (p.x - this.x) * this.facing;
              if (hitDx >= -24 && hitDx <= this.cfg.reach && Math.abs(p.z - this.z) <= 36 && p.jumpY < 60) {
                this.didHitPlayer = true;
                p.takeDamage(this.cfg.dmg, this.facing, true);
              }
            }
          } else if (this.type === 'mushroom') {
            // Leap -> Diving Headbutt -> Ground Slam + Mini Spore Burst (frames 3 -> 9)
            this.frame = Math.min(9, 3 + Math.floor(prog * 7));
            if (!this.didHitPlayer && this.frame >= 4 && this.frame <= 6) {
              const hitDx = (p.x - this.x) * this.facing;
              if (hitDx >= -34 && hitDx <= this.cfg.reach && Math.abs(p.z - this.z) <= 40 && p.jumpY < 64) {
                this.didHitPlayer = true;
                p.takeDamage(this.cfg.dmg, this.facing, true);
              }
            }
            // Frame 6 ground slam burst releases 2 flying mini-mushroom spores!
            if (!this.projFired && this.frame >= 6) {
              this.projFired = true;
              addShake(5, 0.14);
              spawnParticles(this.x, this.z - 16, '#fb923c', 12, 185, 6);
              game.projectiles.push(new EnemyProjectile(this.x + this.facing * 42, this.z, this.facing, 'spore', 11, -24));
              game.projectiles.push(new EnemyProjectile(this.x + this.facing * 42, this.z, this.facing, 'spore', 11, 24));
            }
          }

          if (this.stateTime >= dur) {
            this.state = 'approach';
            this.attackCd = this.cfg.cooldown;
            if (Math.random() < 0.5) this.strafeSide *= -1;
          }
        } else if (this.attackStyle === 'A') {
          // Style A: Close-range Rush / Buzzsaw Spin / Shell Lunge (frames 2 -> 3 -> 4)
          const durA = 0.42;
          this.frame = Math.min(4, 2 + Math.floor((this.stateTime / durA) * 3));

          if (!this.didHitPlayer && this.stateTime >= 0.06 && this.stateTime <= 0.28) {
            const hitDx = (p.x - this.x) * this.facing;
            if (hitDx >= -22 && hitDx <= this.cfg.reach && Math.abs(p.z - this.z) <= 34 && p.jumpY < 58) {
              this.didHitPlayer = true;
              const heavy = this.type === 'boss';
              p.takeDamage(this.cfg.dmg, this.facing, heavy);
            }
          }
          if (this.stateTime >= durA) {
            this.state = 'approach';
            this.attackCd = this.cfg.cooldown * (this.cfg.isBoss && this.hp < this.maxHp * 0.5 ? 0.72 : 1.0);
            if (Math.random() < 0.45) this.strafeSide *= -1;
          }
        } else {
          // Style B: Ranged Cosmic Star / Hydro Water Gun Shot (frames 7 -> 8 -> 9)
          const durB = 0.48;
          this.frame = Math.min(9, 7 + Math.floor((this.stateTime / durB) * 3));

          if (!this.projFired && this.stateTime >= 0.10) {
            this.projFired = true;
            const px = this.x + this.facing * 52 * this.cfg.scale;
            const kind = this.cfg.projKind || 'water';
            const enraged = this.cfg.isBoss && this.hp < this.maxHp * 0.5;
            if (this.cfg.isBoss) {
              // Boss fires a 3-way cosmic star spread (or 2-way before enraged)!
              const fanVz = enraged ? [-68, 0, 68] : [-42, 42];
              for (const vz of fanVz) {
                game.projectiles.push(new EnemyProjectile(px, this.z, this.facing, kind, Math.round(this.cfg.dmg * 0.8), vz));
              }
            } else {
              game.projectiles.push(new EnemyProjectile(px, this.z, this.facing, kind, Math.round(this.cfg.dmg * 0.85), 0));
            }
            spawnParticles(px, this.z - 68, kind === 'star' ? '#fb7185' : '#38bdf8', 8, 150, 5);
          }

          if (this.stateTime >= durB) {
            this.state = 'approach';
            this.attackCd = (this.cfg.cooldown + 0.25) * (this.cfg.isBoss && this.hp < this.maxHp * 0.5 ? 0.72 : 1.0);
            if (Math.random() < 0.5) this.strafeSide *= -1;
          }
        }
      } else {
        // APPROACH / FLANK AI (Belt-scroller slot spacing + Unique Per-Monster Locomotion!)
        this.facing = dx >= 0 ? 1 : -1;

        if (getCurrentStage().isTraining && game.trainingDummyMode) {
          // 🥋 Training Dummy Mode: stand calmly facing hero (or animate move in place when previewing move!)
          this.vx *= Math.pow(0.05, dt);
          if (this._trainingPreviewMove) {
            const mvSheet = this.resolveEnemySheet('move');
            const mvFc = SpriteBank.getFrameCount(mvSheet, 10);
            this.frame = Math.floor(this.animTime * 11) % mvFc;
          } else {
            this.frame = 0;
          }
          this.applyScreenWallBounds(dt);
          return;
        }

        const attackers = game.enemies.filter((e) => !e.dead && (e.state === 'windup' || e.state === 'attack')).length;
        const desiredDist = (this.type === 'koala' || this.type === 'wizard_ghost')
          ? 295
          : (this.type === 'ghost'
            ? 275
            : (this.type === 'joey_kangaroo'
              ? 230
              : (this.type === 'donghua_boss' || this.type === 'zebra_rush'
                ? 210
                : (this.type === 'capybara'
                  ? 135
                  : ((this.type === 'star' || this.type === 'puffer' || this.type === 'slime' || this.type === 'pig' || this.type === 'sheep' || this.type === 'penguin_king' || this.type === 'penguin_ice' || this.type === 'rabbit' || this.type === 'zebra' || this.type === 'cactus') ? 195 : (this.cfg.reach - 10))))));
        const targetX = p.x + this.strafeSide * desiredDist;
        let extraZ = (attackers >= 2 ? this.strafeOffsetZ * 1.8 : 0);
        // Unique Locomotion Z-paths: Skateboard Zebra drifts, Wizard Ghost glides figure-8, Joey Kangaroo zig-zag hops!
        if (this.type === 'zebra') extraZ += Math.sin(this.animTime * 4.2 + this.id) * 52;
        else if (this.type === 'wizard_ghost') extraZ += Math.sin(this.animTime * 2.6 + this.id) * 38;
        else if (this.type === 'joey_kangaroo') extraZ += Math.cos(this.animTime * 3.4 + this.id * 1.7) * 46;
        const targetZ = Math.max(Z_MIN, Math.min(Z_MAX, p.z + extraZ));

        const toX = targetX - this.x;
        const toZ = targetZ - this.z;
        const distToTarget = Math.hypot(toX, toZ);

        if (distToTarget > 14) {
          this.isMoving = true;
          // Zebra Rush: Stop-and-go hoof-pawing stampede bursts!
          let speedBoost = 1.0;
          if (this.type === 'zebra_rush') {
            const stampedePhase = (this.animTime * 1.55 + (this.id % 3) * 0.33) % 1.0;
            speedBoost = stampedePhase < 0.28 ? 0.18 : 1.65;
            if (stampedePhase >= 0.28 && Math.random() < 0.28) {
              spawnParticles(this.x - this.facing * 22, this.z - 6, '#f5f5f4', 1, 85, 4);
            }
          } else if (this.type === 'cactus' && (Math.floor(this.animTime * 2) % 3 === 1)) {
            speedBoost = 1.42;
          }
          const mx = (toX / distToTarget) * this.cfg.speedX * speedBoost;
          const mz = (toZ / distToTarget) * this.cfg.speedZ;
          this.x += mx * dt;
          this.z += mz * dt;
          this.frame = Math.floor(this.animTime * moveFps) % moveFc;

          // Unique Locomotion: Joey Kangaroo bounces in high pogo arcs, Boxing Kangaroo in quick boxing hops!
          if (this.type === 'joey_kangaroo' && this.jumpY === 0) {
            this.vy = 265;
            this.jumpY = 2;
            spawnParticles(this.x, this.z - 4, '#f5f5f4', 3, 75, 4);
          } else if (this.type === 'kangaroo' && this.jumpY === 0) {
            this.vy = 215;
            this.jumpY = 2;
          }
          if (this.type === 'zebra' && Math.random() < 0.25) {
            spawnParticles(this.x - this.facing * 18, this.z - 6, '#f472b6', 1, 70, 3);
          }
        } else {
          this.isMoving = false;
          const idleFps = this.cfg.idleSheet ? (StudioState.getAction(this.cfg.idleSheet)?.fps || 8) : moveFps * 0.7;
          const idleFc = this.cfg.idleSheet ? SpriteBank.getFrameCount(this.cfg.idleSheet, moveFc) : moveFc;
          this.frame = Math.floor(this.animTime * idleFps) % idleFc;
        }

        // Soft separation from other enemies so they don't stack on 1 pixel
        for (const other of game.enemies) {
          if (other === this || other.dead) continue;
          const ox = this.x - other.x;
          const oz = this.z - other.z;
          const d = Math.hypot(ox, oz);
          if (d > 0.1 && d < 66) {
            this.x += (ox / d) * 75 * dt;
            this.z += (oz / d) * 45 * dt;
          }
        }

        // Trigger Attack!
        const absDx = Math.abs(dx);
        const inRangeZ = Math.abs(dz) <= (this.type === 'donghua_boss' ? 46 : 34);
        if (inRangeZ && this.attackCd <= 0 && (attackers < 2 || this.cfg.isBoss)) {
          if (this.cfg.attackMode === 'donghua_boss') {
            const r = Math.random();
            if (absDx <= 185) {
              this.bossMove = r < 0.45 ? 'taichi_nova' : (r < 0.80 ? 'wu_punch' : 'meteor_slam');
            } else if (absDx <= 340) {
              this.bossMove = r < 0.40 ? 'wu_punch' : (r < 0.72 ? 'meteor_slam' : 'chi_wave');
            } else if (absDx <= 560) {
              this.bossMove = r < 0.65 ? 'chi_wave' : 'meteor_slam';
            } else {
              this.bossMove = null;
            }
            if (this.bossMove) {
              this.attackStyle = (this.bossMove === 'chi_wave') ? 'B' : 'A';
              this.state = 'windup';
              this.stateTime = 0;
            }
          } else if (this.cfg.attackMode === 'dual_unique') {
            const closeDist = (this.type === 'koala' || this.type === 'wizard_ghost')
              ? 148
              : (this.type === 'zebra_rush' ? 158 : 175);
            const farDist = (this.type === 'kangaroo') ? 285 : (this.type === 'zebra_rush' ? 385 : 430);
            if (absDx <= closeDist) {
              this.attackStyle = 'A';
              this.state = 'windup';
              this.stateTime = 0;
            } else if (absDx <= farDist && Math.random() < (this.cfg.rangedChance || 0.6)) {
              this.attackStyle = 'B';
              this.state = 'windup';
              this.stateTime = 0;
            }
          } else if (this.cfg.attackMode === 'full10') {
            const triggerDist = this.type === 'ghost'
              ? 390
              : ((this.type === 'puffer' || this.type === 'slime' || this.type === 'pig' || this.type === 'sheep' || this.type === 'penguin_king' || this.type === 'penguin_ice' || this.type === 'rabbit') ? 255 : 210);
            if (absDx <= triggerDist) {
              this.attackStyle = this.type === 'ghost' ? 'B' : 'A';
              this.state = 'windup';
              this.stateTime = 0;
            }
          } else {
            const meleeRange = this.type === 'star' ? 210 : this.cfg.reach + 16;
            if (absDx <= meleeRange) {
              // Up close: mostly Style A melee, occasional Style B point-blank blast
              this.attackStyle = Math.random() < 0.78 ? 'A' : 'B';
              this.state = 'windup';
              this.stateTime = 0;
            } else if (absDx >= 180 && absDx <= 450 && Math.random() < (this.cfg.rangedChance || 0.6)) {
              // Mid-far distance on same Z lane: Style B ranged projectile attack!
              this.attackStyle = 'B';
              this.state = 'windup';
              this.stateTime = 0;
            }
          }
        }
      }

      // Clamp Z & keep entered enemies strictly inside the player's current screen with wall-bounce on knockback
      this.z = Math.max(Z_MIN, Math.min(Z_MAX, this.z));
      this.applyScreenWallBounds(dt);
    }

    applyScreenWallBounds(dt) {
      this.wallBounceCd = Math.max(0, (this.wallBounceCd || 0) - dt);
      const margin = 48;
      const wallMinX = Math.max(margin, game.camX + margin);
      const wallMaxX = Math.min(STAGE_W - margin, game.camX + CANVAS_W - margin);

      if (!this.enteredScreen) {
        if (this.x >= wallMinX && this.x <= wallMaxX) {
          this.enteredScreen = true;
        } else {
          // Even before fully entering, never let knockback launch them further off-screen
          const outerMin = game.camX - 90;
          const outerMax = game.camX + CANVAS_W + 90;
          if (this.x < outerMin) {
            this.x = outerMin;
            if (this.vx < 0) this.vx = Math.abs(this.vx) * 0.5;
          } else if (this.x > outerMax) {
            this.x = outerMax;
            if (this.vx > 0) this.vx = -Math.abs(this.vx) * 0.5;
          }
          return;
        }
      }

      const hitLeft = this.x < wallMinX;
      const hitRight = this.x > wallMaxX;
      if (!hitLeft && !hitRight) return;

      this.x = hitLeft ? wallMinX : wallMaxX;
      const impactSpeed = Math.abs(this.vx);
      const isKnockedOrFlying = this.state === 'knocked' || this.state === 'hurt' || this.state === 'dead' || this.jumpY > 0;

      if (isKnockedOrFlying && impactSpeed > 85 && this.wallBounceCd <= 0) {
        // Classic arcade wall-slam rebound!
        const reboundVx = Math.min(340, Math.max(165, impactSpeed * 0.54));
        this.vx = hitLeft ? reboundVx : -reboundVx;
        this.vy = Math.max(this.vy, 210);
        if (this.jumpY < 8) this.jumpY = 8;
        this.wallBounceCd = 0.22;
        const wallFxX = hitLeft ? game.camX + 18 : game.camX + CANVAS_W - 18;
        spawnParticles(wallFxX, this.z - this.jumpY - 64, '#f8fafc', 12, 220, 6);
        spawnParticles(wallFxX, this.z - this.jumpY - 64, '#fde047', 6, 180, 5);
        addShake(6, 0.12);
        sfx.playHit(false);
        if (this.state !== 'dead') {
          addFloatText(this.x, this.z - this.jumpY - 125, '撞牆!!', '#fde047', 20);
        }
      } else {
        if ((hitLeft && this.vx < 0) || (hitRight && this.vx > 0)) this.vx = 0;
        if ((hitLeft && this.dashVel < 0) || (hitRight && this.dashVel > 0)) this.dashVel = 0;
      }
    }

    draw(ctx) {
      if (this.deadFade <= 0) return;
      const sc = this.cfg.scale;
      const armorMode = this.cfg.superArmor || (this.cfg.armor ? 'attack' : 'none');
      const armorActiveNow = !this.dead && (
        armorMode === 'always' ||
        (armorMode === 'hits' && this.armorShieldCount > 0) ||
        (armorMode === 'attack' && (this.state === 'windup' || this.state === 'attack'))
      );

      ctx.save();
      if (this.state === 'dead') {
        // Classic arcade KO blink fade after dizzy ground pose
        if (this.jumpY === 0 && this.stateTime > 1.05 && Math.floor(this.stateTime * 22) % 2 === 0) {
          ctx.globalAlpha = Math.max(0, this.deadFade * 0.3);
        } else {
          ctx.globalAlpha = Math.max(0, this.deadFade);
        }
      }

      // Ground Shadow
      const shScale = Math.max(0.4, 1 - this.jumpY / 240) * sc;
      ctx.fillStyle = 'rgba(8, 5, 18, 0.5)';
      ctx.beginPath();
      ctx.ellipse(this.x, this.z + 2, 46 * shScale, 13 * shScale, 0, 0, Math.PI * 2);
      ctx.fill();

      // Active Super Armor Ring at Feet (Golden for always/attack, Cyan-Gold for Hit-Shield)
      if (armorActiveNow) {
        ctx.save();
        ctx.strokeStyle = armorMode === 'hits' ? 'rgba(56, 189, 248, 0.85)' : 'rgba(250, 204, 21, 0.85)';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.ellipse(this.x, this.z + 2, 50 * shScale, 15 * shScale, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }

      // Boss golden martial / enraged crimson cosmic aura
      if (this.cfg.isBoss && !this.dead && (this.hp < this.maxHp * 0.5 || this.type === 'donghua_boss' || armorMode === 'always')) {
        const enraged = this.hp < this.maxHp * 0.5;
        const pulse = 1 + Math.sin(game.time * (enraged ? 14 : 7)) * 0.1;
        const auraR = (this.type === 'donghua_boss' ? 105 : 118) * sc * pulse;
        const auraY = this.z - this.jumpY - 78 * sc;
        const grad = ctx.createRadialGradient(this.x, auraY, 18, this.x, auraY, auraR);
        if (enraged) {
          grad.addColorStop(0, this.type === 'donghua_boss' ? 'rgba(250, 204, 21, 0.52)' : 'rgba(244, 63, 94, 0.45)');
          grad.addColorStop(0.55, 'rgba(244, 63, 94, 0.28)');
          grad.addColorStop(1, 'rgba(244, 63, 94, 0)');
        } else {
          grad.addColorStop(0, 'rgba(250, 204, 21, 0.34)');
          grad.addColorStop(0.6, 'rgba(245, 158, 11, 0.14)');
          grad.addColorStop(1, 'rgba(245, 158, 11, 0)');
        }
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(this.x, auraY, auraR, 0, Math.PI * 2);
        ctx.fill();
      }

      // Select HD Sprite Sheet by state (dedicated hurt sheet & customPrefix when available!)
      let sheetKey = (!this.isMoving && this.cfg.idleSheet && SpriteBank.sheets[this.cfg.idleSheet])
        ? this.cfg.idleSheet
        : this.resolveEnemySheet('move');
      if (this.state === 'windup') {
        sheetKey = (this.cfg.windupSheet && SpriteBank.sheets[this.cfg.windupSheet])
          ? this.cfg.windupSheet
          : this.resolveEnemySheet('attack');
      } else if (this.state === 'attack') {
        sheetKey = this.resolveEnemySheet('attack');
      } else if (this.state === 'hurt') {
        sheetKey = this.cfg.hasHurt ? this.resolveEnemySheet('hurt', 'ko') : this.resolveEnemySheet('ko');
      } else if (this.state === 'knocked' || this.state === 'dead') {
        sheetKey = this.resolveEnemySheet('ko');
      }

      let drawFrameIdx = this.frame;
      if (this._customAction && SpriteBank.sheets[this._customAction.sheetKey]) {
        sheetKey = this._customAction.sheetKey;
        drawFrameIdx = this._customFrame || 0;
      }

      SpriteBank.drawFrame(
        ctx,
        sheetKey,
        drawFrameIdx,
        this.x,
        this.z - this.jumpY,
        this.facing,
        sc,
        this.hurtFlash > 0,
        this.variant
      );

      ctx.restore();

      // Telegraph indicator during windup: "!" (Melee) vs "⚡!" (Ranged Style B) vs Boss martial callouts
      if (this.state === 'windup' && !this.dead && !this.cfg.windupSheet) {
        const ty = Math.max(94, this.z - this.jumpY - 154 * sc);
        const isRanged = this.attackStyle === 'B';
        ctx.save();
        let label = isRanged ? '⚡!' : '!';
        let fillCol = isRanged ? (this.cfg.projKind === 'star' ? '#fb7185' : '#38bdf8') : '#facc15';
        if (this.type === 'donghua_boss') {
          if (this.bossMove === 'wu_punch') { label = '武!'; fillCol = '#fde047'; }
          else if (this.bossMove === 'taichi_nova') { label = '震!'; fillCol = '#fb7185'; }
          else if (this.bossMove === 'chi_wave') { label = '氣!'; fillCol = '#38bdf8'; }
          else if (this.bossMove === 'meteor_slam') { label = '斬!'; fillCol = '#f97316'; }
        }
        ctx.fillStyle = fillCol;
        ctx.strokeStyle = '#0d0b14';
        ctx.lineWidth = 5;
        ctx.font = this.type === 'donghua_boss' ? '900 32px "Noto Sans TC", sans-serif' : '900 26px sans-serif';
        ctx.textAlign = 'center';
        ctx.strokeText(label, this.x, ty);
        ctx.fillText(label, this.x, ty);
        ctx.restore();
      }

      // Mini HP bar + Super Armor badge overhead for regular enemies
      if (!this.dead && !this.cfg.isBoss && (this.hp < this.maxHp || armorMode === 'always' || armorMode === 'hits')) {
        const bw = Math.round(68 * Math.max(0.85, Math.min(1.55, sc)));
        const bx = this.x - bw / 2;
        const by = this.z - this.jumpY - 156 * sc;
        ctx.fillStyle = 'rgba(0,0,0,0.75)';
        ctx.fillRect(bx - 1, by - 1, bw + 2, 8);
        if (armorActiveNow) {
          ctx.strokeStyle = armorMode === 'hits' ? '#38bdf8' : '#fde047';
          ctx.lineWidth = 1.5;
          ctx.strokeRect(bx - 1.5, by - 1.5, bw + 3, 9);
        }
        ctx.fillStyle = '#ef4444';
        ctx.fillRect(bx, by, bw * Math.max(0, Math.min(1, this.hp / this.maxHp)), 6);
        if (armorMode === 'hits' && this.armorShieldCount > 0) {
          ctx.save();
          ctx.font = '800 11px "Noto Sans TC", sans-serif';
          ctx.fillStyle = '#7dd3fc';
          ctx.textAlign = 'center';
          ctx.fillText(`🛡×${this.armorShieldCount}`, this.x, by - 5);
          ctx.restore();
        } else if (armorMode === 'always') {
          ctx.save();
          ctx.font = '800 11px "Noto Sans TC", sans-serif';
          ctx.fillStyle = '#fde047';
          ctx.textAlign = 'center';
          ctx.fillText('🛡霸體', this.x, by - 5);
          ctx.restore();
        }
      }
    }
  }

  // --------------------------------------------------------------------------
  // SANRIO KIDS RICE COOKER SUPPLY BOXES (10-FRAME OPENING!) & KAWAII PICKUPS
  // --------------------------------------------------------------------------
  const KAWAII_FOOD_NAMES = [
    '🍗 黃金炸雞腿',
    '🍰 草莓蛋糕',
    '🍔 微笑漢堡',
    '🥟 熱騰騰肉包',
    '🍓 草莓大福',
    '🍡 三色糰子',
  ];

  class Prop {
    constructor(x, z, kind, dropType) {
      this.id = nextEntityId++;
      this.x = x;
      this.z = z;
      this.kind = kind; // 'crate' (HP Pink Kids Rice Cooker) | 'drum' (MP Starry Blue Kids Rice Cooker)
      this.dropType = dropType; // food | crystal | coin
      this.hp = 35;
      this.broken = false; // Prevents further hits once opened
      this.opening = false;
      this.openTime = 0;
      this.openFrame = 0;
      this.dropped = false;
      this.gone = false;
      this.alpha = 1;
      this.age = Math.random() * 6;
      this.shake = 0;
    }

    hit(dmg) {
      if (this.broken) return;
      this.hp -= dmg;
      this.shake = 0.16;
      sfx.playHit(false);
      const isMp = this.kind === 'drum' || this.dropType === 'crystal';
      spawnParticles(this.x, this.z - 38, isMp ? '#7dd3fc' : '#f9a8d4', 8, 170, 5);
      if (this.hp <= 0) {
        this.broken = true;
        this.opening = true;
        this.openTime = 0;
        this.openFrame = 0;
        this.dropped = false;
        sfx.playCrateBreak();
        addFloatText(this.x, this.z - 84, isMp ? '✨ 魔力電鍋開鍋!' : '✨ 美味電鍋開鍋!', isMp ? '#7dd3fc' : '#f9a8d4', 17);
      }
    }

    update(dt) {
      this.age += dt;
      if (this.shake > 0) this.shake -= dt;
      if (this.opening && !this.gone) {
        this.openTime += dt;
        const fps = 14;
        const animDur = 10 / fps; // ~0.714s full 10-frame lid-pop opening!
        this.openFrame = Math.min(9, Math.floor(this.openTime * fps));
        // Spawn HP food or starry blue mana bottle right as lid bursts open on Frame 4!
        if (this.openFrame >= 4 && !this.dropped) {
          this.dropped = true;
          const isMp = this.kind === 'drum' || this.dropType === 'crystal';
          spawnParticles(this.x, this.z - 54, isMp ? '#38bdf8' : '#fef08a', 16, 240, 7);
          spawnParticles(this.x, this.z - 46, '#ffffff', 10, 180, 6);
          if (this.dropType) {
            game.pickups.push(new Pickup(this.x, this.z, this.dropType));
          }
        }
        // Hold cute happy ^ ^ open rice cooker briefly, then gently fade away
        const holdEnd = animDur + 0.55;
        const fadeDur = 0.45;
        if (this.openTime > holdEnd) {
          this.alpha = Math.max(0, 1 - (this.openTime - holdEnd) / fadeDur);
          if (this.alpha <= 0) this.gone = true;
        }
      }
    }

    draw(ctx) {
      if (this.gone) return;
      const sx = this.shake > 0 ? (Math.random() - 0.5) * 9 : 0;
      const isMp = this.kind === 'drum' || this.dropType === 'crystal';
      const sheet = SpriteBank.bgImages && SpriteBank.bgImages[isMp ? 'cooker_mp' : 'cooker_hp'];

      ctx.save();
      ctx.globalAlpha = this.alpha;
      ctx.fillStyle = 'rgba(26, 16, 44, 0.34)';
      ctx.beginPath();
      ctx.ellipse(this.x, this.z + 3, 42, 11, 0, 0, Math.PI * 2);
      ctx.fill();

      if (sheet && sheet.width >= 500) {
        const cols = 5, rows = 2;
        const cw = sheet.width / cols;
        const ch = sheet.height / rows;
        const fIdx = this.opening ? this.openFrame : 0;
        const fc = fIdx % cols;
        const fr = Math.floor(fIdx / cols);
        // Gentle idle cute bounce before opened
        const idleSquash = !this.opening ? Math.sin(this.age * 4.5) * 0.025 : 0;
        const drawScale = 0.86;
        const dw = cw * drawScale;
        const dh = ch * drawScale;
        // Anchor matches ox = 86, oy = 166 in 200x200 cell!
        const anchorX = (86 / 200) * dw;
        const anchorY = (166 / 200) * dh;

        ctx.translate(Math.round(this.x + sx), Math.round(this.z));
        ctx.scale(1 - idleSquash, 1 + idleSquash);
        ctx.drawImage(sheet, fc * cw, fr * ch, cw, ch, -anchorX, -anchorY, dw, dh);
      } else {
        // Fallback cute vector rice cooker if sheet hasn't loaded yet
        ctx.translate(Math.round(this.x + sx), Math.round(this.z));
        ctx.lineWidth = 3.5;
        ctx.strokeStyle = '#3a2449';
        ctx.fillStyle = isMp ? '#60a5fa' : '#ff8fb1';
        ctx.beginPath();
        ctx.roundRect(-34, -56, 68, 52, 14);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = isMp ? '#e0f2fe' : '#ffe4ec';
        ctx.beginPath();
        ctx.arc(0, -56, 33, Math.PI, 0);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  class Pickup {
    constructor(x, z, type) {
      this.x = x;
      this.z = z;
      this.type = type; // food | crystal | coin
      this.foodIdx = Math.floor(Math.random() * KAWAII_FOOD_NAMES.length);
      this.vy = 285;
      this.jumpY = 26;
      this.taken = false;
      this.age = 0;
    }

    update(dt) {
      this.age += dt;
      if (this.jumpY > 0 || this.vy > 0) {
        this.jumpY += this.vy * dt;
        this.vy -= 900 * dt;
        if (this.jumpY <= 0) {
          this.jumpY = 0;
          this.vy = 0;
        }
      }
      const p = game.player;
      if (this.age > 0.2 && Math.abs(p.x - this.x) < 58 && Math.abs(p.z - this.z) < 34) {
        this.taken = true;
        sfx.playPickup(this.type);
        if (this.type === 'food') {
          p.hp = Math.min(p.maxHp, p.hp + 50);
          const fName = KAWAII_FOOD_NAMES[this.foodIdx] || '🍗 美味補給';
          addFloatText(this.x, this.z - 64, `${fName} HP+50!`, '#4ade80', 20);
          spawnParticles(this.x, this.z - 30, '#f9a8d4', 10, 180, 6);
          spawnParticles(this.x, this.z - 30, '#4ade80', 10, 180, 6);
        } else if (this.type === 'crystal') {
          p.energy = Math.min(p.maxEnergy, p.energy + 55);
          addFloatText(this.x, this.z - 64, '🌙 星月魔力 +55!', '#38bdf8', 21);
          spawnParticles(this.x, this.z - 30, '#38bdf8', 12, 190, 6);
          spawnParticles(this.x, this.z - 30, '#fef08a', 8, 160, 5);
        } else {
          game.score += 500;
          addFloatText(this.x, this.z - 60, '+500', '#facc15', 20);
          spawnParticles(this.x, this.z - 30, '#facc15', 10, 160, 5);
        }
      }
    }

    draw(ctx) {
      if (this.taken) return;
      const bob = Math.sin(this.age * 6.5) * 4.5;
      ctx.save();
      ctx.fillStyle = 'rgba(26, 16, 44, 0.34)';
      ctx.beginPath();
      ctx.ellipse(this.x, this.z + 2, 24, 7.5, 0, 0, Math.PI * 2);
      ctx.fill();

      ctx.translate(Math.round(this.x), Math.round(this.z - this.jumpY - 24 + bob));

      if (this.type === 'food') {
        // Soft warm healing glow halo behind kawaii food!
        const aura = ctx.createRadialGradient(0, 0, 6, 0, 0, 34);
        aura.addColorStop(0, 'rgba(254, 240, 138, 0.55)');
        aura.addColorStop(0.6, 'rgba(249, 168, 212, 0.25)');
        aura.addColorStop(1, 'rgba(249, 168, 212, 0)');
        ctx.fillStyle = aura;
        ctx.beginPath();
        ctx.arc(0, 0, 34, 0, Math.PI * 2);
        ctx.fill();

        const foodsImg = SpriteBank.bgImages && SpriteBank.bgImages.foods;
        if (foodsImg && foodsImg.width >= 384) {
          const fw = foodsImg.width / 6;
          const fh = foodsImg.height;
          const sz = 66;
          ctx.drawImage(foodsImg, this.foodIdx * fw, 0, fw, fh, -sz / 2, -sz / 2, sz, sz);
        } else {
          ctx.lineWidth = 3.2;
          ctx.strokeStyle = '#3a2449';
          ctx.fillStyle = '#fb923c';
          ctx.beginPath();
          ctx.ellipse(0, 0, 18, 13, -0.2, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        }
      } else if (this.type === 'crystal') {
        // Soft celestial blue starry aura behind Starry Moon Mana Bottle!
        const aura = ctx.createRadialGradient(0, 0, 6, 0, 0, 36);
        aura.addColorStop(0, 'rgba(56, 189, 248, 0.58)');
        aura.addColorStop(0.6, 'rgba(129, 140, 248, 0.26)');
        aura.addColorStop(1, 'rgba(56, 189, 248, 0)');
        ctx.fillStyle = aura;
        ctx.beginPath();
        ctx.arc(0, 0, 36, 0, Math.PI * 2);
        ctx.fill();

        const manaImg = SpriteBank.bgImages && SpriteBank.bgImages.mana;
        if (manaImg && manaImg.width >= 80) {
          const sz = 68;
          ctx.drawImage(manaImg, -sz / 2, -sz / 2 - 4, sz, sz);
        } else {
          ctx.lineWidth = 3.2;
          ctx.strokeStyle = '#3a2449';
          ctx.fillStyle = '#38bdf8';
          ctx.beginPath();
          ctx.roundRect(-14, -18, 28, 36, 10);
          ctx.fill();
          ctx.stroke();
        }
      } else {
        // Cute Gold Arcade Star Coin
        ctx.lineWidth = 3.2;
        ctx.strokeStyle = '#3a2449';
        ctx.fillStyle = '#facc15';
        ctx.beginPath();
        ctx.arc(0, 0, 14, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#fef08a';
        ctx.fillRect(-3, -7, 6, 14);
      }
      ctx.restore();
    }
  }

  // ==========================================================================
  // 5. STAGE BACKGROUND (3 ELEMENTARY SCHOOL CAMPUS PARALLAX THEMES)
  // ==========================================================================
  const SCHOOL_THEMES = {
    starfish: {
      sky: ['#1e40af', '#0ea5e9', '#bae6fd'],
      celestialType: 'sun',
      farFill: '#1e3a8a',
      farWin: 'rgba(254, 240, 138, 0.5)',
      wallA: '#f8fafc',
      wallB: '#f1f5f9',
      wallStroke: '#334155',
      roof: '#0284c7',
      doorFill: '#1e293b',
      doorLine: '#475569',
      winTop: '#38bdf8',
      winBot: '#0369a1',
      winBorder: '#e2e8f0',
      upperWin: '#7dd3fc',
      signBg: '#0c4a6e',
      sidewalk: '#cbd5e1',
      curb: '#64748b',
      road: ['#b91c1c', '#991b1b', '#7f1d1d'], // School red running track!
      laneMark: 'rgba(255, 255, 255, 0.72)',
      puddleA: 'rgba(56, 189, 248, 0.16)',
      puddleB: 'rgba(254, 240, 138, 0.14)',
      lampGlow: 'rgba(254, 240, 138, 0.12)',
    },
    aqiang: {
      sky: ['#431407', '#c2410c', '#fb923c'],
      celestialType: 'sunset',
      farFill: '#451a03',
      farWin: 'rgba(253, 224, 71, 0.55)',
      wallA: '#7c2d12',
      wallB: '#9a3412',
      wallStroke: '#290f07',
      roof: '#b45309',
      doorFill: '#291008',
      doorLine: '#7c2d12',
      winTop: '#f59e0b',
      winBot: '#451a03',
      winBorder: '#fde68a',
      upperWin: '#fbbf24',
      signBg: '#2b0d06',
      sidewalk: '#78716c',
      curb: '#44403c',
      road: ['#3b2f2f', '#2e2424', '#1f1818'],
      laneMark: 'rgba(251, 191, 36, 0.55)',
      puddleA: 'rgba(249, 115, 22, 0.18)',
      puddleB: 'rgba(250, 204, 21, 0.12)',
      lampGlow: 'rgba(251, 191, 36, 0.24)',
    },
    donghua: {
      sky: ['#0c081c', '#1e1b4b', '#3b1d5e'],
      celestialType: 'winterMoon',
      farFill: '#150d29',
      farWin: 'rgba(186, 230, 253, 0.45)',
      wallA: '#1e293b',
      wallB: '#27244a',
      wallStroke: '#0f172a',
      roof: '#6366f1',
      doorFill: '#0f172a',
      doorLine: '#475569',
      winTop: '#38bdf8',
      winBot: '#1e1b4b',
      winBorder: '#c4b5fd',
      upperWin: '#60a5fa',
      signBg: '#120b24',
      sidewalk: '#64748b',
      curb: '#334155',
      road: ['#2a2c47', '#1e2038', '#15172b'],
      laneMark: 'rgba(186, 230, 253, 0.45)',
      puddleA: 'rgba(192, 132, 252, 0.15)',
      puddleB: 'rgba(56, 189, 248, 0.14)',
      lampGlow: 'rgba(186, 230, 253, 0.24)',
    },
  };

  function drawStageBackground(ctx, camX) {
    const stage = getCurrentStage();
    if (stage.isTraining) {
      // 🥋 Clean High-Contrast Training Dojo Arena (ideal for inspecting sprite edges, combos & hitboxes!)
      const wallGrad = ctx.createLinearGradient(0, 0, 0, 344);
      wallGrad.addColorStop(0, '#0f172a');
      wallGrad.addColorStop(1, '#1e293b');
      ctx.fillStyle = wallGrad;
      ctx.fillRect(0, 0, CANVAS_W, 344);

      // Subtle architectural wall grid (parallax 0.5x)
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.10)';
      ctx.lineWidth = 1;
      const wallOff = -(camX * 0.5) % 64;
      for (let gx = wallOff; gx < CANVAS_W; gx += 64) {
        ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, 344); ctx.stroke();
      }
      for (let gy = 48; gy < 344; gy += 64) {
        ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(CANVAS_W, gy); ctx.stroke();
      }

      // Subtle Dojo Signboard on back wall
      ctx.save();
      ctx.fillStyle = 'rgba(15, 23, 42, 0.72)';
      ctx.strokeStyle = 'rgba(34, 211, 238, 0.42)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(CANVAS_W / 2 - 220, 74, 440, 62, 12);
      ctx.fill();
      ctx.stroke();
      ctx.textAlign = 'center';
      ctx.fillStyle = '#67e8f9';
      ctx.font = '900 22px "Noto Sans TC", sans-serif';
      ctx.fillText('🥋 自由訓練場 · TRAINING DOJO', CANVAS_W / 2, 106);
      ctx.fillStyle = '#94a3b8';
      ctx.font = '600 12px "Noto Sans TC", sans-serif';
      ctx.fillText('不主動出怪 · 無限氣力 · 使用下方控制列召喚怪物與預演動作', CANVAS_W / 2, 126);
      ctx.restore();

      // Floor mat (344..CANVAS_H) with crisp 100px distance markers & Z-lane bounds
      const floorGrad = ctx.createLinearGradient(0, 344, 0, CANVAS_H);
      floorGrad.addColorStop(0, '#334155');
      floorGrad.addColorStop(0.15, '#273449');
      floorGrad.addColorStop(1, '#1e293b');
      ctx.fillStyle = floorGrad;
      ctx.fillRect(0, 344, CANVAS_W, CANVAS_H - 344);

      // Horizontal ground-lane guide lines (Z_MIN, center, Z_MAX)
      ctx.strokeStyle = 'rgba(34, 211, 238, 0.45)';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(0, 344); ctx.lineTo(CANVAS_W, 344); ctx.stroke();
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.22)';
      ctx.lineWidth = 1;
      for (const gy of [Z_MIN, Math.round((Z_MIN + Z_MAX) / 2), Z_MAX]) {
        ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(CANVAS_W, gy); ctx.stroke();
      }

      // World-anchored 100px distance ruler ticks
      const startTick = Math.floor(camX / 100) * 100;
      ctx.font = '700 11px monospace';
      ctx.textAlign = 'center';
      for (let wx = startTick; wx <= camX + CANVAS_W + 100; wx += 100) {
        const sx = Math.round(wx - camX);
        ctx.strokeStyle = 'rgba(56, 189, 248, 0.22)';
        ctx.beginPath(); ctx.moveTo(sx, 344); ctx.lineTo(sx, CANVAS_H); ctx.stroke();
        ctx.fillStyle = 'rgba(148, 163, 184, 0.72)';
        ctx.fillText(`${wx}px`, sx, 360);
      }
      return;
    }
    const theme = SCHOOL_THEMES[stage.key] || SCHOOL_THEMES.starfish;
    const signs = stage.signs || [];
    const stageBg = (SpriteBank.bgImages && SpriteBank.bgImages[stage.key])
      ? SpriteBank.bgImages[stage.key]
      : null;
    const isSanrio = !!stageBg && (stage.key === 'starfish' || stage.key === 'aqiang');

    // ------------------------------------------------------------------------
    // LAYER 0 (0.05x): Pastel Sanrio Sky & Smiling Sun / Winter Moon
    // ------------------------------------------------------------------------
    const sky = ctx.createLinearGradient(0, 0, 0, 315);
    if (isSanrio && stage.key === 'starfish') {
      // Sanrio Ocean Sky-Blue -> Baby-Blue -> Strawberry-Milk Horizon!
      sky.addColorStop(0, '#5cc2ff');
      sky.addColorStop(0.55, '#bae6fd');
      sky.addColorStop(1, '#fff0f6');
    } else if (isSanrio && stage.key === 'aqiang') {
      // Sanrio Warm Hualien Afternoon Sky -> Soft Buttercream -> Pastel Peach Horizon!
      sky.addColorStop(0, '#62c3ff');
      sky.addColorStop(0.54, '#cbeeff');
      sky.addColorStop(1, '#ffedd5');
    } else {
      sky.addColorStop(0, theme.sky[0]);
      sky.addColorStop(0.55, theme.sky[1]);
      sky.addColorStop(1, theme.sky[2]);
    }
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, CANVAS_W, 320);

    const orbX = 835 - camX * 0.05;
    if (isSanrio) {
      // Cute Smiling Sanrio Pastel Sun (0.05x) with warm plum outline & rosy cheeks!
      const sunY = stage.key === 'aqiang' ? 68 : 62;
      const sunGlow = ctx.createRadialGradient(orbX, sunY, 16, orbX, sunY, 112);
      sunGlow.addColorStop(0, 'rgba(255, 253, 224, 0.96)');
      sunGlow.addColorStop(0.42, stage.key === 'aqiang' ? 'rgba(253, 224, 71, 0.56)' : 'rgba(254, 240, 138, 0.52)');
      sunGlow.addColorStop(1, 'rgba(254, 240, 138, 0)');
      ctx.fillStyle = sunGlow;
      ctx.beginPath();
      ctx.arc(orbX, sunY, 112, 0, Math.PI * 2);
      ctx.fill();

      // Gentle rotating Sanrio sun rays
      ctx.save();
      ctx.translate(orbX, sunY);
      ctx.rotate(game.time * 0.14);
      ctx.strokeStyle = 'rgba(254, 240, 138, 0.85)';
      ctx.lineWidth = 4.5;
      ctx.lineCap = 'round';
      for (let i = 0; i < 8; i++) {
        const a = (i * Math.PI) / 4;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * 34, Math.sin(a) * 34);
        ctx.lineTo(Math.cos(a) * 44, Math.sin(a) * 44);
        ctx.stroke();
      }
      ctx.restore();

      // Sun disc with warm Sanrio outline & tiny kawaii smile
      ctx.fillStyle = '#fef08a';
      ctx.strokeStyle = 'rgba(90, 56, 108, 0.55)';
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.arc(orbX, sunY, 27, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = 'rgba(251, 113, 133, 0.45)';
      ctx.beginPath();
      ctx.ellipse(orbX - 11, sunY + 4, 4.5, 2.8, 0, 0, Math.PI * 2);
      ctx.ellipse(orbX + 11, sunY + 4, 4.5, 2.8, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(58, 36, 73, 0.72)';
      ctx.beginPath();
      ctx.arc(orbX - 7, sunY - 1, 2.2, 0, Math.PI * 2);
      ctx.arc(orbX + 7, sunY - 1, 2.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(58, 36, 73, 0.72)';
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.arc(orbX, sunY + 1, 4.2, 0.15 * Math.PI, 0.85 * Math.PI);
      ctx.stroke();

      // LAYER 1A (0.10x): Thick-Outlined Fluffy Sanrio Cotton-Candy Clouds!
      const cloudOff = -((camX * 0.10 + game.time * 8) % 340);
      for (let cx = cloudOff - 170; cx < CANVAS_W + 240; cx += 340) {
        const idx = Math.abs(Math.round((cx - cloudOff) / 340));
        const cy = 48 + (idx % 2) * 22;
        const lobes = [
          { x: cx, y: cy + 10, r: 21 },
          { x: cx + 25, y: cy, r: 28 },
          { x: cx + 56, y: cy + 6, r: 24 },
          { x: cx + 80, y: cy + 12, r: 17 },
        ];
        // Pass 1: Soft Sanrio lavender-plum cloud outline
        ctx.fillStyle = 'rgba(89, 59, 107, 0.28)';
        for (const l of lobes) {
          ctx.beginPath(); ctx.arc(l.x, l.y, l.r + 2.4, 0, Math.PI * 2); ctx.fill();
        }
        ctx.fillRect(cx - 4, cy + 10, 88, 22);
        // Pass 2: Fluffy pastel-cream white fill
        ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
        for (const l of lobes) {
          ctx.beginPath(); ctx.arc(l.x, l.y, l.r, 0, Math.PI * 2); ctx.fill();
        }
        ctx.fillRect(cx, cy + 10, 80, 19);
        // Soft pastel pink/peach cloud belly tint
        ctx.fillStyle = stage.key === 'aqiang' ? 'rgba(254, 215, 170, 0.35)' : 'rgba(251, 207, 232, 0.35)';
        ctx.beginPath();
        ctx.roundRect(cx + 4, cy + 20, 72, 8, 4);
        ctx.fill();
      }
    } else if (theme.celestialType === 'sun') {
      const sunGrad = ctx.createRadialGradient(orbX, 66, 10, orbX, 66, 108);
      sunGrad.addColorStop(0, 'rgba(255, 254, 232, 0.98)');
      sunGrad.addColorStop(0.38, 'rgba(253, 224, 71, 0.52)');
      sunGrad.addColorStop(1, 'rgba(253, 224, 71, 0)');
      ctx.fillStyle = sunGrad;
      ctx.beginPath(); ctx.arc(orbX, 66, 108, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fef9c3';
      ctx.beginPath(); ctx.arc(orbX, 66, 30, 0, Math.PI * 2); ctx.fill();
    } else if (theme.celestialType === 'sunset') {
      const sunGrad = ctx.createRadialGradient(orbX, 118, 16, orbX, 118, 128);
      sunGrad.addColorStop(0, 'rgba(255, 247, 200, 0.96)');
      sunGrad.addColorStop(0.4, 'rgba(251, 146, 60, 0.62)');
      sunGrad.addColorStop(1, 'rgba(239, 68, 68, 0)');
      ctx.fillStyle = sunGrad;
      ctx.beginPath(); ctx.arc(orbX, 118, 128, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fef08a';
      ctx.beginPath(); ctx.arc(orbX, 118, 44, 0, Math.PI * 2); ctx.fill();
    } else {
      const moonGrad = ctx.createRadialGradient(orbX, 82, 12, orbX, 82, 98);
      moonGrad.addColorStop(0, 'rgba(240, 249, 255, 0.96)');
      moonGrad.addColorStop(0.38, 'rgba(192, 132, 252, 0.52)');
      moonGrad.addColorStop(1, 'rgba(192, 132, 252, 0)');
      ctx.fillStyle = moonGrad;
      ctx.beginPath(); ctx.arc(orbX, 82, 98, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#f8fafc';
      ctx.beginPath(); ctx.arc(orbX, 82, 35, 0, Math.PI * 2); ctx.fill();
    }

    // ------------------------------------------------------------------------
    // LAYER 1B (0.18x & 0.28x): Distant Hualien Mountain Ridges (Slow Parallax!)
    // ------------------------------------------------------------------------
    if (isSanrio) {
      // Soft rounded pastel Sanrio Hualien mountains (0.18x far + 0.28x mid!)
      const farCol = stage.key === 'aqiang' ? 'rgba(196, 181, 253, 0.58)' : 'rgba(165, 180, 252, 0.55)';
      const midCol = stage.key === 'aqiang' ? 'rgba(134, 239, 172, 0.48)' : 'rgba(110, 231, 183, 0.48)';

      ctx.fillStyle = farCol;
      ctx.strokeStyle = 'rgba(89, 59, 107, 0.24)';
      ctx.lineWidth = 2.2;
      const mFarOff = -(camX * 0.18) % 520;
      ctx.beginPath();
      ctx.moveTo(-520, 315);
      for (let x = mFarOff - 520; x <= CANVAS_W + 520; x += 260) {
        ctx.quadraticCurveTo(x + 70, 108, x + 140, 176);
        ctx.quadraticCurveTo(x + 205, 126, x + 260, 200);
      }
      ctx.lineTo(CANVAS_W + 520, 315);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = midCol;
      const mMidOff = -(camX * 0.28) % 440;
      ctx.beginPath();
      ctx.moveTo(-440, 315);
      for (let x = mMidOff - 440; x <= CANVAS_W + 440; x += 220) {
        ctx.quadraticCurveTo(x + 65, 162, x + 125, 206);
        ctx.quadraticCurveTo(x + 178, 172, x + 220, 224);
      }
      ctx.lineTo(CANVAS_W + 440, 315);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    } else {
      const mtnFarCol = 'rgba(49, 46, 129, 0.55)';
      const mtnMidCol = 'rgba(30, 27, 75, 0.72)';
      ctx.fillStyle = mtnFarCol;
      const mFarOff = -(camX * 0.18) % 520;
      ctx.beginPath();
      ctx.moveTo(0, 315);
      for (let x = mFarOff - 520; x <= CANVAS_W + 520; x += 260) {
        ctx.lineTo(x, 222);
        ctx.lineTo(x + 95, 128);
        ctx.lineTo(x + 180, 174);
        ctx.lineTo(x + 260, 142);
      }
      ctx.lineTo(CANVAS_W + 520, 315);
      ctx.closePath();
      ctx.fill();

      ctx.fillStyle = mtnMidCol;
      const mMidOff = -(camX * 0.28) % 440;
      ctx.beginPath();
      ctx.moveTo(0, 315);
      for (let x = mMidOff - 440; x <= CANVAS_W + 440; x += 220) {
        ctx.lineTo(x, 244);
        ctx.lineTo(x + 75, 178);
        ctx.lineTo(x + 150, 206);
        ctx.lineTo(x + 220, 182);
      }
      ctx.lineTo(CANVAS_W + 440, 315);
      ctx.closePath();
      ctx.fill();
    }

    // ------------------------------------------------------------------------
    // LAYER 2 (0.42x): Far Campus / Town Horizon Silhouette
    // ------------------------------------------------------------------------
    const farOff = -(camX * 0.42) % 320;
    if (isSanrio) {
      const farFillA = stage.key === 'aqiang' ? 'rgba(254, 215, 170, 0.62)' : 'rgba(221, 214, 254, 0.62)';
      const farFillB = stage.key === 'aqiang' ? 'rgba(251, 207, 232, 0.56)' : 'rgba(186, 230, 253, 0.58)';
      for (let x = farOff - 320; x < CANVAS_W + 320; x += 160) {
        ctx.fillStyle = farFillA;
        ctx.beginPath();
        ctx.roundRect(x, 168, 66, 148, [8, 8, 0, 0]);
        ctx.fill();
        ctx.fillStyle = farFillB;
        ctx.beginPath();
        ctx.roundRect(x + 72, 144, 56, 172, [10, 10, 0, 0]);
        ctx.fill();
        ctx.fillStyle = farFillA;
        ctx.beginPath();
        ctx.roundRect(x + 132, 182, 32, 134, [6, 6, 0, 0]);
        ctx.fill();

        ctx.fillStyle = 'rgba(255, 255, 255, 0.52)';
        for (let wy = 178; wy < 268; wy += 24) {
          ctx.fillRect(x + 12, wy, 12, 10);
          ctx.fillRect(x + 38, wy, 12, 10);
          ctx.fillRect(x + 86, wy - 16, 12, 10);
        }
      }
    } else {
      ctx.fillStyle = theme.farFill;
      for (let x = farOff - 320; x < CANVAS_W + 320; x += 160) {
        ctx.fillRect(x, 152, 68, 164);
        ctx.fillRect(x + 72, 126, 56, 190);
        ctx.beginPath();
        ctx.moveTo(x + 70, 126);
        ctx.lineTo(x + 100, 92);
        ctx.lineTo(x + 130, 126);
        ctx.closePath();
        ctx.fill();
        ctx.fillRect(x + 132, 168, 34, 148);

        ctx.fillStyle = theme.farWin;
        for (let wy = 160; wy < 268; wy += 24) {
          ctx.fillRect(x + 12, wy, 12, 10);
          ctx.fillRect(x + 38, wy, 12, 10);
          ctx.fillRect(x + 86, wy - 16, 12, 10);
        }
        ctx.fillStyle = theme.farFill;
      }
    }

    // Soft atmospheric depth haze separating distant skyline (0.42x) from midground street (0.76x)!
    const haze = ctx.createLinearGradient(0, 175, 0, 316);
    haze.addColorStop(0, 'rgba(255, 255, 255, 0)');
    haze.addColorStop(1, isSanrio
      ? (stage.key === 'aqiang' ? 'rgba(255, 247, 237, 0.55)' : 'rgba(255, 240, 246, 0.52)')
      : 'rgba(99, 102, 241, 0.22)');
    ctx.fillStyle = haze;
    ctx.fillRect(0, 175, CANVAS_W, 141);

    // ------------------------------------------------------------------------
    // LAYER 3 (~0.76x): Sanrio Hand-Drawn Multi-Photo Campus Street Panorama
    // (Stage 1: 海星國小 | Stage 2: 阿強 鑄強國小・永興路 | Stage 3: 冬花國小)
    // ------------------------------------------------------------------------
    if (isSanrio && stageBg) {
      const bgW = stageBg.width || 3120;
      const bgH = 308;
      const maxScroll = Math.max(1, STAGE_W - CANVAS_W);
      const maxBgShift = Math.max(0, bgW - CANVAS_W);
      // Smooth 0.76x parallax spanning all 11 real street photos from Start -> Boss!
      const bgDrawX = -Math.round((camX / maxScroll) * maxBgShift);
      ctx.save();
      ctx.drawImage(stageBg, bgDrawX, 12, bgW, bgH);
      // Soft grounded contact tint along base of panorama locking cleanly to 1.00x sidewalk
      const baseShadow = ctx.createLinearGradient(0, 302, 0, 320);
      baseShadow.addColorStop(0, 'rgba(58, 36, 73, 0)');
      baseShadow.addColorStop(1, 'rgba(58, 36, 73, 0.22)');
      ctx.fillStyle = baseShadow;
      ctx.fillRect(0, 302, CANVAS_W, 18);
      ctx.restore();
    } else {
      // Stage 3 (冬花國小) Midground School Buildings with 0.82x Parallax Depth!
      ctx.save();
      const midCamX = Math.round(camX * 0.82);
      ctx.translate(-midCamX, 0);
      const midSpan = Math.ceil(STAGE_W * 0.88) + 300;
      for (let bx = 0; bx < midSpan; bx += 260) {
        if (bx + 260 < midCamX - 40 || bx > midCamX + CANVAS_W + 40) continue;
        const idx = Math.floor(bx / 260);
        const bH = 198 + (idx % 2) * 20;
        const topY = 314 - bH;

        ctx.fillStyle = idx % 2 === 0 ? theme.wallA : theme.wallB;
        ctx.fillRect(bx + 4, topY, 252, bH);
        ctx.strokeStyle = theme.wallStroke;
        ctx.lineWidth = 3;
        ctx.strokeRect(bx + 4, topY, 252, bH);

        ctx.fillStyle = theme.roof;
        ctx.fillRect(bx, topY, 260, 15);
        if (stage.key === 'donghua') {
          ctx.fillStyle = 'rgba(241, 245, 249, 0.85)';
          ctx.fillRect(bx, topY - 4, 260, 6);
        }

        ctx.fillStyle = theme.doorFill;
        ctx.fillRect(bx + 26, 224, 88, 90);
        ctx.strokeStyle = theme.doorLine;
        ctx.lineWidth = 2;
        for (let sy = 236; sy < 312; sy += 14) {
          ctx.beginPath(); ctx.moveTo(bx + 28, sy); ctx.lineTo(bx + 112, sy); ctx.stroke();
        }

        const winGrad = ctx.createLinearGradient(bx + 138, 220, bx + 138, 298);
        winGrad.addColorStop(0, theme.winTop);
        winGrad.addColorStop(1, theme.winBot);
        ctx.fillStyle = winGrad;
        ctx.fillRect(bx + 138, 224, 98, 70);
        ctx.strokeStyle = theme.winBorder;
        ctx.lineWidth = 2.5;
        ctx.strokeRect(bx + 138, 224, 98, 70);
        ctx.beginPath();
        ctx.moveTo(bx + 187, 224); ctx.lineTo(bx + 187, 294);
        ctx.moveTo(bx + 138, 259); ctx.lineTo(bx + 236, 259);
        ctx.stroke();

        ctx.fillStyle = theme.upperWin;
        ctx.fillRect(bx + 32, topY + 34, 62, 42);
        ctx.fillRect(bx + 166, topY + 34, 62, 42);
        ctx.strokeStyle = theme.wallStroke;
        ctx.lineWidth = 2;
        ctx.strokeRect(bx + 32, topY + 34, 62, 42);
        ctx.strokeRect(bx + 166, topY + 34, 62, 42);

        if (idx % 2 === 0) {
          const clkX = bx + 130, clkY = topY + 55;
          ctx.fillStyle = '#ffffff';
          ctx.beginPath(); ctx.arc(clkX, clkY, 15, 0, Math.PI * 2); ctx.fill();
          ctx.strokeStyle = '#334155';
          ctx.lineWidth = 2.5;
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(clkX, clkY); ctx.lineTo(clkX, clkY - 9);
          ctx.moveTo(clkX, clkY); ctx.lineTo(clkX + 7, clkY + 2);
          ctx.stroke();
        }
      }
      ctx.restore();
    }

    // ------------------------------------------------------------------------
    // LAYER 4 (1.00x World Space): Signs, Perspective Sidewalk, Lamps & Ground
    // ------------------------------------------------------------------------
    ctx.save();
    ctx.translate(-Math.round(camX), 0);

    // Cute Sanrio Landmark Pill Signs (compact & positioned cleanly so panoramas shine!)
    for (const s of signs) {
      if (s.x + s.w < camX - 60 || s.x > camX + CANVAS_W + 60) continue;
      ctx.save();
      const sy = isSanrio ? Math.max(58, s.y - 46) : s.y;
      ctx.fillStyle = isSanrio ? 'rgba(58, 36, 73, 0.84)' : theme.signBg;
      ctx.strokeStyle = isSanrio ? '#fef08a' : s.color;
      ctx.lineWidth = 2.6;
      ctx.shadowColor = s.color;
      ctx.shadowBlur = isSanrio ? 6 : 15;
      ctx.beginPath();
      ctx.roundRect(s.x, sy, s.w, s.h - 4, 10);
      ctx.fill();
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#ffffff';
      ctx.font = '800 16px "Noto Sans TC", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(s.text, s.x + s.w / 2, sy + (s.h - 4) / 2 + 1);
      ctx.restore();
    }

    // Campus Sidewalk with Dynamic 2.5D Perspective Tile Slant (y = 312..347)
    const walkGrad = ctx.createLinearGradient(0, 312, 0, 340);
    if (isSanrio) {
      walkGrad.addColorStop(0, '#f8fafc');
      walkGrad.addColorStop(1, '#e2e8f0');
    } else {
      walkGrad.addColorStop(0, theme.sidewalk);
      walkGrad.addColorStop(1, theme.curb);
    }
    ctx.fillStyle = walkGrad;
    ctx.fillRect(0, 312, STAGE_W, 26);

    const screenCenterWorldX = camX + CANVAS_W * 0.5;
    if (isSanrio) {
      // Cute pastel mint-teal diamond/chevron paver accents (matching Haixing #002 & Aqiang #001-#002!)
      ctx.fillStyle = stage.key === 'aqiang' ? 'rgba(134, 239, 172, 0.36)' : 'rgba(125, 211, 252, 0.32)';
      for (let tx = 20; tx < STAGE_W; tx += 48) {
        if (tx < camX - 60 || tx > camX + CANVAS_W + 60) continue;
        ctx.beginPath();
        ctx.moveTo(tx, 318);
        ctx.lineTo(tx + 16, 325);
        ctx.lineTo(tx, 332);
        ctx.lineTo(tx - 16, 325);
        ctx.closePath();
        ctx.fill();
      }
    }

    ctx.strokeStyle = isSanrio ? 'rgba(58, 36, 73, 0.28)' : 'rgba(15, 23, 42, 0.28)';
    ctx.lineWidth = 2;
    for (let sx = 0; sx < STAGE_W; sx += 76) {
      if (sx < camX - 90 || sx > camX + CANVAS_W + 90) continue;
      const slant = Math.max(-36, Math.min(36, (sx - screenCenterWorldX) * 0.085));
      ctx.beginPath();
      ctx.moveTo(sx, 312);
      ctx.lineTo(sx + slant, 338);
      ctx.stroke();
    }
    ctx.fillStyle = isSanrio ? '#a78bfa' : theme.curb;
    ctx.fillRect(0, 338, STAGE_W, 9);
    if (isSanrio) {
      ctx.strokeStyle = '#3a2449';
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.moveTo(0, 338); ctx.lineTo(STAGE_W, 338);
      ctx.moveTo(0, 347); ctx.lineTo(STAGE_W, 347);
      ctx.stroke();
    }

    // Roadside Lamps (only on Stage 3 Winter Campus so Sanrio daytime street art stays unobstructed!)
    if (!isSanrio) {
      for (let lx = 260; lx < STAGE_W; lx += 460) {
        if (lx < camX - 140 || lx > camX + CANVAS_W + 140) continue;
        ctx.fillStyle = '#1e293b';
        ctx.fillRect(lx - 4, 152, 8, 166);
        ctx.fillRect(lx - 4, 152, 30, 6);
        ctx.fillStyle = '#fef08a';
        ctx.beginPath(); ctx.arc(lx + 24, 162, 7.5, 0, Math.PI * 2); ctx.fill();

        const cone = ctx.createRadialGradient(lx + 24, 168, 6, lx + 24, 340, 175);
        cone.addColorStop(0, theme.lampGlow);
        cone.addColorStop(1, 'rgba(254, 240, 138, 0)');
        ctx.fillStyle = cone;
        ctx.beginPath();
        ctx.moveTo(lx + 16, 164);
        ctx.lineTo(lx - 90, 415);
        ctx.lineTo(lx + 140, 415);
        ctx.lineTo(lx + 32, 164);
        ctx.closePath();
        ctx.fill();
      }
    }

    // Playable 2.5D Street / Track Ground (y = 347..512)
    const road = ctx.createLinearGradient(0, 347, 0, CANVAS_H);
    if (isSanrio) {
      // Soft Sanrio pastel lavender-slate campus street so bright heroes & monsters pop crisply!
      road.addColorStop(0, stage.key === 'aqiang' ? '#7b7894' : '#767a99');
      road.addColorStop(0.55, stage.key === 'aqiang' ? '#625f7a' : '#5e6280');
      road.addColorStop(1, stage.key === 'aqiang' ? '#4a4761' : '#474a66');
    } else {
      road.addColorStop(0, theme.road[0]);
      road.addColorStop(0.55, theme.road[1]);
      road.addColorStop(1, theme.road[2]);
    }
    ctx.fillStyle = road;
    ctx.fillRect(0, 347, STAGE_W, CANVAS_H - 347);

    // Subtle 1-point perspective road expansion lines for crisp depth sensation
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.lineWidth = 2;
    for (let rx = 0; rx < STAGE_W; rx += 180) {
      if (rx < camX - 240 || rx > camX + CANVAS_W + 240) continue;
      const topX = rx;
      const botX = rx + (rx - screenCenterWorldX) * 0.42;
      ctx.beginPath();
      ctx.moveTo(topX, 347);
      ctx.lineTo(botX, CANVAS_H);
      ctx.stroke();
    }

    // Iconic Taiwanese Green-White School Crosswalk in front of 阿強 School Gate (Photos #005 & #009!)
    if (isSanrio && stage.key === 'aqiang') {
      for (const cwX of [1620, 2460]) {
        if (cwX + 160 < camX - 40 || cwX > camX + CANVAS_W + 40) continue;
        ctx.fillStyle = 'rgba(52, 211, 153, 0.42)';
        ctx.fillRect(cwX, 354, 148, 138);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.72)';
        for (let wy = 362; wy < 484; wy += 24) {
          ctx.fillRect(cwX + 10, wy, 128, 12);
        }
      }
    }

    // Ground sunlight pools / soft pastel reflections
    for (let px = 310; px < STAGE_W; px += 520) {
      if (px < camX - 140 || px > camX + CANVAS_W + 140) continue;
      ctx.fillStyle = isSanrio ? 'rgba(254, 249, 195, 0.11)' : theme.puddleA;
      ctx.beginPath();
      ctx.ellipse(px, 430, 74, 14, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = isSanrio ? 'rgba(249, 168, 212, 0.09)' : theme.puddleB;
      ctx.beginPath();
      ctx.ellipse(px + 20, 432, 38, 7, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    // Street / Track Lane Markings
    if (isSanrio) {
      // Crisp white roadside edge stripe + warm sunny-yellow center dashes
      ctx.fillStyle = 'rgba(255, 255, 255, 0.65)';
      ctx.fillRect(0, 355, STAGE_W, 3);
      ctx.fillStyle = 'rgba(253, 224, 71, 0.78)';
      for (let dx = 30; dx < STAGE_W; dx += 140) {
        ctx.beginPath();
        ctx.roundRect(dx, 421, 74, 7, 3.5);
        ctx.fill();
      }
      ctx.fillStyle = 'rgba(255, 255, 255, 0.48)';
      ctx.fillRect(0, 492, STAGE_W, 3);
    } else {
      ctx.fillStyle = theme.laneMark;
      for (let dx = 40; dx < STAGE_W; dx += 130) {
        ctx.fillRect(dx, 418, 66, 7);
      }
      ctx.fillStyle = 'rgba(255, 255, 255, 0.12)';
      ctx.fillRect(0, 496, STAGE_W, 3);
    }
    ctx.restore();

    // Gentle mid-layer falling snowflakes for STAGE 3 冬花國小!
    if (stage.key === 'donghua') {
      ctx.save();
      ctx.fillStyle = 'rgba(241, 245, 249, 0.78)';
      for (let i = 0; i < 42; i++) {
        const fx = ((i * 97 + game.time * (22 + (i % 5) * 7) - camX * 0.35) % (CANVAS_W + 40) + CANVAS_W + 40) % (CANVAS_W + 40) - 20;
        const fy = ((i * 61 + game.time * (34 + (i % 4) * 11)) % CANVAS_H);
        const r = 1.6 + (i % 3) * 1.0;
        ctx.beginPath();
        ctx.arc(fx, fy, r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  // --------------------------------------------------------------------------
  // LAYER 5 (1.38x & 1.48x FAST FOREGROUND DEPTH-OF-FIELD / 景深虛化前景層)
  // Scrolls 38%-48% FASTER than the player/camera for vivid 2.5D perspective depth!
  // --------------------------------------------------------------------------
  function drawForegroundParallax(ctx, camX) {
    const stage = getCurrentStage();
    const isSanrio = stage.key === 'starfish' || stage.key === 'aqiang';
    const fgScroll = camX * 1.38;

    ctx.save();
    // 1. Out-of-focus foreground Sanrio cloud-bush silhouettes sweeping rapidly past the bottom rim!
    const bushStep = 540;
    const firstBush = Math.floor((fgScroll - 220) / bushStep) * bushStep;
    const bushMain = isSanrio
      ? (stage.key === 'aqiang' ? 'rgba(22, 101, 52, 0.62)' : 'rgba(16, 110, 78, 0.60)')
      : 'rgba(18, 16, 46, 0.74)';
    const bushEdge = isSanrio
      ? (stage.key === 'aqiang' ? 'rgba(134, 239, 172, 0.36)' : 'rgba(110, 231, 183, 0.36)')
      : 'rgba(147, 197, 253, 0.26)';

    for (let bx = firstBush; bx < fgScroll + CANVAS_W + 260; bx += bushStep) {
      const sx = bx - fgScroll;
      const variant = Math.abs(Math.round(bx / bushStep)) % 3;

      // Soft outer bokeh halo (depth-of-field blur effect!)
      ctx.fillStyle = bushEdge;
      ctx.beginPath();
      ctx.ellipse(sx, CANVAS_H + 10, 96 + variant * 16, 40 + variant * 6, 0, Math.PI, Math.PI * 2);
      ctx.ellipse(sx + 62, CANVAS_H + 12, 68, 32, 0, Math.PI, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = bushMain;
      ctx.beginPath();
      ctx.ellipse(sx, CANVAS_H + 12, 82 + variant * 14, 30 + variant * 5, 0, Math.PI, Math.PI * 2);
      ctx.ellipse(sx + 56, CANVAS_H + 14, 54, 22, 0, Math.PI, Math.PI * 2);
      ctx.fill();

      // Cute soft-focus pastel Sanrio blossom dots tucked into foreground bushes!
      if (isSanrio) {
        ctx.fillStyle = variant === 1 ? 'rgba(254, 240, 138, 0.72)' : 'rgba(251, 207, 232, 0.76)';
        ctx.beginPath();
        ctx.arc(sx - 24, CANVAS_H - 9, 5.5, 0, Math.PI * 2);
        ctx.arc(sx + 22, CANVAS_H - 12, 4.5, 0, Math.PI * 2);
        ctx.arc(sx + 62, CANVAS_H - 7, 5.0, 0, Math.PI * 2);
        ctx.fill();
      }

      // Occasional blurred roadside palm frond overhang at top edge (1.38x speed!)
      if (variant === 0) {
        const tx = sx + 180;
        ctx.fillStyle = bushEdge;
        ctx.beginPath();
        ctx.ellipse(tx, -6, 108, 26, 0.14, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = bushMain;
        ctx.beginPath();
        ctx.ellipse(tx, -10, 90, 18, 0.14, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // 2. Fast-moving foreground optical bokeh sparkles / sunlit motes / snow (1.48x speed!)
    for (let i = 0; i < 16; i++) {
      const mx = (((i * 193 - camX * 1.48 + game.time * (28 + (i % 4) * 9)) % (CANVAS_W + 120)) + (CANVAS_W + 120)) % (CANVAS_W + 120) - 60;
      const my = 42 + ((i * 73 + Math.sin(game.time * 1.6 + i) * 18) % (CANVAS_H - 70));
      const r = 4.2 + (i % 3) * 2.8;
      if (isSanrio && i % 3 === 0) {
        // Dreamy twinkling 4-point Sanrio bokeh star!
        ctx.fillStyle = stage.key === 'aqiang' ? 'rgba(254, 240, 138, 0.50)' : 'rgba(251, 207, 232, 0.52)';
        ctx.beginPath();
        ctx.moveTo(mx, my - r * 1.3);
        ctx.quadraticCurveTo(mx, my, mx + r * 1.3, my);
        ctx.quadraticCurveTo(mx, my, mx, my + r * 1.3);
        ctx.quadraticCurveTo(mx, my, mx - r * 1.3, my);
        ctx.quadraticCurveTo(mx, my, mx, my - r * 1.3);
        ctx.fill();
      } else {
        ctx.fillStyle = isSanrio
          ? (stage.key === 'aqiang' ? 'rgba(254, 243, 199, 0.36)' : 'rgba(255, 255, 255, 0.38)')
          : 'rgba(224, 242, 254, 0.42)';
        ctx.beginPath();
        ctx.arc(mx, my, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  // --------------------------------------------------------------------------
  // EXTENDING ENERGY CANNON LASER BEAM VFX (Synced to Kuromi's hands!)
  // --------------------------------------------------------------------------
  function drawEnergyCannonBeam(ctx) {
    const b = game.beamEffect;
    if (!b) return;
    const len = 820;
    const width = (46 + b.pulse * 18) * (b.progress > 0.85 ? (1 - b.progress) / 0.15 : 1);

    ctx.save();
    ctx.translate(b.x, b.y);
    ctx.scale(b.facing, 1);

    // Outer violet-magenta glow aura
    const outerGrad = ctx.createLinearGradient(0, -width, 0, width);
    outerGrad.addColorStop(0, 'rgba(192, 38, 211, 0)');
    outerGrad.addColorStop(0.25, 'rgba(232, 121, 249, 0.85)');
    outerGrad.addColorStop(0.5, 'rgba(255, 255, 255, 0.98)');
    outerGrad.addColorStop(0.75, 'rgba(232, 121, 249, 0.85)');
    outerGrad.addColorStop(1, 'rgba(192, 38, 211, 0)');

    ctx.fillStyle = outerGrad;
    ctx.beginPath();
    ctx.moveTo(-10, -width * 0.6);
    ctx.lineTo(len, -width * 1.15);
    ctx.lineTo(len, width * 1.15);
    ctx.lineTo(-10, width * 0.6);
    ctx.closePath();
    ctx.fill();

    // Hot white inner plasma core
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(-8, -width * 0.24);
    ctx.lineTo(len, -width * 0.42);
    ctx.lineTo(len, width * 0.42);
    ctx.lineTo(-8, width * 0.24);
    ctx.closePath();
    ctx.fill();

    // 10-shot pulsing energy rings racing down the beam!
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.lineWidth = 4;
    for (let i = 0; i < 6; i++) {
      const rx = ((game.time * 1500 + i * 145) % len);
      ctx.beginPath();
      ctx.ellipse(rx, 0, 12, width * 0.72, 0, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Muzzle flash star right at palms
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(0, 0, 26 + b.pulse * 12, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  // ==========================================================================
  // 6. ARCADE HUD & SCREENS (Streets of Rage / Warriors of Fate Style)
  // ==========================================================================
  function drawArcadeHUD(ctx) {
    const p = game.player;
    const hero = p.hero || HERO_ROSTER[0];
    ctx.save();

    // --- TOP-LEFT: PLAYER PANEL ---
    ctx.fillStyle = 'rgba(13, 10, 24, 0.8)';
    ctx.strokeStyle = hero.accent;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(14, 12, 344, 74, 10);
    ctx.fill();
    ctx.stroke();

    // Portrait Box
    ctx.fillStyle = '#23193b';
    ctx.beginPath();
    ctx.roundRect(22, 18, 60, 60, 8);
    ctx.fill();
    const portrait = (SpriteBank.portraits && SpriteBank.portraits[hero.id]) || SpriteBank.portraitCanvas;
    if (portrait) {
      ctx.drawImage(portrait, 22, 18, 60, 60);
    }
    ctx.strokeStyle = hero.accentLight || hero.accent;
    ctx.lineWidth = 2;
    ctx.strokeRect(22, 18, 60, 60);

    // Name + Run state badge + Lives
    ctx.fillStyle = '#ffffff';
    ctx.font = '800 14px "Noto Sans TC", sans-serif';
    ctx.fillText(hero.hudName, 92, 33);
    if (p.isRunning || p.state === 'run') {
      ctx.fillStyle = '#38bdf8';
      ctx.font = '900 11px monospace';
      ctx.fillText('RUN ▸', 258, 33);
    }
    ctx.fillStyle = '#facc15';
    ctx.font = '800 14px monospace';
    ctx.fillText(`♥ ×${p.lives}`, 304, 33);

    // HP Bar (Classic yellow/green with white-red trailing damage!)
    const hpX = 92, hpY = 40, hpW = 252, hpH = 16;
    ctx.fillStyle = '#1f162e';
    ctx.fillRect(hpX, hpY, hpW, hpH);
    // Trailing damage bar
    ctx.fillStyle = '#ef4444';
    ctx.fillRect(hpX, hpY, hpW * (p.displayHp / p.maxHp), hpH);
    // Current HP bar
    const hpRatio = p.hp / p.maxHp;
    const hpGrad = ctx.createLinearGradient(hpX, hpY, hpX + hpW, hpY);
    hpGrad.addColorStop(0, hpRatio > 0.35 ? '#22c55e' : '#f97316');
    hpGrad.addColorStop(1, hpRatio > 0.35 ? '#facc15' : '#ef4444');
    ctx.fillStyle = hpGrad;
    ctx.fillRect(hpX, hpY, hpW * hpRatio, hpH);
    ctx.strokeStyle = '#0f0a1c';
    ctx.lineWidth = 2;
    ctx.strokeRect(hpX, hpY, hpW, hpH);

    // Special Gauge
    const mpY = 62, mpH = 14;
    ctx.fillStyle = '#1f162e';
    ctx.fillRect(hpX, mpY, hpW, mpH);
    const ready = p.energy >= 50;
    const mpGrad = ctx.createLinearGradient(hpX, mpY, hpX + hpW, mpY);
    mpGrad.addColorStop(0, hero.id === 'redpanda' ? '#ea580c' : '#9333ea');
    mpGrad.addColorStop(1, ready ? (hero.id === 'redpanda' ? '#facc15' : '#f472b6') : '#6366f1');
    ctx.fillStyle = mpGrad;
    ctx.fillRect(hpX, mpY, hpW * (p.energy / p.maxEnergy), mpH);
    ctx.strokeStyle = ready ? '#fef08a' : '#0f0a1c';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(hpX, mpY, hpW, mpH);

    const spKeyLabel = formatKeyCode(StudioState.getAction('special')?.key);
    ctx.fillStyle = '#ffffff';
    ctx.font = '700 10px "Noto Sans TC", sans-serif';
    const spIcon = hero.id === 'redpanda' ? '🔥' : '⚡';
    ctx.fillText(ready ? `${spIcon} ${hero.specialLabel} READY [${spKeyLabel}]` : `${spIcon} 能量 ${Math.floor(p.energy)}%`, hpX + 6, mpY + 11);

    // --- TOP-CENTER: SCORE & STAGE ---
    ctx.fillStyle = 'rgba(13, 10, 24, 0.78)';
    ctx.beginPath();
    ctx.roundRect(368, 12, 288, 52, 8);
    ctx.fill();
    ctx.textAlign = 'center';
    ctx.fillStyle = '#facc15';
    ctx.font = '900 19px monospace';
    ctx.fillText(`SCORE ${String(game.score).padStart(7, '0')}`, 512, 33);
    ctx.fillStyle = '#e2e8f0';
    ctx.font = '700 11px "Noto Sans TC", sans-serif';
    const curStage = getCurrentStage();
    const curZones = getCurrentZones();
    const curZone = curZones[Math.min(game.zoneIndex, curZones.length - 1)];
    ctx.fillText(`STAGE ${curStage.id}/3 · ${curZone.name}`, 512, 53);
    ctx.textAlign = 'left';

    // --- TOP-RIGHT: TARGET ENEMY / BOSS MULTI-LAYER HP BAR ---
    const boss = game.enemies.find((e) => e.cfg.isBoss && !e.dead);
    const target = boss || (game.lastHitTimer > 0 && game.lastHitEnemy ? game.lastHitEnemy : null);
    if (target) {
      ctx.fillStyle = 'rgba(13, 10, 24, 0.8)';
      ctx.strokeStyle = target.cfg.isBoss ? '#f43f5e' : 'rgba(255,255,255,0.22)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(674, 12, 336, 62, 10);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = target.cfg.isBoss ? '#fda4af' : '#f1f5f9';
      ctx.font = '800 14px "Noto Sans TC", sans-serif';
      ctx.fillText(target.name, 690, 34);

      const ex = 690, ey = 44, ew = 304, eh = 18;
      ctx.fillStyle = '#1f162e';
      ctx.fillRect(ex, ey, ew, eh);

      if (target.cfg.isBoss) {
        // Classic 3-tier color layered Boss HP bar (Green -> Gold -> Crimson)!
        const tierHp = target.maxHp / 3;
        const tiers = ['#ef4444', '#f59e0b', '#22c55e'];
        for (let t = 0; t < 3; t++) {
          const fill = Math.max(0, Math.min(1, (target.hp - t * tierHp) / tierHp));
          if (fill > 0) {
            ctx.fillStyle = tiers[t];
            ctx.fillRect(ex, ey, ew * fill, eh);
          }
        }
      } else {
        ctx.fillStyle = '#ef4444';
        ctx.fillRect(ex, ey, ew * (target.hp / target.maxHp), eh);
      }
      ctx.strokeStyle = '#0f0a1c';
      ctx.lineWidth = 2;
      ctx.strokeRect(ex, ey, ew, eh);
    }

    // --- COMBO COUNTER ---
    if (game.combo >= 2 && game.comboTimer > 0) {
      const pop = 1 + Math.min(0.25, game.comboTimer * 0.08);
      ctx.save();
      ctx.translate(935, 134);
      ctx.scale(pop, pop);
      ctx.textAlign = 'right';
      ctx.lineWidth = 5;
      ctx.strokeStyle = '#0d0b14';
      ctx.font = '900 38px "Noto Sans TC", sans-serif';
      ctx.strokeText(`${game.combo} HIT!`, 0, 0);
      ctx.fillStyle = game.combo >= 10 ? '#f472b6' : '#facc15';
      ctx.fillText(`${game.combo} HIT!`, 0, 0);
      ctx.font = '800 14px "Noto Sans TC", sans-serif';
      ctx.fillStyle = '#ffffff';
      ctx.fillText(game.combo >= 10 ? 'UNSTOPPABLE!!' : 'COMBO!!', -4, 20);
      ctx.restore();
    }

    // --- FLASHING "GO! ▶" ARCADE ARROW ---
    if (game.goBannerTimer > 0 && Math.floor(game.time * 5) % 2 === 0) {
      ctx.save();
      ctx.translate(920, 215);
      ctx.fillStyle = '#facc15';
      ctx.strokeStyle = '#0d0b14';
      ctx.lineWidth = 6;
      ctx.font = '900 44px sans-serif';
      ctx.textAlign = 'center';
      ctx.strokeText('GO! ▶', 0, 0);
      ctx.fillText('GO! ▶', 0, 0);
      ctx.restore();
    }

    // --- BOSS WARNING BANNER ---
    if (game.bossWarningTimer > 0) {
      const alpha = Math.min(1, game.bossWarningTimer);
      ctx.save();
      ctx.globalAlpha = alpha * (0.75 + Math.sin(game.time * 22) * 0.25);
      ctx.fillStyle = 'rgba(159, 18, 57, 0.85)';
      ctx.fillRect(0, 196, CANVAS_W, 108);
      ctx.fillStyle = '#fef08a';
      ctx.font = '900 40px "Noto Sans TC", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('⚠ WARNING · BOSS APPROACHING ⚠', CANVAS_W / 2, 248);
      ctx.fillStyle = '#ffffff';
      ctx.font = '700 20px "Noto Sans TC", sans-serif';
      ctx.fillText(getCurrentStage().bossWarnName, CANVAS_W / 2, 282);
      ctx.restore();
    }

    ctx.restore();
  }

  function drawOverlayScreens(ctx) {
    if (game.state === 'title') {
      ctx.save();
      // 1. Full-Bleed 3D Clay Miniature Diorama Island Map Background
      const mapImg = SpriteBank.bgImages && SpriteBank.bgImages.stage_map;
      if (mapImg) {
        ctx.drawImage(mapImg, 0, 0, CANVAS_W, CANVAS_H);
      } else {
        const fallbackGrad = ctx.createLinearGradient(0, 0, 0, CANVAS_H);
        fallbackGrad.addColorStop(0, '#f5ecd7');
        fallbackGrad.addColorStop(1, '#bfe7e8');
        ctx.fillStyle = fallbackGrad;
        ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
      }

      // 2. Top-Center Handcrafted Clay Storybook Title Ribbon
      ctx.save();
      ctx.textAlign = 'center';
      ctx.font = '900 32px "Noto Sans TC", sans-serif';
      ctx.lineJoin = 'round';
      ctx.shadowColor = 'rgba(120, 62, 24, 0.28)';
      ctx.shadowBlur = 10;
      ctx.shadowOffsetY = 4;
      ctx.lineWidth = 9;
      ctx.strokeStyle = '#fffaf0';
      ctx.strokeText('海星國小 大亂鬥 · 校園地圖', CANVAS_W / 2, 42);
      ctx.shadowBlur = 0;
      ctx.shadowOffsetY = 0;
      const titleGrad = ctx.createLinearGradient(0, 14, 0, 48);
      titleGrad.addColorStop(0, '#fb923c');
      titleGrad.addColorStop(0.55, '#ea580c');
      titleGrad.addColorStop(1, '#c2410c');
      ctx.fillStyle = titleGrad;
      ctx.fillText('海星國小 大亂鬥 · 校園地圖', CANVAS_W / 2, 42);

      // Cute warm clay pill subtitle (like the reference's peach banner!)
      ctx.fillStyle = 'rgba(255, 247, 232, 0.94)';
      ctx.strokeStyle = '#e7c9a0';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(CANVAS_W / 2 - 226, 52, 452, 24, 12);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#7c4a21';
      ctx.font = '700 12px "Noto Sans TC", sans-serif';
      ctx.fillText('📍 點擊地圖上的特色校園選關 · ↑/↓ 換關卡 · ←/→ 選主角！', CANVAS_W / 2, 68);
      ctx.restore();

      // 3. Four Interactive Pastel Clay Map Pins & Landmark Cards on the Island!
      const stageThemes = [
        { bg: '#e0f2fe', header: '#0284c7', border: '#7dd3fc', tag: 'STAGE 1 · 海洋校區', sub: '海岸海星 · 企鵝與海怪' },
        { bg: '#ffe4e6', header: '#e11d48', border: '#fda4af', tag: 'STAGE 2 · 歡樂校區', sub: '摩天輪 · 隨機怪大亂鬥' },
        { bg: '#dcfce7', header: '#15803d', border: '#86efac', tag: 'STAGE 3 · 草原武道', sub: '櫻花道場 · 冬花武聖BOSS' },
        { bg: '#fef3c7', header: '#b45309', border: '#fcd34d', tag: 'FREE · 自由訓練場', sub: '不主動出怪 · 測試招式' },
      ];
      const selHero = getSelectedHero();

      for (let s = 0; s < STAGES.length; s++) {
        const st = STAGES[s];
        const pill = SELECT_UI.stagePills[s];
        const stTheme = stageThemes[s] || stageThemes[0];
        const active = game.selectedStageIndex === s;
        const bounce = active ? Math.sin(game.time * 6.5) * 4 : 0;

        ctx.save();
        // Glowing selection ring on the school courtyard
        if (active) {
          ctx.fillStyle = 'rgba(254, 240, 138, 0.42)';
          ctx.strokeStyle = '#facc15';
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.ellipse(pill.heroX, pill.heroY + 2, 48 + Math.sin(game.time * 5) * 3, 14, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        }

        // Cute clay teardrop map pin floating above the school
        const px = pill.pinX;
        const py = pill.pinY - 56 + bounce;
        ctx.shadowColor = 'rgba(0,0,0,0.22)';
        ctx.shadowBlur = 6;
        ctx.shadowOffsetY = 3;
        ctx.fillStyle = active ? '#ef4444' : stTheme.header;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(px, py, active ? 13 : 10, Math.PI * 0.85, Math.PI * 2.15);
        ctx.lineTo(px, py + (active ? 22 : 17));
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.shadowBlur = 0;
        ctx.shadowOffsetY = 0;
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(px, py, active ? 4.5 : 3.5, 0, Math.PI * 2);
        ctx.fill();

        // Live animated miniature Hero standing right on the selected school!
        if (active) {
          const idleKey = selHero.sheets.idle;
          const idleSheet = SpriteBank.sheets[idleKey];
          if (idleSheet) {
            const fIdx = Math.floor(game.time * 8.5) % idleSheet.frameCount;
            SpriteBank.drawFrame(ctx, idleKey, fIdx, pill.heroX, pill.heroY, 1, 0.44, false);
          }
        }

        // Pastel Rounded Clay Info Tag Card (matching the reference's soft color-coded cards!)
        const cw = 166;
        const ch = 50;
        const cx = pill.cardX;
        const cy = pill.cardY + (active ? -3 : 0);
        ctx.shadowColor = active ? 'rgba(234, 88, 12, 0.35)' : 'rgba(51, 65, 85, 0.22)';
        ctx.shadowBlur = active ? 14 : 8;
        ctx.shadowOffsetY = 4;
        ctx.fillStyle = active ? '#fffdf7' : stTheme.bg;
        ctx.strokeStyle = active ? '#f97316' : stTheme.border;
        ctx.lineWidth = active ? 3 : 2;
        ctx.beginPath();
        ctx.roundRect(cx, cy, cw, ch, 12);
        ctx.fill();
        ctx.stroke();
        ctx.shadowBlur = 0;
        ctx.shadowOffsetY = 0;

        // Top colored header strip inside card
        ctx.fillStyle = active ? '#ea580c' : stTheme.header;
        ctx.beginPath();
        ctx.roundRect(cx + 4, cy + 4, cw - 8, 21, 8);
        ctx.fill();

        ctx.textAlign = 'center';
        ctx.fillStyle = '#ffffff';
        ctx.font = '800 12px "Noto Sans TC", sans-serif';
        ctx.fillText(`${st.icon} ${st.shortName}`, cx + cw / 2, cy + 19);

        ctx.fillStyle = active ? '#9a3412' : '#475569';
        ctx.font = active ? '800 10.5px "Noto Sans TC", sans-serif' : '700 10px "Noto Sans TC", sans-serif';
        ctx.fillText(stTheme.sub, cx + cw / 2, cy + 41);
        ctx.restore();
      }

      // 4. Bottom Warm Clay Dock Bar (3 Compact Live Hero Cards + Juicy Clay Start Button)
      ctx.save();
      ctx.fillStyle = 'rgba(255, 250, 240, 0.88)';
      ctx.strokeStyle = 'rgba(217, 185, 145, 0.9)';
      ctx.lineWidth = 2.5;
      ctx.shadowColor = 'rgba(80, 50, 20, 0.22)';
      ctx.shadowBlur = 14;
      ctx.shadowOffsetY = -2;
      ctx.beginPath();
      ctx.roundRect(14, 414, CANVAS_W - 28, 90, 18);
      ctx.fill();
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.shadowOffsetY = 0;

      // 3 Interactive Hero Cards inside Left Dock
      for (let i = 0; i < HERO_ROSTER.length; i++) {
        const hero = HERO_ROSTER[i];
        const card = SELECT_UI.cards[i];
        if (!card) continue;
        const isSelected = game.selectedHeroId === hero.id;
        const isHovered = game.hoverHeroId === hero.id;

        ctx.save();
        ctx.fillStyle = isSelected ? '#ffffff' : (isHovered ? '#fff7ed' : '#f8f2e6');
        ctx.strokeStyle = isSelected ? hero.accent : (isHovered ? '#fdba74' : '#e2d4be');
        ctx.lineWidth = isSelected ? 3.5 : 2;
        if (isSelected) {
          ctx.shadowColor = hero.accent;
          ctx.shadowBlur = 10;
        }
        ctx.beginPath();
        ctx.roundRect(card.x, card.y, card.w, card.h, 13);
        ctx.fill();
        ctx.stroke();
        ctx.shadowBlur = 0;

        // Live mini hero sprite on left of card
        const demoKey = hero.sheets.idle;
        const demoSheet = SpriteBank.sheets[demoKey];
        if (demoSheet) {
          const fIdx = Math.floor(game.time * 8.5) % demoSheet.frameCount;
          SpriteBank.drawFrame(ctx, demoKey, fIdx, card.x + 38, card.y + 66, 1, isSelected ? 0.34 : 0.30, false);
        }

        // Hero Name & Role Pill
        ctx.textAlign = 'left';
        ctx.fillStyle = isSelected ? '#1e293b' : '#475569';
        ctx.font = '900 16px "Noto Sans TC", sans-serif';
        ctx.fillText(hero.name, card.x + 74, card.y + 30);

        ctx.fillStyle = isSelected ? hero.accent : '#94a3b8';
        ctx.beginPath();
        ctx.roundRect(card.x + 74, card.y + 38, 98, 20, 7);
        ctx.fill();
        ctx.textAlign = 'center';
        ctx.fillStyle = '#ffffff';
        ctx.font = '800 10.5px "Noto Sans TC", sans-serif';
        ctx.fillText(isSelected ? '★ 出戰主角' : `按 [${i + 1}] 切換`, card.x + 123, card.y + 52);
        ctx.restore();
      }

      // Juicy Pulsing Clay Start Button on Right Dock
      const selStage = STAGES[game.selectedStageIndex] || STAGES[0];
      const sb = SELECT_UI.startBtn;
      const pulse = 0.92 + Math.sin(game.time * 6) * 0.08;
      ctx.save();
      ctx.globalAlpha = pulse;
      const btnGrad = ctx.createLinearGradient(sb.x, sb.y, sb.x, sb.y + sb.h);
      btnGrad.addColorStop(0, selStage.isTraining ? '#06b6d4' : '#fb923c');
      btnGrad.addColorStop(1, selStage.isTraining ? '#0284c7' : '#ea580c');
      ctx.fillStyle = btnGrad;
      ctx.shadowColor = selStage.isTraining ? 'rgba(6, 182, 212, 0.45)' : 'rgba(234, 88, 12, 0.45)';
      ctx.shadowBlur = 12;
      ctx.shadowOffsetY = 4;
      ctx.beginPath();
      ctx.roundRect(sb.x, sb.y, sb.w, sb.h, 15);
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.shadowOffsetY = 0;

      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'center';
      ctx.font = '900 22px "Noto Sans TC", sans-serif';
      const startVerb = selStage.isTraining ? '進入' : '進軍';
      ctx.fillText(`▶ ${startVerb}「${selStage.icon} ${selStage.shortName}」`, sb.x + sb.w / 2, sb.y + 34);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
      ctx.font = '700 12.5px "Noto Sans TC", sans-serif';
      ctx.fillText(`由「${selHero.name}」出發 · 按 ENTER 或點擊開始`, sb.x + sb.w / 2, sb.y + 57);
      ctx.restore();
      ctx.restore();
      ctx.restore();
    } else if (game.state === 'paused') {
      ctx.save();
      ctx.fillStyle = 'rgba(10, 8, 20, 0.72)';
      ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
      ctx.textAlign = 'center';
      ctx.fillStyle = '#ffffff';
      ctx.font = '900 44px "Noto Sans TC", sans-serif';
      ctx.fillText('PAUSED 暫停中', CANVAS_W / 2, 232);
      ctx.font = '600 17px "Noto Sans TC", sans-serif';
      ctx.fillStyle = '#cbd5e1';
      ctx.fillText('按 P / ESC / Start 繼續戰鬥  ·  手把按 Select 回選角畫面', CANVAS_W / 2, 280);
      ctx.restore();
    } else if (game.state === 'stageclear' || game.state === 'victory') {
      const isFinalWin = game.state === 'victory';
      const curStage = getCurrentStage();
      const nextStage = STAGES[game.stageIndex + 1];
      const hero = getSelectedHero();
      const p = game.player;

      ctx.save();
      // 1. Rich celebratory twilight-violet backdrop
      const bg = ctx.createLinearGradient(0, 0, CANVAS_W, CANVAS_H);
      bg.addColorStop(0, 'rgba(12, 8, 28, 0.90)');
      bg.addColorStop(0.5, 'rgba(28, 16, 56, 0.86)');
      bg.addColorStop(1, 'rgba(15, 10, 32, 0.92)');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

      // 2. Rotating golden-neon sunburst rays behind Left Hero Podium
      const podX = 250;
      const podY = 392;
      ctx.save();
      ctx.translate(podX, podY - 125);
      ctx.rotate(game.time * 0.28);
      for (let r = 0; r < 12; r++) {
        ctx.rotate((Math.PI * 2) / 12);
        const rayGrad = ctx.createLinearGradient(0, 0, 0, -290);
        rayGrad.addColorStop(0, hero.id === 'redpanda' ? 'rgba(251, 146, 60, 0.22)' : 'rgba(244, 114, 182, 0.22)');
        rayGrad.addColorStop(1, 'rgba(255, 255, 255, 0)');
        ctx.fillStyle = rayGrad;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(-22, -290);
        ctx.lineTo(22, -290);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();

      // 3. Animated celebratory confetti ribbons & twinkling stars
      const confettiColors = ['#facc15', '#f472b6', '#38bdf8', '#4ade80', '#c084fc', '#fb923c'];
      for (let i = 0; i < 36; i++) {
        const cx = ((i * 89 + Math.sin(game.time * 1.8 + i) * 34) % CANVAS_W + CANVAS_W) % CANVAS_W;
        const cy = ((i * 53 + game.time * (48 + (i % 5) * 14)) % (CANVAS_H + 30)) - 15;
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(game.time * (2.5 + (i % 3)) + i);
        ctx.fillStyle = confettiColors[i % confettiColors.length];
        ctx.globalAlpha = 0.8;
        ctx.fillRect(-5, -2.5, 10, 5);
        ctx.restore();
      }

      // 4. Left Hero Victory Podium & LIVE 10-Frame Victory Pose Animation!
      const spot = ctx.createRadialGradient(podX, podY - 110, 20, podX, podY - 110, 175);
      spot.addColorStop(0, hero.id === 'redpanda' ? 'rgba(253, 224, 71, 0.34)' : 'rgba(244, 114, 182, 0.34)');
      spot.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = spot;
      ctx.beginPath();
      ctx.arc(podX, podY - 110, 175, 0, Math.PI * 2);
      ctx.fill();

      // Glowing neon stage podium ring
      ctx.save();
      ctx.fillStyle = 'rgba(18, 12, 38, 0.92)';
      ctx.strokeStyle = hero.accentLight;
      ctx.lineWidth = 3;
      ctx.shadowColor = hero.accent;
      ctx.shadowBlur = 18;
      ctx.beginPath();
      ctx.ellipse(podX, podY + 6, 128, 28, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.ellipse(podX, podY + 2, 98, 18, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();

      // Draw Live 10-Frame Victory Animation!
      const vicKey = hero.sheets.victory || hero.sheets.idle;
      const vicSheet = SpriteBank.sheets[vicKey] || SpriteBank.sheets[hero.sheets.idle];
      const vicActId = hero.id === 'redpanda' ? 'rp_victory' : 'victory';
      const vicFps = StudioState.getFps(vicActId, 10);
      if (vicSheet) {
        const vf = Math.floor(game.time * vicFps) % vicSheet.frameCount;
        SpriteBank.drawFrame(ctx, vicKey, vf, podX, podY + 4, 1, 1.18, false);
      }

      // Hero Nameplate Pill below podium
      ctx.save();
      ctx.fillStyle = 'rgba(12, 9, 28, 0.88)';
      ctx.strokeStyle = hero.accent;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(podX - 115, podY + 44, 230, 42, 21);
      ctx.fill();
      ctx.stroke();
      ctx.textAlign = 'center';
      ctx.fillStyle = '#ffffff';
      ctx.font = '900 18px "Noto Sans TC", sans-serif';
      ctx.fillText(`★ ${hero.name}  VICTORY!`, podX, podY + 71);
      ctx.restore();

      // 5. Right Glassmorphic Results Card
      const cardX = 468, cardY = 42, cardW = 504, cardH = 428;
      ctx.save();
      const cardGrad = ctx.createLinearGradient(cardX, cardY, cardX, cardY + cardH);
      cardGrad.addColorStop(0, 'rgba(24, 18, 52, 0.92)');
      cardGrad.addColorStop(1, 'rgba(12, 9, 28, 0.95)');
      ctx.fillStyle = cardGrad;
      ctx.strokeStyle = isFinalWin ? '#facc15' : curStage.accent;
      ctx.lineWidth = 2.5;
      ctx.shadowColor = isFinalWin ? 'rgba(250, 204, 21, 0.35)' : 'rgba(56, 189, 248, 0.3)';
      ctx.shadowBlur = 22;
      ctx.beginPath();
      ctx.roundRect(cardX, cardY, cardW, cardH, 18);
      ctx.fill();
      ctx.stroke();
      ctx.shadowBlur = 0;

      // Top Stage Clear Ribbon Header
      const hdrGrad = ctx.createLinearGradient(cardX, cardY, cardX + cardW, cardY);
      hdrGrad.addColorStop(0, isFinalWin ? '#f59e0b' : hero.accent);
      hdrGrad.addColorStop(1, isFinalWin ? '#f43f5e' : '#6366f1');
      ctx.fillStyle = hdrGrad;
      ctx.beginPath();
      ctx.roundRect(cardX + 16, cardY + 16, cardW - 32, 62, 12);
      ctx.fill();

      ctx.textAlign = 'left';
      ctx.fillStyle = 'rgba(255, 255, 255, 0.86)';
      ctx.font = '800 12px monospace';
      ctx.fillText(isFinalWin ? 'SCHOOLFIGHT GRAND CHAMPIONSHIP' : `STAGE ${curStage.id} / 3 CLEARED`, cardX + 32, cardY + 37);
      ctx.fillStyle = '#ffffff';
      ctx.font = '900 24px "Noto Sans TC", sans-serif';
      ctx.fillText(isFinalWin ? '🏆 稱霸三校大亂鬥！ALL CLEAR' : `${curStage.icon} 制霸${curStage.shortName}！`, cardX + 32, cardY + 66);

      // Compute Battle Rank (S+ / S / A / B)
      const hpPct = p ? Math.round((p.hp / p.maxHp) * 100) : 100;
      const livesLeft = p ? p.lives : 3;
      const rankPts = game.score + game.maxCombo * 220 + hpPct * 18 + livesLeft * 500;
      const rankInfo = rankPts >= 9500
        ? { grade: 'S+', colA: '#fef08a', colB: '#f43f8e', label: '傳說級校霸！' }
        : rankPts >= 6000
          ? { grade: 'S', colA: '#fde047', colB: '#f97316', label: '完美制霸！' }
          : rankPts >= 3200
            ? { grade: 'A', colA: '#67e8f9', colB: '#3b82f6', label: '熱血高手！' }
            : { grade: 'B', colA: '#a7f3d0', colB: '#10b981', label: '順利通關！' };

      // Gleaming Rank Medallion on Top-Right of Card
      const rcx = cardX + cardW - 76, rcy = cardY + 148;
      const rPulse = 1 + Math.sin(game.time * 5) * 0.04;
      ctx.save();
      ctx.translate(rcx, rcy);
      ctx.scale(rPulse, rPulse);
      const rGrad = ctx.createRadialGradient(0, -10, 6, 0, 0, 50);
      rGrad.addColorStop(0, rankInfo.colA);
      rGrad.addColorStop(1, rankInfo.colB);
      ctx.fillStyle = rGrad;
      ctx.shadowColor = rankInfo.colB;
      ctx.shadowBlur = 18;
      ctx.beginPath();
      ctx.arc(0, 0, 44, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#090710';
      ctx.font = '900 34px sans-serif';
      ctx.fillText(rankInfo.grade, 0, -2);
      ctx.fillStyle = '#fef08a';
      ctx.font = '800 11px "Noto Sans TC", sans-serif';
      ctx.fillText(rankInfo.label, 0, 58);
      ctx.restore();

      // 4 Crisp Itemized Stat Rows (Left of Rank Medallion & Full Width)
      const statItems = [
        { icon: '🏆', label: '戰鬥總分 SCORE', val: `${game.score.toLocaleString()} PTS`, col: '#facc15', w: 326 },
        { icon: '⚡', label: '最高連擊 MAX COMBO', val: `${game.maxCombo} HIT`, col: '#38bdf8', w: 326 },
        { icon: '💥', label: '擊倒敵人 K.O. COUNT', val: `${game.koCount} KO`, col: '#f472b6', w: 468 },
        { icon: '❤️', label: '剩餘體力 LIFE BONUS', val: `HP ${hpPct}%  ·  ❤ ×${livesLeft}`, col: '#4ade80', w: 468 },
      ];
      for (let i = 0; i < statItems.length; i++) {
        const it = statItems[i];
        const ry = cardY + 98 + i * 54;
        ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.roundRect(cardX + 18, ry, it.w, 44, 10);
        ctx.fill();
        ctx.stroke();

        ctx.textAlign = 'left';
        ctx.fillStyle = '#cbd5e1';
        ctx.font = '700 13px "Noto Sans TC", sans-serif';
        ctx.fillText(`${it.icon}  ${it.label}`, cardX + 32, ry + 27);

        ctx.textAlign = 'right';
        ctx.fillStyle = it.col;
        ctx.font = '900 17px monospace';
        ctx.fillText(it.val, cardX + 18 + it.w - 14, ry + 28);
      }

      // Pulsing Next Stage / Play Again CTA Button
      const ctaPulse = 0.90 + Math.sin(game.time * 6) * 0.10;
      ctx.globalAlpha = ctaPulse;
      const ctaGrad = ctx.createLinearGradient(cardX + 24, 0, cardX + cardW - 24, 0);
      ctaGrad.addColorStop(0, isFinalWin ? '#f59e0b' : '#22c55e');
      ctaGrad.addColorStop(1, isFinalWin ? '#ec4899' : '#10b981');
      ctx.fillStyle = ctaGrad;
      ctx.beginPath();
      ctx.roundRect(cardX + 24, cardY + 332, cardW - 48, 54, 12);
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2.5;
      ctx.stroke();
      ctx.textAlign = 'center';
      ctx.fillStyle = '#ffffff';
      ctx.font = '900 19px "Noto Sans TC", sans-serif';
      const ctaText = isFinalWin
        ? '↻ 再戰三校大亂鬥（點擊或按 ENTER）'
        : (nextStage ? `▶ 前往 ${nextStage.name}（點擊或按 ENTER）` : '▶ 繼續下一關（ENTER）');
      ctx.fillText(ctaText, cardX + cardW / 2, cardY + 365);
      ctx.globalAlpha = 1;

      ctx.fillStyle = '#94a3b8';
      ctx.font = '600 11.5px "Noto Sans TC", sans-serif';
      ctx.fillText('提示：上方「⚙️ 動作與按鍵設定」可檢視與匯出勝利動作及所有招式連續動畫', cardX + cardW / 2, cardY + 410);
      ctx.restore();
      ctx.restore();
    } else if (game.state === 'gameover') {
      ctx.save();
      ctx.fillStyle = 'rgba(10, 7, 22, 0.82)';
      ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

      ctx.textAlign = 'center';
      ctx.lineWidth = 7;
      ctx.strokeStyle = '#0d0b14';
      ctx.font = '900 54px "Noto Sans TC", sans-serif';
      ctx.strokeText('GAME OVER', CANVAS_W / 2, 165);
      ctx.fillStyle = '#f43f5e';
      ctx.fillText('GAME OVER', CANVAS_W / 2, 165);

      ctx.fillStyle = '#ffffff';
      ctx.font = '700 22px monospace';
      ctx.fillText(`FINAL SCORE: ${game.score}   |   MAX COMBO: ${game.maxCombo} HIT   |   K.O.: ${game.koCount}`, CANVAS_W / 2, 232);

      ctx.fillStyle = '#f43f8e';
      ctx.beginPath();
      ctx.roundRect(CANVAS_W / 2 - 160, 286, 320, 54, 12);
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2.5;
      ctx.stroke();
      ctx.fillStyle = '#ffffff';
      ctx.font = '800 20px "Noto Sans TC", sans-serif';
      ctx.fillText('↻ 重新挑戰本關（ENTER）', CANVAS_W / 2, 320);
      ctx.restore();
    }
  }

  // ==========================================================================
  // 7. STAGE LIFECYCLE & UPDATE LOOP
  // ==========================================================================
  function setupStageEnvironment(keepStats = false) {
    sfx.bossMode = false;
    game.state = 'playing';
    game.camX = 0;
    game.camMinX = 0;
    game.camMaxX = STAGE_W - CANVAS_W;
    game.zoneIndex = 0;
    game.zoneActive = false;
    game.zoneCleared = false;
    game.pendingSpawns = [];
    game.zoneTimer = 0;
    game.goBannerTimer = 0;
    game.bossWarningTimer = 0;
    game.hitstop = 0;
    game.shakeTime = 0;
    game.shakeAmp = 0;
    game.lastHitEnemy = null;
    game.lastHitTimer = 0;
    game.beamEffect = null;

    if (!keepStats) {
      game.score = 0;
      game.combo = 0;
      game.comboTimer = 0;
      game.maxCombo = 0;
      game.koCount = 0;
      game.player = new Player();
    } else if (game.player) {
      game.player.x = 180;
      game.player.z = 425;
      game.player.vx = 0;
      game.player.vy = 0;
      game.player.jumpY = 0;
      game.player.facing = 1;
      game.player.state = 'idle';
      game.player.hp = game.player.maxHp;
      game.player.displayHp = game.player.maxHp;
      game.player.energy = Math.min(game.player.maxEnergy, game.player.energy + 35);
      game.player.invuln = 1.0;
    } else {
      game.player = new Player();
    }

    game.enemies = [];
    game.pickups = [];
    game.particles = [];
    game.floatTexts = [];
    game.afterimages = [];
    game.comicBubbles = [];
    game.projectiles = [];
    game.impactFrame = null;

    // Destructible school crates & gym drums along the 3600px campus
    game.props = [
      new Prop(560, 382, 'crate', 'food'),
      new Prop(920, 466, 'drum', 'crystal'),
      new Prop(1440, 376, 'crate', 'food'),
      new Prop(1920, 474, 'drum', 'crystal'),
      new Prop(2380, 386, 'crate', 'food'),
      new Prop(2690, 456, 'drum', 'crystal'),
      new Prop(3080, 372, 'crate', 'food'),
    ];

    const st = getCurrentStage();
    addFloatText(game.player.x + 60, game.player.z - 190, `${st.icon} ${st.name} 開戰！`, st.accent, 22);
    updateStatusBar();
  }

  function startNewGame(stageIdx) {
    sfx.init();
    try { window.focus(); canvas.focus(); } catch (_) {}
    if (typeof stageIdx === 'number' && !Number.isNaN(stageIdx)) {
      game.stageIndex = Math.max(0, Math.min(stageIdx, STAGES.length - 1));
      game.selectedStageIndex = game.stageIndex;
    } else {
      game.stageIndex = game.selectedStageIndex || 0;
    }
    setupStageEnvironment(false);
  }

  function syncTrainingBarUI() {
    const bar = document.getElementById('trainingBar');
    if (!bar) return;
    const active = game.state === 'playing' && !!getCurrentStage().isTraining;
    bar.hidden = !active;
    const btnTr = document.getElementById('btnTraining');
    if (btnTr) btnTr.classList.toggle('active', active);
    if (active) {
      bar.querySelectorAll('[data-tr-hero]').forEach((b) => {
        b.classList.toggle('active', b.getAttribute('data-tr-hero') === game.selectedHeroId);
      });
    }
  }

  function advanceToNextStage() {
    sfx.init();
    try { window.focus(); canvas.focus(); } catch (_) {}
    if (game.stageIndex + 1 < STAGES.length && !STAGES[game.stageIndex + 1].isTraining) {
      game.stageIndex++;
      game.selectedStageIndex = game.stageIndex;
      setupStageEnvironment(true);
    } else {
      game.state = 'victory';
      updateStatusBar();
    }
  }

  function updateStatusBar() {
    syncTrainingBarUI();
    if (!statusReadout) return;
    const st = getCurrentStage();
    const zones = getCurrentZones();
    if (game.state === 'playing') {
      if (st.isTraining) {
        const alive = game.enemies.filter((e) => !e.dead).length;
        statusReadout.textContent = `🥋 自由訓練場 · 場上測試怪 ${alive} 隻 · 不主動出怪（無限氣力）`;
      } else {
        const z = zones[Math.min(game.zoneIndex, zones.length - 1)];
        const alive = game.enemies.filter((e) => !e.dead).length + game.pendingSpawns.length;
        statusReadout.textContent = `STAGE ${st.id}/3 · ${z.name} · 剩餘敵人 ${alive}`;
      }
    } else if (game.state === 'stageclear') {
      statusReadout.textContent = `${st.name} 制霸！準備前往下一校`;
    } else if (game.state === 'victory') {
      statusReadout.textContent = `三校全制霸！最終分數 ${game.score}`;
    } else if (game.state === 'gameover') {
      statusReadout.textContent = `戰鬥結束（${st.shortName}）· 分數 ${game.score}`;
    } else if (game.state === 'title') {
      statusReadout.textContent = `${st.name} · 準備開戰`;
    }
  }

  function updateZones(dt) {
    const p = game.player;
    const st = getCurrentStage();
    if (st.isTraining) {
      // 🥋 Training Dojo: NEVER auto-spawn monsters or lock camera!
      game.camMinX = 0;
      game.camMaxX = STAGE_W - CANVAS_W;
      const desiredCam = Math.max(game.camMinX, Math.min(game.camMaxX, p.x - CANVAS_W * 0.36));
      game.camX += (desiredCam - game.camX) * Math.min(1, dt * 6.5);
      return;
    }
    const zones = getCurrentZones();
    if (game.zoneIndex < zones.length) {
      const zone = zones[game.zoneIndex];
      if (!game.zoneActive && p.x >= zone.triggerX) {
        // Lock camera for classic beat 'em up encounter!
        game.zoneActive = true;
        game.zoneTimer = 0;
        game.camMinX = zone.lockCamX;
        game.camMaxX = zone.lockCamX;
        const usedTypes = new Set();
        game.pendingSpawns = zone.spawns.map((s) => {
          const copy = { ...s };
          if (copy.type === 'random') {
            const pool = (copy.pool && copy.pool.length) ? copy.pool : ALL_RANDOM_MONSTER_POOL;
            const fresh = pool.filter((t) => !usedTypes.has(t));
            const srcPool = fresh.length ? fresh : pool;
            copy.type = srcPool[Math.floor(Math.random() * srcPool.length)];
            usedTypes.add(copy.type);
          }
          return copy;
        });
        game.goBannerTimer = 0;
        if (zone.isBoss) {
          game.bossWarningTimer = 2.4;
          sfx.bossMode = true;
          sfx.playBossWarn();
        }
      }

      if (game.zoneActive) {
        game.zoneTimer += dt;
        // Spawn enemies on schedule from left/right off-screen edges
        for (let i = game.pendingSpawns.length - 1; i >= 0; i--) {
          const sp = game.pendingSpawns[i];
          if (game.zoneTimer >= sp.delay) {
            const spawnX = sp.side === 1 ? game.camX + CANVAS_W + 70 : game.camX - 70;
            game.enemies.push(new Enemy(sp.type, spawnX, sp.z, sp));
            game.pendingSpawns.splice(i, 1);
          }
        }

        const aliveCount = game.enemies.filter((e) => !e.dead).length;
        if (game.pendingSpawns.length === 0 && aliveCount === 0) {
          // Zone Cleared!
          game.zoneActive = false;
          game.zoneIndex++;
          if (game.zoneIndex >= zones.length) {
            sfx.bossMode = false;
            sfx.playVictory();
            if (game.stageIndex + 1 < STAGES.length && !STAGES[game.stageIndex + 1].isTraining) {
              game.state = 'stageclear';
            } else {
              game.state = 'victory';
            }
          } else {
            game.camMaxX = STAGE_W - CANVAS_W;
            game.goBannerTimer = 3.2;
            sfx.playGo();
          }
        }
      }
    }

    // Smooth belt-scrolling camera follow
    const desiredCam = Math.max(game.camMinX, Math.min(game.camMaxX, p.x - CANVAS_W * 0.36));
    game.camX += (desiredCam - game.camX) * Math.min(1, dt * 6.5);
  }

  function update(dt) {
    game.time += dt;
    if (game.state !== 'playing') return;

    if (getCurrentStage().isTraining && game.player) {
      game.player.sp = 100;
      game.player.hp = game.player.maxHp;
    }

    // Impact frames & comic bubbles tick smoothly even during impact hitstop!
    if (game.impactFrame) {
      game.impactFrame.life -= dt;
      if (game.impactFrame.life <= 0) game.impactFrame = null;
    }
    for (const cb of game.comicBubbles) {
      cb.age += dt;
      cb.life -= dt;
    }
    game.comicBubbles = game.comicBubbles.filter((cb) => cb.life > 0);

    if (game.hitstop > 0) {
      game.hitstop -= dt;
      return;
    }

    if (game.shakeTime > 0) game.shakeTime -= dt;
    if (game.goBannerTimer > 0) game.goBannerTimer -= dt;
    if (game.bossWarningTimer > 0) game.bossWarningTimer -= dt;
    if (game.lastHitTimer > 0) game.lastHitTimer -= dt;
    if (game.comboTimer > 0) {
      game.comboTimer -= dt;
      if (game.comboTimer <= 0) game.combo = 0;
    }

    game.player.update(dt);
    updateZones(dt);

    for (const e of game.enemies) e.update(dt);
    game.enemies = game.enemies.filter((e) => !e.dead || e.deadFade > 0);

    for (const pj of game.projectiles) pj.update(dt);
    game.projectiles = game.projectiles.filter((pj) => !pj.dead);

    for (const pr of game.props) pr.update(dt);
    for (const pk of game.pickups) pk.update(dt);
    game.pickups = game.pickups.filter((pk) => !pk.taken);

    for (const pt of game.particles) {
      pt.x += pt.vx * dt;
      pt.y += pt.vy * dt;
      pt.vy += pt.gravity * dt;
      pt.life -= dt;
    }
    game.particles = game.particles.filter((pt) => pt.life > 0);

    for (const ft of game.floatTexts) {
      ft.y += ft.vy * dt;
      ft.vy *= 0.92;
      ft.life -= dt;
    }
    game.floatTexts = game.floatTexts.filter((ft) => ft.life > 0);

    for (const ai of game.afterimages) ai.life -= dt;
    game.afterimages = game.afterimages.filter((ai) => ai.life > 0);

    updateStatusBar();
  }

  function render() {
    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);

    // Camera Shake offset
    let sx = 0, sy = 0;
    if (game.shakeTime > 0) {
      sx = (Math.random() - 0.5) * game.shakeAmp * 2;
      sy = (Math.random() - 0.5) * game.shakeAmp * 2;
    }

    ctx.save();
    ctx.translate(Math.round(sx), Math.round(sy));

    drawStageBackground(ctx, game.camX);

    if (game.state === 'playing' || game.state === 'paused' || game.state === 'stageclear' || game.state === 'gameover' || game.state === 'victory') {
      ctx.save();
      ctx.translate(-Math.round(game.camX), 0);

      // Dash Afterimages
      for (const ai of game.afterimages) {
        ctx.save();
        ctx.globalAlpha = (ai.life / ai.maxLife) * 0.42;
        SpriteBank.drawFrame(ctx, ai.sheetKey, ai.frame, ai.x, ai.y, ai.facing, 1.0, false);
        ctx.restore();
      }

      // STRICT 2.5D Z-DEPTH SORTING across player, enemies, crates, pickups, projectiles!
      const drawList = [];
      for (const pr of game.props) if (!pr.gone) drawList.push({ z: pr.z, draw: () => pr.draw(ctx) });
      for (const pk of game.pickups) drawList.push({ z: pk.z, draw: () => pk.draw(ctx) });
      for (const e of game.enemies) drawList.push({ z: e.z, draw: () => e.draw(ctx) });
      for (const pj of game.projectiles) drawList.push({ z: pj.z + 2, draw: () => pj.draw(ctx) });
      drawList.push({ z: game.player.z, draw: () => game.player.draw(ctx) });
      if (game.beamEffect) {
        drawList.push({ z: game.beamEffect.z, draw: () => drawEnergyCannonBeam(ctx) });
      }

      drawList.sort((a, b) => a.z - b.z);
      for (const item of drawList) item.draw();

      // Particles
      for (const pt of game.particles) {
        ctx.save();
        ctx.globalAlpha = Math.max(0, pt.life / pt.maxLife);
        ctx.fillStyle = pt.color;
        if (pt.star) {
          ctx.translate(pt.x, pt.y);
          ctx.rotate(game.time * 12);
          ctx.fillRect(-pt.size, -pt.size * 0.3, pt.size * 2, pt.size * 0.6);
          ctx.fillRect(-pt.size * 0.3, -pt.size, pt.size * 0.6, pt.size * 2);
        } else {
          ctx.beginPath();
          ctx.arc(pt.x, pt.y, pt.size, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      }

      // American Comic-Book Action Bubbles (world space, crisp above particles!)
      for (const cb of game.comicBubbles) {
        if (!cb.screenSpace) drawComicBubble(ctx, cb);
      }

      // Floating Damage / Combo Numbers
      for (const ft of game.floatTexts) {
        ctx.save();
        ctx.globalAlpha = Math.min(1, (ft.life / ft.maxLife) * 1.6);
        ctx.font = `900 ${ft.size}px "Noto Sans TC", sans-serif`;
        ctx.textAlign = 'center';
        ctx.lineWidth = 4.5;
        ctx.strokeStyle = '#0d0b14';
        ctx.strokeText(ft.text, ft.x, ft.y);
        ctx.fillStyle = ft.color;
        ctx.fillText(ft.text, ft.x, ft.y);
        ctx.restore();
      }

      ctx.restore();

      // LAYER 5 (1.38x): Fast Foreground Depth-of-Field Foliage & Bokeh Motes!
      drawForegroundParallax(ctx, game.camX);

      // Comic Impact Frame speed-line flash overlay
      drawImpactFrameOverlay(ctx);

      drawArcadeHUD(ctx);
    }

    ctx.restore();
    drawOverlayScreens(ctx);
    if (typeof GamepadManager !== 'undefined') GamepadManager.drawToast(ctx);
  }

  // ==========================================================================
  // 8. ⚙️ GEAR SETTINGS STUDIO (Character Animations, Keybinds, Tuning, Upload)
  // ==========================================================================
  const studioPreviewItems = [];

  function renderControlsLegend() {
    const el = document.getElementById('controlsLegend');
    if (!el) return;
    const lk = formatKeyCode(StudioState.getAction('lightAttack')?.key);
    const hk = formatKeyCode(StudioState.getAction('heavyAttack')?.key);
    const sk = formatKeyCode(StudioState.getAction('special')?.key);
    const dk = formatKeyCode(StudioState.getAction('dash')?.key);
    const jk = formatKeyCode(StudioState.getAction('jump')?.key);

    el.innerHTML = `
      <span class="key-item"><kbd>WASD</kbd> 走路</span>
      <span class="key-item"><kbd>AA</kbd>/<kbd>DD</kbd> 跑步</span>
      <span class="key-item special"><kbd>↑</kbd>+<kbd>${hk}</kbd> 龍捲旋風腳</span>
      <span class="key-item"><kbd>${dk}</kbd> 閃身步</span>
      <span class="key-item"><kbd>${lk}</kbd> 輕攻(拳)</span>
      <span class="key-item"><kbd>${hk}</kbd> 重攻(杖)</span>
      <span class="key-item special"><kbd>跑步+${lk}</kbd> 浪子踢球</span>
      <span class="key-item special"><kbd>${sk}</kbd> 必殺技</span>
    `;

    // Sync virtual pad button captions
    const map = { lightAttack: lk, heavyAttack: hk, special: sk, dash: dk };
    document.querySelectorAll('[data-action]').forEach((btn) => {
      const id = btn.getAttribute('data-action');
      const sm = btn.querySelector('small');
      if (sm && map[id]) sm.textContent = map[id];
    });
  }

  // ==========================================================================
  // PURE-JS ZERO-DEPENDENCY PKZIP ARCHIVE BUILDER (One-Click Export All!)
  // ==========================================================================
  const ZipBuilder = (() => {
    const crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) {
        c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      }
      crcTable[n] = c >>> 0;
    }
    function crc32(bytes) {
      let c = 0xffffffff;
      for (let i = 0; i < bytes.length; i++) {
        c = crcTable[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
      }
      return (c ^ 0xffffffff) >>> 0;
    }
    function createZipBlob(files) {
      const enc = new TextEncoder();
      const localParts = [];
      const centralParts = [];
      let offset = 0;

      for (const f of files) {
        const nameBytes = enc.encode(f.name);
        const data = f.data instanceof Uint8Array ? f.data : enc.encode(String(f.data));
        const crc = crc32(data);

        const lh = new Uint8Array(30 + nameBytes.length);
        const lv = new DataView(lh.buffer);
        lv.setUint32(0, 0x04034b50, true);
        lv.setUint16(4, 20, true);
        lv.setUint16(6, 0x0800, true); // UTF-8 filename flag
        lv.setUint16(8, 0, true);      // STORE (0)
        lv.setUint16(10, 0, true);
        lv.setUint16(12, 0x5821, true);
        lv.setUint32(14, crc, true);
        lv.setUint32(18, data.length, true);
        lv.setUint32(22, data.length, true);
        lv.setUint16(26, nameBytes.length, true);
        lv.setUint16(28, 0, true);
        lh.set(nameBytes, 30);

        const ch = new Uint8Array(46 + nameBytes.length);
        const cv = new DataView(ch.buffer);
        cv.setUint32(0, 0x02014b50, true);
        cv.setUint16(4, 20, true);
        cv.setUint16(6, 20, true);
        cv.setUint16(8, 0x0800, true);
        cv.setUint16(10, 0, true);
        cv.setUint16(12, 0, true);
        cv.setUint16(14, 0x5821, true);
        cv.setUint32(16, crc, true);
        cv.setUint32(20, data.length, true);
        cv.setUint32(24, data.length, true);
        cv.setUint16(28, nameBytes.length, true);
        cv.setUint16(30, 0, true);
        cv.setUint16(32, 0, true);
        cv.setUint16(34, 0, true);
        cv.setUint16(36, 0, true);
        cv.setUint32(38, 0, true);
        cv.setUint32(42, offset, true);
        ch.set(nameBytes, 46);

        localParts.push(lh, data);
        centralParts.push(ch);
        offset += lh.length + data.length;
      }

      const centralSize = centralParts.reduce((s, p) => s + p.length, 0);
      const eocd = new Uint8Array(22);
      const ev = new DataView(eocd.buffer);
      ev.setUint32(0, 0x06054b50, true);
      ev.setUint16(4, 0, true);
      ev.setUint16(6, 0, true);
      ev.setUint16(8, files.length, true);
      ev.setUint16(10, files.length, true);
      ev.setUint32(12, centralSize, true);
      ev.setUint32(16, offset, true);
      ev.setUint16(20, 0, true);

      return new Blob([...localParts, ...centralParts, eocd], { type: 'application/zip' });
    }
    return { createZipBlob };
  })();

  let isExportingAllZip = false;
  async function exportAllCharactersAnimationsZip(triggerBtn = null) {
    if (isExportingAllZip) return;
    isExportingAllZip = true;
    const origText = triggerBtn ? triggerBtn.textContent : '';
    const setStatus = (txt) => { if (triggerBtn) triggerBtn.textContent = txt; };

    try {
      const sanitize = (s) => String(s || '').replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, '_');
      const tasks = [];
      for (let ci = 0; ci < StudioState.characters.length; ci++) {
        const ch = StudioState.characters[ci];
        for (let ai = 0; ai < ch.actions.length; ai++) {
          const act = ch.actions[ai];
          const sh = SpriteBank.sheets[act.sheetKey] || (act.fallbackSheet ? SpriteBank.sheets[act.fallbackSheet] : null);
          if (sh && sh.img) {
            tasks.push({ ci, ch, ai, act, sh, isFallback: !SpriteBank.sheets[act.sheetKey] });
          }
        }
      }

      const zipFiles = [];
      const manifest = {
        game: 'Star Fish 國小 大亂鬥 (SchoolFight-TV)',
        exportedAt: new Date().toISOString(),
        recommendedCellSize: '300x264',
        totalCharacters: StudioState.characters.length,
        totalAnimationSheets: tasks.length,
        characters: [],
      };

      const charMap = new Map();
      const encodeSheetPngBytes = async (sh) => {
        const src = sh.img && sh.img.src ? String(sh.img.src) : '';
        if (!sh.custom && (src.endsWith('.png') || src.startsWith('data:image/png'))) {
          try {
            const r = await fetch(src);
            if (r.ok) return new Uint8Array(await r.arrayBuffer());
          } catch (_) {}
        }
        const c = document.createElement('canvas');
        c.width = sh.img.width;
        c.height = sh.img.height;
        c.getContext('2d').drawImage(sh.img, 0, 0);
        return await new Promise((resolve) => {
          c.toBlob(async (blob) => {
            if (!blob) return resolve(new Uint8Array(0));
            resolve(new Uint8Array(await blob.arrayBuffer()));
          }, 'image/png');
        });
      };

      const BATCH = 8;
      for (let start = 0; start < tasks.length; start += BATCH) {
        const slice = tasks.slice(start, start + BATCH);
        setStatus(`⏳ 打包中 (${Math.min(tasks.length, start + slice.length)}/${tasks.length})...`);
        const encodedBatch = await Promise.all(slice.map((t) => encodeSheetPngBytes(t.sh)));

        for (let k = 0; k < slice.length; k++) {
          const { ci, ch, ai, act, sh, isFallback } = slice[k];
          const pngBytes = encodedBatch[k];
          const folder = `${String(ci + 1).padStart(2, '0')}_${sanitize(ch.id)}_${sanitize(ch.name).slice(0, 18)}`;
          const baseName = `${String(ai + 1).padStart(2, '0')}_${sanitize(act.id)}_${sh.cols}x${sh.rows}_${sh.frameCount}f`;
          const pngPath = `${folder}/${baseName}.png`;
          zipFiles.push({ name: pngPath, data: pngBytes });

          const metaEntry = {
            actionId: act.id,
            label: act.label,
            sheetKey: act.sheetKey,
            isFallback,
            cols: sh.cols,
            rows: sh.rows,
            frameCount: sh.frameCount,
            fps: act.fps,
            width: sh.img.width,
            height: sh.img.height,
            cellW: sh.cellW,
            cellH: sh.cellH,
            anchorX: sh.anchorX,
            anchorY: sh.anchorY,
            pngFile: pngPath,
          };
          if (!charMap.has(ch.id)) {
            const chRec = {
              id: ch.id,
              name: ch.name,
              role: ch.role || 'monster',
              combatParams: StudioState.getCombatParams(ch.id),
              folder,
              actions: [],
            };
            charMap.set(ch.id, chRec);
            manifest.characters.push(chRec);
          }
          charMap.get(ch.id).actions.push(metaEntry);
        }
      }

      const readme = [
        '《Star Fish 國小 大亂鬥》全部角色連續動畫精靈表與戰鬥參數打包檔',
        '======================================================',
        `匯出時間：${manifest.exportedAt}`,
        `角色總數：${manifest.totalCharacters} 位角色｜連續動畫精靈表總數：${manifest.totalAnimationSheets} 張`,
        '',
        '【建議新精靈表上傳規格（支援 10 ~ 60+ 幀！）】',
        '1. 幀數與排列：不限 10 幀！支援 5×2 (10幀)、5×4 (20幀)、5×6 或 6×5 (30幀) 等任意整齊網格。',
        '2. 單格標準尺寸：遊戲內部每格為 300×264 px（主角腳底錨點 136,242；怪物腳底錨點 150,236）。',
        '   ※ 您上傳任意高解析度圖片（如 1500×1056、2048×2048、2752×1536）皆可！',
        '   ※ 內建「🤖 智能辨識 v2」會自動偵測欄×列與總幀數、自動去背、谷底切格不裁切大特效，並自動等比縮放進 300×264 絕不爆框切割！',
        '3. AI 生圖小撇步：請使用單一純色深色背景（推薦 #0d1220 深藍黑）或透明 PNG，所有幀角色朝右、大小一致、格與格之間留些微空隙、不加文字標籤。',
        '4. 怪物參數與雲端覆寫：於網頁「⚙️ 角色連幀動畫＆怪物戰鬥參數工作台」調整體型、HP、霸體、受擊硬直或上傳 PNG 後，點「☁️ 雲端覆寫」即可同步至 GitHub Pages！',
      ].join('\n');

      zipFiles.unshift({ name: 'animations_manifest.json', data: JSON.stringify(manifest, null, 2) });
      zipFiles.unshift({ name: 'README_動畫規格與匯入說明.txt', data: readme });

      const zipBlob = ZipBuilder.createZipBlob(zipFiles);
      const url = URL.createObjectURL(zipBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `StarFish_All_Characters_Animations_${tasks.length}sheets.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      setStatus(`✅ 已匯出 ${tasks.length} 張動畫！`);
      setTimeout(() => setStatus(origText), 2800);
    } catch (err) {
      console.error('Export all ZIP error:', err);
      setStatus('❌ 匯出失敗');
      setTimeout(() => setStatus(origText), 2600);
    } finally {
      isExportingAllZip = false;
    }
  }

  let studioScalePreviewState = { canvas: null, charId: null, sheetKey: null, frame: 0 };
  let studioControlsWired = false;

  function formatArmorBrief(cp) {
    if (cp.superArmor === 'always') return '🛡金霸體';
    if (cp.superArmor === 'hits') return `🛡${cp.armorHits}擊霸體`;
    if (cp.superArmor === 'attack') return '🛡出招霸體';
    return cp.flinchOnHit === false ? '✖免硬直' : '一般受擊';
  }

  function formatRosterSubline(ch) {
    const cp = StudioState.getCombatParams(ch.id);
    return `${cp.scale.toFixed(2)}x · HP ${cp.hp} · ${formatArmorBrief(cp)} · ${ch.actions.length}招`;
  }

  function cleanCharTitle(rawName) {
    return String(rawName || '').replace(/（.*?）/g, '').trim() || rawName;
  }

  function getCharPrimarySheetKey(ch) {
    if (!ch || !ch.actions || ch.actions.length === 0) return null;
    for (const a of ch.actions) {
      if (SpriteBank.sheets[a.sheetKey]) return a.sheetKey;
      if (a.fallbackSheet && SpriteBank.sheets[a.fallbackSheet]) return a.fallbackSheet;
    }
    return null;
  }

  function isCharAnyModified(ch) {
    if (StudioState.isCombatParamsModified(ch.id)) return true;
    return ch.actions.some((a) => {
      const sh = SpriteBank.sheets[a.sheetKey];
      return (sh && sh.custom) || a.custom;
    });
  }

  function renderRosterSidebar() {
    const tabsEl = document.getElementById('charTabs');
    const catEl = document.getElementById('charCategoryTabs');
    const searchInput = document.getElementById('charSearchInput');
    if (!tabsEl) return;

    const prevScroll = tabsEl.scrollTop;
    const allChars = StudioState.characters;
    const counts = {
      all: allChars.length,
      hero: allChars.filter((c) => c.role === 'hero').length,
      boss: allChars.filter((c) => c.role === 'boss').length,
      monster: allChars.filter((c) => (c.role || 'monster') === 'monster' && c.builtinEnemy).length,
      custom: allChars.filter((c) => c.role === 'custom' || (!c.builtinEnemy && c.role !== 'hero')).length,
    };

    if (catEl) {
      catEl.innerHTML = '';
      const cats = [
        { id: 'all', label: `全部 (${counts.all})` },
        { id: 'hero', label: `主角 (${counts.hero})` },
        { id: 'boss', label: `BOSS (${counts.boss})` },
        { id: 'monster', label: `怪物 (${counts.monster})` },
      ];
      if (counts.custom > 0 || StudioState.categoryFilter === 'custom') {
        cats.push({ id: 'custom', label: `自訂 (${counts.custom})` });
      }
      for (const c of cats) {
        const btn = document.createElement('button');
        btn.className = `cat-pill ${StudioState.categoryFilter === c.id ? 'active' : ''}`;
        btn.textContent = c.label;
        btn.addEventListener('click', () => {
          StudioState.categoryFilter = c.id;
          renderRosterSidebar();
        });
        catEl.appendChild(btn);
      }
    }

    if (searchInput && searchInput.value !== StudioState.searchQuery) {
      searchInput.value = StudioState.searchQuery;
    }

    const q = (StudioState.searchQuery || '').trim().toLowerCase();
    const filtered = allChars.filter((ch) => {
      const chRole = ch.role || (ch.builtinEnemy ? 'monster' : 'custom');
      if (StudioState.categoryFilter !== 'all' && chRole !== StudioState.categoryFilter) return false;
      if (q) {
        const hay = `${ch.name} ${ch.id} ${ch.enemyKey || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    tabsEl.innerHTML = '';
    if (filtered.length === 0) {
      const empty = document.createElement('div');
      empty.style.cssText = 'padding:18px 10px;text-align:center;font-size:12px;color:#94a3b8;';
      empty.textContent = '找不到符合條件的角色／怪物';
      tabsEl.appendChild(empty);
      return;
    }

    for (const ch of filtered) {
      const chRole = ch.role || (ch.builtinEnemy ? 'monster' : 'custom');
      const roleLabel = chRole === 'hero' ? '主角' : (chRole === 'boss' ? 'BOSS' : (chRole === 'monster' ? '怪物' : '自訂'));
      const row = document.createElement('button');
      row.type = 'button';
      row.className = `roster-row char-tab ${ch.id === StudioState.activeCharId ? 'active' : ''}`;
      row.dataset.charId = ch.id;

      const thumb = document.createElement('div');
      thumb.className = 'roster-thumb';
      const tCanvas = document.createElement('canvas');
      tCanvas.width = 76;
      tCanvas.height = 76;
      const pKey = getCharPrimarySheetKey(ch);
      if (pKey && SpriteBank.sheets[pKey]) {
        const sh = SpriteBank.sheets[pKey];
        const tctx = tCanvas.getContext('2d');
        const enemyCfg = ch.enemyKey ? ENEMY_CONFIGS[ch.enemyKey] : null;
        const vIdx = StudioState.previewVariants[ch.id] || 0;
        const variant = (enemyCfg && enemyCfg.colorVariants && enemyCfg.colorVariants[vIdx]) || null;
        SpriteBank.drawFrame(tctx, pKey, 0, 38, 69, 1, Math.min(0.32, 68 / Math.max(120, sh.cellH)), false, variant);
      }
      thumb.appendChild(tCanvas);

      const info = document.createElement('div');
      info.className = 'roster-info';
      const nameLine = document.createElement('div');
      nameLine.className = 'roster-name-line';
      nameLine.innerHTML = `<span class="role-tag ${chRole}">${roleLabel}</span><span class="roster-name" title="${ch.name}">${cleanCharTitle(ch.name)}</span>`;

      const subLine = document.createElement('div');
      subLine.className = 'roster-sub';
      subLine.id = `roster_sub_${ch.id}`;
      subLine.textContent = formatRosterSubline(ch);

      info.appendChild(nameLine);
      info.appendChild(subLine);

      const modIndicator = document.createElement('div');
      if (isCharAnyModified(ch)) {
        const dot = document.createElement('span');
        dot.className = 'roster-mod-dot';
        dot.title = '已自訂戰鬥參數或動畫精靈表';
        modIndicator.appendChild(dot);
      }

      row.appendChild(thumb);
      row.appendChild(info);
      row.appendChild(modIndicator);

      row.addEventListener('click', () => {
        StudioState.activeCharId = ch.id;
        StudioState.rebindingActionId = null;
        renderGearStudio();
      });
      tabsEl.appendChild(row);
    }

    tabsEl.scrollTop = prevScroll;
  }

  function wireStaticStudioControls() {
    if (studioControlsWired) return;
    studioControlsWired = true;

    const searchInput = document.getElementById('charSearchInput');
    if (searchInput) {
      searchInput.addEventListener('input', () => {
        StudioState.searchQuery = searchInput.value;
        renderRosterSidebar();
      });
    }

    const btnAddChar = document.getElementById('btnAddCustomChar');
    if (btnAddChar) {
      btnAddChar.addEventListener('click', () => {
        const idx = StudioState.characters.length + 1;
        const id = `char_${Date.now()}`;
        StudioState.characters.push({
          id,
          name: `👤 自訂角色 ${idx}`,
          role: 'custom',
          actions: [
            { id: `${id}_idle`, label: '待機動畫 (Idle)', triggerDesc: '靜止循環', sheetKey: `${id}_idle`, fallbackSheet: null, fps: 8, cols: 5, rows: 2, key: null, altKeys: [], rebindable: false },
            { id: `${id}_run`, label: '移動／跑步 (Run)', triggerDesc: '移動循環', sheetKey: `${id}_run`, fallbackSheet: null, fps: 14, cols: 5, rows: 2, key: null, altKeys: [], rebindable: false },
            { id: `${id}_atk`, label: '攻擊動作 (Attack)', triggerDesc: '攻擊序列', sheetKey: `${id}_atk`, fallbackSheet: null, fps: 16, cols: 5, rows: 2, key: null, altKeys: [], rebindable: false },
          ],
        });
        StudioState.categoryFilter = 'all';
        StudioState.activeCharId = id;
        StudioState.save();
        renderGearStudio();
      });
    }

    const btnViewList = document.getElementById('btnViewList');
    const btnViewGrid = document.getElementById('btnViewGrid');
    if (btnViewList) {
      btnViewList.addEventListener('click', () => {
        StudioState.viewMode = 'list';
        StudioState.save();
        renderGearStudio();
      });
    }
    if (btnViewGrid) {
      btnViewGrid.addEventListener('click', () => {
        StudioState.viewMode = 'grid';
        StudioState.save();
        renderGearStudio();
      });
    }

    const btnToggleCloud = document.getElementById('btnToggleCloudBar');
    if (btnToggleCloud) {
      btnToggleCloud.addEventListener('click', () => {
        StudioState.specExpanded = !StudioState.specExpanded;
        renderGearStudio();
      });
    }
  }

  function renderCombatParamsInspector(activeChar) {
    const panel = document.getElementById('combatParamsPanel');
    if (!panel || !activeChar) return;

    const cp = StudioState.getCombatParams(activeChar.id);
    const chRole = activeChar.role || (activeChar.builtinEnemy ? 'monster' : 'custom');
    const roleText = chRole === 'hero' ? '主角參數' : (chRole === 'boss' ? 'BOSS 戰鬥參數' : '怪物戰鬥參數');
    const enemyCfg = activeChar.enemyKey ? ENEMY_CONFIGS[activeChar.enemyKey] : null;
    const variants = (enemyCfg && enemyCfg.colorVariants) || [];
    const curVarIdx = StudioState.previewVariants[activeChar.id] || 0;

    panel.innerHTML = `
      <div class="params-header">
        <div class="params-char-lead">
          <div class="param-scale-stage" title="即時體型比例與霸體光環預覽（虛線為 1.0x 主角身高基準）">
            <canvas id="paramScaleCanvas" width="216" height="172"></canvas>
          </div>
          <div class="params-title-block">
            <h3>
              <span class="role-tag ${chRole}">${roleText}</span>
              <span>${activeChar.name}</span>
              <code class="params-id-code">${activeChar.enemyKey || activeChar.id}</code>
            </h3>
            <div style="font-size:11.5px;color:#94a3b8;">
              調整下方數值會<strong>立即套用至場上與新生成的角色／怪物</strong>，並自動儲存於本機（亦可一鍵覆寫至 GitHub 雲端）。
            </div>
            ${variants.length > 0 ? `<div id="paramVariantBar" class="variant-bar"><span>🎨 配色預覽：</span></div>` : ''}
          </div>
        </div>
        <div class="params-header-btns">
          ${activeChar.enemyKey ? `<button id="btnSpawnTestEnemy" class="mini-btn" style="border-color:rgba(74,222,128,0.6);color:#86efac;padding:5px 10px;" title="立即在上方遊戲畫面召喚一隻此怪物（套用目前最新體型/HP/霸體/硬直設定），直接出拳實測！">⚡ 場上召喚實測</button>` : ''}
          <button id="btnSyncParamsCloud" class="mini-btn" style="border-color:rgba(56,189,248,0.6);color:#7dd3fc;padding:5px 10px;" title="將所有怪物戰鬥參數與 FPS 設定同步寫入 GitHub Pages 雲端">☁️ 同步參數至雲端</button>
          <button id="btnResetCharParams" class="mini-btn" style="padding:5px 9px;" title="將此角色的戰鬥參數恢復為出廠預設值">↺ 重置此角參數</button>
        </div>
      </div>

      <div class="params-grid">
        <div class="param-cell">
          <div class="param-cell-top">
            <span>📏 體型大小 (Scale)</span>
            <span id="lblParamScale" class="param-val-badge">${cp.scale.toFixed(2)}x</span>
          </div>
          <div class="param-ctrl-row">
            <input id="rngParamScale" type="range" min="0.40" max="3.00" step="0.02" value="${cp.scale}" />
            <input id="numParamScale" class="param-num" type="number" min="0.35" max="3.50" step="0.05" value="${cp.scale.toFixed(2)}" />
          </div>
        </div>

        <div class="param-cell">
          <div class="param-cell-top">
            <span>❤️ 最大血量 (Max HP)</span>
            <span id="lblParamHp" class="param-val-badge">HP ${cp.hp}</span>
          </div>
          <div class="param-ctrl-row">
            <input id="rngParamHp" type="range" min="20" max="2000" step="5" value="${Math.min(2000, cp.hp)}" />
            <input id="numParamHp" class="param-num" type="number" min="10" max="9999" step="5" value="${cp.hp}" />
          </div>
        </div>

        <div class="param-cell">
          <div class="param-cell-top">
            <span>🛡️ 霸體設定 (Super Armor)</span>
            <span id="lblParamArmor" class="param-val-badge">${formatArmorBrief(cp)}</span>
          </div>
          <div class="param-ctrl-row">
            <select id="selParamArmor" class="param-select" style="flex:1;">
              <option value="none" ${cp.superArmor === 'none' ? 'selected' : ''}>無霸體（正常受擊反應）</option>
              <option value="attack" ${cp.superArmor === 'attack' ? 'selected' : ''}>出招霸體（蓄力/攻擊中不中斷）</option>
              <option value="hits" ${cp.superArmor === 'hits' ? 'selected' : ''}>護盾霸體（承受 N 擊才破防）</option>
              <option value="always" ${cp.superArmor === 'always' ? 'selected' : ''}>全程金霸體（常駐免疫打斷）</option>
            </select>
            <input id="numParamArmorHits" class="param-num" type="number" min="1" max="30" step="1" value="${cp.armorHits}" title="護盾霸體可承受幾次攻擊才破防" style="width:46px;display:${cp.superArmor === 'hits' ? 'block' : 'none'};" />
          </div>
        </div>

        <div class="param-cell">
          <div class="param-cell-top">
            <span>⚡ 受攻擊是否硬直 (Flinch)</span>
            <span id="lblParamFlinch" class="param-val-badge" style="color:${cp.flinchOnHit ? '#86efac' : '#fda4af'};">${cp.flinchOnHit ? '會硬直' : '不硬直'}</span>
          </div>
          <div class="flinch-toggle-group">
            <button type="button" id="btnFlinchYes" class="flinch-btn on ${cp.flinchOnHit ? 'active' : ''}">✔ 受擊會硬直</button>
            <button type="button" id="btnFlinchNo" class="flinch-btn off ${!cp.flinchOnHit ? 'active' : ''}">✖ 受擊不硬直</button>
          </div>
        </div>

        <div class="param-cell">
          <div class="param-cell-top">
            <span>🌪️ 擊退／浮空抗性</span>
            <span id="lblParamKb" class="param-val-badge">${cp.knockbackMode === 'immune' ? '不動如山' : (cp.knockbackMode === 'resist' ? '抗浮空' : '正常浮空')}</span>
          </div>
          <div class="param-ctrl-row">
            <select id="selParamKb" class="param-select">
              <option value="normal" ${cp.knockbackMode === 'normal' ? 'selected' : ''}>正常（可擊退／升龍可打浮空）</option>
              <option value="resist" ${cp.knockbackMode === 'resist' ? 'selected' : ''}>重裝抗浮空（僅微退・不打飛空中）</option>
              <option value="immune" ${cp.knockbackMode === 'immune' ? 'selected' : ''}>不動如山（完全免疫擊退與浮空）</option>
            </select>
          </div>
        </div>

        <div class="param-cell">
          <div class="param-cell-top">
            <span>⏱️ 受擊硬直時長倍率</span>
            <span id="lblParamStun" class="param-val-badge">${cp.hitstunMult.toFixed(2)}x</span>
          </div>
          <div class="param-ctrl-row">
            <input id="rngParamStun" type="range" min="0.25" max="2.20" step="0.05" value="${cp.hitstunMult}" />
          </div>
        </div>

        <div class="param-cell">
          <div class="param-cell-top">
            <span>👟 移動速度倍率</span>
            <span id="lblParamSpd" class="param-val-badge">${cp.speedMult.toFixed(2)}x</span>
          </div>
          <div class="param-ctrl-row">
            <input id="rngParamSpd" type="range" min="0.40" max="2.20" step="0.05" value="${cp.speedMult}" />
          </div>
        </div>

        <div class="param-cell">
          <div class="param-cell-top">
            <span>⚔️ 攻擊傷害倍率</span>
            <span id="lblParamDmg" class="param-val-badge">${cp.dmgMult.toFixed(2)}x</span>
          </div>
          <div class="param-ctrl-row">
            <input id="rngParamDmg" type="range" min="0.40" max="2.50" step="0.05" value="${cp.dmgMult}" />
          </div>
        </div>
      </div>
    `;

    // Wire color variant chips if present
    if (variants.length > 0) {
      const vBar = document.getElementById('paramVariantBar');
      variants.forEach((v, idx) => {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = `variant-chip ${idx === curVarIdx ? 'active' : ''}`;
        const swCol = v.rgb ? `rgb(${v.rgb[0]},${v.rgb[1]},${v.rgb[2]})` : '#fff';
        chip.innerHTML = `<span class="variant-swatch" style="background:${swCol}"></span><span>${v.label}</span>`;
        chip.addEventListener('click', () => {
          StudioState.previewVariants[activeChar.id] = idx;
          renderGearStudio();
        });
        vBar.appendChild(chip);
      });
    }

    studioScalePreviewState = {
      canvas: document.getElementById('paramScaleCanvas'),
      charId: activeChar.id,
      sheetKey: getCharPrimarySheetKey(activeChar),
      frame: studioScalePreviewState.charId === activeChar.id ? studioScalePreviewState.frame : 0,
    };

    const refreshSidebarRowMeta = () => {
      const subEl = document.getElementById(`roster_sub_${activeChar.id}`);
      if (subEl) subEl.textContent = formatRosterSubline(activeChar);
      const cur = StudioState.getCombatParams(activeChar.id);
      const lblArmor = document.getElementById('lblParamArmor');
      if (lblArmor) lblArmor.textContent = formatArmorBrief(cur);
    };

    // Scale controls
    const rngScale = document.getElementById('rngParamScale');
    const numScale = document.getElementById('numParamScale');
    const lblScale = document.getElementById('lblParamScale');
    const applyScale = (val) => {
      const s = Math.max(0.35, Math.min(3.5, parseFloat(val) || 1.0));
      StudioState.setCombatParams(activeChar.id, { scale: Math.round(s * 100) / 100 });
      if (lblScale) lblScale.textContent = `${s.toFixed(2)}x`;
      if (rngScale) rngScale.value = String(Math.min(3.0, s));
      if (numScale) numScale.value = s.toFixed(2);
      refreshSidebarRowMeta();
    };
    if (rngScale) rngScale.addEventListener('input', () => applyScale(rngScale.value));
    if (numScale) numScale.addEventListener('change', () => applyScale(numScale.value));

    // HP controls
    const rngHp = document.getElementById('rngParamHp');
    const numHp = document.getElementById('numParamHp');
    const lblHp = document.getElementById('lblParamHp');
    const applyHp = (val) => {
      const h = Math.max(10, Math.min(9999, Math.round(parseFloat(val) || 100)));
      StudioState.setCombatParams(activeChar.id, { hp: h });
      if (lblHp) lblHp.textContent = `HP ${h}`;
      if (rngHp) rngHp.value = String(Math.min(2000, h));
      if (numHp) numHp.value = String(h);
      refreshSidebarRowMeta();
    };
    if (rngHp) rngHp.addEventListener('input', () => applyHp(rngHp.value));
    if (numHp) numHp.addEventListener('change', () => applyHp(numHp.value));

    // Super Armor controls
    const selArmor = document.getElementById('selParamArmor');
    const numArmorHits = document.getElementById('numParamArmorHits');
    if (selArmor) {
      selArmor.addEventListener('change', () => {
        const mode = selArmor.value;
        StudioState.setCombatParams(activeChar.id, { superArmor: mode });
        if (numArmorHits) numArmorHits.style.display = mode === 'hits' ? 'block' : 'none';
        refreshSidebarRowMeta();
      });
    }
    if (numArmorHits) {
      numArmorHits.addEventListener('change', () => {
        const hits = Math.max(1, Math.min(30, parseInt(numArmorHits.value, 10) || 3));
        numArmorHits.value = String(hits);
        StudioState.setCombatParams(activeChar.id, { armorHits: hits });
        refreshSidebarRowMeta();
      });
    }

    // Flinch on Hit segmented buttons
    const btnFYes = document.getElementById('btnFlinchYes');
    const btnFNo = document.getElementById('btnFlinchNo');
    const lblFlinch = document.getElementById('lblParamFlinch');
    const setFlinch = (flag) => {
      StudioState.setCombatParams(activeChar.id, { flinchOnHit: flag });
      if (btnFYes) btnFYes.classList.toggle('active', flag);
      if (btnFNo) btnFNo.classList.toggle('active', !flag);
      if (lblFlinch) {
        lblFlinch.textContent = flag ? '會硬直' : '不硬直';
        lblFlinch.style.color = flag ? '#86efac' : '#fda4af';
      }
      refreshSidebarRowMeta();
    };
    if (btnFYes) btnFYes.addEventListener('click', () => setFlinch(true));
    if (btnFNo) btnFNo.addEventListener('click', () => setFlinch(false));

    // Knockback Mode
    const selKb = document.getElementById('selParamKb');
    const lblKb = document.getElementById('lblParamKb');
    if (selKb) {
      selKb.addEventListener('change', () => {
        const m = selKb.value;
        StudioState.setCombatParams(activeChar.id, { knockbackMode: m });
        if (lblKb) lblKb.textContent = m === 'immune' ? '不動如山' : (m === 'resist' ? '抗浮空' : '正常浮空');
      });
    }

    // Hitstun / Speed / Damage Multipliers
    const bindSimpleRange = (id, lblId, key) => {
      const r = document.getElementById(id);
      const l = document.getElementById(lblId);
      if (!r) return;
      r.addEventListener('input', () => {
        const v = Math.round(parseFloat(r.value) * 100) / 100;
        StudioState.setCombatParams(activeChar.id, { [key]: v });
        if (l) l.textContent = `${v.toFixed(2)}x`;
      });
    };
    bindSimpleRange('rngParamStun', 'lblParamStun', 'hitstunMult');
    bindSimpleRange('rngParamSpd', 'lblParamSpd', 'speedMult');
    bindSimpleRange('rngParamDmg', 'lblParamDmg', 'dmgMult');

    // Live Spawn Test Monster button!
    const btnSpawn = document.getElementById('btnSpawnTestEnemy');
    if (btnSpawn && activeChar.enemyKey) {
      btnSpawn.addEventListener('click', () => {
        if (game.state === 'title' || game.state === 'gameover' || game.state === 'victory') {
          startNewGame(game.stageIndex || 0);
        }
        const p = game.player;
        const spawnX = Math.min(game.camMaxX + CANVAS_W - 90, p.x + 215);
        const vObj = variants[curVarIdx] || null;
        const testMob = new Enemy(activeChar.enemyKey, spawnX, p.z, vObj ? { variantId: vObj.id } : null);
        game.enemies.push(testMob);
        game.lastHitEnemy = testMob;
        game.lastHitTimer = 5.0;
        const curP = StudioState.getCombatParams(activeChar.id);
        addFloatText(testMob.x, testMob.z - 155 * curP.scale, `⚡ 實測召喚 (${curP.scale.toFixed(2)}x · HP ${curP.hp})`, '#4ade80', 19);
        const statusMsg = document.getElementById('cloudSyncStatusMsg');
        if (statusMsg) {
          statusMsg.style.color = '#4ade80';
          statusMsg.textContent = `⚡ 已於上方遊戲畫面召喚【${cleanCharTitle(activeChar.name)}】(${curP.scale.toFixed(2)}x / HP ${curP.hp} / ${formatArmorBrief(curP)})！`;
        }
        document.getElementById('gameCanvas')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
    }

    // Sync Combat Params to Cloud
    const btnSyncCloud = document.getElementById('btnSyncParamsCloud');
    if (btnSyncCloud) {
      btnSyncCloud.addEventListener('click', async () => {
        const statusMsg = document.getElementById('cloudSyncStatusMsg');
        btnSyncCloud.disabled = true;
        btnSyncCloud.textContent = '⏳ 同步中...';
        try {
          await CloudSyncManager.syncManifestOnly(`${cleanCharTitle(activeChar.name)} combat params`);
          btnSyncCloud.textContent = '✅ 已同步雲端';
          if (statusMsg) {
            statusMsg.style.color = '#4ade80';
            statusMsg.textContent = `✅ 已將怪物戰鬥參數與動作設定覆寫同步至雲端 cloud_manifest.json！`;
          }
        } catch (err) {
          btnSyncCloud.textContent = '❌ 失敗';
          if (statusMsg) {
            statusMsg.style.color = '#f87171';
            statusMsg.textContent = `❌ ${err.message}`;
          }
          document.getElementById('inpCloudToken')?.focus();
        } finally {
          setTimeout(() => {
            btnSyncCloud.textContent = '☁️ 同步參數至雲端';
            btnSyncCloud.disabled = false;
          }, 2200);
        }
      });
    }

    // Reset Single Character Params
    const btnResetChar = document.getElementById('btnResetCharParams');
    if (btnResetChar) {
      btnResetChar.addEventListener('click', () => {
        StudioState.resetCombatParams(activeChar.id);
        renderGearStudio();
      });
    }
  }

  function renderGearStudio() {
    const container = document.getElementById('spriteSlots');
    if (!container) return;

    wireStaticStudioControls();

    // Update Summary Badge
    const summaryBadge = document.getElementById('studioSummaryBadge');
    if (summaryBadge) {
      const totalActions = StudioState.characters.reduce((s, c) => s + c.actions.length, 0);
      const customSheets = Object.values(SpriteBank.sheets).filter((v) => v && v.custom).length;
      const customParams = StudioState.characters.filter((c) => StudioState.isCombatParamsModified(c.id)).length;
      summaryBadge.textContent = `${StudioState.characters.length} 角色 · ${totalActions} 組動作 · 已自訂 ${customSheets + customParams} 項`;
    }

    // 0. Cloud Sync Bar + Expandable Upload Spec Drawer
    const cloudBar = document.getElementById('cloudSyncStudioBar');
    if (cloudBar) {
      cloudBar.classList.toggle('collapsed', !StudioState.specExpanded);
      cloudBar.innerHTML = `
        <div style="display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px;">
          <div style="display:flex;flex-wrap:wrap;align-items:center;gap:8px;">
            <strong style="color:#38bdf8;">☁️ 雲端直連覆寫</strong>
            <label style="display:inline-flex;align-items:center;gap:4px;">Repo
              <input id="inpCloudRepo" type="text" value="${CloudSyncManager.repo}" style="width:168px;padding:3px 6px;border-radius:5px;background:#0f172a;color:#f8fafc;border:1px solid #334155;font-size:11px;font-family:monospace;" />
            </label>
            <label style="display:inline-flex;align-items:center;gap:4px;">Token
              <input id="inpCloudToken" type="password" placeholder="貼上 GitHub Token (ghp_... 僅存本機)" value="${CloudSyncManager.token}" style="width:198px;padding:3px 6px;border-radius:5px;background:#0f172a;color:#f8fafc;border:1px solid #334155;font-size:11px;font-family:monospace;" />
            </label>
            <label style="display:inline-flex;align-items:center;gap:4px;cursor:pointer;" title="上傳任意尺寸 PNG 時自動偵測幾欄×幾列與有效總幀數（支援 10~60+ 幀）並自動去背與等比縮放！">
              <input id="chkSmartAutoGrid" type="checkbox" ${CloudSyncManager.smartAutoGrid ? 'checked' : ''} />
              <span style="color:#fde047;font-weight:700;">🤖 智能辨識格數・去背・防切割</span>
            </label>
            <label style="display:inline-flex;align-items:center;gap:4px;cursor:pointer;" title="勾選後，每次上傳 PNG 完會自動同步覆寫至 GitHub 雲端">
              <input id="chkCloudAuto" type="checkbox" ${CloudSyncManager.autoUpload ? 'checked' : ''} />
              <span>上傳自動覆寫雲端</span>
            </label>
          </div>
          <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
            <button type="button" id="btnToggleSpecInline" class="mini-btn">${StudioState.specExpanded ? '📐 收合規格 ▴' : '📐 20~30幀上傳規格 ▾'}</button>
            <button type="button" id="btnPushAllCustomCloud" class="mini-btn" style="border-color:#38bdf8;color:#38bdf8;">☁️ 同步所有修改至雲端</button>
            <span id="cloudSyncStatusMsg" style="font-size:11px;color:#94a3b8;">設定儲存於本機 IndexedDB，填 Token 可直接覆寫雲端</span>
          </div>
        </div>
        <div class="cloud-spec-drawer" style="font-size:11px;color:#cbd5e1;line-height:1.45;border-top:1px dashed rgba(148,163,184,0.25);padding-top:6px;">
          📐 <strong style="color:#f8fafc;">PNG 動畫上傳最佳規格（支援 10 ~ 60+ 幀，不限 10 幀！）：</strong>
          推薦排列 <code style="color:#38bdf8;">5×2 (10幀)</code>、<code style="color:#38bdf8;">5×4 (20幀)</code>、<code style="color:#38bdf8;">5×6 或 6×5 (30幀)</code>；單格標準 <code style="color:#fde047;">300×264 px</code>（上傳任意 2K/4K 大圖皆可，系統會<strong>自動偵測角色高度並等比縮放進 300×264</strong>，大爆炸特效絕不爆框切割！）。生圖建議：<strong>純色深藍黑背景 (#0d1220) 或透明 PNG、角色統一朝右、格間留少許空隙、勿壓文字</strong>。怪物雙攻擊表：前半幀＝近戰A、後半幀＝遠程/特技B。
        </div>
      `;

      const inpRepo = document.getElementById('inpCloudRepo');
      const inpTok = document.getElementById('inpCloudToken');
      const chkAutoGrid = document.getElementById('chkSmartAutoGrid');
      const chkAutoUp = document.getElementById('chkCloudAuto');
      const btnSpecIn = document.getElementById('btnToggleSpecInline');
      const btnPushAll = document.getElementById('btnPushAllCustomCloud');
      const statusMsg = document.getElementById('cloudSyncStatusMsg');

      if (inpRepo) inpRepo.addEventListener('change', () => { CloudSyncManager.repo = inpRepo.value.trim() || 'snell0804/SchoolFight-TV'; CloudSyncManager.saveConfig(); });
      if (inpTok) inpTok.addEventListener('change', () => { CloudSyncManager.token = inpTok.value.trim(); CloudSyncManager.saveConfig(); if (statusMsg) statusMsg.textContent = CloudSyncManager.token ? '✅ Token 已記住（本機儲存）' : '尚未填入 Token'; });
      if (chkAutoGrid) chkAutoGrid.addEventListener('change', () => { CloudSyncManager.smartAutoGrid = chkAutoGrid.checked; CloudSyncManager.saveConfig(); });
      if (chkAutoUp) chkAutoUp.addEventListener('change', () => { CloudSyncManager.autoUpload = chkAutoUp.checked; CloudSyncManager.saveConfig(); });
      if (btnSpecIn) btnSpecIn.addEventListener('click', () => { StudioState.specExpanded = !StudioState.specExpanded; renderGearStudio(); });
      if (btnPushAll) {
        btnPushAll.addEventListener('click', async () => {
          try {
            const customKeys = Object.entries(SpriteBank.sheets).filter(([, v]) => v && v.custom).map(([k]) => k);
            btnPushAll.disabled = true;
            for (let i = 0; i < customKeys.length; i++) {
              if (statusMsg) statusMsg.textContent = `⏳ 正在覆寫雲端 (${i + 1}/${customKeys.length}): ${customKeys[i]}...`;
              await CloudSyncManager.uploadSheetToCloud(customKeys[i], 'batch');
            }
            await CloudSyncManager.syncManifestOnly('all combat params & action settings');
            if (statusMsg) { statusMsg.style.color = '#4ade80'; statusMsg.textContent = `✅ 雲端覆寫完成！精靈表與怪物參數約 30~60 秒於 GitHub Pages 生效`; }
          } catch (err) {
            if (statusMsg) { statusMsg.style.color = '#f87171'; statusMsg.textContent = `❌ ${err.message}`; }
            document.getElementById('inpCloudToken')?.focus();
          } finally {
            btnPushAll.disabled = false;
          }
        });
      }
    }

    // 1. Render Left Searchable & Categorized Roster List
    renderRosterSidebar();

    // 2. Render Top Combat Parameters Inspector for Active Character
    const activeChar = StudioState.getActiveChar();
    renderCombatParamsInspector(activeChar);

    // 3. View Mode Toggle State & Tabular Action List
    const isListMode = StudioState.viewMode !== 'grid';
    container.classList.toggle('list-mode', isListMode);
    container.classList.toggle('grid-mode', !isListMode);
    document.getElementById('btnViewList')?.classList.toggle('active', isListMode);
    document.getElementById('btnViewGrid')?.classList.toggle('active', !isListMode);
    document.getElementById('actionTableHead')?.classList.toggle('hidden', !isListMode);

    const listHeading = document.getElementById('actionListHeading');
    if (listHeading) {
      listHeading.textContent = `🎞️ ${cleanCharTitle(activeChar.name)} — 連續幀動畫清單（共 ${activeChar.actions.length} 組）`;
    }

    container.innerHTML = '';
    studioPreviewItems.length = 0;

    const isEnemyChar = !!activeChar.builtinEnemy;
    const isBossChar = activeChar.role === 'boss';
    const enemyCfg = activeChar.enemyKey ? ENEMY_CONFIGS[activeChar.enemyKey] : null;
    const activeVariant = (enemyCfg && enemyCfg.colorVariants && enemyCfg.colorVariants[StudioState.previewVariants[activeChar.id] || 0]) || null;

    activeChar.actions.forEach((act, idx) => {
      const ownSheet = SpriteBank.sheets[act.sheetKey];
      const fallbackSheet = act.fallbackSheet ? SpriteBank.sheets[act.fallbackSheet] : null;
      const effectiveSheetKey = ownSheet ? act.sheetKey : (fallbackSheet ? act.fallbackSheet : null);
      const effectiveSheet = ownSheet || fallbackSheet;

      if (!StudioState.previewStates[act.id]) {
        StudioState.previewStates[act.id] = { playing: true, frame: 0 };
      }
      const pState = StudioState.previewStates[act.id];

      const card = document.createElement('div');
      card.className = `slot-card ${ownSheet ? (ownSheet.custom ? 'loaded custom-loaded' : 'loaded') : ''}`;
      card.id = `slot_card_${act.id}`;

      // Column 1: Action Index + Name + Trigger + Keybind
      const colAct = document.createElement('div');
      colAct.className = 'row-col-act';

      const head = document.createElement('div');
      head.className = 'slot-head';
      head.innerHTML = `<span class="act-idx-badge">#${String(idx + 1).padStart(2, '0')}</span><span>${act.label}</span>`;

      const sub = document.createElement('div');
      sub.className = 'slot-sub';
      sub.textContent = act.triggerDesc || '';

      const trigLine = document.createElement('div');
      trigLine.className = 'act-trigger-line';
      if (act.rebindable) {
        const isListening = StudioState.rebindingActionId === act.id;
        const keyBtn = document.createElement('button');
        keyBtn.className = `keybind-btn ${isListening ? 'listening' : ''}`;
        keyBtn.textContent = isListening ? '請按下新按鍵...' : `⌨ 按鍵：${formatKeyCode(act.key)}`;
        keyBtn.title = '點擊後按下鍵盤任意鍵即可修改此動作按鍵';
        keyBtn.addEventListener('click', () => {
          StudioState.rebindingActionId = isListening ? null : act.id;
          renderGearStudio();
        });
        trigLine.appendChild(keyBtn);
      } else {
        const tag = document.createElement('span');
        tag.style.cssText = 'font-size:10.5px;color:#7dd3fc;opacity:0.9;';
        const lightKey = formatKeyCode(StudioState.getAction('lightAttack')?.key);
        const heavyKey = formatKeyCode(StudioState.getAction('heavyAttack')?.key);
        const dashKey = formatKeyCode(StudioState.getAction('dash')?.key);
        const spKey = formatKeyCode(StudioState.getAction('special')?.key);
        tag.textContent = (act.id === 'dashLightAttack' || act.id === 'rp_dashLightAttack')
          ? `觸發：跑步 + ${lightKey}`
          : ((act.id === 'dashAttack' || act.id === 'rp_dashAttack')
            ? `觸發：跑步 + ${heavyKey}`
            : (act.id === 'rp_attack'
              ? `觸發：${heavyKey}（升龍拳）`
              : (act.id === 'rp_lightAttack'
                ? `觸發：${lightKey}（輕攻）`
                : (act.id === 'rp_dash'
                  ? `觸發：${dashKey}（閃身步）`
                  : (act.id === 'rp_special'
                    ? `觸發：${spKey}（必殺技）`
                    : (act.id === 'tornadoKick' || act.id === 'rp_tornadoKick'
                      ? `觸發：↑ + ${heavyKey}`
                      : (act.id === 'victory' || act.id === 'rp_victory'
                        ? '觸發：勝利結算'
                        : (act.id === 'run' || act.id === 'rp_run'
                          ? '觸發：連按 AA / DD'
                          : (act.id === 'walk' || act.id === 'rp_walk' ? '觸發：WASD / 方向鍵' : '觸發：AI / 狀態自動')))))))));
        trigLine.appendChild(tag);
      }
      colAct.appendChild(head);
      colAct.appendChild(sub);
      colAct.appendChild(trigLine);

      // Column 2: Live Checkerboard Preview + Frame Controls
      const colPrev = document.createElement('div');
      colPrev.className = 'row-col-prev';

      const prevWrap = document.createElement('div');
      prevWrap.className = 'slot-preview';
      const pCanvas = document.createElement('canvas');
      pCanvas.width = 300;
      pCanvas.height = 264;
      prevWrap.appendChild(pCanvas);

      const prevSide = document.createElement('div');
      prevSide.className = 'prev-side-ctrl';
      const frameBadge = document.createElement('span');
      frameBadge.className = 'frame-badge';
      frameBadge.textContent = effectiveSheet ? `F 1/${effectiveSheet.frameCount}` : '0 / 0';

      const stepGroup = document.createElement('div');
      stepGroup.style.cssText = 'display:flex;gap:3px;';

      const btnPlay = document.createElement('button');
      btnPlay.className = 'mini-btn';
      btnPlay.textContent = pState.playing ? '⏸' : '▶';
      btnPlay.title = '播放 / 暫停預覽';
      btnPlay.addEventListener('click', () => {
        pState.playing = !pState.playing;
        btnPlay.textContent = pState.playing ? '⏸' : '▶';
      });

      const btnPrev = document.createElement('button');
      btnPrev.className = 'mini-btn';
      btnPrev.textContent = '◀';
      btnPrev.title = '上一幀';
      btnPrev.addEventListener('click', () => {
        pState.playing = false;
        btnPlay.textContent = '▶';
        const fc = effectiveSheet ? effectiveSheet.frameCount : 10;
        pState.frame = (Math.floor(pState.frame) - 1 + fc) % fc;
      });

      const btnNext = document.createElement('button');
      btnNext.className = 'mini-btn';
      btnNext.textContent = '▶';
      btnNext.title = '下一幀';
      btnNext.addEventListener('click', () => {
        pState.playing = false;
        btnPlay.textContent = '▶';
        const fc = effectiveSheet ? effectiveSheet.frameCount : 10;
        pState.frame = (Math.floor(pState.frame) + 1) % fc;
      });

      stepGroup.appendChild(btnPlay);
      stepGroup.appendChild(btnPrev);
      stepGroup.appendChild(btnNext);
      prevSide.appendChild(frameBadge);
      prevSide.appendChild(stepGroup);

      colPrev.appendChild(prevWrap);
      colPrev.appendChild(prevSide);

      studioPreviewItems.push({
        act,
        sheetKey: effectiveSheetKey,
        canvas: pCanvas,
        badge: frameBadge,
        pState,
        variant: activeVariant,
      });

      // Column 3: Grid Spec (Cols × Rows + FrameCount)
      const colGrid = document.createElement('div');
      colGrid.className = 'row-col-grid';
      const gridWrapTop = document.createElement('div');
      gridWrapTop.className = 'grid-inputs';
      const inCols = document.createElement('input');
      inCols.type = 'number';
      inCols.min = '1';
      inCols.max = '32';
      inCols.value = String(ownSheet ? ownSheet.cols : (effectiveSheet ? effectiveSheet.cols : (act.cols || 5)));
      inCols.title = '欄數 (Cols)';
      const inRows = document.createElement('input');
      inRows.type = 'number';
      inRows.min = '1';
      inRows.max = '24';
      inRows.value = String(ownSheet ? ownSheet.rows : (effectiveSheet ? effectiveSheet.rows : (act.rows || 2)));
      inRows.title = '列數 (Rows)';

      const gridWrapBot = document.createElement('div');
      gridWrapBot.className = 'grid-inputs';
      const inFrames = document.createElement('input');
      inFrames.type = 'number';
      inFrames.min = '1';
      inFrames.max = '512';
      const curFc = ownSheet ? ownSheet.frameCount : (effectiveSheet ? effectiveSheet.frameCount : (act.frameCount || (act.cols || 5) * (act.rows || 2)));
      inFrames.value = String(curFc);
      inFrames.title = '有效總幀數（支援 10 ~ 60+ 幀連續動畫）';
      inFrames.style.width = '46px';

      gridWrapTop.appendChild(document.createTextNode('欄'));
      gridWrapTop.appendChild(inCols);
      gridWrapTop.appendChild(document.createTextNode('× 列'));
      gridWrapTop.appendChild(inRows);
      gridWrapBot.appendChild(document.createTextNode('總幀數'));
      gridWrapBot.appendChild(inFrames);
      gridWrapBot.appendChild(document.createTextNode('幀'));
      colGrid.appendChild(gridWrapTop);
      colGrid.appendChild(gridWrapBot);

      // Column 4: Playback Speed (FPS)
      const colFps = document.createElement('div');
      colFps.className = 'row-col-fps';
      const fpsLabel = document.createElement('span');
      fpsLabel.style.cssText = 'font-family:monospace;font-weight:700;color:#f8fafc;';
      fpsLabel.textContent = `${act.fps} FPS`;
      const fpsRange = document.createElement('input');
      fpsRange.type = 'range';
      fpsRange.min = '4';
      fpsRange.max = '60';
      fpsRange.step = '0.5';
      fpsRange.value = String(act.fps);
      fpsRange.addEventListener('input', () => {
        act.fps = parseFloat(fpsRange.value);
        fpsLabel.textContent = `${act.fps} FPS`;
        StudioState.save();
      });
      colFps.appendChild(fpsLabel);
      colFps.appendChild(fpsRange);

      // Column 5: Status Badge + Upload / Cloud / Export / Revert Buttons
      const colOps = document.createElement('div');
      colOps.className = 'row-col-ops';

      const statusClass = ownSheet ? 'ready' : (fallbackSheet ? 'fallback' : 'empty');
      const statusText = ownSheet
        ? `${ownSheet.custom ? '✨自訂 ' : '已載入 '}${ownSheet.cols}×${ownSheet.rows} (${ownSheet.frameCount}幀)`
        : (fallbackSheet ? '沿用備用表（可獨立上傳）' : '尚未上傳');
      const statusBadge = document.createElement('span');
      statusBadge.className = `slot-status ${statusClass}`;
      statusBadge.textContent = statusText;

      let userEditedGrid = false;
      const syncGridLive = async (autoMatchTotal = false) => {
        userEditedGrid = true;
        const cVal = Math.max(1, Math.min(32, parseInt(inCols.value, 10) || 5));
        const rVal = Math.max(1, Math.min(24, parseInt(inRows.value, 10) || 2));
        const maxF = cVal * rVal;
        const fVal = autoMatchTotal ? maxF : Math.max(1, Math.min(maxF, parseInt(inFrames.value, 10) || maxF));
        inCols.value = String(cVal);
        inRows.value = String(rVal);
        inFrames.value = String(fVal);
        act.cols = cVal;
        act.rows = rVal;
        act.frameCount = fVal;
        const sh = SpriteBank.sheets[act.sheetKey];
        if (sh && sh._rawImg) {
          // Re-slice from original uploaded PNG with the user's exact cols × rows!
          const rawImg = sh._rawImg;
          const procOpts = sh._procOpts || { isEnemy: isEnemyChar, isBoss: isBossChar };
          const reprocessed = SpriteBank.processUploadedSheet(rawImg, cVal, rVal, fVal, {
            isEnemy: procOpts.isEnemy,
            isBoss: procOpts.isBoss,
            autoDetect: false,
          });
          reprocessed._rawImg = rawImg;
          reprocessed._procOpts = procOpts;
          SpriteBank.sheets[act.sheetKey] = reprocessed;
          SpriteBank.tintedCache = {};
          statusBadge.textContent = `✨自訂 ${reprocessed.cols}×${reprocessed.rows} (${reprocessed.frameCount}幀)`;
          if (act.sheetKey === 'idle' || act.sheetKey === 'rp_idle') SpriteBank.buildPortrait();
          const cleanDataUrl = SpriteBank.exportSheetToDataUrl(reprocessed);
          CustomSpriteDB.putSheet(act.sheetKey, {
            dataUrl: cleanDataUrl,
            cols: reprocessed.cols,
            rows: reprocessed.rows,
            frameCount: reprocessed.frameCount,
            anchorX: reprocessed.anchorX,
            anchorY: reprocessed.anchorY,
          }).catch(() => {});
        } else if (sh && sh.img) {
          const oldCellW = sh.cellW || 300;
          const oldCellH = sh.cellH || 264;
          sh.cols = cVal;
          sh.rows = rVal;
          sh.cellW = sh.img.width / cVal;
          sh.cellH = sh.img.height / rVal;
          sh.anchorX = sh.cellW * ((sh.anchorX || oldCellW * 0.5) / oldCellW);
          sh.anchorY = sh.cellH * ((sh.anchorY || oldCellH * 0.9) / oldCellH);
          sh.frameCount = fVal;
          SpriteBank.tintedCache = {};
          statusBadge.textContent = `${sh.custom ? '✨自訂 ' : '已載入 '}${cVal}×${rVal} (${fVal}幀)`;
        }
        StudioState.save();
      };
      inCols.addEventListener('change', () => syncGridLive(true));
      inRows.addEventListener('change', () => syncGridLive(true));
      inFrames.addEventListener('change', () => syncGridLive(false));

      const opsBtns = document.createElement('div');
      opsBtns.className = 'ops-btn-group';

      const triggerDownload = (href, filename) => {
        const a = document.createElement('a');
        a.href = href;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
      };
      const safeBase = `${activeChar.id}_${act.id}`;

      const uploadLabel = document.createElement('label');
      uploadLabel.className = 'upload-label';
      uploadLabel.textContent = '📤 上傳PNG';
      uploadLabel.title = '上傳 PNG / WebP / JPG 精靈表（自動智能辨識 10~60+ 幀、去背、防切割縮放並永久保存本機）';
      const fileInput = document.createElement('input');
      fileInput.type = 'file';
      fileInput.accept = 'image/png,image/webp,image/jpeg,.json,application/json';
      fileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const isJson = file.name.toLowerCase().endsWith('.json') || file.type === 'application/json';
        const reader = new FileReader();
        if (isJson) {
          reader.onload = () => {
            try {
              const pkg = JSON.parse(String(reader.result || '{}'));
              if (!pkg.imageDataUrl) return;
              const img = new Image();
              img.onload = async () => {
                const cVal = Math.max(1, Math.min(32, parseInt(pkg.cols, 10) || 5));
                const rVal = Math.max(1, Math.min(24, parseInt(pkg.rows, 10) || 2));
                const fVal = Math.max(1, Math.min(cVal * rVal, parseInt(pkg.frameCount, 10) || (cVal * rVal)));
                const built = SpriteBank.createExactSheet(
                  img, cVal, rVal, fVal,
                  typeof pkg.anchorX === 'number' ? pkg.anchorX : (isEnemyChar ? 150 : 136),
                  typeof pkg.anchorY === 'number' ? pkg.anchorY : (isEnemyChar && !isBossChar ? 236 : 242)
                );
                SpriteBank.sheets[act.sheetKey] = built;
                SpriteBank.tintedCache = {};
                act.cols = cVal;
                act.rows = rVal;
                act.frameCount = fVal;
                if (typeof pkg.fps === 'number' && pkg.fps >= 4 && pkg.fps <= 60) act.fps = pkg.fps;
                if (act.sheetKey === 'idle' || act.sheetKey === 'rp_idle') SpriteBank.buildPortrait();
                StudioState.save();
                await CustomSpriteDB.putSheet(act.sheetKey, {
                  dataUrl: pkg.imageDataUrl,
                  cols: cVal,
                  rows: rVal,
                  frameCount: fVal,
                  anchorX: built.anchorX,
                  anchorY: built.anchorY,
                });
                renderGearStudio();
              };
              img.src = pkg.imageDataUrl;
            } catch (err) {
              console.warn('Invalid animation JSON file:', err);
            }
          };
          reader.readAsText(file);
        } else {
          reader.onload = () => {
            const cVal = Math.max(1, Math.min(32, parseInt(inCols.value, 10) || 5));
            const rVal = Math.max(1, Math.min(24, parseInt(inRows.value, 10) || 2));
            const maxF = cVal * rVal;
            const fVal = Math.max(1, Math.min(maxF, parseInt(inFrames.value, 10) || maxF));
            const img = new Image();
            img.onload = async () => {
              // If the user explicitly edited cols/rows before uploading, strictly honor their grid!
              const useAuto = CloudSyncManager.smartAutoGrid && !userEditedGrid;
              const procOpts = { isEnemy: isEnemyChar, isBoss: isBossChar };
              const processed = SpriteBank.processUploadedSheet(img, cVal, rVal, fVal, {
                ...procOpts,
                autoDetect: useAuto,
              });
              processed._rawImg = img;
              processed._procOpts = procOpts;
              SpriteBank.sheets[act.sheetKey] = processed;
              SpriteBank.tintedCache = {};
              act.cols = processed.cols;
              act.rows = processed.rows;
              act.frameCount = processed.frameCount;
              if (act.sheetKey === 'idle' || act.sheetKey === 'rp_idle') SpriteBank.buildPortrait();
              StudioState.save();

              const cleanDataUrl = SpriteBank.exportSheetToDataUrl(processed);
              await CustomSpriteDB.putSheet(act.sheetKey, {
                dataUrl: cleanDataUrl,
                cols: processed.cols,
                rows: processed.rows,
                frameCount: processed.frameCount,
                anchorX: processed.anchorX,
                anchorY: processed.anchorY,
              });

              let finalColor = '#fde047';
              let finalMsg = `✨ 智能處理完成：${processed.cols}×${processed.rows} 共 ${processed.frameCount} 幀（已等比防切割縮放並永久存於本機）`;

              if (CloudSyncManager.autoUpload && CloudSyncManager.token) {
                try {
                  const p = await CloudSyncManager.uploadSheetToCloud(act.sheetKey, act.label);
                  finalColor = '#4ade80';
                  finalMsg = `✅ 已自動覆寫雲端 ${p} (${processed.frameCount}幀)！`;
                } catch (err) {
                  finalColor = '#f87171';
                  finalMsg = `⚠ 本機已儲存，但雲端覆寫失敗：${err.message}`;
                }
              }
              renderGearStudio();
              const statusMsg = document.getElementById('cloudSyncStatusMsg');
              if (statusMsg) {
                statusMsg.style.color = finalColor;
                statusMsg.textContent = finalMsg;
              }
            };
            img.src = reader.result;
          };
          reader.readAsDataURL(file);
        }
      });
      uploadLabel.appendChild(fileInput);

      const btnCloudUp = document.createElement('button');
      btnCloudUp.className = 'mini-btn';
      btnCloudUp.style.borderColor = 'rgba(56,189,248,0.65)';
      btnCloudUp.style.color = '#38bdf8';
      btnCloudUp.textContent = '☁️ 雲端覆寫';
      btnCloudUp.title = '直接將此動作目前的精靈表與幀數設定覆寫上傳至 GitHub 雲端 (snell0804/SchoolFight-TV)';
      btnCloudUp.disabled = !effectiveSheet;
      btnCloudUp.addEventListener('click', async () => {
        const statusMsg = document.getElementById('cloudSyncStatusMsg');
        btnCloudUp.disabled = true;
        btnCloudUp.textContent = '⏳ 上傳中...';
        try {
          const targetKey = ownSheet ? act.sheetKey : effectiveSheetKey;
          const path = await CloudSyncManager.uploadSheetToCloud(targetKey, act.label);
          btnCloudUp.textContent = '✅ 已覆寫';
          if (statusMsg) {
            statusMsg.style.color = '#4ade80';
            statusMsg.textContent = `✅ 已成功覆寫雲端 ${path} (${effectiveSheet.frameCount}幀)！`;
          }
          setTimeout(() => { btnCloudUp.textContent = '☁️ 雲端覆寫'; btnCloudUp.disabled = false; }, 2400);
        } catch (err) {
          btnCloudUp.textContent = '❌ 失敗';
          if (statusMsg) {
            statusMsg.style.color = '#f87171';
            statusMsg.textContent = `❌ ${err.message}`;
          }
          const inpTok = document.getElementById('inpCloudToken');
          if (inpTok && !CloudSyncManager.token) inpTok.focus();
          setTimeout(() => { btnCloudUp.textContent = '☁️ 雲端覆寫'; btnCloudUp.disabled = false; }, 2400);
        }
      });

      const btnExpPng = document.createElement('button');
      btnExpPng.className = 'mini-btn';
      btnExpPng.textContent = '💾 PNG';
      btnExpPng.title = '匯出此動作的透明精靈表 PNG 檔';
      btnExpPng.disabled = !effectiveSheet;
      btnExpPng.addEventListener('click', () => {
        if (!effectiveSheet) return;
        const url = SpriteBank.exportSheetToDataUrl(effectiveSheet);
        if (url) triggerDownload(url, `${safeBase}_${effectiveSheet.cols}x${effectiveSheet.rows}_${effectiveSheet.frameCount}f.png`);
      });

      const btnExpJson = document.createElement('button');
      btnExpJson.className = 'mini-btn';
      btnExpJson.textContent = '📦 JSON';
      btnExpJson.title = '匯出完整動作檔（含精靈圖、欄列數、總幀數、FPS）';
      btnExpJson.disabled = !effectiveSheet;
      btnExpJson.addEventListener('click', () => {
        if (!effectiveSheet) return;
        const imgData = SpriteBank.exportSheetToDataUrl(effectiveSheet);
        const payload = {
          format: 'schoolfight_anim_v1',
          characterId: activeChar.id,
          actionId: act.id,
          label: act.label,
          cols: effectiveSheet.cols,
          rows: effectiveSheet.rows,
          frameCount: effectiveSheet.frameCount,
          fps: act.fps,
          anchorX: effectiveSheet.anchorX,
          anchorY: effectiveSheet.anchorY,
          imageDataUrl: imgData,
        };
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
        const blobUrl = URL.createObjectURL(blob);
        triggerDownload(blobUrl, `${safeBase}.anim.json`);
        setTimeout(() => URL.revokeObjectURL(blobUrl), 2500);
      });

      opsBtns.appendChild(uploadLabel);
      opsBtns.appendChild(btnCloudUp);
      opsBtns.appendChild(btnExpPng);
      opsBtns.appendChild(btnExpJson);

      if (ownSheet && ownSheet.custom && !act.custom) {
        const revBtn = document.createElement('button');
        revBtn.className = 'mini-btn';
        revBtn.textContent = '↺';
        revBtn.title = '移除本機自訂圖並還原此動作內建預設精靈表';
        revBtn.addEventListener('click', async () => {
          const restored = await SpriteBank.reloadBuiltinSheet(act.sheetKey);
          act.cols = restored ? restored.cols : 5;
          act.rows = restored ? restored.rows : 2;
          act.frameCount = restored ? restored.frameCount : 10;
          StudioState.save();
          renderGearStudio();
        });
        opsBtns.appendChild(revBtn);
      }

      if (act.custom) {
        const delBtn = document.createElement('button');
        delBtn.className = 'mini-btn';
        delBtn.textContent = '🗑';
        delBtn.title = '刪除此自訂動作';
        delBtn.addEventListener('click', () => {
          activeChar.actions = activeChar.actions.filter((a) => a.id !== act.id);
          CustomSpriteDB.deleteSheet(act.sheetKey).catch(() => {});
          StudioState.save();
          renderGearStudio();
        });
        opsBtns.appendChild(delBtn);
      }

      colOps.appendChild(statusBadge);
      colOps.appendChild(opsBtns);

      card.appendChild(colAct);
      card.appendChild(colPrev);
      card.appendChild(colGrid);
      card.appendChild(colFps);
      card.appendChild(colOps);
      container.appendChild(card);
    });
  }

  function animateGearStudioPreviews(dt) {
    const studio = document.getElementById('gearStudio');
    if (!studio || !studio.classList.contains('open')) return;

    // 1. Live Scale & Super-Armor Comparison Stage in Combat Params Inspector
    if (studioScalePreviewState.canvas && studioScalePreviewState.charId) {
      const sCanvas = studioScalePreviewState.canvas;
      const sctx = sCanvas.getContext('2d');
      sctx.clearRect(0, 0, sCanvas.width, sCanvas.height);

      const ch = StudioState.getActiveChar();
      const cp = StudioState.getCombatParams(ch.id);
      const groundY = 152;
      const ref1xTopY = groundY - Math.round(167 * 0.44);

      // Ground floor line + 1.0x Hero Reference Height dashed line
      sctx.strokeStyle = 'rgba(148, 163, 184, 0.35)';
      sctx.lineWidth = 1.5;
      sctx.beginPath();
      sctx.moveTo(10, groundY + 1);
      sctx.lineTo(sCanvas.width - 10, groundY + 1);
      sctx.stroke();

      sctx.save();
      sctx.setLineDash([4, 4]);
      sctx.strokeStyle = 'rgba(56, 189, 248, 0.55)';
      sctx.beginPath();
      sctx.moveTo(8, ref1xTopY);
      sctx.lineTo(sCanvas.width - 8, ref1xTopY);
      sctx.stroke();
      sctx.fillStyle = 'rgba(125, 211, 252, 0.85)';
      sctx.font = '700 13px monospace';
      sctx.fillText('1.0x', 10, ref1xTopY - 4);
      sctx.restore();

      const sk = studioScalePreviewState.sheetKey;
      const sh = sk ? SpriteBank.sheets[sk] : null;
      if (sh) {
        studioScalePreviewState.frame = (studioScalePreviewState.frame + dt * 10) % sh.frameCount;
        const fIdx = Math.floor(studioScalePreviewState.frame) % sh.frameCount;
        const visScale = 0.44 * Math.min(2.05, cp.scale);

        if (cp.superArmor !== 'none') {
          sctx.save();
          sctx.strokeStyle = cp.superArmor === 'hits' ? 'rgba(56, 189, 248, 0.9)' : 'rgba(250, 204, 21, 0.9)';
          sctx.lineWidth = 3;
          sctx.beginPath();
          sctx.ellipse(108, groundY, 34 * Math.min(1.6, cp.scale), 9 * Math.min(1.5, cp.scale), 0, 0, Math.PI * 2);
          sctx.stroke();
          sctx.restore();
        }

        const enemyCfg = ch.enemyKey ? ENEMY_CONFIGS[ch.enemyKey] : null;
        const activeVar = (enemyCfg && enemyCfg.colorVariants && enemyCfg.colorVariants[StudioState.previewVariants[ch.id] || 0]) || null;
        SpriteBank.drawFrame(sctx, sk, fIdx, 108, groundY, 1, visScale, false, activeVar);
      }
    }

    // 2. Action List Row Previews
    for (const item of studioPreviewItems) {
      const pctx = item.canvas.getContext('2d');
      pctx.clearRect(0, 0, 300, 264);
      const sheet = item.sheetKey ? SpriteBank.sheets[item.sheetKey] : null;
      if (sheet) {
        if (item.pState.playing) {
          item.pState.frame = (item.pState.frame + dt * item.act.fps) % sheet.frameCount;
        }
        const fIdx = Math.floor(item.pState.frame) % sheet.frameCount;
        const fitScale = (sheet.cellW !== 300 || sheet.cellH !== 264)
          ? Math.min(300 / Math.max(1, sheet.cellW), 264 / Math.max(1, sheet.cellH))
          : 1.0;
        const drawX = (300 - sheet.cellW * fitScale) / 2 + sheet.anchorX * fitScale;
        const drawY = (264 - sheet.cellH * fitScale) / 2 + sheet.anchorY * fitScale;
        SpriteBank.drawFrame(pctx, item.sheetKey, fIdx, drawX, drawY, 1, fitScale, false, item.variant || null);
        item.badge.textContent = `F ${fIdx + 1}/${sheet.frameCount}`;
      } else {
        pctx.fillStyle = '#64748b';
        pctx.font = '600 18px "Noto Sans TC", sans-serif';
        pctx.textAlign = 'center';
        pctx.fillText('尚未上傳精靈表', 150, 136);
        item.badge.textContent = '0 / 0';
      }
    }
  }

  // ==========================================================================
  // 8.5. GAMEPAD CONTROLLER MANAGER & LIVE MAPPING SETTINGS PAGE
  // ==========================================================================
  const GP_STORAGE_KEY = 'kuromi_beatemup_gamepad_v1';

  const GP_ACTION_DEFS = [
    { id: 'lightAttack', label: '輕攻擊 (Light)', desc: '快速連拳 / 跑步中發動浪子踢球' },
    { id: 'heavyAttack', label: '重攻擊 (Heavy)', desc: '強力重擊 / 跑步衝刺重擊 / 按住↑+重攻 龍捲旋風腳' },
    { id: 'special', label: '必殺技 (Special)', desc: '能量砲十連發 / 赤焰百拳連擊' },
    { id: 'jump', label: '跳躍 / 確認 (Jump)', desc: '跳躍 / 選角畫面確認開戰' },
    { id: 'dash', label: '瞬間衝刺・閃身步 (Dash)', desc: '喊出「閃身步!!」瞬間突進' },
    { id: 'runHold', label: '按住跑步 (Hold Run)', desc: '按住搭配搖桿或十字鍵直接奔跑' },
    { id: 'pause', label: '暫停 / 選單 (Pause)', desc: '暫停與繼續戰鬥' },
    { id: 'moveUp', label: '方向：上 (D-Pad ↑)', desc: '除左搖桿外，十字鍵向上移動' },
    { id: 'moveDown', label: '方向：下 (D-Pad ↓)', desc: '除左搖桿外，十字鍵向下移動' },
    { id: 'moveLeft', label: '方向：左 (D-Pad ←)', desc: '連按兩次向左亦可跑步' },
    { id: 'moveRight', label: '方向：右 (D-Pad →)', desc: '連按兩次向右亦可跑步' },
  ];

  const GP_PRESETS = {
    standard: {
      lightAttack: 2,  // X / □
      heavyAttack: 3,  // Y / △
      special: 1,      // B / ○
      jump: 0,         // A / ✕
      dash: 5,         // RB / R1
      runHold: 4,      // LB / L1
      pause: 9,        // Start / Options
      moveUp: 12,
      moveDown: 13,
      moveLeft: 14,
      moveRight: 15,
    },
    arcade: {
      lightAttack: 2,  // X / □ (LP)
      heavyAttack: 3,  // Y / △ (HP)
      special: 5,      // RB / R1 (SP)
      jump: 0,         // A / ✕ (Jump)
      dash: 1,         // B / ○ (Dash)
      runHold: 7,      // RT / R2 (Run)
      pause: 9,
      moveUp: 12,
      moveDown: 13,
      moveLeft: 14,
      moveRight: 15,
    },
  };

  function formatGamepadButton(btnIndex) {
    if (btnIndex === null || btnIndex === undefined) return '未綁定';
    const names = {
      0: 'A / ✕ (B0)',
      1: 'B / ○ (B1)',
      2: 'X / □ (B2)',
      3: 'Y / △ (B3)',
      4: 'LB / L1 (B4)',
      5: 'RB / R1 (B5)',
      6: 'LT / L2 (B6)',
      7: 'RT / R2 (B7)',
      8: 'Select (B8)',
      9: 'Start (B9)',
      10: 'L3 (B10)',
      11: 'R3 (B11)',
      12: 'D-Pad ↑ (B12)',
      13: 'D-Pad ↓ (B13)',
      14: 'D-Pad ← (B14)',
      15: 'D-Pad → (B15)',
      16: 'Home (B16)',
    };
    return names[btnIndex] || `Button ${btnIndex}`;
  }

  const GamepadManager = {
    connected: false,
    padId: '',
    padIndex: null,
    bindings: { ...GP_PRESETS.standard },
    deadzone: 0.22,
    rumbleEnabled: true,
    rebindingId: null,

    prevButtons: [],
    actionJustPressed: {},
    moveX: 0,
    moveZ: 0,
    runHeld: false,
    prevHorizDir: 0,
    prevVertDir: 0,
    lastTapDir: 0,
    lastTapTime: 0,
    toastText: '',
    toastColor: '#22c55e',
    toastTimer: 0,

    load() {
      try {
        const raw = localStorage.getItem(GP_STORAGE_KEY);
        if (!raw) return;
        const parsed = JSON.parse(raw);
        if (parsed.bindings) this.bindings = { ...GP_PRESETS.standard, ...parsed.bindings };
        if (typeof parsed.deadzone === 'number') this.deadzone = Math.max(0.1, Math.min(0.5, parsed.deadzone));
        if (typeof parsed.rumbleEnabled === 'boolean') this.rumbleEnabled = parsed.rumbleEnabled;
      } catch (_) {}
    },

    save() {
      try {
        localStorage.setItem(GP_STORAGE_KEY, JSON.stringify({
          bindings: this.bindings,
          deadzone: this.deadzone,
          rumbleEnabled: this.rumbleEnabled,
        }));
      } catch (_) {}
    },

    showToast(text, color = '#22c55e', dur = 2.8) {
      this.toastText = text;
      this.toastColor = color;
      this.toastTimer = dur;
    },

    drawToast(ctx) {
      if (this.toastTimer <= 0 || !this.toastText) return;
      const alpha = Math.min(1, this.toastTimer * 1.8);
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.font = '800 14px "Noto Sans TC", sans-serif';
      const tw = Math.min(CANVAS_W - 60, ctx.measureText(this.toastText).width + 44);
      const bx = (CANVAS_W - tw) / 2;
      const by = CANVAS_H - 54;
      ctx.fillStyle = 'rgba(12, 9, 24, 0.9)';
      ctx.strokeStyle = this.toastColor;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.roundRect(bx, by, tw, 36, 18);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(this.toastText, CANVAS_W / 2, by + 19);
      ctx.restore();
    },

    applyPreset(name) {
      const preset = GP_PRESETS[name] || GP_PRESETS.standard;
      this.bindings = { ...preset };
      this.rebindingId = null;
      this.save();
      renderGamepadSettings();
    },

    resetDefaults() {
      this.bindings = { ...GP_PRESETS.standard };
      this.deadzone = 0.22;
      this.rumbleEnabled = true;
      this.rebindingId = null;
      this.save();
      renderGamepadSettings();
    },

    isActionJustPressed(actionId) {
      return !!this.actionJustPressed[actionId];
    },

    getPadsList() {
      const getter = navigator.getGamepads || navigator.webkitGetGamepads;
      if (!getter) return [];
      try {
        return getter.call(navigator) || [];
      } catch (_) {
        return [];
      }
    },

    getActivePad() {
      const pads = this.getPadsList();
      if (!pads || pads.length === 0) return null;

      // Auto-switch to whichever Bluetooth controller is actively sending input (multi-pad TV support)
      for (let i = 0; i < pads.length; i++) {
        const p = pads[i];
        if (!p || !p.connected) continue;
        const anyBtn = p.buttons && p.buttons.some((b) => b && (b.pressed || b.value > 0.5));
        const anyAxis = p.axes && p.axes.length >= 2 && (Math.abs(p.axes[0]) > 0.55 || Math.abs(p.axes[1]) > 0.55);
        if (anyBtn || anyAxis) {
          this.padIndex = i;
          return p;
        }
      }

      if (this.padIndex !== null && pads[this.padIndex] && pads[this.padIndex].connected) {
        return pads[this.padIndex];
      }
      for (let i = 0; i < pads.length; i++) {
        if (pads[i] && pads[i].connected) {
          this.padIndex = i;
          return pads[i];
        }
      }
      return null;
    },

    // Support Bluetooth/Android TV controllers that report D-Pad on axes[6]/axes[7] or HID HAT axes[9]
    readBluetoothDpadAxes(gp) {
      let dx = 0;
      let dy = 0;
      const axes = gp.axes || [];
      if (gp.mapping !== 'standard') {
        if (axes.length >= 8) {
          if (axes[6] < -0.5) dx = -1;
          else if (axes[6] > 0.5) dx = 1;
          if (axes[7] < -0.5) dy = -1;
          else if (axes[7] > 0.5) dy = 1;
        }
        // Standard HID HAT switch single axis (Android TV / 8BitDo / Switch Pro raw Bluetooth mode)
        if (dx === 0 && dy === 0 && axes.length >= 10) {
          const hat = axes[9];
          if (Math.abs(hat) <= 1.05 && Math.abs(hat) > 0.01) {
            if (hat <= -0.85) { dy = -1; }
            else if (hat <= -0.57) { dx = 1; dy = -1; }
            else if (hat <= -0.28) { dx = 1; }
            else if (hat <= 0.0) { dx = 1; dy = 1; }
            else if (hat <= 0.28) { dy = 1; }
            else if (hat <= 0.57) { dx = -1; dy = 1; }
            else if (hat <= 0.85) { dx = -1; }
            else { dx = -1; dy = -1; }
          }
        }
      }
      return { dx, dy };
    },

    rumble(strong = 0.4, weak = 0.2, duration = 120) {
      if (!this.rumbleEnabled) return;
      const gp = this.getActivePad();
      if (!gp) return;
      try {
        if (gp.vibrationActuator && typeof gp.vibrationActuator.playEffect === 'function') {
          gp.vibrationActuator.playEffect('dual-rumble', {
            startDelay: 0,
            duration,
            weakMagnitude: weak,
            strongMagnitude: strong,
          });
        } else if (gp.hapticActuators && gp.hapticActuators[0] && typeof gp.hapticActuators[0].pulse === 'function') {
          gp.hapticActuators[0].pulse(strong, duration);
        }
      } catch (_) {}
    },

    poll(dt = 0.016) {
      if (this.toastTimer > 0) this.toastTimer = Math.max(0, this.toastTimer - dt);

      this.actionJustPressed = {};
      this.moveX = 0;
      this.moveZ = 0;
      this.runHeld = false;

      const gp = this.getActivePad();
      const wasConnected = this.connected;
      this.connected = !!gp;

      if (!gp) {
        this.padId = '';
        this.prevButtons = [];
        if (wasConnected) {
          this.updateStatusUI(null);
          this.showToast('⚠ 藍牙手把已斷線', '#f59e0b', 2.4);
        }
        return;
      }

      if (!wasConnected || this.padId !== gp.id) {
        this.padId = gp.id;
        this.updateStatusUI(gp);
        const shortName = gp.id.length > 34 ? gp.id.slice(0, 34) + '…' : gp.id;
        this.showToast(`🎮 藍牙手把已連線：${shortName}`, '#22c55e', 3.0);
      }

      const btns = gp.buttons || [];
      const isDown = (idx) => idx !== null && idx !== undefined && btns[idx] && (btns[idx].pressed || btns[idx].value > 0.45);
      const isEdge = (idx) => isDown(idx) && !this.prevButtons[idx];

      // 1. Rebinding Listen Mode!
      if (this.rebindingId) {
        for (let i = 0; i < btns.length; i++) {
          if (isEdge(i)) {
            this.bindings[this.rebindingId] = i;
            this.rebindingId = null;
            this.save();
            sfx.init();
            sfx.playPickup('coin');
            this.rumble(0.25, 0.35, 90);
            renderGamepadSettings();
            break;
          }
        }
        this.updateMonitorUI(gp, isDown);
        this.prevButtons = btns.map((_, i) => isDown(i));
        return;
      }

      // 2. Read Analog Left Stick + D-Pad Buttons + Non-standard Bluetooth D-Pad Axes
      const axX = gp.axes && gp.axes.length > 0 ? gp.axes[0] : 0;
      const axY = gp.axes && gp.axes.length > 1 ? gp.axes[1] : 0;
      const dz = this.deadzone;
      let mx = Math.abs(axX) >= dz ? (axX > 0 ? 1 : -1) : 0;
      let mz = Math.abs(axY) >= dz ? (axY > 0 ? 1 : -1) : 0;

      const btDpad = this.readBluetoothDpadAxes(gp);
      if (btDpad.dx !== 0) mx = btDpad.dx;
      if (btDpad.dy !== 0) mz = btDpad.dy;

      if (isDown(this.bindings.moveLeft)) mx = -1;
      if (isDown(this.bindings.moveRight)) mx = 1;
      if (isDown(this.bindings.moveUp)) mz = -1;
      if (isDown(this.bindings.moveDown)) mz = 1;

      this.moveX = mx;
      this.moveZ = mz;
      this.runHeld = isDown(this.bindings.runHold);

      // Directional edge detection (Character/Stage Select & Double-Tap Run!)
      const horizEdgeLeft = mx === -1 && this.prevHorizDir !== -1;
      const horizEdgeRight = mx === 1 && this.prevHorizDir !== 1;
      const vertEdgeUp = mz === -1 && this.prevVertDir !== -1;
      const vertEdgeDown = mz === 1 && this.prevVertDir !== 1;
      this.prevHorizDir = mx;
      this.prevVertDir = mz;

      // Double-tap left/right to trigger Run
      if (horizEdgeLeft || horizEdgeRight) {
        const dir = horizEdgeRight ? 1 : -1;
        const now = performance.now();
        if (this.lastTapDir === dir && now - this.lastTapTime < 300) {
          doubleTapRunTrigger = dir;
          this.lastTapDir = 0;
        } else {
          this.lastTapDir = dir;
          this.lastTapTime = now;
        }
      }

      // 3. Action Edge Triggers (Up + Heavy Attack triggers 龍捲旋風腳 automatically via moveZ < -0.35!)
      const actionIds = ['lightAttack', 'heavyAttack', 'special', 'jump', 'dash', 'pause'];
      for (const id of actionIds) {
        if (isEdge(this.bindings[id])) {
          this.actionJustPressed[id] = true;
          sfx.init();
        }
      }

      // 4. Screen Navigation (Title Character/Stage Select / StageClear / Pause / GameOver)
      if (game.state === 'title') {
        if (horizEdgeLeft) {
          const idx = HERO_ROSTER.findIndex((h) => h.id === game.selectedHeroId);
          game.selectedHeroId = HERO_ROSTER[(idx - 1 + HERO_ROSTER.length) % HERO_ROSTER.length].id;
          sfx.init();
          sfx.playPickup('coin');
        } else if (horizEdgeRight) {
          const idx = HERO_ROSTER.findIndex((h) => h.id === game.selectedHeroId);
          game.selectedHeroId = HERO_ROSTER[(idx + 1) % HERO_ROSTER.length].id;
          sfx.init();
          sfx.playPickup('coin');
        }
        if (vertEdgeUp) {
          game.selectedStageIndex = (game.selectedStageIndex + STAGES.length - 1) % STAGES.length;
          game.stageIndex = game.selectedStageIndex;
          sfx.init();
          sfx.playPickup('coin');
        } else if (vertEdgeDown) {
          game.selectedStageIndex = (game.selectedStageIndex + 1) % STAGES.length;
          game.stageIndex = game.selectedStageIndex;
          sfx.init();
          sfx.playPickup('coin');
        }
        if (this.actionJustPressed.jump || this.actionJustPressed.pause || this.actionJustPressed.lightAttack) {
          startNewGame(game.selectedStageIndex);
        }
      } else if (game.state === 'stageclear') {
        if (this.actionJustPressed.jump || this.actionJustPressed.pause || this.actionJustPressed.lightAttack) {
          advanceToNextStage();
        }
      } else if (game.state === 'gameover' || game.state === 'victory') {
        if (this.actionJustPressed.jump || this.actionJustPressed.pause || this.actionJustPressed.lightAttack) {
          startNewGame(game.state === 'victory' ? 0 : game.stageIndex);
        }
      } else if (this.actionJustPressed.pause) {
        if (game.state === 'playing') game.state = 'paused';
        else if (game.state === 'paused') game.state = 'playing';
      } else if (game.state === 'paused' && isEdge(8)) {
        // Select button while paused returns to Title / Hero & School Select on TV!
        sfx.bossMode = false;
        game.state = 'title';
        game.beamEffect = null;
        updateStatusBar();
      }

      this.updateMonitorUI(gp, isDown, btDpad);
      this.prevButtons = btns.map((_, i) => isDown(i));
    },

    updateStatusUI(gp) {
      const bar = document.getElementById('gpStatusBar');
      const txt = document.getElementById('gpStatusText');
      const btn = document.getElementById('btnGamepad');
      if (gp) {
        if (bar) bar.classList.add('connected');
        if (btn) {
          btn.classList.add('connected');
          btn.textContent = '🎮 藍牙手把已連線';
        }
        if (txt) {
          const shortId = gp.id.length > 52 ? gp.id.slice(0, 52) + '…' : gp.id;
          const mapTag = gp.mapping === 'standard' ? 'Standard' : 'BT-Auto';
          txt.textContent = `已連線：${shortId}（${gp.buttons.length} 按鍵 · ${gp.axes.length} 軸 · ${mapTag}）`;
        }
      } else {
        if (bar) bar.classList.remove('connected');
        if (btn) {
          btn.classList.remove('connected');
          btn.textContent = '🎮 手把設定';
        }
        if (txt) {
          txt.textContent = '尚未偵測到手把 — 請插入 USB 或連接藍牙手把，並按下手把任意按鍵喚醒瀏覽器偵測';
        }
      }
    },

    updateMonitorUI(gp, isDown, btDpad = { dx: 0, dy: 0 }) {
      const panel = document.getElementById('gamepadPanel');
      if (!panel || !panel.classList.contains('open')) return;

      // Update live Left Stick dot
      const axX = gp.axes && gp.axes.length > 0 ? gp.axes[0] : 0;
      const axY = gp.axes && gp.axes.length > 1 ? gp.axes[1] : 0;
      const dot = document.getElementById('gpStickDot');
      const readout = document.getElementById('gpStickReadout');
      if (dot) {
        const px = 50 + Math.max(-1, Math.min(1, axX)) * 38;
        const py = 50 + Math.max(-1, Math.min(1, axY)) * 38;
        dot.style.left = `${px}%`;
        dot.style.top = `${py}%`;
      }
      if (readout) {
        readout.textContent = `L-Stick (${axX.toFixed(2)}, ${axY.toFixed(2)})`;
      }

      // Light up visual controller chips (including non-standard Bluetooth D-Pad axes!)
      panel.querySelectorAll('[data-gp-btn]').forEach((el) => {
        const idx = parseInt(el.getAttribute('data-gp-btn'), 10);
        let pressed = isDown(idx);
        if (idx === 12 && btDpad.dy < 0) pressed = true;
        if (idx === 13 && btDpad.dy > 0) pressed = true;
        if (idx === 14 && btDpad.dx < 0) pressed = true;
        if (idx === 15 && btDpad.dx > 0) pressed = true;
        el.classList.toggle('pressed', pressed);
      });

      // Highlight active bound action cards
      panel.querySelectorAll('[data-gp-action-card]').forEach((card) => {
        const id = card.getAttribute('data-gp-action-card');
        card.classList.toggle('active-press', isDown(this.bindings[id]));
      });
    },
  };

  function renderGamepadSettings() {
    const grid = document.getElementById('gpBindingsGrid');
    const dzRange = document.getElementById('gpDeadzoneRange');
    const dzVal = document.getElementById('gpDeadzoneVal');
    const dzRing = document.getElementById('gpDeadzoneRing');
    const rumbleChk = document.getElementById('gpRumbleCheck');

    const dzPct = Math.round(GamepadManager.deadzone * 100);
    if (dzRange) dzRange.value = String(dzPct);
    if (dzVal) dzVal.textContent = `${dzPct}%`;
    if (dzRing) {
      dzRing.style.width = `${dzPct}%`;
      dzRing.style.height = `${dzPct}%`;
    }
    if (rumbleChk) rumbleChk.checked = GamepadManager.rumbleEnabled;

    GamepadManager.updateStatusUI(GamepadManager.getActivePad());
    if (!grid) return;
    grid.innerHTML = '';

    for (const def of GP_ACTION_DEFS) {
      const card = document.createElement('div');
      card.className = 'gp-bind-card';
      card.setAttribute('data-gp-action-card', def.id);

      const meta = document.createElement('div');
      meta.className = 'gp-bind-meta';
      meta.innerHTML = `<span class="gp-bind-title">${def.label}</span><span class="gp-bind-desc">${def.desc}</span>`;

      const btnWrap = document.createElement('div');
      btnWrap.style.display = 'flex';
      btnWrap.style.alignItems = 'center';
      btnWrap.style.gap = '6px';

      const studioSlotMap = {
        lightAttack: ['lightAttack', 'rp_lightAttack'],
        heavyAttack: ['heavyAttack', 'rp_attack'],
        special: ['special', 'rp_special'],
        dash: ['dash', 'rp_dash'],
        tornado: ['tornadoKick', 'rp_tornadoKick'],
        jump: ['jump', 'rp_idle'],
      };
      if (studioSlotMap[def.id]) {
        const pngShortcut = document.createElement('button');
        pngShortcut.className = 'mini-btn';
        pngShortcut.style.borderColor = 'rgba(56,189,248,0.6)';
        pngShortcut.style.color = '#38bdf8';
        pngShortcut.textContent = '📤 PNG/雲端';
        pngShortcut.title = '前往此招式的 PNG 連續動畫上傳與雲端覆寫槽位';
        pngShortcut.addEventListener('click', () => {
          const isRp = game.selectedHeroId === 'redpanda';
          StudioState.activeCharId = isRp ? 'redpanda' : 'kuromi';
          const targetSlot = studioSlotMap[def.id][isRp ? 1 : 0];
          toggleGearStudio(true);
          setTimeout(() => {
            const el = document.getElementById(`slot_card_${targetSlot}`);
            if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }, 80);
        });
        btnWrap.appendChild(pngShortcut);
      }

      const isListening = GamepadManager.rebindingId === def.id;
      const btn = document.createElement('button');
      btn.className = `gp-bind-btn ${isListening ? 'listening' : ''}`;
      btn.textContent = isListening
        ? '請按下手把按鍵...'
        : formatGamepadButton(GamepadManager.bindings[def.id]);
      btn.title = '點擊後按下手把任意按鍵即可改綁（按 ESC 取消）';
      btn.addEventListener('click', () => {
        GamepadManager.rebindingId = isListening ? null : def.id;
        renderGamepadSettings();
      });
      btnWrap.appendChild(btn);

      card.appendChild(meta);
      card.appendChild(btnWrap);
      grid.appendChild(card);
    }
  }

  window.addEventListener('gamepadconnected', (e) => {
    GamepadManager.padIndex = e.gamepad.index;
    GamepadManager.connected = true;
    GamepadManager.padId = e.gamepad.id;
    GamepadManager.updateStatusUI(e.gamepad);
    const shortName = e.gamepad.id.length > 34 ? e.gamepad.id.slice(0, 34) + '…' : e.gamepad.id;
    GamepadManager.showToast(`🎮 藍牙手把已連線：${shortName}`, '#22c55e', 3.0);
  });
  window.addEventListener('gamepaddisconnected', () => {
    GamepadManager.padIndex = null;
    const nextPad = GamepadManager.getActivePad();
    GamepadManager.connected = !!nextPad;
    GamepadManager.updateStatusUI(nextPad);
    if (!nextPad) GamepadManager.showToast('⚠ 藍牙手把已斷線', '#f59e0b', 2.4);
  });

  // ==========================================================================
  // 9. TOOLBAR CONTROLS & MAIN RAF LOOP
  // ==========================================================================
  const btnGear = document.getElementById('btnGear');
  const btnCloseGear = document.getElementById('btnCloseGear');
  const btnExportAllTop = document.getElementById('btnExportAllTop');
  const btnExportAllZip = document.getElementById('btnExportAllZip');
  const btnGamepad = document.getElementById('btnGamepad');
  const btnCloseGamepad = document.getElementById('btnCloseGamepad');
  const btnGpPresetStd = document.getElementById('btnGpPresetStd');
  const btnGpPresetArc = document.getElementById('btnGpPresetArc');
  const btnGpReset = document.getElementById('btnGpReset');
  const gpDeadzoneRange = document.getElementById('gpDeadzoneRange');
  const gpRumbleCheck = document.getElementById('gpRumbleCheck');
  const btnGpTestRumble = document.getElementById('btnGpTestRumble');
  const btnResetConfig = document.getElementById('btnResetConfig');
  const btnAddAction = document.getElementById('btnAddAction');
  const btnBgm = document.getElementById('btnBgm');
  const btnSfx = document.getElementById('btnSfx');
  const btnTouch = document.getElementById('btnTouch');
  const btnRestart = document.getElementById('btnRestart');

  function toggleGamepadPanel(forceState) {
    const panel = document.getElementById('gamepadPanel');
    if (!panel) return;
    const nextOpen = typeof forceState === 'boolean' ? forceState : !panel.classList.contains('open');
    if (nextOpen) toggleGearStudio(false);
    panel.classList.toggle('open', nextOpen);
    if (btnGamepad) btnGamepad.classList.toggle('active', nextOpen);
    if (!nextOpen) GamepadManager.rebindingId = null;
    if (nextOpen) renderGamepadSettings();
  }

  function toggleGearStudio(forceState) {
    const studio = document.getElementById('gearStudio');
    if (!studio) return;
    const nextOpen = typeof forceState === 'boolean' ? forceState : !studio.classList.contains('open');
    if (nextOpen) toggleGamepadPanel(false);
    studio.classList.toggle('open', nextOpen);
    if (btnGear) btnGear.classList.toggle('active', nextOpen);
    if (!nextOpen) StudioState.rebindingActionId = null;
    if (nextOpen) renderGearStudio();
  }

  if (btnGear) btnGear.addEventListener('click', () => toggleGearStudio());
  if (btnCloseGear) btnCloseGear.addEventListener('click', () => toggleGearStudio(false));
  if (btnExportAllTop) btnExportAllTop.addEventListener('click', () => exportAllCharactersAnimationsZip(btnExportAllTop));
  if (btnExportAllZip) btnExportAllZip.addEventListener('click', () => exportAllCharactersAnimationsZip(btnExportAllZip));
  if (btnGamepad) btnGamepad.addEventListener('click', () => toggleGamepadPanel());
  if (btnCloseGamepad) btnCloseGamepad.addEventListener('click', () => toggleGamepadPanel(false));
  if (btnGpPresetStd) btnGpPresetStd.addEventListener('click', () => GamepadManager.applyPreset('standard'));
  if (btnGpPresetArc) btnGpPresetArc.addEventListener('click', () => GamepadManager.applyPreset('arcade'));
  if (btnGpReset) btnGpReset.addEventListener('click', () => GamepadManager.resetDefaults());
  if (gpDeadzoneRange) {
    gpDeadzoneRange.addEventListener('input', () => {
      const pct = parseInt(gpDeadzoneRange.value, 10) || 22;
      GamepadManager.deadzone = pct / 100;
      const dzVal = document.getElementById('gpDeadzoneVal');
      const dzRing = document.getElementById('gpDeadzoneRing');
      if (dzVal) dzVal.textContent = `${pct}%`;
      if (dzRing) { dzRing.style.width = `${pct}%`; dzRing.style.height = `${pct}%`; }
      GamepadManager.save();
    });
  }
  if (gpRumbleCheck) {
    gpRumbleCheck.addEventListener('change', () => {
      GamepadManager.rumbleEnabled = gpRumbleCheck.checked;
      GamepadManager.save();
    });
  }
  if (btnGpTestRumble) {
    btnGpTestRumble.addEventListener('click', () => {
      GamepadManager.rumble(0.7, 0.5, 240);
    });
  }

  if (btnResetConfig) {
    btnResetConfig.addEventListener('click', () => {
      StudioState.resetDefaults();
      renderControlsLegend();
      renderGearStudio();
    });
  }

  if (btnAddAction) {
    btnAddAction.addEventListener('click', () => {
      const nameInput = document.getElementById('newActName');
      const colsInput = document.getElementById('newActCols');
      const rowsInput = document.getElementById('newActRows');
      const fpsInput = document.getElementById('newActFps');
      const name = (nameInput && nameInput.value.trim()) || `自訂動作 ${StudioState.getActiveChar().actions.length + 1}`;
      const cols = Math.max(1, parseInt(colsInput?.value, 10) || 5);
      const rows = Math.max(1, parseInt(rowsInput?.value, 10) || 2);
      const fps = Math.max(4, Math.min(30, parseFloat(fpsInput?.value) || 14));
      const id = `custom_${Date.now()}`;
      StudioState.getActiveChar().actions.push({
        id,
        label: name,
        triggerDesc: '自訂動作（綁定按鍵後可在遊戲中直接施放）',
        sheetKey: id,
        fallbackSheet: null,
        fps,
        cols,
        rows,
        key: null,
        altKeys: [],
        rebindable: true,
        custom: true,
      });
      if (nameInput) nameInput.value = '';
      StudioState.save();
      renderGearStudio();
    });
  }

  if (btnBgm) {
    btnBgm.addEventListener('click', () => {
      sfx.init();
      sfx.bgmEnabled = !sfx.bgmEnabled;
      btnBgm.classList.toggle('active', sfx.bgmEnabled);
      btnBgm.textContent = sfx.bgmEnabled ? '🎵 BGM：開' : '🎵 BGM：關';
    });
  }
  if (btnSfx) {
    btnSfx.addEventListener('click', () => {
      sfx.init();
      sfx.sfxEnabled = !sfx.sfxEnabled;
      btnSfx.classList.toggle('active', sfx.sfxEnabled);
      btnSfx.textContent = sfx.sfxEnabled ? '🔊 音效：開' : '🔇 音效：關';
    });
  }
  if (btnTouch) {
    btnTouch.addEventListener('click', () => {
      const tp = document.getElementById('touchPad');
      tp.classList.toggle('visible');
      btnTouch.classList.toggle('active', tp.classList.contains('visible'));
    });
  }
  const btnSelectHero = document.getElementById('btnSelectHero');
  if (btnSelectHero) {
    btnSelectHero.addEventListener('click', () => {
      sfx.bossMode = false;
      game.state = 'title';
      game.beamEffect = null;
      updateStatusBar();
      canvas.focus();
    });
  }

  // 🥋 Training Dojo Toolbar Button & Interactive Control Panel
  const btnTraining = document.getElementById('btnTraining');
  if (btnTraining) {
    btnTraining.addEventListener('click', () => {
      const trIdx = STAGES.findIndex((s) => s.isTraining);
      if (trIdx >= 0) {
        startNewGame(trIdx);
        canvas.focus();
      }
    });
  }
  (function initTrainingBar() {
    const bar = document.getElementById('trainingBar');
    const sel = document.getElementById('trMonsterSelect');
    const btnSpawn = document.getElementById('btnTrSpawn');
    const btnAi = document.getElementById('btnTrAiMode');
    const chkInf = document.getElementById('chkTrInfHp');
    const btnClear = document.getElementById('btnTrClear');
    if (!bar || !sel) return;

    // Populate monster dropdown with all playable/testable enemy types
    const monsterOrder = [
      ['zebra', '🦓 斑斑（旋風飛踢斑馬）'],
      ['koala', '🐨 無尾熊（尤加利葉撲擊怪）'],
      ['capybara', '🦫 佛系水豚君（橘子頭槌坦克）'],
      ['sheep', '🐑 綿羊怪（雲球衝鋒）'],
      ['pig', '🐗 暴怒豬豬怪（雙角衝撞）'],
      ['fat_tiger', '🐯 胖虎（飛撲重壓虎貓怪）'],
      ['rabbit', '🐰 兔兔怪'],
      ['ghost', '👻 幽靈怪'],
      ['kangaroo', '🥊 拳擊袋鼠'],
      ['joey_kangaroo', '🦘 育兒袋鼠怪'],
      ['zebra_rush', '🦓 暴衝斑馬怪'],
      ['cactus', '🌵 針刺仙人掌'],
      ['wizard_ghost', '🧙‍♂️ 星空巫師幽靈'],
      ['penguin_king', '🐧 企鵝王'],
      ['penguin_ice', '❄️ 冰雪企鵝'],
      ['slime', '💧 藍色水滴史萊姆'],
      ['mushroom', '🍄 蘑菇怪'],
      ['puffer', '🐡 河豚怪'],
      ['star', '⭐ 宇宙海星'],
      ['donghua_boss', '🥋 冬花武聖大宗師 (BOSS)'],
      ['boss', '⭐ 宇宙海星大霸王 (BOSS)'],
    ];
    for (const [key, label] of monsterOrder) {
      if (!ENEMY_CONFIGS[key]) continue;
      const opt = document.createElement('option');
      opt.value = key;
      opt.textContent = label;
      sel.appendChild(opt);
    }

    // Instant hero switch without leaving Training Dojo
    bar.querySelectorAll('[data-tr-hero]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const hid = btn.getAttribute('data-tr-hero');
        if (!hid || !HERO_ROSTER.some((h) => h.id === hid)) return;
        game.selectedHeroId = hid;
        const oldX = game.player ? game.player.x : 220;
        const oldZ = game.player ? game.player.z : 418;
        const oldFace = game.player ? game.player.facing : 1;
        game.player = new Player();
        game.player.x = oldX;
        game.player.z = oldZ;
        game.player.facing = oldFace;
        game.player.sp = 100;
        syncTrainingBarUI();
        renderControlsLegend();
        canvas.focus();
      });
    });

    // Spawn 1 selected monster right in front of the player
    if (btnSpawn) {
      btnSpawn.addEventListener('click', () => {
        if (!getCurrentStage().isTraining || !game.player) return;
        const mType = sel.value || 'zebra';
        const p = game.player;
        const rawX = p.x + p.facing * 260;
        const spawnX = Math.max(game.camX + 80, Math.min(game.camX + CANVAS_W - 80, rawX));
        const spawnZ = Math.max(Z_MIN + 10, Math.min(Z_MAX - 10, p.z));
        const e = new Enemy(mType, spawnX, spawnZ);
        e.facing = -p.facing;
        e.hasEnteredScreen = true;
        game.enemies.push(e);
        spawnParticles(spawnX, spawnZ - 60, '#22d3ee', 12, 220, 6);
        updateStatusBar();
        canvas.focus();
      });
    }

    // Toggle Dummy (stand still) vs Free AI (walk & attack)
    if (btnAi) {
      btnAi.addEventListener('click', () => {
        game.trainingDummyMode = !game.trainingDummyMode;
        btnAi.textContent = game.trainingDummyMode ? '🪵 木樁（不還手）' : '⚔️ 自由行動（會打人）';
        btnAi.classList.toggle('active', game.trainingDummyMode);
        if (!game.trainingDummyMode) {
          game.enemies.forEach((e) => { e._trainingPreviewMove = false; });
        }
        canvas.focus();
      });
    }

    // Toggle Infinite Enemy HP
    if (chkInf) {
      chkInf.addEventListener('change', () => {
        game.trainingInfiniteHp = !!chkInf.checked;
        canvas.focus();
      });
    }

    // Force-preview a specific monster animation on all active training enemies (auto-spawns 1 if empty!)
    bar.querySelectorAll('[data-tr-anim]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (!getCurrentStage().isTraining || !game.player) return;
        const anim = btn.getAttribute('data-tr-anim');
        let targets = game.enemies.filter((e) => !e.dead);
        if (targets.length === 0 && btnSpawn) {
          btnSpawn.click();
          targets = game.enemies.filter((e) => !e.dead);
        }
        for (const e of targets) {
          e._trainingPreviewMove = (anim === 'move');
          if (anim === 'move') {
            e.state = 'approach';
            e.stateTime = 0;
            e.frame = 0;
          } else if (anim === 'attack') {
            e.state = 'attack';
            e.attackStyle = 'A';
            e.stateTime = 0;
            e.frame = 0;
            e.didHit = false;
            e.projFired = false;
          } else if (anim === 'hurt') {
            e.takeHit(1, -e.facing, false, 70, { noScore: true });
          } else if (anim === 'ko') {
            e.hp = 1;
            e.takeHit(9999, -e.facing, true, 260, { forceKill: true });
          }
        }
        canvas.focus();
      });
    });

    // Clear all spawned test monsters
    if (btnClear) {
      btnClear.addEventListener('click', () => {
        game.enemies = [];
        game.projectiles = [];
        game.pickups = [];
        updateStatusBar();
        canvas.focus();
      });
    }
  })();

  const btnFullscreen = document.getElementById('btnFullscreen');
  if (btnFullscreen) {
    btnFullscreen.addEventListener('click', () => {
      const targetEl = canvas.parentElement || canvas;
      const fsEl = document.fullscreenElement || document.webkitFullscreenElement;
      if (!fsEl) {
        const req = targetEl.requestFullscreen || targetEl.webkitRequestFullscreen;
        if (req) req.call(targetEl).catch(() => {});
      } else {
        const exit = document.exitFullscreen || document.webkitExitFullscreen;
        if (exit) exit.call(document).catch(() => {});
      }
      canvas.focus();
    });
  }
  if (btnRestart) {
    btnRestart.addEventListener('click', () => {
      startNewGame();
      canvas.focus();
    });
  }

  let lastTs = performance.now();
  function loop(ts) {
    const dt = Math.min(0.05, (ts - lastTs) / 1000);
    lastTs = ts;

    GamepadManager.poll(dt);
    update(dt);
    render();
    animateGearStudioPreviews(dt);

    // Clear single-frame edge triggers
    for (const k in justPressed) justPressed[k] = false;

    requestAnimationFrame(loop);
  }

  // Boot!
  GamepadManager.load();
  SpriteBank.loadAll().then(() => {
    renderGamepadSettings();
    game.state = 'title';
    requestAnimationFrame(loop);
  });
})();
