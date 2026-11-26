// ============================================================================
// src/app/DevDrawer.ts — Dev-Only F9 Playtest Drawer
// ============================================================================

import type { DebugBridge, GameDataCatalog, InputMode } from '../contracts/index';

export class DevDrawer {
  private readonly root: HTMLElement;
  private readonly bridge: DebugBridge;
  private readonly catalog: GameDataCatalog;
  private open = false;
  private panel: HTMLDivElement | null = null;
  private telemetryEl: HTMLPreElement | null = null;
  private waveInput: HTMLInputElement | null = null;
  private weaponSelect: HTMLSelectElement | null = null;
  private itemSelect: HTMLSelectElement | null = null;
  private godCheckbox: HTMLInputElement | null = null;
  private onKeyDownBound: (e: KeyboardEvent) => void;

  constructor(root: HTMLElement, bridge: DebugBridge, catalog: GameDataCatalog) {
    this.root = root;
    this.bridge = bridge;
    this.catalog = catalog;
    this.onKeyDownBound = (e: KeyboardEvent) => {
      if (e.code === 'F9') {
        e.preventDefault();
        this.toggle();
      }
    };
    if (typeof window !== 'undefined') {
      window.addEventListener('keydown', this.onKeyDownBound);
    }
    this.buildDom();
  }

  private buildDom(): void {
    const panel = document.createElement('div');
    panel.id = 'krunked-dev-drawer';
    panel.style.cssText = [
      'position:fixed',
      'top:12px',
      'right:12px',
      'width:320px',
      'max-height:calc(100vh - 24px)',
      'overflow-y:auto',
      'background:rgba(16,15,24,0.94)',
      'border:2px solid #f7c948',
      'border-radius:12px',
      'padding:12px',
      'color:#f4f2ec',
      'font-family:ui-monospace,Consolas,monospace',
      'font-size:12px',
      'box-shadow:0 12px 32px rgba(0,0,0,0.6)',
      'pointer-events:auto',
      'display:none',
      'z-index:9999',
    ].join(';');

    const title = document.createElement('div');
    title.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;font-weight:700;color:#f7c948;';
    title.innerHTML = '<span>F9 PLAYTEST DRAWER</span>';
    const closeBtn = this.makeBtn('X', () => this.setOpen(false));
    closeBtn.style.minWidth = '28px';
    title.appendChild(closeBtn);
    panel.appendChild(title);

    const telemetry = document.createElement('pre');
    telemetry.style.cssText = 'margin:0 0 8px 0;padding:8px;background:#0c0b12;border-radius:6px;white-space:pre-wrap;line-height:1.35;font-size:11px;';
    panel.appendChild(telemetry);
    this.telemetryEl = telemetry;

    // Wave Warp row
    const warpRow = this.makeRow();
    const waveInput = document.createElement('input');
    waveInput.type = 'number';
    waveInput.min = '1';
    waveInput.max = '25';
    waveInput.value = '11';
    waveInput.style.cssText = 'width:62px;padding:4px 6px;background:#1d1b2b;color:#fff;border:1px solid #444;border-radius:6px;';
    this.waveInput = waveInput;
    warpRow.appendChild(waveInput);
    warpRow.appendChild(
      this.makeBtn('Warp Wave', () => {
        const w = Math.max(1, Math.min(25, Number(waveInput.value) || 1));
        this.bridge.dispatch({ type: 'debug_warp_wave', wave: w });
      }),
    );
    warpRow.appendChild(
      this.makeBtn('W20 Boss', () => {
        this.bridge.dispatch({ type: 'debug_warp_wave', wave: 20 });
      }),
    );
    panel.appendChild(warpRow);

    // Elite / Boss / Kill All row
    const combatRow = this.makeRow();
    combatRow.appendChild(this.makeBtn('+Elite', () => this.bridge.dispatch({ type: 'debug_spawn_elite' })));
    combatRow.appendChild(this.makeBtn('+Boss', () => this.bridge.dispatch({ type: 'debug_spawn_boss' })));
    combatRow.appendChild(this.makeBtn('Kill All', () => this.bridge.dispatch({ type: 'debug_kill_all' })));
    combatRow.appendChild(this.makeBtn('+500 Mat', () => this.bridge.dispatch({ type: 'debug_give_materials', amount: 500 })));
    panel.appendChild(combatRow);

    // Spawn Weapon row
    const wepRow = this.makeRow();
    const wepSel = document.createElement('select');
    wepSel.style.cssText = 'flex:1;padding:4px;background:#1d1b2b;color:#fff;border:1px solid #444;border-radius:6px;';
    for (const w of this.catalog.weapons) {
      const opt = document.createElement('option');
      opt.value = w.id;
      opt.textContent = w.name;
      wepSel.appendChild(opt);
    }
    this.weaponSelect = wepSel;
    wepRow.appendChild(wepSel);
    wepRow.appendChild(
      this.makeBtn('+Wep T4', () => {
        if (this.weaponSelect) {
          this.bridge.dispatch({ type: 'debug_give_weapon', weaponId: this.weaponSelect.value, tier: 4 });
        }
      }),
    );
    panel.appendChild(wepRow);

    // Spawn Item row
    const itemRow = this.makeRow();
    const itemSel = document.createElement('select');
    itemSel.style.cssText = 'flex:1;padding:4px;background:#1d1b2b;color:#fff;border:1px solid #444;border-radius:6px;';
    for (const it of this.catalog.items) {
      const opt = document.createElement('option');
      opt.value = it.id;
      opt.textContent = it.name;
      itemSel.appendChild(opt);
    }
    this.itemSelect = itemSel;
    itemRow.appendChild(itemSel);
    itemRow.appendChild(
      this.makeBtn('+Item', () => {
        if (this.itemSelect) {
          this.bridge.dispatch({ type: 'debug_give_item', itemId: this.itemSelect.value });
        }
      }),
    );
    panel.appendChild(itemRow);

    // God mode + Level Up + Step Ticks
    const utilRow = this.makeRow();
    const godLabel = document.createElement('label');
    godLabel.style.cssText = 'display:flex;align-items:center;gap:4px;cursor:pointer;';
    const godCb = document.createElement('input');
    godCb.type = 'checkbox';
    godCb.addEventListener('change', () => {
      this.bridge.dispatch({ type: 'debug_set_godmode', enabled: godCb.checked });
    });
    this.godCheckbox = godCb;
    godLabel.appendChild(godCb);
    godLabel.appendChild(document.createTextNode('God'));
    utilRow.appendChild(godLabel);
    utilRow.appendChild(this.makeBtn('+LvlUp', () => this.bridge.dispatch({ type: 'debug_force_level_up' })));
    utilRow.appendChild(this.makeBtn('Step 60t', () => this.bridge.stepTicks(60)));
    panel.appendChild(utilRow);

    // Input mode test buttons
    const modeRow = this.makeRow();
    for (const m of ['keyboard', 'gamepad', 'touch'] as InputMode[]) {
      modeRow.appendChild(this.makeBtn(`Mode:${m}`, () => this.bridge.setInputMode(m)));
    }
    panel.appendChild(modeRow);

    // Save reset & kit shortcuts
    const resetRow = this.makeRow();
    resetRow.appendChild(this.makeBtn('Quick Run', () => this.bridge.startQuickRun()));
    resetRow.appendChild(
      this.makeBtn('+3 Weps', () => {
        this.bridge.dispatch({ type: 'debug_give_weapon', weaponId: 'sword', tier: 2 });
        this.bridge.dispatch({ type: 'debug_give_weapon', weaponId: 'smg', tier: 2 });
        this.bridge.dispatch({ type: 'debug_give_weapon', weaponId: 'slingshot', tier: 2 });
      }),
    );
    resetRow.appendChild(this.makeBtn('Reset Save', () => this.bridge.resetSave()));
    panel.appendChild(resetRow);

    this.root.appendChild(panel);
    this.panel = panel;
  }

  private makeRow(): HTMLDivElement {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:6px;';
    return row;
  }

  private makeBtn(label: string, onClick: () => void): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = label;
    btn.style.cssText =
      'padding:4px 8px;background:#2b2740;color:#fff;border:1px solid #59527a;border-radius:6px;cursor:pointer;font:inherit;';
    btn.addEventListener('click', onClick);
    return btn;
  }

  toggle(): void {
    this.setOpen(!this.open);
  }

  setOpen(open: boolean): void {
    this.open = open;
    if (this.panel) {
      this.panel.style.display = open ? 'block' : 'none';
    }
    if (open) this.refresh();
  }

  refresh(): void {
    if (!this.open || !this.telemetryEl) return;
    const s = this.bridge.getState();
    const p = this.bridge.getPerf();
    const t = this.bridge.getTouchOverlayStatus();
    if (this.godCheckbox) {
      this.godCheckbox.checked = s.player.godMode;
    }
    this.telemetryEl.textContent = [
      `FPS: ${p.fps.toFixed(0)} | SimHz: ${p.simHz.toFixed(0)} | ${p.backend}`,
      `Screen: ${s.screen} | Wave: ${s.wave} (${Math.ceil((s.waveDurationTicks - s.waveElapsedTicks) / 60)}s)`,
      `Entities: E=${p.enemyCount} P=${p.projectileCount} G=${p.pickupCount} Q=${p.quadCount}`,
      `Player: HP=${s.player.hp}/${s.player.maxHp} Mat=${s.player.materials} Bag=${s.player.bonusGold}`,
      `Input: ${t.mode} | TouchVis=${t.visible} (a=${t.opacity.toFixed(2)})`,
      `Hash: ${this.bridge.getHash()} | Tick: ${s.tick}`,
    ].join('\n');
  }

  dispose(): void {
    if (typeof window !== 'undefined') {
      window.removeEventListener('keydown', this.onKeyDownBound);
    }
    if (this.panel && this.panel.parentElement) {
      this.panel.parentElement.removeChild(this.panel);
    }
  }
}
