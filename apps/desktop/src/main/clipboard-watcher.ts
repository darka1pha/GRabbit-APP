import { clipboard } from 'electron';
import { isMagnetLink } from '@grabbit/utils';
import type { ClipboardLink } from '../shared/types';
import { looksLikeDirectFile } from './downloads/categories';
import { detectPlatform, extractUrlFromText } from './media/url-parser';

const POLL_MS = 1000;

const MAGNET_IN_TEXT = /magnet:\?[^\s"'<>]+/i;

/** Watches the clipboard for media links, direct file links and magnet links. */
export class ClipboardWatcher {
  private timer: NodeJS.Timeout | null = null;
  private last = '';

  constructor(private readonly onLink: (link: ClipboardLink) => void) {}

  public setEnabled(enabled: boolean): void {
    if (enabled && !this.timer) {
      void this.read().then((text) => (this.last = text));
      this.timer = setInterval(() => void this.check(), POLL_MS);
    } else if (!enabled && this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Text the app put on the clipboard itself must not trigger a prompt. */
  public ignore(text: string): void {
    this.last = text;
  }

  private async read(): Promise<string> {
    try {
      return await clipboard.readText();
    } catch {
      return '';
    }
  }

  private async check(): Promise<void> {
    const text = await this.read();
    if (!text || text === this.last) return;
    this.last = text;
    // Magnet links with many trackers run long, so they get a larger allowance than web links
    if (text.length <= 16_384) {
      const magnet = MAGNET_IN_TEXT.exec(text)?.[0];
      if (magnet && isMagnetLink(magnet)) {
        this.onLink({ url: magnet, kind: 'torrent' });
        return;
      }
    }
    if (text.length > 4096) return;
    const url = extractUrlFromText(text);
    if (!url) return;
    let host: string;
    try {
      host = new URL(url).hostname;
    } catch {
      return;
    }
    if (looksLikeDirectFile(url)) this.onLink({ url, kind: 'file' });
    else if (detectPlatform(host) !== 'generic') this.onLink({ url, kind: 'media' });
  }
}
