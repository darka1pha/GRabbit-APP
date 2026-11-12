import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { motion } from 'motion/react';
import {
  AudioLines,
  Download,
  Layers,
  Link,
  Moon,
  Pause,
  Play,
  Plus,
  Search,
  Settings,
  Sun,
  TvMinimal,
} from 'lucide-react';
import { useI18n, type MessageKey } from '../i18n';
import { api, useApp } from '../state';
import type { DownloadItem } from '../../../shared/types';
import { formatBytes } from '../format';

interface CommandItem {
  id: string;
  title: string;
  subtitle?: string;
  category: string;
  icon: ReactNode;
  action: () => void;
}

export function CommandPalette({
  isOpen,
  onClose,
  onNavigate,
  onOpenAdd,
  onSelectDownload,
}: {
  isOpen: boolean;
  onClose: () => void;
  onNavigate: (view: 'grab' | 'downloads' | 'recognize' | 'settings', section?: string) => void;
  onOpenAdd: (mode?: 'single' | 'batch' | 'pattern') => void;
  onSelectDownload?: (item: DownloadItem) => void;
}) {
  const { t, language } = useI18n();
  const { settings, updateSettings, downloads } = useApp();
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  const commands = useMemo<CommandItem[]>(() => {
    const list: CommandItem[] = [
      // Quick Actions
      {
        id: 'action-add',
        title: t('dl.add'),
        subtitle: 'Ctrl+N',
        category: t('palette.actions') ?? 'Actions',
        icon: <Plus size={16} />,
        action: () => {
          onClose();
          onOpenAdd('single');
        },
      },
      {
        id: 'action-add-batch',
        title: t('dl.addBatch'),
        subtitle: t('add.modeBatch'),
        category: t('palette.actions') ?? 'Actions',
        icon: <Layers size={16} />,
        action: () => {
          onClose();
          onOpenAdd('batch');
        },
      },
      {
        id: 'action-resume-all',
        title: t('dl.resumeAll'),
        category: t('palette.actions') ?? 'Actions',
        icon: <Play size={16} />,
        action: () => {
          onClose();
          void api.downloads.resumeAll();
        },
      },
      {
        id: 'action-pause-all',
        title: t('dl.pauseAll'),
        category: t('palette.actions') ?? 'Actions',
        icon: <Pause size={16} />,
        action: () => {
          onClose();
          void api.downloads.pauseAll();
        },
      },
      {
        id: 'action-clear-completed',
        title: t('dl.clearCompleted'),
        category: t('palette.actions') ?? 'Actions',
        icon: <Download size={16} />,
        action: () => {
          onClose();
          void api.downloads.clearCompleted();
        },
      },
      {
        id: 'action-toggle-theme',
        title: settings?.theme === 'dark' ? t('set.theme.light') : t('set.theme.dark'),
        category: t('palette.actions') ?? 'Actions',
        icon: settings?.theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />,
        action: () => {
          onClose();
          void updateSettings({ theme: settings?.theme === 'dark' ? 'light' : 'dark' });
        },
      },
      {
        id: 'action-mini-mode',
        title: t('tray.miniMode') ?? 'Mini Mode',
        category: t('palette.actions') ?? 'Actions',
        icon: <TvMinimal size={16} />,
        action: () => {
          onClose();
          void api.app.toggleMiniMode(true);
        },
      },
      // Navigation
      {
        id: 'nav-grab',
        title: t('nav.grab'),
        category: t('palette.navigation') ?? 'Navigation',
        icon: <Link size={16} />,
        action: () => {
          onClose();
          onNavigate('grab');
        },
      },
      {
        id: 'nav-downloads',
        title: t('nav.downloads'),
        category: t('palette.navigation') ?? 'Navigation',
        icon: <Download size={16} />,
        action: () => {
          onClose();
          onNavigate('downloads');
        },
      },
      {
        id: 'nav-recognize',
        title: t('nav.recognize'),
        category: t('palette.navigation') ?? 'Navigation',
        icon: <AudioLines size={16} />,
        action: () => {
          onClose();
          onNavigate('recognize');
        },
      },
      {
        id: 'nav-settings',
        title: t('nav.settings'),
        category: t('palette.navigation') ?? 'Navigation',
        icon: <Settings size={16} />,
        action: () => {
          onClose();
          onNavigate('settings');
        },
      },
      // Settings Sections
      {
        id: 'set-general',
        title: `${t('nav.settings')} → ${t('set.section.general') ?? 'General'}`,
        category: t('nav.settings'),
        icon: <Settings size={16} />,
        action: () => {
          onClose();
          onNavigate('settings', 'general');
        },
      },
      {
        id: 'set-network',
        title: `${t('nav.settings')} → ${t('set.section.network') ?? 'Network & Speed'}`,
        category: t('nav.settings'),
        icon: <Settings size={16} />,
        action: () => {
          onClose();
          onNavigate('settings', 'network');
        },
      },
      {
        id: 'set-media',
        title: `${t('nav.settings')} → ${t('set.section.media') ?? 'Media & Platforms'}`,
        category: t('nav.settings'),
        icon: <Settings size={16} />,
        action: () => {
          onClose();
          onNavigate('settings', 'media');
        },
      },
      {
        id: 'set-extension',
        title: `${t('nav.settings')} → ${t('set.section.extension') ?? 'Browser Extension'}`,
        category: t('nav.settings'),
        icon: <Settings size={16} />,
        action: () => {
          onClose();
          onNavigate('settings', 'extension');
        },
      },
    ];

    // Download Items matching query
    if (query.trim().length > 1) {
      const q = query.toLowerCase();
      const matchingDownloads = downloads
        .filter((d) => d.fileName.toLowerCase().includes(q) || d.url.toLowerCase().includes(q))
        .slice(0, 5)
        .map((d) => ({
          id: `dl-${d.id}`,
          title: d.fileName,
          subtitle: `${formatBytes(d.receivedBytes, language)} · ${t(`status.${d.status}` as MessageKey)}`,
          category: t('nav.downloads'),
          icon: <Download size={16} />,
          action: () => {
            onClose();
            if (onSelectDownload) {
              onSelectDownload(d);
            } else {
              onNavigate('downloads');
            }
          },
        }));
      list.push(...matchingDownloads);
    }

    return list;
  }, [t, language, settings, updateSettings, downloads, query, onClose, onOpenAdd, onNavigate, onSelectDownload]);

  const filtered = useMemo(() => {
    if (!query.trim()) return commands;
    const q = query.toLowerCase().trim();
    return commands.filter(
      (c) => c.title.toLowerCase().includes(q) || (c.subtitle && c.subtitle.toLowerCase().includes(q))
    );
  }, [commands, query]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [filtered.length]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!isOpen) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((i) => (i + 1 < filtered.length ? i + 1 : 0));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((i) => (i - 1 >= 0 ? i - 1 : filtered.length - 1));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (filtered[selectedIndex]) {
          filtered[selectedIndex].action();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, filtered, selectedIndex, onClose]);

  // Scroll active item into view
  useEffect(() => {
    if (listRef.current) {
      const el = listRef.current.querySelector<HTMLElement>(`[data-index="${selectedIndex}"]`);
      if (el) {
        el.scrollIntoView({ block: 'nearest' });
      }
    }
  }, [selectedIndex]);

  if (!isOpen) return null;

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-label={t('palette.title') ?? 'Command Palette'}
    >
      <motion.div
        className="command-palette-modal"
        initial={{ opacity: 0, scale: 0.95, y: -20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: -10 }}
        transition={{ type: 'spring', damping: 26, stiffness: 340 }}
      >
        <div className="command-palette-search">
          <Search size={18} className="search-icon" />
          <input
            ref={inputRef}
            className="command-palette-input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('palette.placeholder') ?? 'Type a command or search…'}
          />
          <kbd className="command-palette-esc" onClick={onClose}>
            ESC
          </kbd>
        </div>

        <div className="command-palette-list" ref={listRef}>
          {filtered.length === 0 ? (
            <div className="command-palette-empty">
              {t('grab.noResults') ?? 'No matching commands'}
            </div>
          ) : (
            filtered.map((item, idx) => (
              <div
                key={item.id}
                data-index={idx}
                className={`command-palette-row ${idx === selectedIndex ? 'selected' : ''}`}
                onMouseEnter={() => setSelectedIndex(idx)}
                onClick={() => item.action()}
              >
                <div className="command-palette-row-icon">{item.icon}</div>
                <div className="command-palette-row-text">
                  <span className="title">{item.title}</span>
                  {item.subtitle && <span className="subtitle">{item.subtitle}</span>}
                </div>
                <span className="category-tag">{item.category}</span>
              </div>
            ))
          )}
        </div>
      </motion.div>
    </div>
  );
}
