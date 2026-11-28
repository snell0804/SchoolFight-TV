// game_catalog.js
// Complete catalog of all built-in SchoolFight-TV characters, animations, backgrounds, and items
// so the asset editor (editor.html) can browse, preview, and override every built-in asset.

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GameCatalog = api;
})(typeof self !== 'undefined' ? self : this, function () {
  function act(id, label, sheetKey, file, fps = 12, trigger = 'on_attack', loop = false) {
    return {
      id, label, sheetKey, png: file, webp: file,
      cols: 5, rows: 2, frames: 10, fps, loop, trigger, condition: '', priority: 0, builtin: true,
    };
  }

  function enemyChar(id, name, prefix, hasHurt = true, opts = {}) {
    const filePrefix = opts.fallbackPrefix || prefix;
    const actions = [
      act(`${prefix}_move`, '移動動畫 (Move)', `${prefix}_move`, `assets/${filePrefix}_move_sheet.webp`, 12, 'on_move', true),
      act(`${prefix}_attack`, '攻擊動畫 (Attack)', `${prefix}_attack`, `assets/${filePrefix}_attack_sheet.webp`, 14, 'on_attack', false),
    ];
    if (hasHurt) {
      actions.push(act(`${prefix}_hurt`, '受傷動畫 (Hurt)', `${prefix}_hurt`, `assets/${filePrefix}_hurt_sheet.webp`, 14, 'on_hurt', false));
    }
    actions.push(act(`${prefix}_ko`, hasHurt ? '被打敗動畫 (KO)' : '受擊與被打倒 (Hurt / KO)', `${prefix}_ko`, `assets/${filePrefix}_ko_sheet.webp`, 12, 'on_ko', false));
    return { id, name, role: opts.role || 'monster', enemyKey: opts.enemyKey || id, builtin: true, actions };
  }

  const characters = [
    {
      id: 'kuromi', name: '😈 呆呆伶（主角 1）', role: 'hero', builtin: true,
      actions: [
        act('idle', '待機動畫 (Idle)', 'idle', 'assets/idle_sheet.webp', 8.5, 'on_idle', true),
        act('walk', '走路動畫 (Walk)', 'walk', 'assets/walk_sheet.webp', 11, 'on_move', true),
        act('run', '跑步動畫 (Run)', 'run', 'assets/run_sheet.webp', 17, 'on_move', true),
        act('dash', '瞬間衝刺・閃身步 (Dash)', 'dash', 'assets/dash_sheet.webp', 25, 'on_move', false),
        act('lightAttack', '輕攻擊・揮拳連擊 (Light)', 'lightAttack', 'assets/lightAttack_sheet.webp', 17, 'on_attack', false),
        { ...act('heavyAttack', '重攻擊・月牙天沖 (Heavy)', 'attack', 'assets/attack_sheet.webp', 16, 'on_attack', false), cols: 5, rows: 2, frames: 10 },
        act('dashLightAttack', '衝刺輕攻擊・浪子踢球 (Dash Light)', 'dashLightAttack', 'assets/dashLightAttack_sheet.webp', 17, 'on_attack', false),
        act('dashAttack', '衝刺重攻擊・星杖衝刺斬 (Dash Heavy)', 'dashAttack', 'assets/dashAttack_sheet.webp', 18, 'on_attack', false),
        act('tornadoKick', '特殊招式・龍捲旋風腳 (Tornado Kick)', 'tornadoKick', 'assets/tornadoKick_sheet.webp', 15, 'on_attack', false),
        act('special', '能量砲十連發 (Special)', 'special', 'assets/special_sheet.webp', 12, 'on_attack', false),
        act('jump', '跳躍 (Jump)', 'jump', 'assets/run_sheet.webp', 12, 'on_move', false),
        act('hurt', '受傷／受擊 (Hurt)', 'hurt', 'assets/hurt_sheet.webp', 15, 'on_hurt', false),
        act('victory', '戰鬥勝利動作 (Victory)', 'victory', 'assets/victory_sheet.webp', 10, 'custom', true),
      ],
    },
    {
      id: 'redpanda', name: '🦊 超級帆（主角 2）', role: 'hero', builtin: true,
      actions: [
        act('rp_idle', '待機動畫 (Idle)', 'rp_idle', 'assets/rp_idle_sheet.webp', 8.5, 'on_idle', true),
        act('rp_walk', '走路動畫 (Walk)', 'rp_walk', 'assets/rp_walk_sheet.webp', 12, 'on_move', true),
        act('rp_run', '奔跑動畫 (Run)', 'rp_run', 'assets/rp_run_sheet.webp', 17, 'on_move', true),
        act('rp_dash', '瞬間衝刺・蒼藍音爆閃身步 (Dash)', 'rp_dash', 'assets/rp_dash_sheet.webp', 24, 'on_move', false),
        act('rp_lightAttack', '輕攻擊・五連閃電連擊 (Light)', 'rp_lightAttack', 'assets/rp_lightAttack_sheet.webp', 18, 'on_attack', false),
        act('rp_attack', '重攻擊・升龍拳 (Heavy)', 'rp_attack', 'assets/rp_attack_sheet.webp', 16, 'on_attack', false),
        act('rp_dashLightAttack', '衝刺輕攻擊・閃電踢球 (Dash Light)', 'rp_dashLightAttack', 'assets/rp_dashLightAttack_sheet.webp', 17, 'on_attack', false),
        act('rp_dashAttack', '衝刺重攻擊・赤焰衝刺撞擊 (Dash Heavy)', 'rp_dashAttack', 'assets/rp_dashAttack_sheet.webp', 18, 'on_attack', false),
        act('rp_tornadoKick', '特殊招式・烈焰龍捲旋風腳 (Tornado Kick)', 'rp_tornadoKick', 'assets/rp_tornadoKick_sheet.webp', 15, 'on_attack', false),
        act('rp_special', '必殺技・赤焰百拳連擊 (Special)', 'rp_special', 'assets/rp_special_sheet.webp', 14, 'on_attack', false),
        act('rp_hurt', '受傷／受擊 (Hurt)', 'rp_hurt', 'assets/rp_idle_sheet.webp', 14, 'on_hurt', false),
        act('rp_victory', '戰鬥勝利動作 (Victory)', 'rp_victory', 'assets/rp_victory_sheet.webp', 10, 'custom', true),
      ],
    },
    {
      id: 'adailing', name: '🎒 阿呆伶（主角 3）', role: 'hero', builtin: true,
      actions: [
        act('ad_idle', '待機動畫 (Idle)', 'ad_idle', 'assets/ad_idle_sheet.webp', 8.5, 'on_idle', true),
        { ...act('ad_walk', '走路動畫 (Walk)', 'ad_walk', 'assets/ad_walk_sheet.webp', 12, 'on_move', true), cols: 5, rows: 2, frames: 10 },
        { ...act('ad_run', '奔跑動畫 (Run)', 'ad_run', 'assets/ad_run_sheet.webp', 17, 'on_move', true), cols: 5, rows: 2, frames: 10 },
        act('ad_dash', '課間衝刺・疾風步 (Dash)', 'ad_dash', 'assets/ad_dash_sheet.webp', 24, 'on_move', false),
        { ...act('ad_lightAttack', '輕攻擊・海星三連拍 (Light)', 'ad_lightAttack', 'assets/ad_lightAttack_sheet.webp', 17, 'on_attack', false), cols: 5, rows: 2, frames: 10 },
        { ...act('ad_attack', '重攻擊・海星字典泰山壓頂 (Heavy)', 'ad_attack', 'assets/ad_attack_sheet.webp', 15, 'on_attack', false), cols: 5, rows: 2, frames: 10 },
        { ...act('ad_dashLightAttack', '衝刺輕攻擊・飛書砸擊 (Dash Light)', 'ad_dashLightAttack', 'assets/ad_dashLightAttack_sheet.webp', 17, 'on_attack', false), cols: 5, rows: 2, frames: 10 },
        { ...act('ad_dashAttack', '衝刺重攻擊・海星倒掛流星踢 (Dash Heavy)', 'ad_dashAttack', 'assets/ad_dashAttack_sheet.webp', 15, 'on_attack', false), cols: 5, rows: 2, frames: 10 },
        { ...act('ad_tornadoKick', '特殊招式・海星旋風踢 (Tornado Kick)', 'ad_tornadoKick', 'assets/ad_tornadoKick_sheet.webp', 16, 'on_attack', false), cols: 5, rows: 2, frames: 10 },
        { ...act('ad_special', '必殺技・愛心星光波動砲 (Special)', 'ad_special', 'assets/ad_special_sheet.webp', 12, 'on_attack', false), cols: 5, rows: 2, frames: 10 },
        act('ad_hurt', '受傷／受擊 (Hurt)', 'ad_hurt', 'assets/ad_idle_sheet.webp', 15, 'on_hurt', false),
        act('ad_victory', '戰鬥勝利動作 (Victory)', 'ad_victory', 'assets/ad_idle_sheet.webp', 10, 'custom', true),
      ],
    },
    {
      id: 'aqiang_boy', name: '📚 班長小強（主角 4）', role: 'hero', builtin: true,
      actions: [
        act('boy_idle', '待機動畫 (Idle)', 'boy_idle', 'assets/boy_idle_sheet.webp', 8.5, 'on_idle', true),
        act('boy_walk', '行走動畫 (Walk)', 'boy_walk', 'assets/boy_walk_sheet.webp', 12, 'on_move', true),
        act('boy_run', '奔跑動畫 (Run)', 'boy_run', 'assets/boy_run_sheet.webp', 17, 'on_move', true),
        act('boy_dash', '衝刺・疾風滑步 (Dash)', 'boy_dash', 'assets/boy_dash_sheet.webp', 24, 'on_move', false),
        act('boy_lightAttack', '輕攻擊・雙掌太極推 (Light)', 'boy_lightAttack', 'assets/boy_lightAttack_sheet.webp', 17, 'on_attack', false),
        act('boy_attack', '重攻擊・書包大風車橫掃 (Heavy)', 'boy_attack', 'assets/boy_attack_sheet.webp', 16, 'on_attack', false),
        act('boy_dashLightAttack', '衝刺輕攻擊・飛馳穿心掌 (Dash Light)', 'boy_dashLightAttack', 'assets/boy_dashLightAttack_sheet.webp', 17, 'on_attack', false),
        act('boy_dashAttack', '衝刺重攻擊・書包肩撞鐵山靠 (Dash Heavy)', 'boy_dashAttack', 'assets/boy_dashAttack_sheet.webp', 16, 'on_attack', false),
        act('boy_tornadoKick', '特殊技・直尺昇龍旋風斬 (Special Skill)', 'boy_tornadoKick', 'assets/boy_tornadoKick_sheet.webp', 16, 'on_attack', false),
        act('boy_special', '必殺技・黃金課本聖光審判 (Super Special)', 'boy_special', 'assets/boy_special_sheet.webp', 12, 'on_attack', false),
        act('boy_hurt', '受傷硬直 (Hurt)', 'boy_hurt', 'assets/boy_hurt_sheet.webp', 15, 'on_hurt', false),
        act('boy_victory', '戰鬥勝利動作 (Victory)', 'boy_victory', 'assets/boy_victory_sheet.webp', 10, 'custom', true),
      ],
    },
    (() => { const c = enemyChar('enemy_whale_boss', '⚓ 戰艦鯨魚魔王（海星國小 STAGE 1 BOSS）', 'enemy_whale_boss', true, { role: 'boss', enemyKey: 'whale_boss' }); c.actions.forEach((a) => Object.assign(a, { cols: 5, rows: 2, frames: 10 })); return c; })(),
    enemyChar('enemy_donghua_boss', '🥋 冬花武聖大宗師（冬花 FINAL BOSS）', 'enemy_donghua_boss', true, { role: 'boss', enemyKey: 'donghua_boss' }),
    enemyChar('enemy_star_boss', '⭐ 宇宙海星大霸王（關卡 BOSS）', 'enemy_star_boss', false, { role: 'boss', enemyKey: 'boss', fallbackPrefix: 'enemy_star' }),
    enemyChar('enemy_zebra_rush', '🦓 暴衝斑馬怪（5色變色）', 'enemy_zebra_rush', true, { enemyKey: 'zebra_rush' }),
    enemyChar('enemy_joey_kangaroo', '🦘 育兒袋鼠怪（5色變色）', 'enemy_joey_kangaroo', true, { enemyKey: 'joey_kangaroo' }),
    enemyChar('enemy_kangaroo', '🥊 拳擊袋鼠（彈跳拳擊怪）', 'enemy_kangaroo', true, { enemyKey: 'kangaroo' }),
    (() => { const c = enemyChar('enemy_zebra', '🦓 斑斑（旋風飛踢斑馬）', 'enemy_zebra', true, { enemyKey: 'zebra' }); c.actions.forEach((a) => Object.assign(a, { cols: 5, rows: 2, frames: 10 })); return c; })(),
    (() => { const c = enemyChar('enemy_koala', '🐨 無尾熊（尤加利葉撲擊怪）', 'enemy_koala', true, { enemyKey: 'koala' }); c.actions.forEach((a) => Object.assign(a, { cols: 5, rows: 2, frames: 10 })); return c; })(),
    (() => { const c = enemyChar('enemy_capybara', '🍊 佛系水豚君（橘子頭槌坦克）', 'enemy_capybara', true, { enemyKey: 'capybara' }); c.actions.forEach((a) => Object.assign(a, { cols: 5, rows: 2, frames: 10 })); return c; })(),
    enemyChar('enemy_fat_tiger', '🐯 胖虎（飛撲重壓虎貓怪）', 'enemy_fat_tiger', true, { enemyKey: 'fat_tiger' }),
    enemyChar('enemy_cactus', '🌵 針刺仙人掌（條紋針刺怪）', 'enemy_cactus', true, { enemyKey: 'cactus' }),
    (() => {
      const wg = enemyChar('enemy_wizard_ghost', '🧙‍♂️ 星空巫師幽靈（星辰法師怪）', 'enemy_wizard_ghost', true, { enemyKey: 'wizard_ghost' });
      const mv = wg.actions.find((a) => a.id === 'enemy_wizard_ghost_move');
      if (mv) Object.assign(mv, { cols: 5, rows: 4, frames: 20, fps: 16 });
      const atk = wg.actions.find((a) => a.id === 'enemy_wizard_ghost_attack');
      if (atk) Object.assign(atk, { cols: 5, rows: 4, frames: 20, fps: 18 });
      return wg;
    })(),
    enemyChar('enemy_pengking', '👑 王者企鵝（海洋敵人）', 'enemy_pengking', true, { enemyKey: 'penguin_king' }),
    enemyChar('enemy_pengice', '❄️ 冰雪企鵝（海洋敵人）', 'enemy_pengice', true, { enemyKey: 'penguin_ice' }),
    enemyChar('enemy_rabbit', '🐰 兔兔怪（5色共用）', 'enemy_rabbit', true, { enemyKey: 'rabbit' }),
    enemyChar('enemy_ghost', '👻 幽靈怪（5色共用）', 'enemy_ghost', true, { enemyKey: 'ghost' }),
    (() => { const c = enemyChar('enemy_sheep', '🐑 綿羊怪（雲球衝鋒・5色共用）', 'enemy_sheep', true, { enemyKey: 'sheep' }); c.actions.forEach((a) => Object.assign(a, { cols: 5, rows: 2, frames: 10 })); return c; })(),
    (() => { const c = enemyChar('enemy_pig', '🐗 暴怒豬豬怪（雙角衝撞・敵人）', 'enemy_pig', true, { enemyKey: 'pig' }); c.actions.forEach((a) => Object.assign(a, { cols: 5, rows: 2, frames: 10 })); return c; })(),
    {
      id: 'enemy_slime', name: '💧 藍色水滴史萊姆（敵人）', role: 'monster', enemyKey: 'slime', builtin: true,
      actions: [
        act('enemy_slime_idle', '夢幻待機 (Idle)', 'enemy_slime_idle', 'assets/enemy_slime_idle_sheet.webp', 8, 'on_idle', true),
        act('enemy_slime_move', '跳躍奔跑 (Move)', 'enemy_slime_move', 'assets/enemy_slime_move_sheet.webp', 13, 'on_move', true),
        act('enemy_slime_angry', '憤怒反應／蓄力 (Angry)', 'enemy_slime_angry', 'assets/enemy_slime_angry_sheet.webp', 14, 'on_low_hp', false),
        act('enemy_slime_attack', '果凍衝刺撞擊 (Attack)', 'enemy_slime_attack', 'assets/enemy_slime_attack_sheet.webp', 16, 'on_attack', false),
        act('enemy_slime_ko', '受擊與融化倒地 (Hurt / KO)', 'enemy_slime_ko', 'assets/enemy_slime_ko_sheet.webp', 12, 'on_ko', false),
      ],
    },
    enemyChar('enemy_slime_mini', '💧 分裂小史萊姆（衍生小怪）', 'enemy_slime_mini', false, { enemyKey: 'slime_mini', fallbackPrefix: 'enemy_slime' }),
    enemyChar('enemy_mushroom', '🍄 蘑菇怪（敵人）', 'enemy_mushroom', false, { enemyKey: 'mushroom' }),
    enemyChar('enemy_puffer', '🐡 河豚怪（敵人）', 'enemy_puffer', true, { enemyKey: 'puffer' }),
    enemyChar('enemy_star', '⭐ 宇宙海星（一般敵人）', 'enemy_star', false, { enemyKey: 'star' }),
  ];

  const backgrounds = [
    { id: 'bg_starfish_street', name: '海星國小黏土海岸全景', stage: 1, parallax: 1.0, png: 'assets/bg_starfish_street.webp', webp: 'assets/bg_starfish_street.webp', builtin: true },
    { id: 'bg_aqiang_street', name: '阿強國小黏土摩天輪全景', stage: 2, parallax: 1.0, png: 'assets/bg_aqiang_street.webp', webp: 'assets/bg_aqiang_street.webp', builtin: true },
    { id: 'bg_donghua_street', name: '冬花國小黏土櫻花道場全景', stage: 3, parallax: 1.0, png: 'assets/bg_donghua_street.webp', webp: 'assets/bg_donghua_street.webp', builtin: true },
  ];

  const items = [
    { id: 'item_foods', name: '補給食物精靈表', effect: 'heal', value: 30, png: 'assets/item_foods_sheet.webp', webp: 'assets/item_foods_sheet.webp', builtin: true },
    { id: 'item_mana_bottle', name: '能量魔力瓶', effect: 'power', value: 40, png: 'assets/item_mana_bottle.webp', webp: 'assets/item_mana_bottle.webp', builtin: true },
    { id: 'prop_cooker_hp', name: '補血電鍋補給箱', effect: 'heal', value: 50, png: 'assets/prop_cooker_sheet.webp', webp: 'assets/prop_cooker_sheet.webp', builtin: true },
    { id: 'prop_cooker_mp', name: '回魔電鍋補給箱', effect: 'power', value: 50, png: 'assets/prop_cooker_mp_sheet.webp', webp: 'assets/prop_cooker_mp_sheet.webp', builtin: true },
  ];

  characters.forEach((c) => {
    c.turnaround = `assets/turnarounds/${c.id}_turnaround.webp`;
    c.turnaroundBuiltin = true;
  });

  return { characters, backgrounds, items };
});
