import { useEffect, useSyncExternalStore } from 'react';
import type { DownloadItem, DownloadProgressPatch, DownloadsAggregate } from '../../shared/types';

type Listener = () => void;

/** The part of the preload API the store listens to. */
export interface DownloadsSource {
  list(): Promise<DownloadItem[]>;
  onChanged(listener: (items: DownloadItem[]) => void): () => void;
  onProgress(listener: (patches: DownloadProgressPatch[]) => void): () => void;
  onAggregate(listener: (aggregate: DownloadsAggregate) => void): () => void;
  onRemoved(listener: (ids: string[]) => void): () => void;
  onOrderChanged(listener: (ids: string[]) => void): () => void;
  watchSegments(ids: string[]): Promise<void>;
}

const IDLE: DownloadsAggregate = { active: 0, speed: 0, percent: null };

/**
 * All downloads, kept outside React so that a progress update re-renders only what shows it.
 *
 * There are two kinds of subscription:
 * - the list: changes when a download is added, removed, reordered, changes status or is
 *   otherwise sent whole by the main process. Items in the list are snapshots from the last
 *   such change, so their byte counts and speed may be behind;
 * - one item: changes on every progress update for that download.
 */
export class DownloadStore {
  private byId = new Map<string, DownloadItem>();
  private order: string[] = [];
  private list: DownloadItem[] = [];
  private aggregate: DownloadsAggregate = IDLE;
  private listListeners = new Set<Listener>();
  private aggregateListeners = new Set<Listener>();
  private itemListeners = new Map<string, Set<Listener>>();
  private watchCounts = new Map<string, number>();
  private source: DownloadsSource | null = null;

  /** Loads the current downloads and follows the main process from then on. Returns a disconnect function. */
  public connect(source: DownloadsSource): () => void {
    this.source = source;
    void source.list().then((items) => this.reset(items));
    const off = [
      source.onChanged((items) => this.applyItems(items)),
      source.onProgress((patches) => this.applyPatches(patches)),
      source.onAggregate((aggregate) => this.setAggregate(aggregate)),
      source.onRemoved((ids) => this.remove(ids)),
      source.onOrderChanged((ids) => this.setOrder(ids)),
    ];
    return () => {
      for (const fn of off) fn();
      if (this.source === source) this.source = null;
    };
  }

  // ---------------------------------------------------------------- updates

  public reset(items: DownloadItem[]): void {
    // Updates that arrived while the list was loading are newer than it
    const fresher = this.byId;
    this.byId = new Map(items.map((item) => [item.id, fresher.get(item.id) ?? item]));
    this.order = items.map((item) => item.id);
    for (const [id, item] of fresher) {
      if (!this.byId.has(id)) {
        this.byId.set(id, item);
        this.order.push(id);
      }
    }
    this.rebuildList();
    for (const id of this.itemListeners.keys()) this.notifyItem(id);
  }

  /** Whole items from the main process: new downloads or anything beyond running progress. */
  public applyItems(items: DownloadItem[]): void {
    if (items.length === 0) return;
    for (const item of items) {
      if (!this.byId.has(item.id)) this.order.push(item.id);
      // A whole item sent without segments must not wipe live segment data being watched
      const previous = this.byId.get(item.id);
      this.byId.set(item.id, item.segments || !previous?.segments || item.status === 'completed' ? item : { ...item, segments: previous.segments });
      this.notifyItem(item.id);
    }
    this.rebuildList();
  }

  public applyPatches(patches: DownloadProgressPatch[]): void {
    let listChanged = false;
    for (const patch of patches) {
      const previous = this.byId.get(patch.id);
      if (!previous) continue;
      const { id: _id, stage, segments, ...numbers } = patch;
      const next: DownloadItem = { ...previous, ...numbers };
      if (previous.media && previous.media.stage !== stage) next.media = { ...previous.media, stage };
      if (segments) next.segments = segments;
      this.byId.set(patch.id, next);
      // The list is filtered, counted and labelled by status, so a status change is a list change
      if (previous.status !== next.status) listChanged = true;
      this.notifyItem(patch.id);
    }
    if (listChanged) this.rebuildList();
  }

  public remove(ids: string[]): void {
    const gone = new Set(ids);
    for (const id of ids) this.byId.delete(id);
    this.order = this.order.filter((id) => !gone.has(id));
    this.rebuildList();
    for (const id of ids) this.notifyItem(id);
  }

  public setOrder(ids: string[]): void {
    this.order = ids.filter((id) => this.byId.has(id));
    // Anything the main process did not mention keeps its place at the end
    const listed = new Set(this.order);
    for (const id of this.byId.keys()) if (!listed.has(id)) this.order.push(id);
    this.rebuildList();
  }

  public setAggregate(aggregate: DownloadsAggregate): void {
    this.aggregate = aggregate.active === 0 ? IDLE : aggregate;
    for (const listener of this.aggregateListeners) listener();
  }

  private rebuildList(): void {
    this.list = this.order.map((id) => this.byId.get(id)).filter((item): item is DownloadItem => Boolean(item));
    for (const listener of this.listListeners) listener();
  }

  private notifyItem(id: string): void {
    const listeners = this.itemListeners.get(id);
    if (listeners) for (const listener of listeners) listener();
  }

  // ---------------------------------------------------------------- reads

  public getList = (): DownloadItem[] => this.list;
  public getAggregate = (): DownloadsAggregate => this.aggregate;
  /** The latest version of one download, including running progress. */
  public get(id: string): DownloadItem | undefined {
    return this.byId.get(id);
  }

  public subscribeList = (listener: Listener): (() => void) => {
    this.listListeners.add(listener);
    return () => this.listListeners.delete(listener);
  };

  public subscribeAggregate = (listener: Listener): (() => void) => {
    this.aggregateListeners.add(listener);
    return () => this.aggregateListeners.delete(listener);
  };

  public subscribeItem(id: string, listener: Listener): () => void {
    let listeners = this.itemListeners.get(id);
    if (!listeners) this.itemListeners.set(id, (listeners = new Set()));
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0 && this.itemListeners.get(id) === listeners) this.itemListeners.delete(id);
    };
  }

  /**
   * Asks the main process for live segment data for one download while something on screen
   * shows it. Several views may watch the same download; it stops when the last one lets go.
   */
  public watchSegments(id: string): () => void {
    this.watchCounts.set(id, (this.watchCounts.get(id) ?? 0) + 1);
    this.pushWatched();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const left = (this.watchCounts.get(id) ?? 1) - 1;
      if (left > 0) this.watchCounts.set(id, left);
      else this.watchCounts.delete(id);
      this.pushWatched();
    };
  }

  private pushWatched(): void {
    void this.source?.watchSegments([...this.watchCounts.keys()]).catch(() => undefined);
  }
}

export const downloadStore = new DownloadStore();

/** Every download, in queue order. Re-renders on list changes only (see DownloadStore). */
export function useDownloadList(): DownloadItem[] {
  return useSyncExternalStore(downloadStore.subscribeList, downloadStore.getList);
}

/** The live version of a download from the list: re-renders on each of its progress updates. */
export function useLiveDownload(item: DownloadItem): DownloadItem {
  const id = item.id;
  const live = useSyncExternalStore(
    (listener) => downloadStore.subscribeItem(id, listener),
    () => downloadStore.get(id)
  );
  return live ?? item;
}

export function useDownloadsAggregate(): DownloadsAggregate {
  return useSyncExternalStore(downloadStore.subscribeAggregate, downloadStore.getAggregate);
}

/** Keeps live segment data flowing for a download while the calling component is mounted. */
export function useSegmentWatch(id: string | null | undefined): void {
  useEffect(() => (id ? downloadStore.watchSegments(id) : undefined), [id]);
}
