import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Copy, X, QrCode } from 'lucide-react';
import { useI18n } from '../i18n';

interface QRCodeModalProps {
  value: string;
  title: string;
  subtitle?: string;
  onClose: () => void;
}

export function QRCodeModal({ value, title, subtitle, onClose }: QRCodeModalProps) {
  const { t } = useI18n();
  const [dataUrl, setDataUrl] = useState<string>('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let active = true;
    QRCode.toDataURL(value, {
      width: 280,
      margin: 2,
      color: {
        dark: '#000000',
        light: '#ffffff',
      },
      errorCorrectionLevel: 'M',
    })
      .then((url) => {
        if (active) setDataUrl(url);
      })
      .catch((err) => {
        console.error('Failed to generate QR code:', err);
      });

    return () => {
      active = false;
    };
  }, [value]);

  const handleCopy = () => {
    void navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="qr-modal-title"
      onClick={onClose}
    >
      <div
        className="modal qr-modal"
        style={{ maxWidth: 400, textAlign: 'center' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <QrCode size={20} color="var(--accent)" />
            <h3 id="qr-modal-title" style={{ margin: 0, fontSize: 16 }}>
              {title}
            </h3>
          </div>
          <button
            onClick={onClose}
            aria-label={t('common.close')}
            style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
          >
            <X size={18} />
          </button>
        </div>

        {subtitle && (
          <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 16 }}>{subtitle}</p>
        )}

        <div
          style={{
            background: '#ffffff',
            padding: 12,
            borderRadius: 12,
            display: 'inline-block',
            margin: '0 auto 16px auto',
            boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
          }}
        >
          {dataUrl ? (
            <img src={dataUrl} alt="Pairing QR Code" style={{ display: 'block', width: 240, height: 240 }} />
          ) : (
            <div style={{ width: 240, height: 240, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <span style={{ color: '#666', fontSize: 13 }}>Generating QR code…</span>
            </div>
          )}
        </div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
          <button className="btn" onClick={handleCopy}>
            <Copy size={14} />
            {copied ? t('set.tokenCopied') : t('common.copy')}
          </button>
          <button className="btn btn-primary" onClick={onClose}>
            {t('common.close')}
          </button>
        </div>
      </div>
    </div>
  );
}
