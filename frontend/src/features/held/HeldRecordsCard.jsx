import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, PauseCircle, Trash2 } from 'lucide-react';
import { Alert, Badge, Button, Card, EmptyState, LoadingRegion, SkeletonText, SummaryList, useToast } from '../../components/ui';
import { applyHeldRecord, discardHeldRecord, getHeldRecords } from '../../services/api';
import { ATTENDANCE, MEALS } from '../recording/recordTypes';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';
import { formatDate, formatDateTime, formatNumber } from '../../utils/format';

/**
 * Held records (#61), for administrators: records captured on a school device that the
 * server did not apply on its own, because the person who captured them was
 * deactivated or had their password reset afterwards, or the device was removed.
 */
function HeldRecordsCard() {
  const isOnline = useOnlineStatus();
  const toast = useToast();
  const [held, setHeld] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null);
  const [confirmDiscard, setConfirmDiscard] = useState(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      setHeld((await getHeldRecords()).held || []);
    } catch (err) {
      setHeld([]);
      setError(err.message);
    }
  }, []);

  useEffect(() => {
    if (isOnline) load();
  }, [isOnline, load]);

  const run = async (key, action, message) => {
    setBusy(key);
    setError(null);
    try {
      await action();
      toast.show({ tone: 'success', ...message });
      setConfirmDiscard(null);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card
      id="held"
      title="Held records"
      description="Records captured offline that were not applied automatically. Check each one, then apply it or discard it."
    >
      <div className="ui-stack">
        {!isOnline && <Alert tone="neutral" title="You are offline">Reviewing held records needs a connection.</Alert>}
        {error && <Alert tone="danger" title="Not done">{error}</Alert>}
        {isOnline && held === null && <LoadingRegion label="Loading held records"><SkeletonText lines={3} /></LoadingRegion>}
        {held?.length === 0 && !error && (
          <EmptyState compact icon={CheckCircle2} title="Nothing held" description="Records are held when the person who captured them was deactivated or had their password reset, or the device was removed." />
        )}

        {held?.length > 0 && (
          <ul className="held__list">
            {held.map((record) => {
              const type = record.entityType === 'attendance' ? ATTENDANCE : MEALS;
              const date = record.payload[type.dateField];
              return (
                <li key={record.id} className="held__item">
                  <div className="held__head">
                    <PauseCircle className="held__icon" aria-hidden="true" />
                    <div className="held__text">
                      <p className="held__title">
                        {type.title} · {formatDate(date)}
                        <Badge tone="warning">{record.operation === 'update' ? 'Edit' : 'New record'}</Badge>
                      </p>
                      <p className="held__reason">{record.reasonText}.</p>
                    </div>
                  </div>
                  <SummaryList
                    rows={[
                      ...type.fields.map((field) => ({ key: field.name, label: field.label, value: formatNumber(record.payload[field.name]) })),
                      { key: 'by', label: 'Captured by', value: record.capturedBy || '–' },
                      { key: 'when', label: 'Captured', value: record.capturedAt ? formatDateTime(record.capturedAt) : '–' },
                      { key: 'device', label: 'Device', value: record.device || '–' },
                    ]}
                  />
                  {confirmDiscard === record.id ? (
                    <Alert
                      tone="warning"
                      title="Discard this record?"
                      action={(
                        <div className="held__actions">
                          <Button variant="danger" size="sm" loading={busy === record.id} onClick={() => run(record.id, () => discardHeldRecord(record.id), { title: 'Record discarded' })}>
                            Discard
                          </Button>
                          <Button variant="secondary" size="sm" onClick={() => setConfirmDiscard(null)} disabled={Boolean(busy)}>Cancel</Button>
                        </div>
                      )}
                    >
                      It will not be added. The decision is recorded with your name.
                    </Alert>
                  ) : (
                    <div className="held__actions">
                      <Button
                        size="sm"
                        icon={CheckCircle2}
                        loading={busy === record.id}
                        disabled={!isOnline || Boolean(busy)}
                        onClick={() => run(record.id, () => applyHeldRecord(record.id), { title: 'Record applied', description: `${type.title} for ${formatDate(date)} is now on the server.` })}
                      >
                        Apply
                      </Button>
                      <Button variant="ghost" size="sm" icon={Trash2} disabled={!isOnline || Boolean(busy)} onClick={() => setConfirmDiscard(record.id)}>
                        Discard
                      </Button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Card>
  );
}

export default HeldRecordsCard;
