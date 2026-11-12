import { Download, ExternalLink, RefreshCw } from 'lucide-react';
import type { DownloadItem } from '../../../shared/types';
import { useI18n, type MessageKey } from '../i18n';
import { formatBytes } from '../format';
import { Modal } from './ui';

export function DuplicateDialog({
  existingItem,
  newUrl,
  onViewExisting,
  onDownloadAgain,
  onRefreshLink,
  onClose,
}: {
  existingItem: DownloadItem;
  newUrl: string;
  onViewExisting: () => void;
  onDownloadAgain: () => void;
  onRefreshLink?: () => void;
  onClose: () => void;
}) {
  const { t, language } = useI18n();

  return (
    <Modal
      size="sm"
      title={t('dl.duplicateTitle') ?? 'Link Already Exists'}
      icon={<Download size={18} />}
      onClose={onClose}
      footer={
        <div className="row" style={{ gap: 8, width: '100%', justifyContent: 'flex-end' }}>
          <button className="btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          {onRefreshLink && (
            <button className="btn" onClick={onRefreshLink} title={t('dl.newLinkHint')}>
              <RefreshCw size={14} /> {t('dl.refreshLink') ?? 'Refresh Link'}
            </button>
          )}
          <button className="btn" onClick={onDownloadAgain}>
            {t('dl.downloadAgain') ?? 'Download Again'}
          </button>
          <button className="btn primary" onClick={onViewExisting} autoFocus>
            <ExternalLink size={14} /> {t('dl.viewExisting') ?? 'View Existing'}
          </button>
        </div>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <p style={{ margin: 0 }} title={newUrl}>
          {t('dl.duplicatePrompt') ??
            'This link or file is already in your downloads list. What would you like to do?'}
        </p>

        <div className="card card-pad" style={{ padding: '10px 14px' }}>
          <b className="ellipsis" style={{ display: 'block', fontSize: 13.5 }}>
            {existingItem.fileName}
          </b>
          <div className="small muted" style={{ marginTop: 4 }}>
            <span>{t(`status.${existingItem.status}` as MessageKey)}</span>
            {' · '}
            <span>{formatBytes(existingItem.receivedBytes, language)}</span>
            {existingItem.totalBytes ? ` / ${formatBytes(existingItem.totalBytes, language)}` : ''}
          </div>
        </div>
      </div>
    </Modal>
  );
}
