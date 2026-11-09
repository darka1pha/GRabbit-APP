import { BrowserWindow, clipboard, globalShortcut, screen } from 'electron';
import { join } from 'node:path';
import { IPC, type GrabPillInitData } from '../shared/types';
import { logger } from './logger';

export interface GrabPillDeps {
  getAccelerator: () => string;
  isEnabled: () => boolean;
  onOpenMainWithUrl: (url: string, kind: 'grab' | 'download') => void;
}

export class GrabPillManager {
  private window: BrowserWindow | null = null;
  private currentAccelerator: string | null = null;

  constructor(private readonly deps: GrabPillDeps) {}

  public init(): void {
    this.createWindow();
    this.updateShortcut();
  }

  private createWindow(): void {
    if (this.window && !this.window.isDestroyed()) return;

    this.window = new BrowserWindow({
      width: 580,
      height: 74,
      frame: false,
      transparent: true,
      resizable: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      show: false,
      hasShadow: true,
      backgroundColor: '#00000000',
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        spellcheck: false,
      },
    });

    this.window.on('blur', () => {
      if (this.window && !this.window.isDestroyed() && this.window.isVisible()) {
        this.window.hide();
      }
    });

    if (!process.env.ELECTRON_RENDERER_URL) {
      void this.window.loadFile(join(__dirname, '../renderer/index.html'), { hash: '/pill' });
    } else {
      void this.window.loadURL(`${process.env.ELECTRON_RENDERER_URL}#/pill`);
    }
  }

  public updateShortcut(): void {
    if (this.currentAccelerator) {
      try {
        globalShortcut.unregister(this.currentAccelerator);
      } catch {
        // ignore
      }
      this.currentAccelerator = null;
    }

    if (!this.deps.isEnabled()) return;

    const accelerator = this.deps.getAccelerator() || 'CommandOrControl+Alt+G';
    try {
      const ok = globalShortcut.register(accelerator, () => {
        this.toggle();
      });
      if (ok) {
        this.currentAccelerator = accelerator;
        logger.info({ accelerator }, 'Registered global shortcut for grab pill');
      } else {
        logger.warn({ accelerator }, 'Failed to register global shortcut');
      }
    } catch (err) {
      logger.warn({ err, accelerator }, 'Error registering global shortcut');
    }
  }

  public async show(): Promise<void> {
    if (!this.window || this.window.isDestroyed()) {
      this.createWindow();
    }
    if (!this.window) return;

    // Center pill horizontally on the display containing cursor, placed ~15% from the top
    try {
      const point = screen.getCursorScreenPoint();
      const display = screen.getDisplayNearestPoint(point);
      const width = 580;
      const x = Math.round(display.workArea.x + (display.workArea.width - width) / 2);
      const y = Math.round(display.workArea.y + Math.max(60, display.workArea.height * 0.14));
      this.window.setPosition(x, y);
    } catch {
      this.window.center();
    }

    let clipboardUrl: string | undefined;
    try {
      const raw = await clipboard.readText();
      const clipText = typeof raw === 'string' ? raw.trim() : '';
      if (/^https?:\/\//i.test(clipText)) {
        clipboardUrl = clipText;
      }
    } catch {
      // ignore
    }

    this.window.show();
    this.window.focus();

    const data: GrabPillInitData = { clipboardUrl };
    this.window.webContents.send(IPC.pillInit, data);
  }

  public hide(): void {
    if (this.window && !this.window.isDestroyed() && this.window.isVisible()) {
      this.window.hide();
    }
  }

  public toggle(): void {
    if (this.window && !this.window.isDestroyed() && this.window.isVisible()) {
      this.hide();
    } else {
      this.show();
    }
  }

  public submit(url: string, action: 'grab' | 'download' = 'grab'): void {
    this.hide();
    this.deps.onOpenMainWithUrl(url, action);
  }

  public destroy(): void {
    if (this.currentAccelerator) {
      try {
        globalShortcut.unregister(this.currentAccelerator);
      } catch {
        // ignore
      }
      this.currentAccelerator = null;
    }
    if (this.window && !this.window.isDestroyed()) {
      this.window.destroy();
      this.window = null;
    }
  }
}
