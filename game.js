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
  const STORAGE_KEY = 'schoolfight_studio_v10';

  const HERO_ROSTER = [
    {
      id: 'kuromi',
      name: '呆呆伶',
      hudName: '呆呆伶',
      badge: '😈 海星魔杖使',
      subtitle: '徒手三連拳 · ↓↑龍捲旋風腳 · 能量砲十連發',
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
      heavyShout: '魔杖重擊!!',
      heavySub: 'WAND CRUSH!!',
      dashLightShout: '浪子踢球!!',
      dashLightSub: 'ROGUE SHOOT!!',
      dashHeavyShout: '星杖衝刺斬!!',
      dashHeavySub: 'STAR SLASH!!',
      tornadoShout: '龍捲旋風腳!!',
      tornadoSub: 'TORNADO HURRICANE KICK!!',
      sparkColor: '#e879f9',
      heavySparkColor: '#facc15',
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
      subtitle: '五連閃電拳 · ↓↑烈焰龍捲旋風腳 · 百拳連擊',
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
      heavyShout: '烈焰猛撞!!',
      heavySub: 'FLAME IMPACT!!',
      dashLightShout: '閃電踢球!!',
      dashLightSub: 'THUNDER SHOOT!!',
      dashHeavyShout: '赤焰衝刺撞擊!!',
      dashHeavySub: 'BLAZING TACKLE!!',
      tornadoShout: '烈焰龍捲旋風腳!!',
      tornadoSub: 'BLAZING TORNADO KICK!!',
      sparkColor: '#facc15',
      heavySparkColor: '#fb923c',
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
        attack: 'rp_dashAttack',
        dashLightAttack: 'rp_lightAttack',
        hurt: 'rp_idle',
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
    { key: 'attack', file: 'assets/attack_sheet.webp', cols: 5, rows: 2, anchorX: 136, anchorY: 242 },
    { key: 'dashLightAttack', file: 'assets/dashLightAttack_sheet.webp', cols: 5, rows: 2, anchorX: 136, anchorY: 242 },
    { key: 'dashAttack', file: 'assets/dashAttack_sheet.webp', cols: 5, rows: 2, anchorX: 136, anchorY: 242 },
    { key: 'tornadoKick', file: 'assets/tornadoKick_sheet.webp', cols: 5, rows: 2, anchorX: 136, anchorY: 242 },
    { key: 'special', file: 'assets/special_sheet.webp', cols: 5, rows: 2, anchorX: 136, anchorY: 242 },
    { key: 'hurt', file: 'assets/hurt_sheet.webp', cols: 5, rows: 2, anchorX: 136, anchorY: 242 },
    { key: 'victory', file: 'assets/victory_sheet.webp', cols: 5, rows: 2, anchorX: 136, anchorY: 242 },
    // Hero 2: 超級帆 (10-Frame Hand-Drawn HD Sprite Sheets)
    { key: 'rp_idle', file: 'assets/rp_idle_sheet.webp', cols: 5, rows: 2, anchorX: 136, anchorY: 242 },
    { key: 'rp_walk', file: 'assets/rp_walk_sheet.webp', cols: 5, rows: 2, anchorX: 136, anchorY: 242 },
    { key: 'rp_run', file: 'assets/rp_run_sheet.webp', cols: 5, rows: 2, anchorX: 136, anchorY: 242 },
    { key: 'rp_dash', file: 'assets/rp_dash_sheet.webp', cols: 5, rows: 2, anchorX: 136, anchorY: 242 },
    { key: 'rp_lightAttack', file: 'assets/rp_lightAttack_sheet.webp', cols: 5, rows: 2, anchorX: 136, anchorY: 242 },
    { key: 'rp_dashAttack', file: 'assets/rp_dashAttack_sheet.webp', cols: 5, rows: 2, anchorX: 136, anchorY: 242 },
    { key: 'rp_tornadoKick', file: 'assets/rp_tornadoKick_sheet.webp', cols: 5, rows: 2, anchorX: 136, anchorY: 242 },
    { key: 'rp_special', file: 'assets/rp_special_sheet.webp', cols: 5, rows: 2, anchorX: 136, anchorY: 242 },
    { key: 'rp_victory', file: 'assets/rp_victory_sheet.webp', cols: 5, rows: 2, anchorX: 136, anchorY: 242 },
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
    { key: 'enemy_sheep_move', file: 'assets/enemy_sheep_move_sheet.webp', cols: 5, rows: 2, anchorX: 150, anchorY: 236 },
    { key: 'enemy_sheep_attack', file: 'assets/enemy_sheep_attack_sheet.webp', cols: 5, rows: 2, anchorX: 150, anchorY: 236 },
    { key: 'enemy_sheep_hurt', file: 'assets/enemy_sheep_hurt_sheet.webp', cols: 5, rows: 2, anchorX: 150, anchorY: 236 },
    { key: 'enemy_sheep_ko', file: 'assets/enemy_sheep_ko_sheet.webp', cols: 5, rows: 2, anchorX: 150, anchorY: 236 },
    // Classic Monsters: Full 10-Frame Hand-Drawn HD Sprite Sheets (Pig, Slime, Mushroom, Pufferfish)
    { key: 'enemy_pig_move', file: 'assets/enemy_pig_move_sheet.webp', cols: 5, rows: 2, anchorX: 150, anchorY: 236 },
    { key: 'enemy_pig_attack', file: 'assets/enemy_pig_attack_sheet.webp', cols: 5, rows: 2, anchorX: 150, anchorY: 236 },
    { key: 'enemy_pig_ko', file: 'assets/enemy_pig_ko_sheet.webp', cols: 5, rows: 2, anchorX: 150, anchorY: 236 },
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
      { id: 'heavyAttack', label: '重攻擊・魔杖重擊 (Heavy)', triggerDesc: '強力魔杖重砸與擊飛＋美漫打擊框', sheetKey: 'attack', fallbackSheet: null, fps: 14, cols: 5, rows: 2, key: 'Numpad5', altKeys: ['KeyU', 'KeyC'], rebindable: true },
      { id: 'dashLightAttack', label: '衝刺輕攻擊・浪子踢球 (Dash Light)', triggerDesc: '跑步中 按 輕攻擊 發動！踢出能量足球', sheetKey: 'dashLightAttack', fallbackSheet: 'lightAttack', fps: 17, cols: 5, rows: 2, key: null, altKeys: [], rebindable: false },
      { id: 'dashAttack', label: '衝刺重攻擊・星杖衝刺斬 (Dash Heavy)', triggerDesc: '跑步中 按 重攻擊 發動！', sheetKey: 'dashAttack', fallbackSheet: 'attack', fps: 18, cols: 5, rows: 2, key: null, altKeys: [], rebindable: false },
      { id: 'tornadoKick', label: '特殊招式・龍捲旋風腳 (Tornado Kick)', triggerDesc: '快速先按 ↓ 再按 ↑（S→W）發動！多段旋風擊飛浮空可空中追打', sheetKey: 'tornadoKick', fallbackSheet: 'dashAttack', fps: 15, cols: 5, rows: 2, key: null, altKeys: [], rebindable: false },
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
      { id: 'rp_dashAttack', label: '重攻／衝刺撞擊 (Heavy & Dash)', triggerDesc: '赤焰高速衝刺撞擊＋爆裂火花（共用重攻鍵）', sheetKey: 'rp_dashAttack', fallbackSheet: null, fps: 18, cols: 5, rows: 2, key: null, altKeys: [], rebindable: false },
      { id: 'rp_tornadoKick', label: '特殊招式・烈焰龍捲旋風腳 (Tornado Kick)', triggerDesc: '快速先按 ↓ 再按 ↑（S→W）發動！烈焰旋風打浮空可空中追打', sheetKey: 'rp_tornadoKick', fallbackSheet: 'rp_dashAttack', fps: 15, cols: 5, rows: 2, key: null, altKeys: [], rebindable: false },
      { id: 'rp_special', label: '必殺技・赤焰百拳連擊 (Special)', triggerDesc: '霸體狂暴 10 連擊烈焰百烈拳（共用必殺鍵）', sheetKey: 'rp_special', fallbackSheet: null, fps: 14, cols: 5, rows: 2, key: null, altKeys: [], rebindable: false },
      { id: 'rp_hurt', label: '受傷／受擊 (Hurt)', triggerDesc: '可上傳獨立 10 幀受傷精靈表', sheetKey: 'rp_hurt', fallbackSheet: 'rp_idle', fps: 14, cols: 5, rows: 2, key: null, altKeys: [], rebindable: false },
      { id: 'rp_victory', label: '戰鬥勝利動作 (Victory)', triggerDesc: '過關結算專屬 10 幀金星慶祝勝利動畫', sheetKey: 'rp_victory', fallbackSheet: 'rp_idle', fps: 10, cols: 5, rows: 2, key: null, altKeys: [], rebindable: false },
    ];
  }

  function createEnemyCharProfile(id, name, prefix, atkADesc, atkBDesc, hasHurt = false) {
    const actions = [
      { id: `${prefix}_move`, label: '移動動畫 (Move)', triggerDesc: '10 幀移動巡邏循環', sheetKey: `${prefix}_move`, fallbackSheet: null, fps: 12, cols: 5, rows: 2, key: null, altKeys: [], rebindable: false },
      { id: `${prefix}_attack`, label: atkBDesc ? '雙模式攻擊 (Attack A+B)' : '攻擊動畫 (Attack)', triggerDesc: atkBDesc ? `1-5幀：${atkADesc} ｜ 6-10幀：${atkBDesc}` : atkADesc, sheetKey: `${prefix}_attack`, fallbackSheet: null, fps: 14, cols: 5, rows: 2, key: null, altKeys: [], rebindable: false },
    ];
    if (hasHurt) {
      actions.push({ id: `${prefix}_hurt`, label: '受傷動畫 (Hurt)', triggerDesc: '10 幀受擊硬直、踉蹌與回復動作', sheetKey: `${prefix}_hurt`, fallbackSheet: `${prefix}_ko`, fps: 14, cols: 5, rows: 2, key: null, altKeys: [], rebindable: false });
    }
    actions.push({ id: `${prefix}_ko`, label: hasHurt ? '被打敗動畫 (KO)' : '受擊與被打倒 (Hurt / KO)', triggerDesc: '10 幀受擊飛退 → 翻滾墜地 → 暈眩倒地', sheetKey: `${prefix}_ko`, fallbackSheet: null, fps: 12, cols: 5, rows: 2, key: null, altKeys: [], rebindable: false });
    return {
      id,
      name,
      builtinEnemy: true,
      actions,
    };
  }

  function createDefaultCharacters() {
    return [
      { id: 'kuromi', name: '😈 呆呆伶（主角 1）', actions: createDefaultHeroActions() },
      { id: 'redpanda', name: '🦊 超級帆（主角 2）', actions: createDefaultRedPandaActions() },
      createEnemyCharProfile('enemy_pengking', '👑 王者企鵝（海洋敵人）', 'enemy_pengking', '10 幀王者滑冰飛撲猛撞（含蓄力金光與急煞）', null, true),
      createEnemyCharProfile('enemy_pengice', '❄️ 冰雪企鵝（海洋敵人）', 'enemy_pengice', '10 幀寒冰滑衝＋冰錐爆發震波', null, true),
      createEnemyCharProfile('enemy_rabbit', '🐰 兔兔怪（5色共用模組）', 'enemy_rabbit', '10 幀極速跳躍撲咬突進（支援雪白/粉櫻/奶茶/芋紫/薄荷 5 亮色自動變色）', null, true),
      createEnemyCharProfile('enemy_ghost', '👻 幽靈怪（5色共用模組）', 'enemy_ghost', '10 幀飄浮鬼火彈發射（支援蒼白/冰藍/紫焰/螢光綠/櫻粉 5 亮色變色）', null, true),
      createEnemyCharProfile('enemy_sheep', '🐑 綿羊怪（5色共用模組）', 'enemy_sheep', '10 幀暴躁綿羊彎角衝刺猛撞（支援雲白/粉莓/黃金/天藍/薄荷 5 亮色變色）', null, true),
      createEnemyCharProfile('enemy_pig', '🐗 暴怒豬豬怪（敵人）', 'enemy_pig', '10 幀近身衝刺攻擊：蹬蹄蓄力 → 躍起狂奔 → 極速猛撞 → 急煞', null),
      {
        id: 'enemy_slime',
        name: '💧 藍色水滴史萊姆（敵人）',
        builtinEnemy: true,
        actions: [
          { id: 'enemy_slime_idle', label: '夢幻待機 (Idle)', triggerDesc: '10 幀打盹水泡待機循環', sheetKey: 'enemy_slime_idle', fallbackSheet: null, fps: 8, cols: 5, rows: 2, key: null, altKeys: [], rebindable: false },
          { id: 'enemy_slime_move', label: '跳躍奔跑 (Move)', triggerDesc: '10 幀彈跳水花奔跑循環', sheetKey: 'enemy_slime_move', fallbackSheet: null, fps: 13, cols: 5, rows: 2, key: null, altKeys: [], rebindable: false },
          { id: 'enemy_slime_angry', label: '憤怒反應／蓄力 (Angry)', triggerDesc: '10 幀驚嚇「！」→ 冒煙生氣起手預告', sheetKey: 'enemy_slime_angry', fallbackSheet: null, fps: 14, cols: 5, rows: 2, key: null, altKeys: [], rebindable: false },
          { id: 'enemy_slime_attack', label: '果凍衝刺撞擊 (Attack)', triggerDesc: '10 幀高速水花衝刺 → 爆擊撞擊 → 煞車', sheetKey: 'enemy_slime_attack', fallbackSheet: null, fps: 16, cols: 5, rows: 2, key: null, altKeys: [], rebindable: false },
          { id: 'enemy_slime_ko', label: '受擊與融化倒地 (Hurt / KO)', triggerDesc: '10 幀受擊翻滾 → 墜地濺水 → 暈眩融化（倒地分裂）', sheetKey: 'enemy_slime_ko', fallbackSheet: null, fps: 12, cols: 5, rows: 2, key: null, altKeys: [], rebindable: false },
        ],
      },
      createEnemyCharProfile('enemy_mushroom', '🍄 蘑菇怪（敵人）', 'enemy_mushroom', '10 幀完整動作：蓄力金光 → 飛躍頭頂 → 重砸爆發孢子彈', null),
      createEnemyCharProfile('enemy_puffer', '🐡 河豚怪（敵人）', 'enemy_puffer', '10 幀完整動作：吸氣膨脹霸體 → 尖刺水花衝刺 → 閃電撞擊', null),
      createEnemyCharProfile('enemy_star', '⭐ 宇宙海星（敵人／BOSS）', 'enemy_star', '高速迴旋衝撞', '寶石念力星彈'),
    ];
  }

  const StudioState = {
    activeCharId: 'kuromi',
    characters: createDefaultCharacters(),
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

    save() {
      try {
        const data = {
          heroOverrides: this.getHero().actions.map((a) => ({
            id: a.id,
            label: a.label,
            fps: a.fps,
            key: a.key,
            cols: a.cols,
            rows: a.rows,
            custom: !!a.custom,
            sheetKey: a.sheetKey,
            triggerDesc: a.triggerDesc,
          })),
          extraChars: this.characters.filter((c) => c.id !== 'kuromi' && !c.builtinEnemy).map((c) => ({
            id: c.id,
            name: c.name,
            actions: c.actions.map((a) => ({ ...a })),
          })),
        };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      } catch (_) {}
    },

    load() {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return;
        const data = JSON.parse(raw);
        if (Array.isArray(data.heroOverrides)) {
          const hero = this.getHero();
          for (const ov of data.heroOverrides) {
            const existing = hero.actions.find((a) => a.id === ov.id);
            if (existing) {
              if (typeof ov.fps === 'number') existing.fps = ov.fps;
              if (existing.rebindable && ov.key) existing.key = ov.key;
              if (ov.cols) existing.cols = ov.cols;
              if (ov.rows) existing.rows = ov.rows;
            } else if (ov.custom) {
              hero.actions.push({
                id: ov.id,
                label: ov.label,
                triggerDesc: ov.triggerDesc || '自訂動作',
                sheetKey: ov.sheetKey || ov.id,
                fallbackSheet: null,
                fps: ov.fps || 14,
                cols: ov.cols || 5,
                rows: ov.rows || 2,
                key: ov.key || null,
                altKeys: [],
                rebindable: true,
                custom: true,
              });
            }
          }
        }
        if (Array.isArray(data.extraChars)) {
          for (const ec of data.extraChars) {
            if (!this.characters.some((c) => c.id === ec.id)) {
              this.characters.push(ec);
            }
          }
        }
      } catch (_) {}
    },

    resetDefaults() {
      this.characters = createDefaultCharacters();
      this.activeCharId = 'kuromi';
      this.rebindingActionId = null;
      try { localStorage.removeItem(STORAGE_KEY); } catch (_) {}
    },
  };

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

    async loadAll() {
      StudioState.load();
      const embedded = window.EMBEDDED_SPRITES || {};
      const promises = DEFAULT_SHEETS_DEF.map(async (def) => {
        const src = embedded[def.key] || def.file;
        if (!src) return;
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
      });
      // Load stitched anime-stylized Haixing Elementary real street panorama
      const bgDef = [
        { key: 'starfish', embedKey: 'bg_starfish_street', file: 'assets/bg_starfish_street.webp' },
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
      this.portraitCanvas = this.portraits.kuromi;
    },

    /**
     * Browser-side smart valley-split + dark-background removal + 300x264 zero-clipping aligner
     * for any sprite sheets uploaded live in the Gear Settings Studio!
     */
    processUploadedSheet(img, cols = 5, rows = 2, frameCount = null) {
      const sw = img.width;
      const sh = img.height;
      const rowH = Math.floor(sh / rows);
      const outCellW = 300;
      const outCellH = 264;
      const targetCx = 136;
      const targetFootY = 242;

      const srcCanvas = document.createElement('canvas');
      srcCanvas.width = sw;
      srcCanvas.height = sh;
      const sctx = srcCanvas.getContext('2d');
      sctx.drawImage(img, 0, 0);
      const fullData = sctx.getImageData(0, 0, sw, sh).data;

      const bgR = fullData[0], bgG = fullData[1], bgB = fullData[2], bgA = fullData[3];
      const alreadyTransparent = bgA < 20;

      const outCanvas = document.createElement('canvas');
      outCanvas.width = outCellW * cols;
      outCanvas.height = outCellH * rows;
      const octx = outCanvas.getContext('2d');

      for (let r = 0; r < rows; r++) {
        const y0 = r * rowH;
        const y1 = Math.min(sh, (r + 1) * rowH);

        // Smart valley split along X so wide effects never clip!
        const colCounts = new Int32Array(sw);
        for (let x = 0; x < sw; x++) {
          let cnt = 0;
          for (let y = y0; y < y1; y++) {
            const idx = (y * sw + x) * 4;
            if (alreadyTransparent) {
              if (fullData[idx + 3] > 20) cnt++;
            } else {
              const dr = fullData[idx] - bgR;
              const dg = fullData[idx + 1] - bgG;
              const db = fullData[idx + 2] - bgB;
              if (dr * dr + dg * dg + db * db > 18 * 18) cnt++;
            }
          }
          colCounts[x] = cnt;
        }

        const splits = [0];
        for (let k = 1; k < cols; k++) {
          const nom = Math.round((k * sw) / cols);
          let bestX = nom;
          let bestVal = 1e12;
          const lo = Math.max(splits[splits.length - 1] + 40, nom - 58);
          const hi = Math.min(sw - 40, nom + 58);
          for (let sx = lo; sx <= hi; sx++) {
            const score = colCounts[sx] * 100 + Math.abs(sx - nom) * 0.12;
            if (score < bestVal) {
              bestVal = score;
              bestX = sx;
            }
          }
          splits.push(bestX);
        }
        splits.push(sw);

        for (let c = 0; c < cols; c++) {
          const x0 = splits[c];
          const cw = Math.max(1, splits[c + 1] - x0);
          const ch = Math.max(1, y1 - y0);

          const tmp = document.createElement('canvas');
          tmp.width = cw;
          tmp.height = ch;
          const tctx = tmp.getContext('2d');
          tctx.drawImage(img, x0, y0, cw, ch, 0, 0, cw, ch);
          const id = tctx.getImageData(0, 0, cw, ch);
          const d = id.data;

          if (!alreadyTransparent) {
            const visited = new Uint8Array(cw * ch);
            const isBg = new Uint8Array(cw * ch);
            const queue = new Int32Array(cw * ch);
            let head = 0, tail = 0;
            const dist = (i) => Math.hypot(d[i] - bgR, d[i + 1] - bgG, d[i + 2] - bgB);
            const enqueue = (x, y) => {
              const p = y * cw + x;
              if (visited[p]) return;
              const idx = p * 4;
              const pureBlack = d[idx] < 14 && d[idx + 1] < 14 && d[idx + 2] < 18 && d[idx + 2] - d[idx] < 6;
              if (!pureBlack && dist(idx) < 20) {
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
              if (isBg[p] || (dist(idx) < 11.5 && d[idx + 2] - d[idx] >= 7)) {
                d[idx + 3] = 0;
              }
            }
            tctx.putImageData(id, 0, 0);
          }

          // Measure non-transparent bbox & white-body center
          let minX = cw, maxX = 0, minY = ch, maxY = 0;
          let bodySumX = 0, bodyCnt = 0;
          for (let y = 0; y < ch; y++) {
            for (let x = 0; x < cw; x++) {
              const idx = (y * cw + x) * 4;
              if (d[idx + 3] > 160) {
                if (x < minX) minX = x;
                if (x > maxX) maxX = x;
                if (y < minY) minY = y;
                if (y > maxY) maxY = y;
                if (d[idx] > 190 && d[idx + 1] > 190 && d[idx + 2] > 190 && x > cw * 0.16 && x < cw * 0.78) {
                  bodySumX += x;
                  bodyCnt++;
                }
              }
            }
          }
          const cx = bodyCnt ? bodySumX / bodyCnt : (minX + maxX) / 2 || cw / 2;
          let dx = Math.round(targetCx - cx);
          let dy = Math.round(targetFootY - (maxY || ch * 0.88));
          if (minX <= maxX) {
            if (minX + dx < 2) dx = 2 - minX;
            if (maxX + dx > outCellW - 2) dx = outCellW - 2 - maxX;
            if (minY + dy < 2) dy = 2 - minY;
            if (maxY + dy > outCellH - 2) dy = outCellH - 2 - maxY;
          }
          octx.drawImage(tmp, c * outCellW + dx, r * outCellH + dy);
        }
      }

      const maxFrames = cols * rows;
      const effCount = (typeof frameCount === 'number' && frameCount >= 1) ? Math.min(maxFrames, Math.floor(frameCount)) : maxFrames;
      return {
        img: outCanvas,
        cols,
        rows,
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
          if (lum < 66) continue;

          const maxC = Math.max(r, g, b);
          const minC = Math.min(r, g, b);
          const sat = maxC > 0 ? (maxC - minC) / maxC : 0;

          if (mode === 'ghost') {
            // Preserve bright yellow dizzy stars & vivid red/pink mouth/cheeks
            if (r > 205 && g > 155 && b < 110) continue;
            if (r > 180 && g < 115 && b < 145) continue;
            if (sat > 0.30 && b > r && auraRgb) {
              // Recolor spectral flames & magic aura to variant aura color!
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
          } else {
            // Fur / Wool mode (Rabbit & Sheep): keep eyes, inner-ear pink, brown horns, dizzy stars & speed lines!
            if (r > 195 && g > 155 && b < 95) continue; // Yellow dizzy stars / lightning bursts
            if (b > r + 42 && g > 130) continue;        // Cyan speed lines
            if (r > 165 && g < 105 && b < 115) continue; // Red eyes / open mouth
            if (mode === 'sheep' && r > 85 && g > 48 && b < 95 && (r - b) > 32 && lum < 175) continue; // Curved brown sheep horns
            if (mode === 'rabbit' && r > 185 && (r - g) > 28 && (r - b) > 12 && g < 185) continue; // Pink inner ears & cheek blush

            // Tint light fur / wool cleanly with soft shading preserved
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
  let lastDownTapTime = 0;
  let tornadoKickTrigger = false;

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
      } else if (code === 'ArrowDown' || code === 'KeyS') {
        lastDownTapTime = now;
      } else if (code === 'ArrowUp' || code === 'KeyW') {
        if (lastDownTapTime > 0 && now - lastDownTapTime < 360) {
          tornadoKickTrigger = true;
          lastDownTapTime = 0;
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
      if (e.code === 'ArrowLeft' || e.code === 'KeyA' || e.code === 'Digit1') {
        if (game.selectedHeroId !== HERO_ROSTER[0].id) {
          game.selectedHeroId = HERO_ROSTER[0].id;
          sfx.init();
          sfx.playPickup('coin');
        }
        return;
      }
      if (e.code === 'ArrowRight' || e.code === 'KeyD' || e.code === 'Digit2') {
        if (game.selectedHeroId !== HERO_ROSTER[1].id) {
          game.selectedHeroId = HERO_ROSTER[1].id;
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
      { id: 'kuromi', x: 64, y: 90, w: 426, h: 274 },
      { id: 'redpanda', x: 534, y: 90, w: 426, h: 274 },
    ],
    stagePills: [
      { idx: 0, x: 182, y: 374, w: 208, h: 32 },
      { idx: 1, x: 408, y: 374, w: 208, h: 32 },
      { idx: 2, x: 634, y: 374, w: 208, h: 32 },
    ],
    startBtn: { x: 312, y: 416, w: 400, h: 48 },
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
    'penguin_king', 'penguin_ice', 'rabbit', 'ghost', 'sheep',
    'pig', 'slime', 'mushroom', 'puffer', 'star',
  ];

  const STAGES = [
    {
      id: 1,
      key: 'starfish',
      name: 'STAGE 1 · 海星國小',
      shortName: '海星國小',
      themeBadge: '🌊 海洋生物大軍',
      icon: '⭐',
      accent: '#38bdf8',
      bossWarnName: '海星國小 宇宙海星體育股長 登場！',
      clearTitle: 'STAGE 1 CLEAR!! 制霸海星國小！',
      signs: [
        { x: 180, y: 122, w: 156, h: 40, text: '海星國小大門', color: '#38bdf8' },
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
          name: '海星國小 · 海洋校門口',
          triggerX: 280,
          lockCamX: 0,
          spawns: [
            { type: 'penguin_ice', side: 1, z: 394, delay: 0.15 },
            { type: 'slime', side: 1, z: 444, delay: 0.55 },
            { type: 'puffer', side: -1, z: 422, delay: 1.45 },
            { type: 'penguin_king', side: 1, z: 406, delay: 2.35 },
          ],
        },
        {
          id: 2,
          name: '海星國小 · 水族福利社走廊',
          triggerX: 1360,
          lockCamX: 1080,
          spawns: [
            { type: 'puffer', side: 1, z: 404, delay: 0.2 },
            { type: 'penguin_king', side: 1, z: 456, delay: 0.65 },
            { type: 'star', side: -1, z: 388, delay: 1.5 },
            { type: 'penguin_ice', side: -1, z: 448, delay: 2.3 },
            { type: 'slime', side: 1, z: 416, delay: 3.1 },
          ],
        },
        {
          id: 3,
          name: '海星國小 · 海洋大操場 BOSS 戰',
          triggerX: 2760,
          lockCamX: STAGE_W - CANVAS_W,
          isBoss: true,
          spawns: [
            { type: 'boss', side: 1, z: 425, delay: 1.1, customName: '⭐ 海星國小 宇宙海星體育股長', hpMult: 0.72 },
            { type: 'penguin_king', side: -1, z: 385, delay: 3.6 },
            { type: 'puffer', side: 1, z: 465, delay: 7.4 },
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
      themeBadge: '🎲 全怪隨機大亂鬥',
      icon: '🔥',
      accent: '#f97316',
      bossWarnName: '阿強國小 暴走鐵拳教官 降臨！',
      clearTitle: 'STAGE 2 CLEAR!! 制霸阿強國小！',
      signs: [
        { x: 220, y: 142, w: 164, h: 44, text: '阿強國小', color: '#f97316' },
        { x: 640, y: 128, w: 148, h: 38, text: '隨機大亂鬥', color: '#ef4444' },
        { x: 1180, y: 144, w: 156, h: 42, text: '營養午餐部', color: '#facc15' },
        { x: 1660, y: 132, w: 154, h: 40, text: '阿強籃球場', color: '#fb923c' },
        { x: 2180, y: 138, w: 164, h: 42, text: '夕陽司令台', color: '#f43f5e' },
        { x: 2760, y: 128, w: 174, h: 44, text: '武鬥體育館', color: '#f97316' },
        { x: 3250, y: 142, w: 150, h: 40, text: '強者對決', color: '#ef4444' },
      ],
      zones: [
        {
          id: 1,
          name: '阿強國小 · 隨機熱血前庭',
          triggerX: 280,
          lockCamX: 0,
          spawns: [
            { type: 'random', pool: ALL_RANDOM_MONSTER_POOL, side: 1, z: 404, delay: 0.15 },
            { type: 'random', pool: ALL_RANDOM_MONSTER_POOL, side: 1, z: 458, delay: 0.55 },
            { type: 'random', pool: ALL_RANDOM_MONSTER_POOL, side: -1, z: 390, delay: 1.4 },
            { type: 'random', pool: ALL_RANDOM_MONSTER_POOL, side: 1, z: 446, delay: 2.2 },
          ],
        },
        {
          id: 2,
          name: '阿強國小 · 隨機夕陽籃球場',
          triggerX: 1360,
          lockCamX: 1080,
          spawns: [
            { type: 'random', pool: ALL_RANDOM_MONSTER_POOL, side: 1, z: 388, delay: 0.2 },
            { type: 'random', pool: ALL_RANDOM_MONSTER_POOL, side: 1, z: 454, delay: 0.65 },
            { type: 'random', pool: ALL_RANDOM_MONSTER_POOL, side: -1, z: 422, delay: 1.45 },
            { type: 'random', pool: ALL_RANDOM_MONSTER_POOL, side: 1, z: 402, delay: 2.3 },
            { type: 'random', pool: ALL_RANDOM_MONSTER_POOL, side: -1, z: 462, delay: 3.1 },
          ],
        },
        {
          id: 3,
          name: '阿強國小 · 武鬥司令台 BOSS 戰',
          triggerX: 2760,
          lockCamX: STAGE_W - CANVAS_W,
          isBoss: true,
          spawns: [
            { type: 'boss', side: 1, z: 425, delay: 1.1, customName: '🔥 阿強國小 暴走鐵拳教官', hpMult: 0.9 },
            { type: 'random', pool: ALL_RANDOM_MONSTER_POOL, side: -1, z: 382, delay: 3.5 },
            { type: 'random', pool: ALL_RANDOM_MONSTER_POOL, side: 1, z: 468, delay: 7.2 },
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
      themeBadge: '🌿 草原動物軍團（綿羊・豬・兔）',
      icon: '❄️',
      accent: '#c084fc',
      bossWarnName: '冬花國小 冰晶宇宙大校長 降臨！',
      clearTitle: 'ALL CLEAR!! 稱霸三校大亂鬥！',
      signs: [
        { x: 220, y: 142, w: 164, h: 44, text: '冬花國小', color: '#c084fc' },
        { x: 640, y: 128, w: 152, h: 38, text: '草原牧場園', color: '#4ade80' },
        { x: 1180, y: 144, w: 154, h: 42, text: '雪見音樂廳', color: '#f472b6' },
        { x: 1660, y: 132, w: 154, h: 40, text: '可愛動物區', color: '#67e8f9' },
        { x: 2180, y: 138, w: 164, h: 42, text: '冬花大禮堂', color: '#a855f7' },
        { x: 2760, y: 128, w: 174, h: 44, text: '校長室廣場', color: '#f43f8e' },
        { x: 3250, y: 142, w: 156, h: 40, text: 'FINAL BOSS', color: '#facc15' },
      ],
      zones: [
        {
          id: 1,
          name: '冬花國小 · 草原動物雪廊',
          triggerX: 280,
          lockCamX: 0,
          spawns: [
            { type: 'sheep', side: 1, z: 390, delay: 0.15 },
            { type: 'rabbit', side: 1, z: 454, delay: 0.5 },
            { type: 'pig', side: -1, z: 420, delay: 1.3 },
            { type: 'rabbit', side: 1, z: 402, delay: 2.1 },
          ],
        },
        {
          id: 2,
          name: '冬花國小 · 草原中庭花園',
          triggerX: 1360,
          lockCamX: 1080,
          spawns: [
            { type: 'sheep', side: 1, z: 398, delay: 0.2 },
            { type: 'pig', side: -1, z: 454, delay: 0.6 },
            { type: 'rabbit', side: 1, z: 430, delay: 1.35 },
            { type: 'sheep', side: -1, z: 386, delay: 2.1 },
            { type: 'ghost', side: 1, z: 462, delay: 2.9 },
          ],
        },
        {
          id: 3,
          name: '冬花國小 · 校長室終極決戰',
          triggerX: 2760,
          lockCamX: STAGE_W - CANVAS_W,
          isBoss: true,
          spawns: [
            { type: 'boss', side: 1, z: 425, delay: 1.2, customName: '❄️ 冬花國小 冰晶宇宙大校長', hpMult: 1.12 },
            { type: 'sheep', side: -1, z: 382, delay: 3.6 },
            { type: 'rabbit', side: 1, z: 466, delay: 7.0 },
            { type: 'pig', side: -1, z: 422, delay: 10.6 },
            { type: 'ghost', side: 1, z: 396, delay: 14.0 },
          ],
        },
      ],
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
    ctx.rotate(b.tilt);
    ctx.scale(scale, scale);

    const n = b.radii.length;
    const traceBubble = (ox, oy) => {
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const ang = (i / n) * Math.PI * 2;
        const r = b.radii[i];
        const px = Math.cos(ang) * b.rx * r + ox;
        const py = Math.sin(ang) * b.ry * r + oy;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
    };

    // Bold offset black comic ink drop shadow
    ctx.fillStyle = '#090710';
    traceBubble(5, 6);
    ctx.fill();

    // Optional speech pointer tail for shout bubbles (「閃身步!!」「浪子踢球!!」)
    if (b.style === 'shout') {
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
    const fontSize = b.style === 'super' ? 30 : (b.style === 'shout' ? 23 : 22);
    ctx.font = `900 italic ${fontSize}px "Noto Sans TC", Impact, sans-serif`;
    ctx.lineWidth = 6;
    ctx.strokeStyle = '#090710';
    const textY = b.subText ? -6 : 1;
    ctx.strokeText(b.text, 0, textY);
    ctx.fillStyle = b.textColor;
    ctx.fillText(b.text, 0, textY);

    if (b.subText) {
      ctx.font = `900 italic ${b.style === 'super' ? 14 : 11}px Impact, sans-serif`;
      ctx.lineWidth = 3.5;
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
    constructor(x, z, facing) {
      this.x = x;
      this.z = z;
      this.facing = facing;
      this.vx = facing * 760;
      this.jumpY = 24;
      this.vy = 180;
      this.rot = 0;
      this.life = 1.05;
      this.hitsLeft = 4;
      this.hitIds = new Set();
      this.dead = false;
    }

    update(dt) {
      this.life -= dt;
      if (this.life <= 0) { this.dead = true; return; }
      this.x += this.vx * dt;
      this.rot += this.facing * 26 * dt;

      // Energetic soccer bounce along the street!
      this.jumpY += this.vy * dt;
      this.vy -= 1200 * dt;
      if (this.jumpY < 16) {
        this.jumpY = 16;
        this.vy = Math.abs(this.vy) * 0.62;
        if (this.vy < 140) this.vy = 190;
        spawnParticles(this.x, this.z, '#e879f9', 4, 120, 4);
      }

      // Fiery purple trail sparks
      if (Math.random() < 0.75) {
        game.particles.push({
          x: this.x - this.facing * 14,
          y: this.z - this.jumpY + (Math.random() - 0.5) * 14,
          vx: -this.facing * 110,
          vy: (Math.random() - 0.5) * 40,
          size: 5 + Math.random() * 4,
          color: Math.random() < 0.5 ? '#f472b6' : '#facc15',
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
          e.takeHit(28, this.facing, true, 320, '#facc15', 'GOAL!!');
          sfx.playHit(true);
          game.hitstop = 0.048;
          addShake(8, 0.16);
          if (this.hitsLeft <= 0) {
            this.dead = true;
            spawnParticles(this.x, this.z - this.jumpY, '#f472b6', 16, 280, 7);
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

      // Blazing energy comet tail
      const by = this.z - this.jumpY;
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

  // Enemy Ranged Attack Projectiles (Style B: Cosmic Star Shot & Aqua Hydro Bolt)
  class EnemyProjectile {
    constructor(x, z, facing, kind = 'star', dmg = 14, vz = 0, color = null) {
      this.id = nextEntityId++;
      this.x = x;
      this.z = z;
      this.jumpY = 66;
      this.facing = facing;
      this.kind = kind; // 'star' | 'water' | 'spore' | 'ghost_orb'
      this.color = color || (kind === 'ghost_orb' ? '#c084fc' : null);
      this.dmg = dmg;
      this.vx = facing * (kind === 'star' ? 445 : (kind === 'spore' ? 340 : (kind === 'ghost_orb' ? 360 : 405)));
      this.vz = vz;
      this.rot = 0;
      this.life = kind === 'spore' ? 1.55 : 2.1;
      this.dead = false;
    }

    update(dt) {
      this.life -= dt;
      if (this.life <= 0) {
        this.dead = true;
        return;
      }
      this.x += this.vx * dt;
      this.z = Math.max(Z_MIN, Math.min(Z_MAX, this.z + this.vz * dt));
      this.rot += this.facing * dt * (this.kind === 'star' ? 14 : (this.kind === 'spore' ? 10 : 9));

      if (Math.random() < 0.55) {
        spawnParticles(
          this.x - this.facing * 12,
          this.z - this.jumpY,
          this.kind === 'ghost_orb' ? (this.color || '#c084fc') : (this.kind === 'star' ? '#fb7185' : (this.kind === 'spore' ? '#fb923c' : '#38bdf8')),
          1,
          75,
          4
        );
      }

      const p = game.player;
      if (
        p &&
        Math.abs(p.x - this.x) < 42 &&
        Math.abs(p.z - this.z) <= 30 &&
        p.jumpY < 58
      ) {
        p.takeDamage(this.dmg, this.facing, false);
        spawnSlashSparks(this.x, this.z - this.jumpY, this.facing, this.kind === 'ghost_orb' ? (this.color || '#c084fc') : (this.kind === 'star' ? '#fb7185' : (this.kind === 'spore' ? '#f97316' : '#38bdf8')));
        this.dead = true;
        return;
      }

      if (this.x < game.camX - 100 || this.x > game.camX + CANVAS_W + 100) {
        this.dead = true;
      }
    }

    draw(ctx) {
      if (this.dead) return;
      ctx.save();

      // Ground shadow
      ctx.fillStyle = 'rgba(8, 5, 18, 0.4)';
      ctx.beginPath();
      ctx.ellipse(this.x, this.z + 2, 18, 6, 0, 0, Math.PI * 2);
      ctx.fill();

      const py = this.z - this.jumpY;

      if (this.kind === 'ghost_orb') {
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

      this.hp = 140;
      this.maxHp = 140;
      this.displayHp = 140;
      this.energy = 100; // Start full so user can fire Special right away!
      this.maxEnergy = 100;
      this.lives = 3;

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
    }

    startHeavyAttack() {
      this.isRunning = false;
      this.state = 'heavy';
      this.stateTime = 0;
      this.comboQueued = null;
      this.hitIds.clear();
      this.frame = 2;
      sfx.playSwing(3);
      this.x += this.facing * (this.hero.id === 'redpanda' ? 28 : 18);
      spawnComicBubble(this.x - this.facing * 24, this.z - 196, this.hero.heavyShout, {
        style: 'shout',
        subText: this.hero.heavySub,
        fillA: '#fde047',
        fillB: this.hero.accent,
        rx: 94,
        ry: 42,
        tailDir: -this.facing,
      });
    }

    /**
     * 衝刺輕攻擊：浪子踢球 / 閃電踢球 (Dash Light Attack — Running + Light Attack!)
     */
    startDashLightAttack() {
      this.isRunning = false;
      this.state = 'dashLightAttack';
      this.stateTime = 0;
      this.frame = 0;
      this.ballLaunched = false;
      this.hitIds.clear();
      sfx.playSwing(2);
      spawnComicBubble(this.x - this.facing * 20, this.z - 198, this.hero.dashLightShout, {
        style: 'shout',
        subText: this.hero.dashLightSub,
        fillA: this.hero.accentLight,
        fillB: this.hero.accentDark,
        rx: 96,
        ry: 44,
        tailDir: -this.facing,
      });
    }

    /**
     * 衝刺重攻擊：星杖衝刺斬 / 赤焰衝刺撞擊 (Dash Heavy Attack — Running + Heavy Attack!)
     */
    startDashAttack() {
      this.isRunning = false;
      this.state = 'dashAttack';
      this.stateTime = 0;
      this.frame = 0;
      this.dashImpactDone = false;
      this.hitIds.clear();
      this.hitIdsStage2.clear();
      sfx.playSwing(3);
      spawnComicBubble(this.x - this.facing * 20, this.z - 198, this.hero.dashHeavyShout, {
        style: 'shout',
        subText: this.hero.dashHeavySub,
        fillA: '#fde047',
        fillB: this.hero.accent,
        rx: 108,
        ry: 46,
        tailDir: -this.facing,
      });
    }

    /**
     * 特殊招式：龍捲旋風腳 (Tornado Hurricane Kick — Fast ↓ then ↑!)
     * Multi-hit rising cyclone kick that launches enemies high into the air for follow-up juggles!
     */
    startTornadoKick() {
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
      const colA = this.hero.id === 'redpanda' ? '#fde047' : '#e879f9';
      const colB = this.hero.id === 'redpanda' ? '#ea580c' : '#7e22ce';
      spawnComicBubble(this.x - this.facing * 12, this.z - 210, this.hero.tornadoShout || '龍捲旋風腳!!', {
        style: 'shout',
        subText: this.hero.tornadoSub || 'TORNADO HURRICANE KICK!!',
        fillA: colA,
        fillB: colB,
        rx: 122,
        ry: 48,
        tailDir: -this.facing,
        dur: 0.72,
      });
      spawnParticles(this.x, this.z - 24, colA, 14, 240, 6);
    }

    startDash(dir) {
      if (this.dashCd > 0) return;
      if (dir !== 0) this.facing = dir;
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
      spawnComicBubble(this.x - this.facing * 18, this.z - 186, '閃身步!!', {
        style: 'shout',
        subText: 'FLASH STEP!',
        fillA: '#67e8f9',
        fillB: '#6366f1',
        rx: 84,
        ry: 40,
        tailDir: -this.facing,
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
    }

    startSpecial() {
      if (this.energy < 40) {
        addFloatText(this.x, this.z - 165, '能量不足!', '#fbbf24', 18);
        return;
      }
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
      addShake(6, 0.25);
      if (typeof GamepadManager !== 'undefined') GamepadManager.rumble(0.75, 0.5, 260);
      spawnComicBubble(this.x + this.facing * 40, this.z - 210, this.hero.specialShout, {
        style: 'super',
        subText: this.hero.specialSub,
        fillA: '#fde047',
        fillB: this.hero.id === 'redpanda' ? '#ea580c' : '#e11d48',
        rx: 142,
        ry: 56,
        dur: 0.92,
      });
    }

    takeDamage(dmg, knockDir, heavy = false) {
      if (this.invuln > 0 || this.state === 'special' || this.state === 'dash') return;
      this.isRunning = false;
      this.hp = Math.max(0, this.hp - dmg);
      this.energy = Math.min(this.maxEnergy, this.energy + 8);
      this.hurtFlash = 0.22;
      this.invuln = heavy ? 1.15 : 0.72;
      this.state = 'hurt';
      this.stateTime = 0;
      this.vx = knockDir * (heavy ? 260 : 140);
      if (heavy) {
        this.vy = 260;
      }
      game.combo = 0;
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
      let wantTornado = false;
      if (tornadoKickTrigger) {
        wantTornado = true;
        tornadoKickTrigger = false;
      }

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

      // Vertical Jump Physics (skip gravity override during tornadoKick custom flight curve)
      if (this.state !== 'tornadoKick' && (this.jumpY > 0 || this.vy > 0)) {
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
        const hurtSheet = SpriteBank.sheets.hurt;
        const fc = hurtSheet ? hurtSheet.frameCount : 10;
        const fps = StudioState.getFps('hurt', 15);
        const totalDur = fc / fps;
        this.frame = Math.min(fc - 1, Math.floor((this.stateTime / totalDur) * fc));
        // Recoil knockback during frames 0-5, steady footing recovery on frames 6-9
        this.x += this.vx * dt;
        this.vx *= Math.pow(this.frame <= 4 ? 0.08 : 0.01, dt);
        if (this.stateTime >= totalDur && this.jumpY === 0) {
          this.state = 'idle';
          this.animTimer = 0;
        }
      } else if (this.state === 'special') {
        this.updateSpecial(dt);
      } else if (this.state === 'tornadoKick') {
        this.updateTornadoKick(dt, wantSpecial);
      } else if (this.state === 'dash') {
        this.updateDash(dt, wantLight, wantHeavy, wantSpecial);
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
        this.frame = this.stateTime < 0.12 ? 3 : 5;
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
            // RUNNING + LIGHT ATTACK => ROGUE SOCCER KICK (浪子踢球)!!
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

          const speedX = this.isRunning ? (this.hero.runSpeed || 395) : (this.hero.walkSpeed || 215);
          const speedZ = this.isRunning ? 225 : 155;

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
            // Dedicated 10-frame upright Walk animation!
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
     * 100% Image-faithful 10-frame Instant Burst Dash (閃身步!) triggered by SHIFT!
     */
    updateDash(dt, wantLight, wantHeavy, wantSpecial) {
      this.stateTime += dt;
      const fps = StudioState.getFps(this.hero.id === 'redpanda' ? 'rp_dash' : 'dash', 25);
      const totalDur = 10 / fps;
      const progress = Math.min(0.999, this.stateTime / totalDur);
      this.frame = Math.floor(progress * 10);

      let speed = 0;
      if (this.frame <= 1) speed = 260;
      else if (this.frame === 2) speed = 920;
      else if (this.frame === 3) speed = 1380;
      else if (this.frame === 4) speed = 1650;
      else if (this.frame === 5) speed = 1320;
      else if (this.frame === 6) speed = 740;
      else if (this.frame === 7) speed = 320;
      else if (this.frame === 8) speed = 120;
      else speed = 0;

      this.x += this.facing * speed * dt;

      if (this.frame >= 3 && this.frame <= 6 && Math.random() < 0.65) {
        game.afterimages.push({
          sheetKey: this.resolveSheet('dash'),
          frame: this.frame,
          x: this.x,
          y: this.z - this.jumpY,
          facing: this.facing,
          life: 0.14,
          maxLife: 0.14,
        });
      }

      // Cancel brake frames (7-9) right into 浪子踢球 / 星杖衝刺斬 / 能量砲!
      if (this.frame >= 7) {
        if (wantSpecial) { this.startSpecial(); return; }
        if (wantHeavy) { this.startDashAttack(); return; }
        if (wantLight) { this.startDashLightAttack(); return; }
      }

      if (this.stateTime >= totalDur) {
        this.state = 'idle';
        this.animTimer = 0;
      }
    }

    /**
     * 10-frame Rogue Soccer Kick (浪子踢球) — Running + Light Attack!
     * Launches a blazing spinning Gothic Energy Soccer Ball across the street on frame 4!
     */
    updateDashLightAttack(dt, wantSpecial) {
      this.stateTime += dt;
      if (wantSpecial && this.frame >= 7) {
        this.startSpecial();
        return;
      }

      const fps = StudioState.getFps('dashLightAttack', 17);
      const totalDur = 10 / fps;
      const progress = Math.min(0.999, this.stateTime / totalDur);
      this.frame = Math.floor(progress * 10);

      // Slide-in momentum slowing on kick plant
      let speed = 0;
      if (this.frame === 0) speed = 310;
      else if (this.frame === 1) speed = 200;
      else if (this.frame === 2) speed = 110;
      else if (this.frame === 3 || this.frame === 4) speed = 80;
      else if (this.frame === 6 || this.frame === 7) speed = 90;
      this.x += this.facing * speed * dt;

      // Frame 3: Point-blank instep kick hitbox
      if (this.frame === 3) {
        this.performMeleeHitbox(148, 22, false, 180);
      }

      // Frame 4: Launch blazing Gothic Energy Soccer Ball + Comic Impact Frame!
      if (this.frame >= 4 && !this.ballLaunched) {
        this.ballLaunched = true;
        game.projectiles.push(new SoccerBall(this.x + this.facing * 68, this.z, this.facing));
        sfx.playHit(true);
        addShake(7, 0.14);
        triggerImpactFrame('#f0abfc', 0.055);
      }

      if (this.stateTime >= totalDur) {
        this.state = 'idle';
        this.animTimer = 0;
      }
    }

    /**
     * 100% Image-faithful 10-frame Magic Star Wand Dash Attack (星杖衝刺斬)
     */
    updateDashAttack(dt, wantSpecial) {
      this.stateTime += dt;
      if (wantSpecial && this.frame >= 7) {
        this.startSpecial();
        return;
      }

      const fps = StudioState.getFps('dashAttack', 18);
      const totalDur = 10 / fps;
      const progress = Math.min(0.999, this.stateTime / totalDur);
      this.frame = Math.floor(progress * 10);

      let speed = 0;
      if (this.frame <= 1) speed = 320;
      else if (this.frame <= 3) speed = 480;
      else if (this.frame === 4) speed = 560;
      else if (this.frame === 5) speed = 400;
      else if (this.frame === 6) speed = 260;
      else if (this.frame === 7) speed = 120;
      else speed = 0;

      this.x += this.facing * speed * dt;

      if (this.frame === 3 || this.frame === 4) {
        this.performMeleeHitbox(164, 22, false, 140, this.hitIds);
      }
      if (this.frame === 5 && !this.dashImpactDone) {
        this.dashImpactDone = true;
        triggerImpactFrame('#fde047', 0.06);
      }
      if (this.frame === 5 || this.frame === 6) {
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
      // Allow custom actions to also deal melee hit during middle frames!
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
        this.startSpecial();
        return;
      }
      if (this.stateTime > 0.05) {
        if (wantHeavy) this.comboQueued = 'heavy';
        else if (wantLight && !this.comboQueued) this.comboQueued = 'light';
      }

      const lightFps = StudioState.getFps('lightAttack', 17);
      const heavyFps = StudioState.getFps('heavyAttack', 14);

      if (this.state === 'light1') {
        // Stage 1: Snappy Straight Jab [0, 1, 2]
        const seq = [0, 1, 2];
        const dur = seq.length / lightFps;
        const idx = Math.min(seq.length - 1, Math.floor((this.stateTime / dur) * seq.length));
        this.frame = seq[idx];
        if (this.frame === 2) {
          this.performMeleeHitbox(134, 14, false, 80);
        }
        if (this.stateTime >= dur) {
          if (this.comboQueued === 'heavy') this.startHeavyAttack();
          else if (this.comboQueued === 'light') this.startLightAttack(2);
          else this.state = 'idle';
        }
      } else if (this.state === 'light2') {
        // Stage 2: Stepping Cross + Sweeping Hook [3, 4, 5]
        const seq = [3, 4, 5];
        const dur = seq.length / lightFps;
        const idx = Math.min(seq.length - 1, Math.floor((this.stateTime / dur) * seq.length));
        this.frame = seq[idx];
        if (this.frame === 4 || this.frame === 5) {
          this.performMeleeHitbox(148, 20, false, 125);
        }
        if (this.stateTime >= dur) {
          if (this.comboQueued === 'heavy') this.startHeavyAttack();
          else if (this.comboQueued === 'light') this.startLightAttack(3);
          else this.state = 'idle';
        }
      } else if (this.state === 'light3') {
        // Stage 3: Crouch -> Soaring Rising Uppercut Finisher [6, 7, 8, 9]
        const seq = [6, 7, 8, 9];
        const dur = seq.length / Math.max(10, lightFps * 0.85);
        const idx = Math.min(seq.length - 1, Math.floor((this.stateTime / dur) * seq.length));
        this.frame = seq[idx];
        if (this.frame === 7) {
          this.performMeleeHitbox(156, 28, true, 240);
        }
        if (this.stateTime >= dur) {
          if (this.comboQueued === 'heavy') this.startHeavyAttack();
          else this.state = 'idle';
        }
      } else if (this.state === 'heavy') {
        // Heavy Attack (Numpad5): Magic Star Wand Overhead Slam [2, 3, 5, 7, 8, 9]
        const seq = [2, 3, 5, 7, 8, 9];
        const dur = seq.length / heavyFps;
        const idx = Math.min(seq.length - 1, Math.floor((this.stateTime / dur) * seq.length));
        this.frame = seq[idx];
        if (this.frame === 5 || this.frame === 7 || this.frame === 8) {
          this.performMeleeHitbox(168, 42, true, 340);
        }
        if (this.stateTime >= dur) {
          this.state = 'idle';
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
      const sparkCol = heavy ? (this.hero.heavySparkColor || '#facc15') : (this.hero.sparkColor || '#e879f9');
      const minDx = -(opts && opts.wideBack ? opts.wideBack : 30);
      for (const e of game.enemies) {
        if (e.dead || hitSet.has(e.id)) continue;
        const dx = (e.x - this.x) * this.facing;
        if (dx >= minDx && dx <= reach && Math.abs(e.z - this.z) <= Z_HIT_MELEE + 12) {
          hitSet.add(e.id);
          e.takeHit(dmg, this.facing, heavy, knockForce, sparkCol, opts && opts.customWord ? opts.customWord : null, opts);
          this.energy = Math.min(this.maxEnergy, this.energy + (heavy ? 12 : 7));
          hitAny = true;
        }
      }
      for (const prop of game.props) {
        if (prop.broken || hitSet.has(prop.id)) continue;
        const dx = (prop.x - this.x) * this.facing;
        if (dx >= minDx && dx <= reach && Math.abs(prop.z - this.z) <= Z_HIT_MELEE) {
          hitSet.add(prop.id);
          prop.hit(dmg);
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
      const shadowScale = Math.max(0.45, 1 - this.jumpY / 260);
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

      // 1:1 NATIVE PIXEL SCALE — 100% UNCLIPPED (300x264)!
      SpriteBank.drawFrame(ctx, sheetKey, frameToDraw, this.x, drawY, this.facing, 1.0, this.hurtFlash > 0);
      ctx.restore();
    }
  }

  // --------------------------------------------------------------------------
  // ENEMIES (HD Multi-Frame Sprite Sheets: Move, Dual-Style Attack A+B, KO)
  // --------------------------------------------------------------------------
  let nextEntityId = 1;

  const ENEMY_CONFIGS = {
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

  class Enemy {
    constructor(type, x, z, opts = null) {
      const cfg = ENEMY_CONFIGS[type] || ENEMY_CONFIGS.slime;
      this.id = nextEntityId++;
      this.type = type;
      this.cfg = cfg;
      // Pick color variant for shared-module monsters (Rabbit / Ghost / Sheep)
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
      this.facing = x > game.player.x ? -1 : 1;

      const scaledHp = Math.round(cfg.hp * ((opts && opts.hpMult) ? opts.hpMult : 1));
      this.hp = scaledHp;
      this.maxHp = scaledHp;
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
    }

    takeHit(dmg, dir, heavy, knockForce, sparkColor = '#f472b6', customComicWord = null, opts = null) {
      if (this.dead) return;
      const launchAir = !!(opts && opts.launchAir);
      const wasAirborne = this.jumpY > 8 || (this.isLaunched && this.vy > 20);
      const isAirJuggle = wasAirborne && !launchAir;
      const finalDmg = isAirJuggle ? Math.round(dmg * 1.2) : dmg;

      this.hp = Math.max(0, this.hp - finalDmg);
      this.hurtFlash = 0.14;
      this.facing = -dir;
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
      if (launchAir && !wasAirborne) {
        addFloatText(this.x, hitY - 26, '▲ 浮空!!', '#e879f9', 20);
      }
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

      if (this.hp <= 0) {
        this.dead = true;
        this.state = 'dead';
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

      // Armored foes resist light pokes mid-attack, UNLESS hit by Tornado Launch, heavy finisher, or already airborne!
      if (this.cfg.armor && !launchAir && !wasAirborne && (this.state === 'attack' || (this.cfg.spikyCounter && this.state === 'windup')) && !heavy) {
        this.vx = dir * 45;
        return;
      }

      if (this.cfg.spikyCounter && !heavy && !launchAir && !wasAirborne && this.state === 'approach' && this.attackCd <= 0.4 && Math.random() < 0.45) {
        this.state = 'windup';
        this.stateTime = 0;
        this.attackStyle = 'A';
        spawnParticles(this.x, this.z - 65, '#facc15', 8, 160, 5);
        return;
      }

      if (launchAir) {
        // 龍捲旋風腳浮空擊飛：高拋並保持在前方近距離，方便接其他招式空中追打！
        this.state = 'knocked';
        this.isLaunched = true;
        this.stateTime = 0;
        this.frame = 2;
        this.vx = dir * Math.min(knockForce || 80, 95);
        this.vy = Math.max(this.vy, (opts && opts.launchVy) || 540);
        this.jumpY = Math.max(this.jumpY, 10);
      } else if (wasAirborne) {
        // 浮空追打 (Air Juggle follow-up)：任何招式命中浮空敵人皆可再次頂起追打！
        this.airJuggleCount++;
        const decay = Math.max(0.45, 1 - this.airJuggleCount * 0.13);
        this.state = 'knocked';
        this.isLaunched = true;
        this.stateTime = 0;
        this.frame = 2;
        this.vx = dir * (heavy ? Math.min(knockForce, 175) : 72);
        this.vy = Math.max(this.vy, (heavy ? 430 : 350) * decay);
        this.jumpY = Math.max(this.jumpY, 12);
      } else if (heavy) {
        this.state = 'knocked';
        this.isLaunched = false;
        this.stateTime = 0;
        this.frame = 2;
        this.vx = dir * knockForce;
        this.vy = 320;
        this.jumpY = 2;
      } else {
        this.state = 'hurt';
        this.stateTime = 0;
        this.frame = 0;
        this.vx = dir * knockForce;
      }
    }

    update(dt) {
      this.animTime += dt;
      if (this.hurtFlash > 0) this.hurtFlash -= dt;
      if (this.attackCd > 0) this.attackCd -= dt;

      const prefix = this.cfg.spritePrefix;
      const moveFps = StudioState.getAction(`${prefix}_move`)?.fps || 12;
      const koFps = StudioState.getAction(`${prefix}_ko`)?.fps || 12;

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
        this.frame = Math.min(9, Math.floor(this.stateTime * koFps));
        // Let the knocked-out dizzy animation stay visible on the ground before arcade blink-fade
        if (this.jumpY === 0 && this.stateTime > 1.05) {
          this.deadFade -= dt * 1.4;
        }
        return;
      }

      const p = game.player;
      const dx = p.x - this.x;
      const dz = p.z - this.z;

      if (this.state === 'hurt') {
        this.stateTime += dt;
        const hurtDur = this.cfg.hasHurt ? 0.36 : 0.28;
        if (this.cfg.hasHurt && SpriteBank.sheets[`${prefix}_hurt`]) {
          this.frame = Math.min(9, Math.floor((this.stateTime / hurtDur) * 10));
        } else {
          this.frame = this.stateTime < 0.14 ? 0 : 1;
        }
        this.x += this.vx * dt;
        this.vx *= Math.pow(0.02, dt);
        if (this.stateTime >= hurtDur) {
          this.state = 'approach';
          this.attackCd = Math.max(this.attackCd, 0.35);
        }
      } else if (this.state === 'knocked') {
        this.stateTime += dt;
        this.frame = Math.min(7, 2 + Math.floor((this.stateTime / 0.72) * 6));
        if (this.jumpY === 0 && this.stateTime >= 0.72) {
          this.state = 'approach';
          this.attackCd = 0.55;
        }
      } else if (this.state === 'windup') {
        this.stateTime += dt;
        this.facing = dx >= 0 ? 1 : -1;
        const enraged = this.cfg.isBoss && this.hp < this.maxHp * 0.5;
        const dur = enraged ? this.cfg.windup * 0.76 : this.cfg.windup;
        const prog = Math.min(0.99, this.stateTime / dur);

        if (this.cfg.attackMode === 'full10') {
          if (this.cfg.windupSheet) {
            // Slime plays its dedicated 10-frame Angry Reaction sheet (`!` -> steaming mad!)
            this.frame = Math.min(9, Math.floor(prog * 10));
          } else if (this.type === 'puffer') {
            // Pufferfish inflates across frames 0 -> 1 -> 2 -> 3
            this.frame = Math.min(3, Math.floor(prog * 4));
          } else {
            // Windup crouch / charge across frames 0 -> 1 -> 2
            this.frame = Math.min(2, Math.floor(prog * 3));
          }
        } else {
          this.frame = this.attackStyle === 'A' ? Math.floor(prog * 2) : 5 + Math.floor(prog * 2);
        }

        if (this.stateTime >= dur) {
          this.state = 'attack';
          this.stateTime = 0;
          this.didHitPlayer = false;
          this.projFired = false;

          if (this.cfg.attackMode === 'full10') {
            if (this.type === 'pig' || this.type === 'sheep') {
              // Close-range blazing boar / furious sheep horn ramming dash!
              this.dashVel = this.facing * (this.type === 'sheep' ? 560 : 590);
              spawnParticles(this.x - this.facing * 26, this.z - 16, '#fde68a', 12, 200, 6);
            } else if (this.type === 'penguin_king') {
              // Royal golden belly-slide tackle!
              this.dashVel = this.facing * 540;
              spawnParticles(this.x - this.facing * 24, this.z - 14, '#facc15', 12, 190, 6);
            } else if (this.type === 'penguin_ice') {
              // Frost belly-slide + icy crystal burst!
              this.dashVel = this.facing * 510;
              spawnParticles(this.x - this.facing * 20, this.z - 22, '#67e8f9', 12, 195, 6);
            } else if (this.type === 'rabbit') {
              // Fast hopping bunny lunge!
              this.dashVel = this.facing * 570;
              this.vy = 240;
              this.jumpY = 2;
              spawnParticles(this.x - this.facing * 18, this.z - 12, '#f9a8d4', 8, 160, 5);
            } else if (this.type === 'ghost') {
              // Floating ghost hovers back slightly while launching spectral ghost_orb!
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
              // Mushroom leaps forward into a headbutt ground slam!
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
              this.dashVel = -this.facing * 45; // Subtle firing recoil
            }
            sfx.playSwing(this.cfg.isBoss ? 3 : (this.attackStyle === 'B' ? 2 : 1));
          }
        }
      } else if (this.state === 'attack') {
        this.stateTime += dt;
        this.x += this.dashVel * dt;
        this.dashVel *= Math.pow(0.08, dt);

        if (this.cfg.attackMode === 'full10') {
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
        // APPROACH / FLANK AI (Belt-scroller slot spacing!)
        this.facing = dx >= 0 ? 1 : -1;

        // Check how many other enemies are already winding up/attacking
        const attackers = game.enemies.filter((e) => !e.dead && (e.state === 'windup' || e.state === 'attack')).length;
        const desiredDist = this.type === 'ghost'
          ? 275
          : ((this.type === 'star' || this.type === 'puffer' || this.type === 'slime' || this.type === 'pig' || this.type === 'sheep' || this.type === 'penguin_king' || this.type === 'penguin_ice' || this.type === 'rabbit') ? 185 : (this.cfg.reach - 10));
        const targetX = p.x + this.strafeSide * desiredDist;
        const targetZ = Math.max(Z_MIN, Math.min(Z_MAX, p.z + (attackers >= 2 ? this.strafeOffsetZ * 1.8 : 0)));

        const toX = targetX - this.x;
        const toZ = targetZ - this.z;
        const distToTarget = Math.hypot(toX, toZ);

        if (distToTarget > 14) {
          this.isMoving = true;
          const mx = (toX / distToTarget) * this.cfg.speedX;
          const mz = (toZ / distToTarget) * this.cfg.speedZ;
          this.x += mx * dt;
          this.z += mz * dt;
          this.frame = Math.floor(this.animTime * moveFps) % 10;
        } else {
          this.isMoving = false;
          const idleFps = this.cfg.idleSheet ? (StudioState.getAction(this.cfg.idleSheet)?.fps || 8) : moveFps * 0.7;
          this.frame = Math.floor(this.animTime * idleFps) % 10;
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
        const inRangeZ = Math.abs(dz) <= 32;
        if (inRangeZ && this.attackCd <= 0 && (attackers < 2 || this.cfg.isBoss)) {
          if (this.cfg.attackMode === 'full10') {
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

      // Clamp Z & loose horizontal bounds
      this.z = Math.max(Z_MIN, Math.min(Z_MAX, this.z));
      this.x = Math.max(game.camMinX - 80, Math.min(game.camMaxX + CANVAS_W + 80, this.x));
    }

    draw(ctx) {
      if (this.deadFade <= 0) return;
      const sc = this.cfg.scale;
      const prefix = this.cfg.spritePrefix;

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

      // Boss enraged crimson cosmic aura
      if (this.cfg.isBoss && !this.dead && this.hp < this.maxHp * 0.5) {
        const pulse = 1 + Math.sin(game.time * 14) * 0.1;
        const grad = ctx.createRadialGradient(this.x, this.z - this.jumpY - 82 * sc, 16, this.x, this.z - this.jumpY - 82 * sc, 118 * sc * pulse);
        grad.addColorStop(0, 'rgba(244, 63, 94, 0.45)');
        grad.addColorStop(1, 'rgba(244, 63, 94, 0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(this.x, this.z - this.jumpY - 82 * sc, 118 * sc * pulse, 0, Math.PI * 2);
        ctx.fill();
      }

      // Select HD Sprite Sheet by state (dedicated 10f hurt sheet when available!)
      let sheetKey = (!this.isMoving && this.cfg.idleSheet && SpriteBank.sheets[this.cfg.idleSheet])
        ? this.cfg.idleSheet
        : `${prefix}_move`;
      if (this.state === 'windup') {
        sheetKey = (this.cfg.windupSheet && SpriteBank.sheets[this.cfg.windupSheet])
          ? this.cfg.windupSheet
          : `${prefix}_attack`;
      } else if (this.state === 'attack') {
        sheetKey = `${prefix}_attack`;
      } else if (this.state === 'hurt') {
        sheetKey = (this.cfg.hasHurt && SpriteBank.sheets[`${prefix}_hurt`]) ? `${prefix}_hurt` : `${prefix}_ko`;
      } else if (this.state === 'knocked' || this.state === 'dead') {
        sheetKey = `${prefix}_ko`;
      }

      SpriteBank.drawFrame(
        ctx,
        sheetKey,
        this.frame,
        this.x,
        this.z - this.jumpY,
        this.facing,
        sc,
        this.hurtFlash > 0,
        this.variant
      );

      ctx.restore();

      // Telegraph indicator during windup: "!" (Melee) vs "⚡!" (Ranged Style B)
      if (this.state === 'windup' && !this.dead && !this.cfg.windupSheet) {
        const ty = this.z - this.jumpY - 154 * sc;
        const isRanged = this.attackStyle === 'B';
        ctx.save();
        ctx.fillStyle = isRanged ? (this.cfg.projKind === 'star' ? '#fb7185' : '#38bdf8') : '#facc15';
        ctx.strokeStyle = '#0d0b14';
        ctx.lineWidth = 4;
        ctx.font = '900 26px sans-serif';
        ctx.textAlign = 'center';
        const label = isRanged ? '⚡!' : '!';
        ctx.strokeText(label, this.x, ty);
        ctx.fillText(label, this.x, ty);
        ctx.restore();
      }

      // Mini HP bar overhead for damaged regular enemies
      if (!this.dead && !this.cfg.isBoss && this.hp < this.maxHp) {
        const bw = 68;
        const bx = this.x - bw / 2;
        const by = this.z - this.jumpY - 156 * sc;
        ctx.fillStyle = 'rgba(0,0,0,0.72)';
        ctx.fillRect(bx - 1, by - 1, bw + 2, 8);
        ctx.fillStyle = '#ef4444';
        ctx.fillRect(bx, by, bw * (this.hp / this.maxHp), 6);
      }
    }
  }

  // --------------------------------------------------------------------------
  // DESTRUCTIBLE PROPS & CLASSIC ARCADE PICKUPS
  // --------------------------------------------------------------------------
  class Prop {
    constructor(x, z, kind, dropType) {
      this.id = nextEntityId++;
      this.x = x;
      this.z = z;
      this.kind = kind; // crate | drum
      this.dropType = dropType; // food | crystal | coin
      this.hp = 35;
      this.broken = false;
      this.shake = 0;
    }

    hit(dmg) {
      if (this.broken) return;
      this.hp -= dmg;
      this.shake = 0.16;
      sfx.playHit(false);
      spawnParticles(this.x, this.z - 34, this.kind === 'crate' ? '#d97706' : '#64748b', 8, 180, 6);
      if (this.hp <= 0) {
        this.broken = true;
        sfx.playCrateBreak();
        spawnParticles(this.x, this.z - 36, this.kind === 'crate' ? '#b45309' : '#475569', 16, 260, 8);
        if (this.dropType) {
          game.pickups.push(new Pickup(this.x, this.z, this.dropType));
        }
      }
    }

    update(dt) {
      if (this.shake > 0) this.shake -= dt;
    }

    draw(ctx) {
      if (this.broken) return;
      const sx = this.shake > 0 ? (Math.random() - 0.5) * 8 : 0;
      ctx.save();
      ctx.fillStyle = 'rgba(8,5,18,0.45)';
      ctx.beginPath();
      ctx.ellipse(this.x, this.z + 3, 38, 11, 0, 0, Math.PI * 2);
      ctx.fill();

      ctx.translate(Math.round(this.x + sx), Math.round(this.z));
      ctx.lineWidth = 4;
      ctx.strokeStyle = '#0d0b14';

      if (this.kind === 'crate') {
        ctx.fillStyle = '#b45309';
        ctx.beginPath();
        ctx.roundRect(-30, -64, 60, 64, 6);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#d97706';
        ctx.fillRect(-22, -56, 44, 48);
        ctx.strokeRect(-22, -56, 44, 48);
        // Diagonal brace
        ctx.beginPath();
        ctx.moveTo(-22, -56); ctx.lineTo(22, -8);
        ctx.moveTo(22, -56); ctx.lineTo(-22, -8);
        ctx.stroke();
      } else {
        // Gothic Neon Oil Drum
        ctx.fillStyle = '#4c1d95';
        ctx.beginPath();
        ctx.roundRect(-26, -70, 52, 70, 10);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#ec4899';
        ctx.fillRect(-24, -46, 48, 16);
        ctx.strokeRect(-24, -46, 48, 16);
      }
      ctx.restore();
    }
  }

  class Pickup {
    constructor(x, z, type) {
      this.x = x;
      this.z = z;
      this.type = type; // food | crystal | coin
      this.vy = 240;
      this.jumpY = 12;
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
          addFloatText(this.x, this.z - 60, 'HP +50!', '#4ade80', 22);
          spawnParticles(this.x, this.z - 30, '#4ade80', 12, 180, 6);
        } else if (this.type === 'crystal') {
          p.energy = Math.min(p.maxEnergy, p.energy + 55);
          addFloatText(this.x, this.z - 60, '能量 +55!', '#e879f9', 22);
          spawnParticles(this.x, this.z - 30, '#e879f9', 12, 180, 6);
        } else {
          game.score += 500;
          addFloatText(this.x, this.z - 60, '+500', '#facc15', 20);
          spawnParticles(this.x, this.z - 30, '#facc15', 10, 160, 5);
        }
      }
    }

    draw(ctx) {
      if (this.taken) return;
      const bob = Math.sin(this.age * 7) * 4;
      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,0.4)';
      ctx.beginPath();
      ctx.ellipse(this.x, this.z + 2, 22, 7, 0, 0, Math.PI * 2);
      ctx.fill();

      ctx.translate(Math.round(this.x), Math.round(this.z - this.jumpY - 18 + bob));
      ctx.lineWidth = 3.5;
      ctx.strokeStyle = '#0d0b14';

      if (this.type === 'food') {
        // Classic Streets of Rage Roast Drumstick!
        ctx.fillStyle = '#f8fafc';
        ctx.beginPath();
        ctx.roundRect(6, -5, 20, 10, 4);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#ea580c';
        ctx.beginPath();
        ctx.ellipse(-6, 0, 18, 13, -0.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      } else if (this.type === 'crystal') {
        // Glowing Purple Energy Crystal
        ctx.fillStyle = '#e879f9';
        ctx.beginPath();
        ctx.moveTo(0, -22);
        ctx.lineTo(15, 0);
        ctx.lineTo(0, 18);
        ctx.lineTo(-15, 0);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.moveTo(0, -14);
        ctx.lineTo(6, -2);
        ctx.lineTo(0, 6);
        ctx.lineTo(-6, -2);
        ctx.closePath();
        ctx.fill();
      } else {
        // Gold Arcade Coin
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
    const theme = SCHOOL_THEMES[stage.key] || SCHOOL_THEMES.starfish;
    const signs = stage.signs || [];
    const starfishBg = (stage.key === 'starfish' && SpriteBank.bgImages && SpriteBank.bgImages.starfish)
      ? SpriteBank.bgImages.starfish
      : null;

    // ------------------------------------------------------------------------
    // LAYER 0 (0.05x): Ultra-Far Sky Gradient & Sun / Sunset / Winter Moon
    // ------------------------------------------------------------------------
    const sky = ctx.createLinearGradient(0, 0, 0, 315);
    if (starfishBg) {
      sky.addColorStop(0, '#1d84e5');
      sky.addColorStop(0.48, '#53b7fb');
      sky.addColorStop(1, '#cdeeff');
    } else {
      sky.addColorStop(0, theme.sky[0]);
      sky.addColorStop(0.55, theme.sky[1]);
      sky.addColorStop(1, theme.sky[2]);
    }
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, CANVAS_W, 320);

    const orbX = 830 - camX * 0.05;
    if (theme.celestialType === 'sun') {
      const sunGrad = ctx.createRadialGradient(orbX, 66, 10, orbX, 66, 108);
      sunGrad.addColorStop(0, 'rgba(255, 254, 232, 0.98)');
      sunGrad.addColorStop(0.38, 'rgba(253, 224, 71, 0.52)');
      sunGrad.addColorStop(1, 'rgba(253, 224, 71, 0)');
      ctx.fillStyle = sunGrad;
      ctx.beginPath();
      ctx.arc(orbX, 66, 108, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fef9c3';
      ctx.beginPath();
      ctx.arc(orbX, 66, 30, 0, Math.PI * 2);
      ctx.fill();

      // LAYER 1A (0.10x): Slow drifting fluffy sunny clouds
      ctx.fillStyle = 'rgba(255, 255, 255, 0.72)';
      const cloudOff = -((camX * 0.10 + game.time * 7) % 320);
      for (let cx = cloudOff - 160; cx < CANVAS_W + 220; cx += 320) {
        const cy = 54 + ((Math.round((cx - cloudOff) / 320) % 2) * 20);
        ctx.beginPath();
        ctx.arc(cx, cy + 8, 22, 0, Math.PI * 2);
        ctx.arc(cx + 26, cy, 30, 0, Math.PI * 2);
        ctx.arc(cx + 58, cy + 8, 23, 0, Math.PI * 2);
        ctx.arc(cx + 80, cy + 12, 16, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (theme.celestialType === 'sunset') {
      const sunGrad = ctx.createRadialGradient(orbX, 118, 16, orbX, 118, 128);
      sunGrad.addColorStop(0, 'rgba(255, 247, 200, 0.96)');
      sunGrad.addColorStop(0.4, 'rgba(251, 146, 60, 0.62)');
      sunGrad.addColorStop(1, 'rgba(239, 68, 68, 0)');
      ctx.fillStyle = sunGrad;
      ctx.beginPath();
      ctx.arc(orbX, 118, 128, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fef08a';
      ctx.beginPath();
      ctx.arc(orbX, 118, 44, 0, Math.PI * 2);
      ctx.fill();

      // Sunset clouds (0.10x)
      ctx.fillStyle = 'rgba(254, 215, 170, 0.36)';
      const cloudOff = -((camX * 0.10 + game.time * 6) % 360);
      for (let cx = cloudOff - 180; cx < CANVAS_W + 220; cx += 360) {
        ctx.beginPath();
        ctx.ellipse(cx + 45, 78, 66, 14, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    } else {
      const moonGrad = ctx.createRadialGradient(orbX, 82, 12, orbX, 82, 98);
      moonGrad.addColorStop(0, 'rgba(240, 249, 255, 0.96)');
      moonGrad.addColorStop(0.38, 'rgba(192, 132, 252, 0.52)');
      moonGrad.addColorStop(1, 'rgba(192, 132, 252, 0)');
      ctx.fillStyle = moonGrad;
      ctx.beginPath();
      ctx.arc(orbX, 82, 98, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#f8fafc';
      ctx.beginPath();
      ctx.arc(orbX, 82, 35, 0, Math.PI * 2);
      ctx.fill();
    }

    // ------------------------------------------------------------------------
    // LAYER 1B (0.18x & 0.28x): Distant Hualien Mountain Ridges (Slow Parallax!)
    // ------------------------------------------------------------------------
    const mtnFarCol = stage.key === 'starfish'
      ? 'rgba(108, 168, 224, 0.58)'
      : (stage.key === 'aqiang' ? 'rgba(124, 45, 18, 0.48)' : 'rgba(49, 46, 129, 0.55)');
    const mtnMidCol = stage.key === 'starfish'
      ? 'rgba(72, 138, 178, 0.65)'
      : (stage.key === 'aqiang' ? 'rgba(92, 28, 22, 0.62)' : 'rgba(30, 27, 75, 0.72)');

    // Far misty mountain peaks (0.18x)
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

    // Closer mountain foothills (0.28x)
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

    // ------------------------------------------------------------------------
    // LAYER 2 (0.42x): Far Campus / City Horizon Silhouette
    // ------------------------------------------------------------------------
    ctx.fillStyle = stage.key === 'starfish' ? 'rgba(56, 108, 148, 0.52)' : theme.farFill;
    const farOff = -(camX * 0.42) % 320;
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
      ctx.fillStyle = stage.key === 'starfish' ? 'rgba(56, 108, 148, 0.52)' : theme.farFill;
    }

    // Soft atmospheric depth haze between distant mountains/skyline and midground campus
    const haze = ctx.createLinearGradient(0, 175, 0, 316);
    haze.addColorStop(0, 'rgba(224, 242, 254, 0)');
    haze.addColorStop(1, stage.key === 'starfish'
      ? 'rgba(224, 242, 254, 0.45)'
      : (stage.key === 'aqiang' ? 'rgba(251, 146, 60, 0.22)' : 'rgba(99, 102, 241, 0.22)'));
    ctx.fillStyle = haze;
    ctx.fillRect(0, 175, CANVAS_W, 141);

    // ------------------------------------------------------------------------
    // LAYER 3 (0.78x - 0.82x): Midground Stitched 海星國小 Street Panorama
    // (or Parallax School Buildings for Stages 2 & 3!)
    // ------------------------------------------------------------------------
    if (starfishBg) {
      const bgW = starfishBg.width || 3120;
      const bgH = 296;
      const maxScroll = Math.max(1, STAGE_W - CANVAS_W);
      const maxBgShift = Math.max(0, bgW - CANVAS_W);
      // Smooth 0.78x-mapped parallax spanning Start (#001 Gate) -> Boss (#011 Silver Dragon)!
      const bgDrawX = -Math.round((camX / maxScroll) * maxBgShift);
      ctx.save();
      ctx.drawImage(starfishBg, bgDrawX, 22, bgW, bgH);
      // Subtle grounded contact shadow along base of panorama so it locks to the 1.0x sidewalk
      const baseShadow = ctx.createLinearGradient(0, 294, 0, 318);
      baseShadow.addColorStop(0, 'rgba(15, 23, 42, 0)');
      baseShadow.addColorStop(1, 'rgba(15, 23, 42, 0.34)');
      ctx.fillStyle = baseShadow;
      ctx.fillRect(0, 294, CANVAS_W, 24);
      ctx.restore();
    } else {
      // Stages 2 & 3 Midground School Buildings with 0.82x Parallax Depth!
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
          ctx.beginPath();
          ctx.moveTo(bx + 28, sy);
          ctx.lineTo(bx + 112, sy);
          ctx.stroke();
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
        ctx.moveTo(bx + 187, 224);
        ctx.lineTo(bx + 187, 294);
        ctx.moveTo(bx + 138, 259);
        ctx.lineTo(bx + 236, 259);
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
          ctx.beginPath();
          ctx.arc(clkX, clkY, 15, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = '#334155';
          ctx.lineWidth = 2.5;
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(clkX, clkY);
          ctx.lineTo(clkX, clkY - 9);
          ctx.moveTo(clkX, clkY);
          ctx.lineTo(clkX + 7, clkY + 2);
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

    // Glowing Landmark Banners (aligned with world zones; compact pill style over real Haixing BG)
    for (const s of signs) {
      if (s.x + s.w < camX - 60 || s.x > camX + CANVAS_W + 60) continue;
      ctx.save();
      const sy = starfishBg ? Math.max(82, s.y - 36) : s.y;
      ctx.fillStyle = starfishBg ? 'rgba(15, 23, 42, 0.80)' : theme.signBg;
      ctx.strokeStyle = s.color;
      ctx.lineWidth = 2.5;
      ctx.shadowColor = s.color;
      ctx.shadowBlur = stage.key === 'starfish' ? 8 : 15;
      ctx.beginPath();
      ctx.roundRect(s.x, sy, s.w, s.h - 4, 8);
      ctx.fill();
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#ffffff';
      ctx.font = '800 17px "Noto Sans TC", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(s.text, s.x + s.w / 2, sy + (s.h - 4) / 2 + 1);
      ctx.restore();
    }

    // Campus Sidewalk with Dynamic 2.5D Perspective Tile Slant (y = 310..347)
    const walkGrad = ctx.createLinearGradient(0, 310, 0, 340);
    if (starfishBg) {
      walkGrad.addColorStop(0, '#cbd5e1');
      walkGrad.addColorStop(1, '#94a3b8');
    } else {
      walkGrad.addColorStop(0, theme.sidewalk);
      walkGrad.addColorStop(1, theme.curb);
    }
    ctx.fillStyle = walkGrad;
    ctx.fillRect(0, 310, STAGE_W, 28);
    ctx.strokeStyle = 'rgba(15, 23, 42, 0.28)';
    ctx.lineWidth = 2;
    const screenCenterWorldX = camX + CANVAS_W * 0.5;
    for (let sx = 0; sx < STAGE_W; sx += 76) {
      if (sx < camX - 90 || sx > camX + CANVAS_W + 90) continue;
      // True 1-point perspective slant pointing toward horizon center!
      const slant = Math.max(-36, Math.min(36, (sx - screenCenterWorldX) * 0.085));
      ctx.beginPath();
      ctx.moveTo(sx, 310);
      ctx.lineTo(sx + slant, 338);
      ctx.stroke();
    }
    ctx.fillStyle = starfishBg ? '#64748b' : theme.curb;
    ctx.fillRect(0, 338, STAGE_W, 9);

    // Roadside Lamps (skip procedural dark poles on real Haixing street so the iconic gate & blue skybridge stay unobstructed!)
    if (!starfishBg) {
      for (let lx = 260; lx < STAGE_W; lx += 460) {
        if (lx < camX - 140 || lx > camX + CANVAS_W + 140) continue;
        ctx.fillStyle = '#1e293b';
        ctx.fillRect(lx - 4, 152, 8, 166);
        ctx.fillRect(lx - 4, 152, 30, 6);
        ctx.fillStyle = '#fef08a';
        ctx.beginPath();
        ctx.arc(lx + 24, 162, 7.5, 0, Math.PI * 2);
        ctx.fill();

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
    if (starfishBg) {
      // Sunlit Hualien campus street asphalt matching the real Haixing photos!
      road.addColorStop(0, '#5b6577');
      road.addColorStop(0.55, '#475162');
      road.addColorStop(1, '#333b4a');
    } else {
      road.addColorStop(0, theme.road[0]);
      road.addColorStop(0.55, theme.road[1]);
      road.addColorStop(1, theme.road[2]);
    }
    ctx.fillStyle = road;
    ctx.fillRect(0, 347, STAGE_W, CANVAS_H - 347);

    // Subtle 1-point perspective road expansion lines for crisp depth sensation
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.07)';
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

    // Ground sunlight pools / reflections
    for (let px = 310; px < STAGE_W; px += 520) {
      if (px < camX - 140 || px > camX + CANVAS_W + 140) continue;
      ctx.fillStyle = starfishBg ? 'rgba(254, 249, 195, 0.08)' : theme.puddleA;
      ctx.beginPath();
      ctx.ellipse(px, 430, 74, 14, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = starfishBg ? 'rgba(125, 211, 252, 0.07)' : theme.puddleB;
      ctx.beginPath();
      ctx.ellipse(px + 20, 432, 38, 7, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    // Street / Track Lane Markings
    if (starfishBg) {
      // Crisp white roadside edge line + warm yellow center dashes (real Taiwanese campus street!)
      ctx.fillStyle = 'rgba(255, 255, 255, 0.58)';
      ctx.fillRect(0, 355, STAGE_W, 3);
      ctx.fillStyle = 'rgba(250, 204, 21, 0.72)';
      for (let dx = 30; dx < STAGE_W; dx += 140) {
        ctx.fillRect(dx, 422, 74, 6);
      }
      ctx.fillStyle = 'rgba(255, 255, 255, 0.42)';
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
  // LAYER 5 (1.38x FAST FOREGROUND DEPTH-OF-FIELD / 景深虛化前景層)
  // Scrolls 38% FASTER than the player/camera for vivid 2.5D perspective depth!
  // --------------------------------------------------------------------------
  function drawForegroundParallax(ctx, camX) {
    const stage = getCurrentStage();
    const fgScroll = camX * 1.38;

    ctx.save();
    // 1. Out-of-focus foreground foliage/bush silhouettes sweeping rapidly past the bottom rim
    const bushStep = 560;
    const firstBush = Math.floor((fgScroll - 220) / bushStep) * bushStep;
    const bushMain = stage.key === 'starfish'
      ? 'rgba(12, 46, 28, 0.72)'
      : (stage.key === 'aqiang' ? 'rgba(38, 14, 14, 0.72)' : 'rgba(18, 16, 46, 0.74)');
    const bushEdge = stage.key === 'starfish'
      ? 'rgba(34, 128, 72, 0.30)'
      : (stage.key === 'aqiang' ? 'rgba(234, 88, 12, 0.24)' : 'rgba(147, 197, 253, 0.26)');

    for (let bx = firstBush; bx < fgScroll + CANVAS_W + 260; bx += bushStep) {
      const sx = bx - fgScroll;
      const variant = Math.abs(Math.round(bx / bushStep)) % 3;
      // Soft outer bokeh halo (mimics shallow camera depth-of-field blur without slow canvas filters!)
      ctx.fillStyle = bushEdge;
      ctx.beginPath();
      ctx.ellipse(sx, CANVAS_H + 10, 96 + variant * 16, 42 + variant * 6, 0, Math.PI, Math.PI * 2);
      ctx.ellipse(sx + 62, CANVAS_H + 12, 68, 34, 0, Math.PI, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = bushMain;
      ctx.beginPath();
      ctx.ellipse(sx, CANVAS_H + 12, 82 + variant * 14, 32 + variant * 5, 0, Math.PI, Math.PI * 2);
      ctx.ellipse(sx + 56, CANVAS_H + 14, 54, 24, 0, Math.PI, Math.PI * 2);
      ctx.fill();

      // Occasional blurred roadside palm frond overhang at top edge (1.38x speed!)
      if (variant === 0) {
        const tx = sx + 180;
        ctx.fillStyle = bushEdge;
        ctx.beginPath();
        ctx.ellipse(tx, -6, 108, 28, 0.14, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = bushMain;
        ctx.beginPath();
        ctx.ellipse(tx, -10, 90, 20, 0.14, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // 2. Fast-moving foreground optical bokeh dust / sunlit motes / snow (1.48x speed!)
    const moteCol = stage.key === 'starfish'
      ? 'rgba(254, 249, 195, 0.34)'
      : (stage.key === 'aqiang' ? 'rgba(253, 186, 116, 0.34)' : 'rgba(224, 242, 254, 0.42)');
    ctx.fillStyle = moteCol;
    for (let i = 0; i < 16; i++) {
      const mx = (((i * 193 - camX * 1.48 + game.time * (28 + (i % 4) * 9)) % (CANVAS_W + 120)) + (CANVAS_W + 120)) % (CANVAS_W + 120) - 60;
      const my = 42 + ((i * 73 + Math.sin(game.time * 1.6 + i) * 18) % (CANVAS_H - 70));
      const r = 4.5 + (i % 3) * 3.2;
      ctx.beginPath();
      ctx.arc(mx, my, r, 0, Math.PI * 2);
      ctx.fill();
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
      // Deep arcade backdrop overlay
      const bgGrad = ctx.createLinearGradient(0, 0, 0, CANVAS_H);
      bgGrad.addColorStop(0, 'rgba(10, 6, 22, 0.84)');
      bgGrad.addColorStop(0.55, 'rgba(18, 11, 36, 0.76)');
      bgGrad.addColorStop(1, 'rgba(10, 6, 22, 0.88)');
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

      // Top Arcade Title Header
      ctx.textAlign = 'center';
      ctx.lineWidth = 7;
      ctx.strokeStyle = '#090710';
      ctx.font = '900 35px "Noto Sans TC", sans-serif';
      ctx.strokeText('海星國小 大亂鬥 · 選擇出戰主角', CANVAS_W / 2, 46);
      const tGrad = ctx.createLinearGradient(0, 14, 0, 52);
      tGrad.addColorStop(0, '#ffffff');
      tGrad.addColorStop(0.55, '#fde047');
      tGrad.addColorStop(1, '#f43f8e');
      ctx.fillStyle = tGrad;
      ctx.fillText('海星國小 大亂鬥 · 選擇出戰主角', CANVAS_W / 2, 46);

      ctx.font = '700 12.5px "Noto Sans TC", sans-serif';
      ctx.fillStyle = '#cbd5e1';
      ctx.fillText('SELECT YOUR FIGHTER & SCHOOL  ·  ←/→ 切換主角（呆呆伶 / 超級帆）｜ ↑/↓ 或點擊選擇三大關卡！', CANVAS_W / 2, 72);

      // Draw 2 Interactive Hero Cards!
      for (let i = 0; i < HERO_ROSTER.length; i++) {
        const hero = HERO_ROSTER[i];
        const card = SELECT_UI.cards[i];
        const isSelected = game.selectedHeroId === hero.id;
        const isHovered = game.hoverHeroId === hero.id;

        ctx.save();
        // Card Background with radial hero spotlight
        const cardGrad = ctx.createLinearGradient(card.x, card.y, card.x, card.y + card.h);
        if (isSelected) {
          cardGrad.addColorStop(0, hero.id === 'redpanda' ? 'rgba(154, 52, 18, 0.78)' : 'rgba(131, 24, 67, 0.78)');
          cardGrad.addColorStop(1, 'rgba(15, 11, 28, 0.94)');
        } else {
          cardGrad.addColorStop(0, isHovered ? 'rgba(42, 30, 68, 0.85)' : 'rgba(22, 17, 40, 0.78)');
          cardGrad.addColorStop(1, 'rgba(12, 9, 24, 0.90)');
        }
        ctx.fillStyle = cardGrad;
        ctx.beginPath();
        ctx.roundRect(card.x, card.y, card.w, card.h, 16);
        ctx.fill();

        // Animated glowing border for selected hero
        if (isSelected) {
          ctx.shadowColor = hero.accent;
          ctx.shadowBlur = 18 + Math.sin(game.time * 7) * 6;
          ctx.strokeStyle = hero.accentLight;
          ctx.lineWidth = 4;
        } else {
          ctx.strokeStyle = isHovered ? 'rgba(255,255,255,0.45)' : 'rgba(255,255,255,0.16)';
          ctx.lineWidth = 2;
        }
        ctx.stroke();
        ctx.shadowBlur = 0;

        // Top-Left Hero Tag Pill
        ctx.fillStyle = isSelected ? hero.accent : 'rgba(255,255,255,0.12)';
        ctx.beginPath();
        ctx.roundRect(card.x + 14, card.y + 12, 128, 25, 8);
        ctx.fill();
        ctx.textAlign = 'center';
        ctx.fillStyle = '#ffffff';
        ctx.font = '800 12px "Noto Sans TC", sans-serif';
        ctx.fillText(hero.badge, card.x + 78, card.y + 29);

        // Top-Right "P1 SELECTED" Bouncing Badge
        if (isSelected) {
          const bounce = Math.sin(game.time * 9) * 3;
          ctx.fillStyle = '#facc15';
          ctx.strokeStyle = '#090710';
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.roundRect(card.x + card.w - 118, card.y + 10 + bounce, 104, 26, 8);
          ctx.fill();
          ctx.stroke();
          ctx.fillStyle = '#090710';
          ctx.font = '900 12px "Noto Sans TC", sans-serif';
          ctx.fillText('★ P1 選擇中', card.x + card.w - 66, card.y + 27 + bounce);
        } else {
          ctx.textAlign = 'right';
          ctx.fillStyle = 'rgba(203,213,225,0.55)';
          ctx.font = '700 11px monospace';
          ctx.fillText(`KEY [${i + 1}]`, card.x + card.w - 16, card.y + 29);
        }

        // Spotlight stage circle under live hero sprite
        const stageX = card.x + 114;
        const stageY = card.y + 206;
        const spot = ctx.createRadialGradient(stageX, stageY - 56, 12, stageX, stageY - 56, 92);
        spot.addColorStop(0, isSelected ? (hero.id === 'redpanda' ? 'rgba(251, 146, 60, 0.36)' : 'rgba(244, 114, 182, 0.36)') : 'rgba(148, 163, 184, 0.12)');
        spot.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.fillStyle = spot;
        ctx.beginPath();
        ctx.arc(stageX, stageY - 56, 92, 0, Math.PI * 2);
        ctx.fill();

        // Ground shadow ellipse
        ctx.fillStyle = 'rgba(5, 3, 12, 0.55)';
        ctx.beginPath();
        ctx.ellipse(stageX, stageY + 2, 54, 12, 0, 0, Math.PI * 2);
        ctx.fill();

        // Live Animated Hero Preview
        let demoKey = hero.sheets.idle;
        let demoFps = 8.5;
        if (isSelected) {
          const cycle = Math.floor(game.time / 2.2) % 2;
          demoKey = cycle === 0 ? hero.sheets.lightAttack : hero.sheets.run;
          demoFps = 15;
        }
        const demoSheet = SpriteBank.sheets[demoKey] || SpriteBank.sheets[hero.sheets.idle];
        if (demoSheet) {
          const fIdx = Math.floor(game.time * demoFps) % demoSheet.frameCount;
          SpriteBank.drawFrame(ctx, demoKey, fIdx, stageX, stageY, 1, isSelected ? 0.9 : 0.82, false);
        }

        // Right Column: Hero Name, Style & 3 Stat Bars
        const infoX = card.x + 216;
        ctx.textAlign = 'left';
        ctx.lineWidth = 4;
        ctx.strokeStyle = '#090710';
        ctx.font = '900 28px "Noto Sans TC", sans-serif';
        ctx.strokeText(hero.name, infoX, card.y + 82);
        ctx.fillStyle = isSelected ? '#ffffff' : '#e2e8f0';
        ctx.fillText(hero.name, infoX, card.y + 82);

        ctx.font = '700 12px "Noto Sans TC", sans-serif';
        ctx.fillStyle = hero.accentLight;
        ctx.fillText(`必殺技：${hero.specialShout.replace(/!/g, '')}`, infoX, card.y + 108);

        const statRows = [
          { label: '力量 POW', val: hero.stats.power, color: '#f97316' },
          { label: '速度 SPD', val: hero.stats.speed, color: '#38bdf8' },
          { label: '範圍 RNG', val: hero.stats.range, color: '#e879f9' },
        ];
        for (let s = 0; s < statRows.length; s++) {
          const sy = card.y + 136 + s * 27;
          ctx.fillStyle = '#cbd5e1';
          ctx.font = '700 11px monospace';
          ctx.fillText(statRows[s].label, infoX, sy);
          for (let b = 0; b < 5; b++) {
            const bx = infoX + 70 + b * 24;
            ctx.fillStyle = b < statRows[s].val ? statRows[s].color : 'rgba(255,255,255,0.12)';
            ctx.beginPath();
            ctx.roundRect(bx, sy - 10, 19, 11, 3);
            ctx.fill();
          }
        }

        // Bottom Moves Strip inside Card
        ctx.fillStyle = 'rgba(8, 5, 18, 0.65)';
        ctx.beginPath();
        ctx.roundRect(card.x + 14, card.y + card.h - 42, card.w - 28, 30, 8);
        ctx.fill();
        ctx.textAlign = 'center';
        ctx.fillStyle = '#f1f5f9';
        ctx.font = '600 12px "Noto Sans TC", sans-serif';
        ctx.fillText(hero.subtitle, card.x + card.w / 2, card.y + card.h - 23);

        ctx.restore();
      }

      // 3 Clickable School Stage Selector Pills (海星國小 / 阿強國小 / 冬花國小)
      for (let s = 0; s < STAGES.length; s++) {
        const st = STAGES[s];
        const pill = SELECT_UI.stagePills[s];
        const active = game.selectedStageIndex === s;
        ctx.save();
        ctx.fillStyle = active ? 'rgba(30, 22, 54, 0.96)' : 'rgba(15, 11, 30, 0.72)';
        ctx.strokeStyle = active ? st.accent : 'rgba(255,255,255,0.18)';
        ctx.lineWidth = active ? 2.5 : 1.5;
        if (active) {
          ctx.shadowColor = st.accent;
          ctx.shadowBlur = 10;
        }
        ctx.beginPath();
        ctx.roundRect(pill.x, pill.y, pill.w, pill.h, 9);
        ctx.fill();
        ctx.stroke();
        ctx.shadowBlur = 0;
        ctx.textAlign = 'center';
        ctx.fillStyle = active ? '#ffffff' : '#94a3b8';
        ctx.font = active ? '800 12.5px "Noto Sans TC", sans-serif' : '600 11.5px "Noto Sans TC", sans-serif';
        const pillTag = st.key === 'starfish' ? '海洋' : (st.key === 'aqiang' ? '隨機' : '草原');
        ctx.fillText(`${st.icon} ${st.shortName} · ${pillTag}`, pill.x + pill.w / 2, pill.y + 21);
        ctx.restore();
      }

      // Pulsing Start Button at Bottom Center
      const selHero = getSelectedHero();
      const selStage = STAGES[game.selectedStageIndex] || STAGES[0];
      const sb = SELECT_UI.startBtn;
      const pulse = 0.88 + Math.sin(game.time * 6) * 0.12;
      ctx.globalAlpha = pulse;
      const btnGrad = ctx.createLinearGradient(sb.x, sb.y, sb.x + sb.w, sb.y);
      btnGrad.addColorStop(0, selHero.accent);
      btnGrad.addColorStop(1, selHero.id === 'redpanda' ? '#ef4444' : '#9333ea');
      ctx.fillStyle = btnGrad;
      ctx.beginPath();
      ctx.roundRect(sb.x, sb.y, sb.w, sb.h, 12);
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'center';
      ctx.font = '900 19px "Noto Sans TC", sans-serif';
      ctx.fillText(`▶ 以「${selHero.name}」進軍${selStage.shortName}（ENTER）`, CANVAS_W / 2, sb.y + 31);

      // Controls Footer Hint
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#94a3b8';
      ctx.font = '600 11.5px "Noto Sans TC", sans-serif';
      const lk = formatKeyCode(StudioState.getAction('lightAttack')?.key);
      const hk = formatKeyCode(StudioState.getAction('heavyAttack')?.key);
      const sk = formatKeyCode(StudioState.getAction('special')?.key);
      const dk = formatKeyCode(StudioState.getAction('dash')?.key);
      ctx.fillText(`WASD走路 ｜ AA/DD跑步 ｜ ↓↑龍捲旋風腳(浮空追打) ｜ ${dk}閃身步 ｜ ${lk}輕攻 ｜ ${hk}重攻 ｜ ${sk}必殺技`, CANVAS_W / 2, 492);
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

  function advanceToNextStage() {
    sfx.init();
    try { window.focus(); canvas.focus(); } catch (_) {}
    if (game.stageIndex + 1 < STAGES.length) {
      game.stageIndex++;
      game.selectedStageIndex = game.stageIndex;
      setupStageEnvironment(true);
    } else {
      game.state = 'victory';
      updateStatusBar();
    }
  }

  function updateStatusBar() {
    if (!statusReadout) return;
    const st = getCurrentStage();
    const zones = getCurrentZones();
    if (game.state === 'playing') {
      const z = zones[Math.min(game.zoneIndex, zones.length - 1)];
      const alive = game.enemies.filter((e) => !e.dead).length + game.pendingSpawns.length;
      statusReadout.textContent = `STAGE ${st.id}/3 · ${z.name} · 剩餘敵人 ${alive}`;
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
            if (game.stageIndex + 1 < STAGES.length) {
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
      for (const pr of game.props) if (!pr.broken) drawList.push({ z: pr.z, draw: () => pr.draw(ctx) });
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
      <span class="key-item special"><kbd>↓</kbd><kbd>↑</kbd> 龍捲旋風腳</span>
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

  function renderGearStudio() {
    const tabsEl = document.getElementById('charTabs');
    const container = document.getElementById('spriteSlots');
    if (!container) return;

    // 1. Character Selector Tabs
    if (tabsEl) {
      tabsEl.innerHTML = '';
      for (const ch of StudioState.characters) {
        const tb = document.createElement('button');
        tb.className = `char-tab ${ch.id === StudioState.activeCharId ? 'active' : ''}`;
        tb.textContent = ch.name;
        tb.addEventListener('click', () => {
          StudioState.activeCharId = ch.id;
          StudioState.rebindingActionId = null;
          renderGearStudio();
        });
        tabsEl.appendChild(tb);
      }
      const addCharBtn = document.createElement('button');
      addCharBtn.className = 'char-tab';
      addCharBtn.textContent = '＋ 新增角色槽';
      addCharBtn.addEventListener('click', () => {
        const idx = StudioState.characters.length + 1;
        const id = `char_${Date.now()}`;
        StudioState.characters.push({
          id,
          name: `👤 自訂角色 ${idx}`,
          actions: [
            { id: `${id}_idle`, label: '待機動畫 (Idle)', triggerDesc: '靜止循環', sheetKey: `${id}_idle`, fallbackSheet: null, fps: 8, cols: 5, rows: 2, key: null, altKeys: [], rebindable: false },
            { id: `${id}_run`, label: '移動／跑步 (Run)', triggerDesc: '移動循環', sheetKey: `${id}_run`, fallbackSheet: null, fps: 14, cols: 5, rows: 2, key: null, altKeys: [], rebindable: false },
            { id: `${id}_atk`, label: '攻擊動作 (Attack)', triggerDesc: '攻擊序列', sheetKey: `${id}_atk`, fallbackSheet: null, fps: 16, cols: 5, rows: 2, key: null, altKeys: [], rebindable: false },
          ],
        });
        StudioState.activeCharId = id;
        StudioState.save();
        renderGearStudio();
      });
      tabsEl.appendChild(addCharBtn);
    }

    // 2. Action Cards for Active Character
    container.innerHTML = '';
    studioPreviewItems.length = 0;

    const activeChar = StudioState.getActiveChar();

    for (const act of activeChar.actions) {
      const ownSheet = SpriteBank.sheets[act.sheetKey];
      const fallbackSheet = act.fallbackSheet ? SpriteBank.sheets[act.fallbackSheet] : null;
      const effectiveSheetKey = ownSheet ? act.sheetKey : (fallbackSheet ? act.fallbackSheet : null);
      const effectiveSheet = ownSheet || fallbackSheet;

      if (!StudioState.previewStates[act.id]) {
        StudioState.previewStates[act.id] = { playing: true, frame: 0 };
      }
      const pState = StudioState.previewStates[act.id];

      const card = document.createElement('div');
      card.className = `slot-card ${ownSheet ? 'loaded' : ''}`;

      // Card Header
      const statusClass = ownSheet ? 'ready' : (fallbackSheet ? 'fallback' : 'empty');
      const statusText = ownSheet
        ? `已載入 ${ownSheet.frameCount}幀`
        : (fallbackSheet ? '沿用備用表（可獨立上傳）' : '尚未上傳');

      const head = document.createElement('div');
      head.className = 'slot-head';
      head.innerHTML = `<span>${act.label}</span><span class="slot-status ${statusClass}">${statusText}</span>`;

      const sub = document.createElement('div');
      sub.className = 'slot-sub';
      sub.textContent = act.triggerDesc || '';

      // Live Multi-Frame Preview Canvas (300x264 unclipped!)
      const prevWrap = document.createElement('div');
      prevWrap.className = 'slot-preview';
      const pCanvas = document.createElement('canvas');
      pCanvas.width = 300;
      pCanvas.height = 264;
      const frameBadge = document.createElement('span');
      frameBadge.className = 'frame-badge';
      frameBadge.textContent = effectiveSheet ? `1 / ${effectiveSheet.frameCount}` : '0 / 0';
      prevWrap.appendChild(pCanvas);
      prevWrap.appendChild(frameBadge);

      studioPreviewItems.push({
        act,
        sheetKey: effectiveSheetKey,
        canvas: pCanvas,
        badge: frameBadge,
        pState,
      });

      // Play/Pause, Frame Stepper, & Keybind Row
      const animCtrl = document.createElement('div');
      animCtrl.className = 'anim-controls';

      const stepGroup = document.createElement('div');
      stepGroup.style.display = 'flex';
      stepGroup.style.gap = '4px';

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
      animCtrl.appendChild(stepGroup);

      // Rebindable Key Button (or trigger pill)
      if (act.rebindable) {
        const isListening = StudioState.rebindingActionId === act.id;
        const keyBtn = document.createElement('button');
        keyBtn.className = `keybind-btn ${isListening ? 'listening' : ''}`;
        keyBtn.textContent = isListening ? '請按下新按鍵...' : `按鍵：${formatKeyCode(act.key)}`;
        keyBtn.title = '點擊後按下鍵盤任意鍵即可修改此動作按鍵';
        keyBtn.addEventListener('click', () => {
          StudioState.rebindingActionId = isListening ? null : act.id;
          renderGearStudio();
        });
        animCtrl.appendChild(keyBtn);
      } else {
        const tag = document.createElement('span');
        tag.style.fontSize = '11px';
        tag.style.opacity = '0.85';
        tag.textContent = act.id === 'dashLightAttack'
          ? `觸發：跑步+${formatKeyCode(StudioState.getAction('lightAttack')?.key)}`
          : (act.id === 'dashAttack'
            ? `觸發：跑步+${formatKeyCode(StudioState.getAction('heavyAttack')?.key)}`
            : (act.id === 'tornadoKick' || act.id === 'rp_tornadoKick'
              ? '觸發：快速 ↓ → ↑'
              : (act.id === 'victory' || act.id === 'rp_victory'
                ? '觸發：戰鬥勝利結算'
                : (act.id === 'run' || act.id === 'rp_run'
                  ? '觸發：連按 AA / DD'
                  : (act.id === 'walk' || act.id === 'rp_walk' ? '觸發：WASD' : '自動觸發')))));
        animCtrl.appendChild(tag);
      }

      // Live FPS Slider (4 ~ 40 FPS)
      const fpsRow = document.createElement('div');
      fpsRow.className = 'fps-row';
      const fpsLabel = document.createElement('span');
      fpsLabel.textContent = `速度 ${act.fps} FPS`;
      const fpsRange = document.createElement('input');
      fpsRange.type = 'range';
      fpsRange.min = '4';
      fpsRange.max = '40';
      fpsRange.step = '0.5';
      fpsRange.value = String(act.fps);
      fpsRange.addEventListener('input', () => {
        act.fps = parseFloat(fpsRange.value);
        fpsLabel.textContent = `速度 ${act.fps} FPS`;
        StudioState.save();
      });
      fpsRow.appendChild(fpsLabel);
      fpsRow.appendChild(fpsRange);

      // Unlimited Frame Grid (Cols × Rows + Exact FrameCount, not limited to 10 frames!)
      const actionsRow = document.createElement('div');
      actionsRow.className = 'slot-actions';
      actionsRow.style.flexWrap = 'wrap';
      actionsRow.style.rowGap = '6px';

      const gridWrap = document.createElement('div');
      gridWrap.className = 'grid-inputs';
      gridWrap.innerHTML = '<span>格</span>';
      const inCols = document.createElement('input');
      inCols.type = 'number';
      inCols.min = '1';
      inCols.max = '32';
      inCols.value = String(act.cols || (ownSheet ? ownSheet.cols : 5));
      inCols.title = '欄數 (Cols，最多 32)';
      const inRows = document.createElement('input');
      inRows.type = 'number';
      inRows.min = '1';
      inRows.max = '16';
      inRows.value = String(act.rows || (ownSheet ? ownSheet.rows : 2));
      inRows.title = '列數 (Rows，最多 16)';
      const inFrames = document.createElement('input');
      inFrames.type = 'number';
      inFrames.min = '1';
      inFrames.max = '512';
      const curFc = act.frameCount || (ownSheet ? ownSheet.frameCount : (act.cols || 5) * (act.rows || 2));
      inFrames.value = String(curFc);
      inFrames.title = '有效總禎數（支援超過 10 禎，如 12/16/24/30 禎）';
      inFrames.style.width = '40px';

      const syncGridLive = (autoMatchTotal = false) => {
        const cVal = Math.max(1, Math.min(32, parseInt(inCols.value, 10) || 5));
        const rVal = Math.max(1, Math.min(16, parseInt(inRows.value, 10) || 2));
        const maxF = cVal * rVal;
        let fVal = autoMatchTotal ? maxF : Math.max(1, Math.min(maxF, parseInt(inFrames.value, 10) || maxF));
        inCols.value = String(cVal);
        inRows.value = String(rVal);
        inFrames.value = String(fVal);
        act.cols = cVal;
        act.rows = rVal;
        act.frameCount = fVal;
        const sh = SpriteBank.sheets[act.sheetKey];
        if (sh && sh.img) {
          sh.cols = cVal;
          sh.rows = rVal;
          sh.cellW = sh.img.width / cVal;
          sh.cellH = sh.img.height / rVal;
          sh.frameCount = fVal;
          const statusEl = head.querySelector('.slot-status');
          if (statusEl) statusEl.textContent = `已載入 ${fVal}幀`;
        }
        StudioState.save();
      };

      inCols.addEventListener('change', () => syncGridLive(true));
      inRows.addEventListener('change', () => syncGridLive(true));
      inFrames.addEventListener('change', () => syncGridLive(false));

      gridWrap.appendChild(inCols);
      gridWrap.appendChild(document.createTextNode('×'));
      gridWrap.appendChild(inRows);
      gridWrap.appendChild(document.createTextNode(' 禎'));
      gridWrap.appendChild(inFrames);

      // Import (PNG/WebP/JPG or .anim.json) + Export (PNG & JSON) buttons
      const rightBtns = document.createElement('div');
      rightBtns.style.display = 'flex';
      rightBtns.style.flexWrap = 'wrap';
      rightBtns.style.gap = '4px';

      const triggerDownload = (href, filename) => {
        const a = document.createElement('a');
        a.href = href;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
      };

      const safeBase = `${activeChar.id}_${act.id}`;

      const btnExpPng = document.createElement('button');
      btnExpPng.className = 'mini-btn';
      btnExpPng.textContent = '💾 匯出PNG';
      btnExpPng.title = '匯出此動作的透明精靈表 PNG 檔';
      btnExpPng.disabled = !effectiveSheet;
      btnExpPng.addEventListener('click', () => {
        if (!effectiveSheet) return;
        const url = SpriteBank.exportSheetToDataUrl(effectiveSheet);
        if (url) triggerDownload(url, `${safeBase}_${effectiveSheet.cols}x${effectiveSheet.rows}_${effectiveSheet.frameCount}f.png`);
      });

      const btnExpJson = document.createElement('button');
      btnExpJson.className = 'mini-btn';
      btnExpJson.textContent = '📦 匯出JSON';
      btnExpJson.title = '匯出完整動作檔（含精靈圖、欄列數、總禎數、FPS）';
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

      const uploadLabel = document.createElement('label');
      uploadLabel.className = 'upload-label';
      uploadLabel.textContent = '📥 匯入';
      uploadLabel.title = '匯入 PNG / WebP / JPG 精靈表，或匯入 .anim.json 動作檔（支援超過 10 禎）';
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
              img.onload = () => {
                const cVal = Math.max(1, Math.min(32, parseInt(pkg.cols, 10) || 5));
                const rVal = Math.max(1, Math.min(16, parseInt(pkg.rows, 10) || 2));
                const fVal = Math.max(1, Math.min(cVal * rVal, parseInt(pkg.frameCount, 10) || (cVal * rVal)));
                SpriteBank.sheets[act.sheetKey] = SpriteBank.createExactSheet(
                  img, cVal, rVal, fVal,
                  typeof pkg.anchorX === 'number' ? pkg.anchorX : 136,
                  typeof pkg.anchorY === 'number' ? pkg.anchorY : 242
                );
                act.cols = cVal;
                act.rows = rVal;
                act.frameCount = fVal;
                if (typeof pkg.fps === 'number' && pkg.fps >= 4 && pkg.fps <= 40) act.fps = pkg.fps;
                if (act.sheetKey === 'idle' || act.sheetKey === 'rp_idle') SpriteBank.buildPortrait();
                StudioState.save();
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
            const rVal = Math.max(1, Math.min(16, parseInt(inRows.value, 10) || 2));
            const maxF = cVal * rVal;
            const fVal = Math.max(1, Math.min(maxF, parseInt(inFrames.value, 10) || maxF));
            const img = new Image();
            img.onload = () => {
              SpriteBank.sheets[act.sheetKey] = SpriteBank.processUploadedSheet(img, cVal, rVal, fVal);
              act.cols = cVal;
              act.rows = rVal;
              act.frameCount = fVal;
              if (act.sheetKey === 'idle' || act.sheetKey === 'rp_idle') SpriteBank.buildPortrait();
              StudioState.save();
              renderGearStudio();
            };
            img.src = reader.result;
          };
          reader.readAsDataURL(file);
        }
      });
      uploadLabel.appendChild(fileInput);

      rightBtns.appendChild(uploadLabel);
      rightBtns.appendChild(btnExpPng);
      rightBtns.appendChild(btnExpJson);

      if (act.custom) {
        const delBtn = document.createElement('button');
        delBtn.className = 'mini-btn';
        delBtn.textContent = '🗑';
        delBtn.title = '刪除此自訂動作';
        delBtn.addEventListener('click', () => {
          activeChar.actions = activeChar.actions.filter((a) => a.id !== act.id);
          StudioState.save();
          renderGearStudio();
        });
        rightBtns.appendChild(delBtn);
      }

      actionsRow.appendChild(gridWrap);
      actionsRow.appendChild(rightBtns);

      card.appendChild(head);
      card.appendChild(sub);
      card.appendChild(prevWrap);
      card.appendChild(animCtrl);
      card.appendChild(fpsRow);
      card.appendChild(actionsRow);
      container.appendChild(card);
    }
  }

  function animateGearStudioPreviews(dt) {
    const studio = document.getElementById('gearStudio');
    if (!studio || !studio.classList.contains('open')) return;
    for (const item of studioPreviewItems) {
      const pctx = item.canvas.getContext('2d');
      pctx.clearRect(0, 0, 300, 264);
      const sheet = item.sheetKey ? SpriteBank.sheets[item.sheetKey] : null;
      if (sheet) {
        if (item.pState.playing) {
          item.pState.frame = (item.pState.frame + dt * item.act.fps) % sheet.frameCount;
        }
        const fIdx = Math.floor(item.pState.frame) % sheet.frameCount;
        SpriteBank.drawFrame(pctx, item.sheetKey, fIdx, sheet.anchorX, sheet.anchorY, 1, 1.0, false);
        item.badge.textContent = `Frame ${fIdx + 1} / ${sheet.frameCount}`;
      } else {
        pctx.fillStyle = '#64748b';
        pctx.font = '600 18px "Noto Sans TC", sans-serif';
        pctx.textAlign = 'center';
        pctx.fillText('請點擊下方「上傳精靈表」', 150, 136);
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
    { id: 'heavyAttack', label: '重攻擊 (Heavy)', desc: '強力重擊 / 跑步中發動衝刺重擊' },
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

      // Fast Down -> Up (↓↑) on Gamepad D-Pad or Stick triggers 龍捲旋風腳 during gameplay!
      if (game.state === 'playing') {
        if (vertEdgeDown) {
          lastDownTapTime = performance.now();
        } else if (vertEdgeUp && lastDownTapTime > 0 && performance.now() - lastDownTapTime < 380) {
          tornadoKickTrigger = true;
          lastDownTapTime = 0;
        }
      }

      // 3. Action Edge Triggers
      const actionIds = ['lightAttack', 'heavyAttack', 'special', 'jump', 'dash', 'pause'];
      for (const id of actionIds) {
        if (isEdge(this.bindings[id])) {
          this.actionJustPressed[id] = true;
          sfx.init();
        }
      }

      // 4. Screen Navigation (Title Character/Stage Select / StageClear / Pause / GameOver)
      if (game.state === 'title') {
        if (horizEdgeLeft && game.selectedHeroId !== HERO_ROSTER[0].id) {
          game.selectedHeroId = HERO_ROSTER[0].id;
          sfx.init();
          sfx.playPickup('coin');
        } else if (horizEdgeRight && game.selectedHeroId !== HERO_ROSTER[1].id) {
          game.selectedHeroId = HERO_ROSTER[1].id;
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

      card.appendChild(meta);
      card.appendChild(btn);
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
