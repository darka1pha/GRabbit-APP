import type { DetectedMediaStream, RpcAddDownloadRequest } from '@grabbit/types';

export interface ExtensionConfig {
  bridgeHost: string;
  bridgePort: number;
  bridgeToken: string;
  interceptDownloads: boolean;
  interceptExtensions: string[];
  excludedDomains: string[];
  enableVideoSniffer: boolean;
  minFileSizeMB: number;
}

export type ExtensionMessageType =
  | 'MEDIA_DETECTED'
  | 'GET_PAGE_MEDIA'
  | 'SCAN_PAGE_MEDIA'
  | 'EXTRACT_PAGE_LINKS'
  | 'DOWNLOAD_MEDIA'
  | 'DOWNLOAD_URL'
  | 'DOWNLOAD_BATCH'
  | 'CHECK_CONNECTION'
  | 'CHECK_EXTENSION_UPDATE'
  | 'RELOAD_EXTENSION'
  | 'GET_CONFIG'
  | 'SAVE_CONFIG';

export interface ExtensionUpdateInfo {
  ok: boolean;
  currentVersion: string;
  latestVersion?: string;
  updateAvailable: boolean;
  downloadUrl?: string;
  releaseUrl?: string;
  installed?: boolean;
  downloaded?: boolean;
  error?: string;
}

export interface ExtensionMessage<T = unknown> {
  type: ExtensionMessageType;
  payload?: T;
}

export interface MediaDetectedPayload {
  tabId?: number;
  media: DetectedMediaStream;
}

export interface DownloadUrlPayload {
  url: string;
  fileName?: string;
  referrer?: string;
  cookies?: string;
  startPaused?: boolean;
}

export interface DownloadBatchPayload {
  items: RpcAddDownloadRequest[];
}

export interface ExtractedLink {
  url: string;
  text: string;
  fileName?: string;
  category?: string;
}

// Ambient Chrome Extension API typing
declare global {
  namespace chrome {
    namespace runtime {
      const id: string;
      const lastError: { message?: string } | undefined;
      function getURL(path: string): string;
      function getManifest(): { version: string; name: string };
      function reload(): void;
      function openOptionsPage(callback?: () => void): void;
      function sendMessage<M = any, R = any>(message: M): Promise<R>;
      function sendMessage<M = any, R = any>(
        message: M,
        responseCallback?: (response: R) => void
      ): void;
      const onMessage: {
        addListener(
          callback: (
            message: any,
            sender: { tab?: { id?: number; url?: string; title?: string } },
            sendResponse: (response?: any) => void
          ) => boolean | void
        ): void;
      };
      const onInstalled: {
        addListener(callback: (details: { reason: string }) => void): void;
      };
    }

    namespace storage {
      interface StorageArea {
        get(keys?: string | string[] | Record<string, any> | null): Promise<Record<string, any>>;
        get(keys: any, callback: (items: Record<string, any>) => void): void;
        set(items: Record<string, any>): Promise<void>;
        set(items: Record<string, any>, callback: () => void): void;
        remove(keys: string | string[]): Promise<void>;
        clear(): Promise<void>;
      }
      const sync: StorageArea;
      const local: StorageArea;
    }

    namespace tabs {
      interface Tab {
        id?: number;
        url?: string;
        title?: string;
        active?: boolean;
      }
      function query(queryInfo: {
        active?: boolean;
        currentWindow?: boolean;
        url?: string | string[];
      }): Promise<Tab[]>;
      function sendMessage<M = any, R = any>(tabId: number, message: M): Promise<R>;
      function sendMessage<M = any, R = any>(
        tabId: number,
        message: M,
        responseCallback?: (response: R) => void
      ): void;
      function create(createProperties: { url: string }): Promise<Tab>;
    }

    namespace scripting {
      function executeScript(injection: {
        target: { tabId: number; allFrames?: boolean };
        files: string[];
      }): Promise<unknown[]>;
      function insertCSS(injection: {
        target: { tabId: number; allFrames?: boolean };
        files: string[];
      }): Promise<void>;
    }

    namespace downloads {
      interface DownloadItem {
        id: number;
        url: string;
        finalUrl?: string;
        filename: string;
        danger?: string;
        mime?: string;
        startTime?: string;
        estimatedEndTime?: string;
        state: 'in_progress' | 'interrupted' | 'complete';
        paused: boolean;
        canResume: boolean;
        error?: string;
        bytesReceived: number;
        totalBytes: number;
        fileSize?: number;
        referrer?: string;
      }
      interface DownloadDelta {
        id: number;
        filename?: { previous?: string; current?: string };
        mime?: { previous?: string; current?: string };
        state?: { previous?: string; current?: string };
      }
      function download(options: { url: string; filename?: string }): Promise<number>;
      function pause(downloadId: number): Promise<void>;
      function resume(downloadId: number): Promise<void>;
      function cancel(downloadId: number): Promise<void>;
      function erase(query: { id: number }): Promise<number[]>;
      function search(
        query: { id?: number },
        callback: (results: DownloadItem[]) => void
      ): void;
      const onCreated: {
        addListener(callback: (downloadItem: DownloadItem) => void): void;
      };
      const onChanged: {
        addListener(callback: (downloadDelta: DownloadDelta) => void): void;
      };
      const onDeterminingFilename: {
        addListener(
          callback: (
            downloadItem: DownloadItem,
            suggest: (suggestion?: { filename: string; conflictAction?: string }) => void
          ) => boolean | void
        ): void;
      };
    }

    namespace contextMenus {
      interface CreateProperties {
        id?: string;
        title?: string;
        contexts?: Array<'all' | 'page' | 'selection' | 'link' | 'image' | 'video' | 'audio'>;
        parentId?: string | number;
      }
      function create(createProperties: CreateProperties, callback?: () => void): string | number;
      function removeAll(): Promise<void>;
      const onClicked: {
        addListener(
          callback: (
            info: {
              menuItemId: string | number;
              linkUrl?: string;
              srcUrl?: string;
              pageUrl?: string;
              selectionText?: string;
            },
            tab?: tabs.Tab
          ) => void
        ): void;
      };
    }

    namespace cookies {
      interface Cookie {
        name: string;
        value: string;
        domain: string;
        path: string;
      }
      function getAll(details: { url?: string; domain?: string }): Promise<Cookie[]>;
    }

    namespace notifications {
      function create(
        notificationId: string,
        options: {
          type: 'basic' | 'image' | 'list' | 'progress';
          iconUrl: string;
          title: string;
          message: string;
        }
      ): Promise<string>;
    }
  }
}
