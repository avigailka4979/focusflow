import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { formatDate, TYPE_LABELS } from '../util.js';

const SAMPLE_YT = 'https://www.youtube.com/watch?v=aircAruvnKk';

function AddContentForm({ onAdded }) {
  const [type, setType] = useState('youtube');
  const [title, setTitle] = useState('');
  const [source, setSource] = useState('');
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError(''); setOk('');
    if (!source.trim()) {
      setError(type === 'youtube' ? 'יש להדביק קישור לסרטון YouTube' : 'יש להדביק את הטקסט');
      return;
    }
    let finalTitle = title.trim();
    if (!finalTitle) {
      if (type === 'text') { setError('יש לתת כותרת לטקסט'); return; }
      finalTitle = 'סרטון YouTube';
    }
    setBusy(true);
    try {
      const item = await api('/content', { method: 'POST', body: { type, title: finalTitle, source: source.trim() } });
      setTitle(''); setSource('');
      setOk(`"${item.title}" נוסף לספרייה`);
      onAdded(item);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card" onSubmit={submit} noValidate aria-labelledby="add-title">
      <h2 id="add-title">הוספת פריט תוכן</h2>
      <fieldset className="type-switch">
        <legend>סוג התוכן</legend>
        <label className={type === 'youtube' ? 'chip active' : 'chip'}>
          <input type="radio" name="type" value="youtube" checked={type === 'youtube'}
            onChange={() => { setType('youtube'); setError(''); }} /> סרטון YouTube
        </label>
        <label className={type === 'text' ? 'chip active' : 'chip'}>
          <input type="radio" name="type" value="text" checked={type === 'text'}
            onChange={() => { setType('text'); setError(''); }} /> טקסט לקריאה
        </label>
      </fieldset>

      <label htmlFor="content-title">כותרת {type === 'youtube' && <span className="muted">(רשות)</span>}</label>
      <input id="content-title" name="title" maxLength={200} value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder={type === 'youtube' ? 'למשל: מבוא לרשתות נוירונים' : 'למשל: מאמר על שינה ולמידה'} />

      {type === 'youtube' ? (
        <>
          <label htmlFor="content-source">קישור לסרטון YouTube</label>
          <input id="content-source" name="source" dir="ltr" value={source}
            onChange={(e) => setSource(e.target.value)} placeholder={SAMPLE_YT} />
          <small className="muted">נתמכים קישורים מסוג youtube.com/watch?v=…, youtu.be/…, shorts ו-embed.</small>
        </>
      ) : (
        <>
          <label htmlFor="content-source">הטקסט</label>
          <textarea id="content-source" name="source" rows={6} value={source} maxLength={50000}
            onChange={(e) => setSource(e.target.value)} placeholder="הדביקו כאן מאמר או כל טקסט לקריאה (לפחות 20 תווים)" />
        </>
      )}

      {error && <div className="alert alert-error" role="alert">{error}</div>}
      {ok && <div className="alert alert-success" role="status">{ok}</div>}
      <button className="btn" type="submit" disabled={busy}>{busy ? 'מוסיף…' : 'הוספה לספרייה'}</button>
    </form>
  );
}

function ContentRow({ item, onDeleted }) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState('');

  async function remove() {
    setError('');
    try {
      await api(`/content/${item.id}`, { method: 'DELETE' });
      onDeleted(item.id);
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <li className="content-row">
      <div className="content-main">
        <span className={`badge badge-${item.type}`}>{TYPE_LABELS[item.type]}</span>
        <Link to={`/content/${item.id}`} className="content-title">{item.title}</Link>
        <span className="muted small">נוסף {formatDate(item.created_at)}</span>
      </div>
      <div className="row-actions">
        <Link className="btn btn-small" to={`/content/${item.id}`}>פתיחה וצפייה</Link>
        {confirming ? (
          <span className="confirm" role="group" aria-label="אישור מחיקה">
            <span>למחוק את הפריט?</span>
            <button type="button" className="btn btn-small btn-danger" onClick={remove}>כן, למחוק</button>
            <button type="button" className="btn btn-small btn-ghost" onClick={() => setConfirming(false)}>ביטול</button>
          </span>
        ) : (
          <button type="button" className="btn btn-small btn-ghost" onClick={() => setConfirming(true)}>מחיקה</button>
        )}
      </div>
      {error && <div className="alert alert-error" role="alert">{error}</div>}
    </li>
  );
}

export default function Library() {
  const [items, setItems] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api('/content').then(setItems).catch((err) => setError(err.message));
  }, []);

  return (
    <div className="grid-2">
      <section aria-labelledby="lib-title">
        <h1 id="lib-title">הספרייה שלי</h1>
        <p className="muted">כל פריט הוא סרטון או טקסט. פותחים פריט ומתחילים סשן כדי למדוד קשב בזמן הצפייה או הקריאה.</p>
        {error && <div className="alert alert-error" role="alert">{error}</div>}
        {items === null && !error && <p className="muted">טוען…</p>}
        {items && items.length === 0 && (
          <div className="card empty">
            <h2>הספרייה ריקה</h2>
            <p>עוד לא הוספת תוכן. הוסיפו סרטון YouTube או טקסט בטופס, ואז פתחו אותו כדי להתחיל סשן.</p>
          </div>
        )}
        {items && items.length > 0 && (
          <ul className="content-list">
            {items.map((it) => (
              <ContentRow key={it.id} item={it} onDeleted={(id) => setItems(items.filter((x) => x.id !== id))} />
            ))}
          </ul>
        )}
      </section>
      <aside>
        <AddContentForm onAdded={(item) => setItems((prev) => [item, ...(prev || [])])} />
      </aside>
    </div>
  );
}
