import { useCallback, useEffect, useRef, useState } from 'react';
import { CalendarCheck2, CalendarClock, CalendarDays, CalendarPlus, CalendarRange, Check, Pencil, Plus, Trash2 } from 'lucide-react';
import {
  Alert, Badge, Button, Card, ChoiceGroup, DataTable, DateField, EmptyState, FormField, LoadingRegion, SkeletonText,
  StatusLine, useToast,
} from '../../components/ui';
import {
  createCalendarEvent, createCalendarTerm, deleteCalendarEvent, deleteCalendarTerm, getCalendarEvents, getCalendarTerms,
  prefillCalendarHolidays, updateCalendarEvent, updateCalendarTerm,
} from '../../services/api';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';
import {
  calendarYears, dateRange, EVENT_KINDS, eventErrors, KIND_LABEL, MAX_NAME, missingTerms, startingYear, termErrors,
} from './calendarRules';

const TERM_OPTIONS = [1, 2, 3].map((n) => ({ value: n, label: `Term ${n}` }));
const EMPTY_TERM = { term: null, opensOn: '', closesOn: '', halfTermStart: '', halfTermEnd: '' };
const EMPTY_EVENT = { kind: 'public_holiday', name: '', startsOn: '', endsOn: '' };

/** Move focus to a form's heading when it opens, for keyboard and screen reader users. */
function useFocusOnOpen() {
  const ref = useRef(null);
  useEffect(() => ref.current?.focus(), []);
  return ref;
}

function TermForm({ year, initial, takenTerms, busy, serverError, onSave, onCancel }) {
  const [form, setForm] = useState(initial || { ...EMPTY_TERM, term: missingTerms(takenTerms, year)[0] ?? null });
  const [errors, setErrors] = useState({});
  const headingRef = useFocusOnOpen();
  const set = (key) => (value) => setForm((f) => ({ ...f, [key]: value }));

  const submit = (event) => {
    event.preventDefault();
    const found = termErrors(form, year);
    setErrors(found);
    if (Object.keys(found).length === 0) onSave({ ...form, year: Number(year) });
  };

  return (
    <form className="calendar__form" onSubmit={submit} noValidate>
      <h3 ref={headingRef} tabIndex={-1} className="calendar__form-title">{initial ? `Change Term ${initial.term} ${year}` : `Add a term for ${year}`}</h3>
      {serverError && <Alert tone="danger" title="Not saved">{serverError}</Alert>}
      <ChoiceGroup name="term" label="Term" required options={TERM_OPTIONS} value={form.term} onChange={set('term')} error={errors.term} />
      <div className="calendar__dates">
        <DateField label="Opens" required value={form.opensOn} onChange={set('opensOn')} error={errors.opensOn} />
        <DateField label="Closes" required value={form.closesOn} onChange={set('closesOn')} error={errors.closesOn} hint="The last day learners are in school" />
      </div>
      <div className="calendar__dates">
        <DateField label="Half-term starts" value={form.halfTermStart} onChange={set('halfTermStart')} error={errors.halfTermStart} hint="Leave empty if there is none" />
        <DateField label="Half-term ends" value={form.halfTermEnd} onChange={set('halfTermEnd')} error={errors.halfTermEnd} hint="The last day of the break" />
      </div>
      <div className="calendar__actions">
        <Button type="submit" loading={busy}>{initial ? 'Save changes' : 'Add term'}</Button>
        <Button variant="secondary" onClick={onCancel} disabled={busy}>Cancel</Button>
      </div>
    </form>
  );
}

function EventForm({ year, initial, busy, serverError, onSave, onCancel }) {
  const [form, setForm] = useState(initial || EMPTY_EVENT);
  const [errors, setErrors] = useState({});
  const headingRef = useFocusOnOpen();
  const set = (key) => (value) => setForm((f) => ({ ...f, [key]: value }));

  const submit = (event) => {
    event.preventDefault();
    const found = eventErrors(form);
    setErrors(found);
    if (Object.keys(found).length === 0) {
      const { kind, startsOn, endsOn } = form;
      // Saving an estimated date confirms it
      onSave({ kind, name: form.name.trim(), startsOn, endsOn: endsOn || startsOn, ...(initial?.toConfirm && { confirmed: true }) });
    }
  };

  return (
    <form className="calendar__form" onSubmit={submit} noValidate>
      <h3 ref={headingRef} tabIndex={-1} className="calendar__form-title">{initial ? `Change ${initial.name}` : `Add a holiday or exam for ${year}`}</h3>
      {serverError && <Alert tone="danger" title="Not saved">{serverError}</Alert>}
      {initial?.toConfirm && (
        <StatusLine icon={CalendarClock} tone="warning">Lishe estimated this date. Set it to the date in the gazette notice; saving confirms it.</StatusLine>
      )}
      <ChoiceGroup name="kind" label="What is it?" required options={EVENT_KINDS} value={form.kind} onChange={set('kind')} error={errors.kind} />
      <FormField label="Name" required maxLength={MAX_NAME} value={form.name} onChange={(e) => set('name')(e.target.value)} error={errors.name}
        hint="As schools know it, for example Madaraka Day or KCSE 2027" />
      <div className="calendar__dates">
        <DateField label="First day" required value={form.startsOn} onChange={set('startsOn')} error={errors.startsOn} />
        <DateField label="Last day" value={form.endsOn} onChange={set('endsOn')} error={errors.endsOn} hint="Leave empty for a single day" />
      </div>
      <div className="calendar__actions">
        <Button type="submit" loading={busy}>{initial?.toConfirm ? 'Save and confirm' : initial ? 'Save changes' : 'Add'}</Button>
        <Button variant="secondary" onClick={onCancel} disabled={busy}>Cancel</Button>
      </div>
    </form>
  );
}

/** An inline "Remove …?" question, so nothing is removed by one stray tap. */
function ConfirmRemove({ title, children, busy, onConfirm, onCancel }) {
  return (
    <Alert
      tone="warning"
      title={title}
      action={(
        <div className="calendar__actions">
          <Button variant="danger" size="sm" loading={busy} onClick={onConfirm}>Remove</Button>
          <Button variant="secondary" size="sm" onClick={onCancel} disabled={busy}>Cancel</Button>
        </div>
      )}
    >
      {children}
    </Alert>
  );
}

/**
 * School calendar, for system administrators: term dates and half-terms, public holidays
 * and national exams, by year. School devices get the changes the next time they sync.
 */
function SchoolCalendar() {
  const isOnline = useOnlineStatus();
  const toast = useToast();
  const [terms, setTerms] = useState(null);
  const [events, setEvents] = useState(null);
  const [year, setYear] = useState(null);
  const [loadError, setLoadError] = useState(null);
  // { type: 'term' | 'event', id?: string } while a form is open
  const [editing, setEditing] = useState(null);
  const [removing, setRemoving] = useState(null);
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState(null);

  const loadTerms = useCallback(async () => {
    try {
      setLoadError(null);
      const list = (await getCalendarTerms()).terms || [];
      setTerms(list);
      setYear((current) => current ?? startingYear(list));
    } catch (err) {
      setTerms([]);
      setLoadError(err.message);
    }
  }, []);

  const loadEvents = useCallback(async (forYear) => {
    try {
      setEvents((await getCalendarEvents(forYear)).events || []);
    } catch (err) {
      setEvents([]);
      setLoadError(err.message);
    }
  }, []);

  useEffect(() => {
    if (isOnline) loadTerms();
  }, [isOnline, loadTerms]);

  useEffect(() => {
    if (isOnline && year) {
      setEvents(null);
      loadEvents(year);
    }
  }, [isOnline, year, loadEvents]);

  const closeForms = () => {
    setEditing(null);
    setRemoving(null);
    setServerError(null);
  };

  const run = async (action, message, reload) => {
    setBusy(true);
    setServerError(null);
    try {
      await action();
      toast.show({ tone: 'success', title: message, description: 'School devices get it the next time they sync.' });
      closeForms();
      await reload();
    } catch (err) {
      setServerError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const yearTerms = (terms || []).filter((t) => t.year === year).sort((a, b) => a.opensOn.split('-').reverse().join('').localeCompare(b.opensOn.split('-').reverse().join('')));
  const nationalTerms = yearTerms.filter((t) => !t.practice);
  const missing = year ? missingTerms(terms, year) : [];
  const disabled = !isOnline || busy;

  const saveTerm = (form) => {
    const { term, opensOn, closesOn, halfTermStart, halfTermEnd } = form;
    const body = { year: form.year, term, opensOn, closesOn, halfTermStart: halfTermStart || null, halfTermEnd: halfTermEnd || null };
    return editing.id
      ? run(() => updateCalendarTerm(editing.id, body), `Term ${term} ${year} saved`, loadTerms)
      : run(() => createCalendarTerm(body), `Term ${term} ${year} added`, loadTerms);
  };

  const saveEvent = (form) => (editing.id
    ? run(() => updateCalendarEvent(editing.id, form), `${form.name} saved`, () => loadEvents(year))
    : run(() => createCalendarEvent(form), `${form.name} added`, () => loadEvents(year)));

  // Fill in the year's public holidays Lishe works out; the result says what was added
  const fillHolidays = async () => {
    setBusy(true);
    setServerError(null);
    try {
      const { added } = await prefillCalendarHolidays(year);
      toast.show(added.length > 0
        ? { tone: 'success', title: `${added.length === 1 ? '1 public holiday' : `${added.length} public holidays`} added for ${year}`, description: 'Check them, and confirm any marked to confirm.' }
        : { tone: 'success', title: `All of ${year}'s regular public holidays are already in` });
      closeForms();
      await loadEvents(year);
    } catch (err) {
      setServerError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const toConfirm = (events || []).filter((e) => e.toConfirm);

  const eventColumns = [
    {
      key: 'name', header: 'Name', primary: true, sortValue: (e) => e.name,
      render: (e) => (
        <span className="calendar__name">
          {e.name}
          {e.toConfirm && <Badge tone="warning" icon={CalendarClock}>To confirm</Badge>}
        </span>
      ),
    },
    { key: 'kind', header: 'What', render: (e) => <Badge tone={e.kind === 'national_exam' ? 'info' : 'neutral'}>{KIND_LABEL[e.kind]}</Badge> },
    { key: 'dates', header: 'Dates', render: (e) => <span className="tabular-nums">{dateRange(e.startsOn, e.endsOn)}</span>, sortValue: (e) => e.startsOn.split('-').reverse().join('-') },
    {
      key: 'actions',
      header: <span className="visually-hidden">Actions</span>,
      action: true,
      align: 'end',
      render: (e) => (
        <div className="calendar__actions calendar__actions--row">
          {e.toConfirm && (
            <Button size="sm" icon={Check} disabled={disabled}
              onClick={() => run(() => updateCalendarEvent(e.id, { confirmed: true }), `${e.name} on ${e.startsOn} confirmed`, () => loadEvents(year))}
              aria-label={`Confirm ${e.name} on ${e.startsOn}`}>Confirm</Button>
          )}
          <Button variant="secondary" size="sm" icon={Pencil} disabled={disabled} onClick={() => { closeForms(); setEditing({ type: 'event', id: e.id }); }}
            aria-label={`Change ${e.name}`}>Change</Button>
          <Button variant="ghost" size="sm" icon={Trash2} disabled={disabled} onClick={() => { closeForms(); setRemoving({ type: 'event', id: e.id }); }}
            aria-label={`Remove ${e.name}`}>Remove</Button>
        </div>
      ),
    },
  ];

  const editingEvent = editing?.type === 'event' && editing.id && (events || []).find((e) => e.id === editing.id);
  const removingEvent = removing?.type === 'event' && (events || []).find((e) => e.id === removing.id);

  return (
    <div className="ui-stack">
      {!isOnline && <Alert tone="neutral" title="You are offline">Changing the calendar needs a connection.</Alert>}
      {loadError && <Alert tone="danger" title="The calendar could not be loaded">{loadError}</Alert>}

      {isOnline && terms === null && <LoadingRegion label="Loading the calendar"><SkeletonText lines={4} /></LoadingRegion>}

      {terms !== null && year && (
        <>
          <div className="calendar__year">
            <FormField
              as="select"
              label="Year"
              value={String(year)}
              onChange={(e) => { closeForms(); setYear(Number(e.target.value)); }}
              options={calendarYears(terms).map((y) => ({ value: String(y), label: String(y) }))}
            />
          </div>

          {missing.length > 0 && (
            <StatusLine icon={CalendarRange} tone="warning">
              <strong>
                {missing.length === 3 ? `${year} has no terms yet.` : `${year} has no ${missing.map((n) => `Term ${n}`).join(' or ')} yet.`}
              </strong>{' '}
              Add them from the Ministry of Education&apos;s school calendar for {year}. Until they are added, schools have no current term for planning and reports in those weeks.
            </StatusLine>
          )}

          <Card
            title={`Terms ${year}`}
            description="Opening and closing days and half-term. Schools feed learners on the weekdays in between."
            actions={missing.length > 0 && editing?.type !== 'term' && (
              <Button icon={Plus} disabled={disabled} onClick={() => { closeForms(); setEditing({ type: 'term' }); }}>Add a term</Button>
            )}
          >
            <div className="ui-stack">
              {editing?.type === 'term' && !editing.id && (
                <TermForm year={year} takenTerms={terms} busy={busy} serverError={serverError} onSave={saveTerm} onCancel={closeForms} />
              )}
              {yearTerms.length === 0 && editing?.type !== 'term' && (
                <EmptyState compact icon={CalendarDays} title={`No terms for ${year}`} description="Add each term with its half-term." />
              )}
              {yearTerms.length > 0 && (
                <ul className="calendar__list">
                  {yearTerms.map((t) => (
                    <li key={t.id} className="calendar__item">
                      {editing?.type === 'term' && editing.id === t.id ? (
                        <TermForm year={year} initial={{ ...t, halfTermStart: t.halfTermStart || '', halfTermEnd: t.halfTermEnd || '' }}
                          takenTerms={terms} busy={busy} serverError={serverError} onSave={saveTerm} onCancel={closeForms} />
                      ) : (
                        <>
                          <div className="calendar__text">
                            <p className="calendar__name">
                              {t.label}
                              {t.practice && <Badge tone="neutral">Practice term</Badge>}
                            </p>
                            <p className="calendar__meta tabular-nums">
                              {dateRange(t.opensOn, t.closesOn)}
                              {' · '}
                              {t.halfTermStart ? `half-term ${dateRange(t.halfTermStart, t.halfTermEnd)}` : 'no half-term'}
                            </p>
                          </div>
                          {!t.practice && (
                            removing?.type === 'term' && removing.id === t.id ? (
                              <ConfirmRemove
                                title={`Remove ${t.label}?`}
                                busy={busy}
                                onConfirm={() => run(() => deleteCalendarTerm(t.id), `${t.label} removed`, loadTerms)}
                                onCancel={closeForms}
                              >
                                {serverError || 'Only remove a term added by mistake. If the Ministry moved its dates, change them instead.'}
                              </ConfirmRemove>
                            ) : (
                              <div className="calendar__actions calendar__actions--row">
                                <Button variant="secondary" size="sm" icon={Pencil} disabled={disabled} onClick={() => { closeForms(); setEditing({ type: 'term', id: t.id }); }}
                                  aria-label={`Change ${t.label}`}>Change</Button>
                                <Button variant="ghost" size="sm" icon={Trash2} disabled={disabled} onClick={() => { closeForms(); setRemoving({ type: 'term', id: t.id }); }}
                                  aria-label={`Remove ${t.label}`}>Remove</Button>
                              </div>
                            )
                          )}
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {nationalTerms.length === 3 && (
                <p className="calendar__meta">All three terms for {year} are in the calendar.</p>
              )}
            </div>
          </Card>

          <Card
            title={`Holidays and national exams ${year}`}
            description="Days schools do not feed learners as usual. Lishe fills in the regular public holidays; add exam periods and any extra gazetted holiday."
            actions={!(editing?.type === 'event' && !editing.id) && (
              <div className="calendar__actions">
                <Button variant="secondary" icon={CalendarCheck2} disabled={disabled} loading={busy && !editing} onClick={fillHolidays}>Fill in public holidays</Button>
                <Button icon={CalendarPlus} disabled={disabled} onClick={() => { closeForms(); setEditing({ type: 'event' }); }}>Add a holiday or exam</Button>
              </div>
            )}
          >
            <div className="ui-stack">
              {!editing && !removing && serverError && <Alert tone="danger" title="Not done">{serverError}</Alert>}
              {toConfirm.length > 0 && (
                <StatusLine icon={CalendarClock} tone="warning">
                  <strong>{toConfirm.map((e) => `${e.name} (${e.startsOn})`).join(', ')} {toConfirm.length === 1 ? 'is an estimate' : 'are estimates'}.</strong>{' '}
                  Check the gazette notice, then confirm the date or change it.
                </StatusLine>
              )}
              {editing?.type === 'event' && !editing.id && (
                <EventForm year={year} busy={busy} serverError={serverError} onSave={saveEvent} onCancel={closeForms} />
              )}
              {editingEvent && (
                <EventForm year={year} initial={{ ...editingEvent, endsOn: editingEvent.endsOn }} busy={busy} serverError={serverError} onSave={saveEvent} onCancel={closeForms} />
              )}
              {removingEvent && (
                <ConfirmRemove
                  title={`Remove ${removingEvent.name}?`}
                  busy={busy}
                  onConfirm={() => run(() => deleteCalendarEvent(removingEvent.id), `${removingEvent.name} removed`, () => loadEvents(year))}
                  onCancel={closeForms}
                >
                  {serverError || `Schools will count ${dateRange(removingEvent.startsOn, removingEvent.endsOn)} as a normal school day again.`}
                </ConfirmRemove>
              )}
              <DataTable
                caption={`Holidays and national exams ${year}`}
                columns={eventColumns}
                rows={events}
                loading={events === null && isOnline}
                noun="dates"
                initialSort={{ key: 'dates', direction: 'ascending' }}
                emptyState={{ icon: CalendarDays, title: `No holidays or exams for ${year} yet` }}
              />
            </div>
          </Card>
        </>
      )}
    </div>
  );
}

export default SchoolCalendar;
