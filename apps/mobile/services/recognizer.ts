import * as FileSystem from 'expo-file-system';
import { RecognizedTrack } from '@grabbit/types';
import { mobileSettingsManager } from './settings-manager';

export interface RecognitionHistoryItem extends RecognizedTrack {
  id: string;
  recognizedAt: number;
}

type RecognizerListener = (history: RecognitionHistoryItem[]) => void;

class MobileRecognizerService {
  private history: RecognitionHistoryItem[] = [];
  private listeners: Set<RecognizerListener> = new Set();
  private loaded = false;

  private getHistoryPath(): string {
    return `${FileSystem.documentDirectory || FileSystem.cacheDirectory}grabbit_recognize_history.json`;
  }

  async loadHistory(): Promise<RecognitionHistoryItem[]> {
    if (this.loaded) return this.history;
    try {
      const path = this.getHistoryPath();
      const info = await FileSystem.getInfoAsync(path);
      if (info.exists) {
        const raw = await FileSystem.readAsStringAsync(path);
        this.history = JSON.parse(raw);
      }
    } catch (err) {
      console.warn('Failed to load recognition history:', err);
    }
    this.loaded = true;
    this.notify();
    return this.history;
  }

  getHistory(): RecognitionHistoryItem[] {
    return this.history;
  }

  subscribe(listener: RecognizerListener): () => void {
    this.listeners.add(listener);
    listener(this.history);
    return () => this.listeners.delete(listener);
  }

  private notify() {
    for (const listener of this.listeners) {
      listener(this.history);
    }
  }

  private async persist() {
    try {
      const path = this.getHistoryPath();
      await FileSystem.writeAsStringAsync(path, JSON.stringify(this.history.slice(0, 30), null, 2));
    } catch (err) {
      console.warn('Failed to persist recognition history:', err);
    }
  }

  /**
   * Recognize a track from a URL (e.g. YouTube clip, TikTok audio, direct audio stream, or query)
   */
  async recognizeFromUrl(url: string, signal?: AbortSignal): Promise<RecognizedTrack | null> {
    const settings = mobileSettingsManager.getSettings();

    // 1. If Desktop RPC Bridge is enabled, try delegating to Desktop's Shazam & yt-dlp recognizer
    if (settings.desktopBridge.enabled && settings.desktopBridge.host) {
      try {
        const rpcUrl = `http://${settings.desktopBridge.host}:${settings.desktopBridge.port}/media/recognize`;
        const res = await fetch(rpcUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-GRabbit-Token': settings.desktopBridge.token,
          },
          body: JSON.stringify({ url }),
          signal,
        });
        if (res.ok) {
          const track = await res.json();
          if (track?.title) {
            this.addToHistory(track);
            return track;
          }
        }
      } catch (err) {
        console.warn('Desktop RPC recognition failed, falling back:', err);
      }
    }

    // 2. Standalone cloud / online recognition via iTunes & OEmbed lookup
    try {
      const trimmed = url.trim();
      let query = trimmed;

      // Extract query or title if it is a YouTube or social URL
      if (trimmed.includes('youtube.com') || trimmed.includes('youtu.be')) {
        try {
          const oembedRes = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(trimmed)}&format=json`, { signal });
          if (oembedRes.ok) {
            const data = await oembedRes.json();
            if (data.title) {
              query = data.title.replace(/\((official|video|audio|lyrics|hd|4k)\)/gi, '').trim();
            }
          }
        } catch {}
      } else if (trimmed.includes('spotify.com/track/')) {
        const parts = trimmed.split('/track/')[1]?.split('?')[0];
        if (parts) {
          query = `spotify track ${parts}`;
        }
      } else if (trimmed.startsWith('http')) {
        // Direct media filename as search seed
        const filename = trimmed.split('/').pop()?.split('?')[0] || '';
        query = filename.replace(/\.(mp3|m4a|wav|mp4|webm|flac|ogg)$/i, '').replace(/[-_+]/g, ' ');
      }

      // Query iTunes Search API to get high-accuracy song metadata, artwork, preview, and album info
      const itunesUrl = `https://itunes.apple.com/search?term=${encodeURIComponent(query)}&media=music&entity=song&limit=1`;
      const res = await fetch(itunesUrl, { signal });
      if (res.ok) {
        const data = await res.json();
        if (data.results && data.results.length > 0) {
          const item = data.results[0];
          const track: RecognizedTrack = {
            title: item.trackName,
            artist: item.artistName,
            album: item.collectionName,
            releaseYear: item.releaseDate ? String(new Date(item.releaseDate).getFullYear()) : undefined,
            genre: item.primaryGenreName,
            coverArtUrl: (item.artworkUrl100 || '').replace('100x100bb', '600x600bb'),
            appleMusicUrl: item.trackViewUrl,
            spotifyUri: undefined,
            shazamUrl: `https://www.shazam.com/search?q=${encodeURIComponent(`${item.artistName} ${item.trackName}`)}`,
          };

          this.addToHistory(track);
          return track;
        }
      }
    } catch (err: any) {
      console.warn('Recognition error:', err);
      throw new Error(err.message || 'Could not recognize track');
    }

    return null;
  }

  /**
   * Recognize a track from a local audio file
   */
  async recognizeFromFile(fileUri: string, signal?: AbortSignal): Promise<RecognizedTrack | null> {
    const filename = fileUri.split('/').pop()?.split('?')[0] || 'Unknown';
    const cleanName = filename.replace(/\.(mp3|m4a|wav|flac|ogg|mp4|webm)$/i, '').replace(/[-_+]/g, ' ');
    return this.recognizeFromUrl(cleanName, signal);
  }

  private addToHistory(track: RecognizedTrack) {
    const item: RecognitionHistoryItem = {
      ...track,
      id: `rec-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      recognizedAt: Date.now(),
    };
    // De-duplicate
    this.history = [item, ...this.history.filter((h) => !(h.title === track.title && h.artist === track.artist))].slice(0, 30);
    this.notify();
    this.persist();
  }

  async clearHistory() {
    this.history = [];
    this.notify();
    await this.persist();
  }
}

export const mobileRecognizer = new MobileRecognizerService();

