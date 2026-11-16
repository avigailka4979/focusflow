import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import ScoreChart from '../components/ScoreChart.jsx';
import { durationText, formatDate, formatScore, levelFor, TYPE_LABELS } from '../util.js';

export default function History() {
  const [sessions, setSessions] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api('/sessions').then(setSessions).catch((err) => setError(err.message));
  }, []);

  const scored = (sessions || []).filter((s) => s.average_score !== null);
  const overall = scored.length ? scored.reduce((a, s) => a + s.average_score, 0) / scored.length : null;

  return (
    <section aria-labelledby="hist-title">
      <h1 id="hist-title">היסטוריית סשנים</h1>
      <p className="muted">כל סשן הוא פעם אחת של צפייה או קריאה עם מדידה. לחצו על סשן כדי לראות את כל המדידות שלו.</p>
      {error && <div className="alert alert-error" role="alert">{error}</div>}
      {sessions === null && !error && <p className="muted">טוען…</p>}
      {sessions && sessions.length === 0 && (
        <div className="card empty">
          <h2>אין עדיין סשנים</h2>
          <p>פתחו פריט מ<Link to="/library">הספרייה</Link> והתחילו סשן מדידה.</p>
        </div>
      )}
      {sessions && sessions.length > 0 && (
        <>
          {scored.length > 1 && (
            <div className="card">
              <h2>הקשב שלך לאורך זמן</h2>
              <p className="muted small">ציון ממוצע לכל סשן, מהישן לחדש. ממוצע כללי: <strong>{formatScore(overall)}</strong></p>
              <ScoreChart points={[...scored].reverse().map((s) => s.average_score)} height={140} label="ממוצע קשב לפי סשן" />
            </div>
          )}
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr><th>תאריך</th><th>תוכן</th><th>משך</th><th>מדידות</th><th>ציון ממוצע</th><th /></tr>
              </thead>
              <tbody>
                {sessions.map((s) => {
                  const lv = levelFor(s.average_score);
                  return (
                    <tr key={s.id}>
                      <td>{formatDate(s.started_at)}</td>
                      <td>
                        <span className={`badge badge-${s.content_type}`}>{TYPE_LABELS[s.content_type] || ''}</span>{' '}
                        {s.content_title}
                      </td>
                      <td>{s.ended_at ? durationText(s.started_at, s.ended_at) : <span className="badge">פעיל</span>}</td>
                      <td>{s.reading_count}</td>
                      <td><strong style={{ color: lv?.color }}>{formatScore(s.average_score)}</strong>{lv && <span className="muted small"> {lv.label}</span>}</td>
                      <td><Link className="btn btn-small" to={`/history/${s.id}`}>פרטים</Link></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
