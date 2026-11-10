import { useState } from 'react';
import { Clock, Layers, Trash2 } from 'lucide-react';
import type { DownloadQueue, QueueAfterAction } from '../../../shared/types';
import { useI18n } from '../i18n';
import { api, useApp } from '../state';
import { DayPicker, Modal, Switch } from './ui';

export function QueueConfigModal({
  queue,
  onClose,
  onSaved,
  onDeleted,
}: {
  queue?: DownloadQueue | null;
  onClose(): void;
  onSaved?(): void;
  onDeleted?(id: string): void;
}) {
  const { t } = useI18n();
  const { refreshQueues, toast } = useApp();
  const isNew = !queue;

  const [name, setName] = useState(
    queue?.id === 'main'
      ? t('queue.main')
      : queue?.id === 'scheduled'
      ? t('queue.scheduled')
      : queue?.name ?? ''
  );
  const [maxConcurrent, setMaxConcurrent] = useState(queue?.maxConcurrent ?? 1);
  const [schedulerEnabled, setSchedulerEnabled] = useState(queue?.scheduler?.enabled ?? false);
  const [startTime, setStartTime] = useState(queue?.scheduler?.startTime ?? '02:00');
  const [stopTime, setStopTime] = useState(queue?.scheduler?.stopTime ?? '08:00');
  const [days, setDays] = useState<number[]>(queue?.scheduler?.days ?? []);
  const [afterQueue, setAfterQueue] = useState<QueueAfterAction>(queue?.afterQueue ?? 'stopQueue');
  const [busy, setBusy] = useState(false);

  async function handleSave() {
    if (!name.trim()) return;
    setBusy(true);
    try {
      if (isNew) {
        await api.queues.create(name.trim(), {
          maxConcurrent,
          scheduler: { enabled: schedulerEnabled, startTime, stopTime, days },
          afterQueue,
        });
      } else {
        await api.queues.update(queue.id, {
          name: name.trim(),
          maxConcurrent,
          scheduler: { enabled: schedulerEnabled, startTime, stopTime, days },
          afterQueue,
        });
      }
      await refreshQueues();
      onSaved?.();
      onClose();
    } catch (err) {
      toast(String(err), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (!queue || queue.id === 'main') return;
    if (!confirm(t('queue.deleteConfirm'))) return;
    setBusy(true);
    try {
      await api.queues.delete(queue.id);
      await refreshQueues();
      onDeleted?.(queue.id);
      onClose();
    } catch (err) {
      toast(String(err), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={isNew ? t('queue.create') : t('queue.edit')}
      icon={<Layers size={18} />}
      onClose={onClose}
      footer={
        <>
          {!isNew && queue.id !== 'main' && (
            <button className="btn danger ghost" onClick={handleDelete} disabled={busy} style={{ marginRight: 'auto' }}>
              <Trash2 size={15} /> {t('queue.delete')}
            </button>
          )}
          <button className="btn" onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </button>
          <button className="btn primary" onClick={handleSave} disabled={!name.trim() || busy}>
            {t('common.save')}
          </button>
        </>
      }
    >
      <div className="field">
        <label>{t('queue.name')}</label>
        <input
          className="input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Night Queue, Work, High Priority"
          autoFocus
        />
      </div>

      <div className="field">
        <label>
          {t('queue.maxConcurrent')}: <b>{maxConcurrent}</b>
        </label>
        <input
          type="range"
          min={1}
          max={8}
          value={maxConcurrent}
          onChange={(e) => setMaxConcurrent(Number(e.target.value))}
          style={{ accentColor: 'var(--accent)', height: 34 }}
        />
      </div>

      <div className="field">
        <label>{t('queue.afterQueue')}</label>
        <select className="select" value={afterQueue} onChange={(e) => setAfterQueue(e.target.value as QueueAfterAction)}>
          <option value="none">{t('queue.after.none')}</option>
          <option value="stopQueue">{t('queue.after.stopQueue')}</option>
          <option value="quit">{t('queue.after.quit')}</option>
          <option value="sleep">{t('queue.after.sleep')}</option>
          <option value="shutdown">{t('queue.after.shutdown')}</option>
        </select>
      </div>

      <div className="card card-pad" style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <div className="row" style={{ gap: 8, alignItems: 'center' }}>
            <Clock size={16} />
            <b>{t('queue.schedule')}</b>
          </div>
          <Switch checked={schedulerEnabled} onChange={setSchedulerEnabled} />
        </div>

        {schedulerEnabled && (
          <div className="row" style={{ gap: 12, alignItems: 'center', marginTop: 4 }}>
            <div className="field" style={{ flex: 1, margin: 0 }}>
              <label style={{ fontSize: 12 }}>{t('queue.startAt')}</label>
              <input className="input" type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
            </div>
            <div className="field" style={{ flex: 1, margin: 0 }}>
              <label style={{ fontSize: 12 }}>{t('queue.stopAt')}</label>
              <input className="input" type="time" value={stopTime} onChange={(e) => setStopTime(e.target.value)} />
            </div>
          </div>
        )}
        {schedulerEnabled && <DayPicker value={days} onChange={setDays} />}
      </div>
    </Modal>
  );
}
