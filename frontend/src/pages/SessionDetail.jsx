import { useEffect, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { api } from '../api.js';
import ScoreChart from '../components/ScoreChart.jsx';
import { durationText, formatDate, formatPosition, formatScore, levelFor, LOW_FOCUS_THRESHOLD } from '../util.js';

export default function SessionDetail() {
  const { id } = useParams();
  const location = useLocation();
  const [s, setS] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api(`/sessions/${id}`).then(setS).catch(setError);
  }, [id]);

  if (error) {
    return (
      <div className="card center">
        <h1>{error.status === 404 ? 'הסשן לא נמצא' : 'שגיאה'}</h1>
        <p>{error.status === 404 ? 'הסשן לא קיים או שאין לך גישה אליו.' : error.message}</p>
        <Link className="btn" to="/history">חזרה להיסטוריה</Link>
      </div>
    );
  }
  if (!s) return <p className="muted center">טוען…</p>;

  const lv = levelFor(s.average_score);
  const lows = s.readings.filter((r) => r.score < LOW_FOCUS_THRESHOLD).length;

  return (
    <section aria-labelledby="sd-title">
      <p className="crumbs"><Link to="/history">היסטוריה</Link> ‹ סשן</p>
      {location.state?.justEnded && <div className="alert alert-success" role="status">הסשן הסתיים ונשמר. זה הסיכום שלו.</div>}
      <h1 id="sd-title">{s.content_title}</h1>
      <div className="stats">
        <div className="stat"><span>ציון ממוצע</span><strong style={{ color: lv?.color }}>{formatScore(s.average_score)}</strong><small>{lv?.label || 'אין מדידות'}</small></div>
        <div className="stat"><span>מדידות</span><strong>{s.reading_count}</strong></div>
        <div className="stat"><span>משך</span><strong>{s.ended_at ? durationText(s.started_at, s.ended_at) : 'פעיל'}</strong></div>
        <div className="stat"><span>רגעים של קשב נמוך</span><strong>{lows}</strong></div>
      </div>
      <p className="muted small">התחיל: {formatDate(s.started_at)}{s.ended_at && ` · הסתיים: ${formatDate(s.ended_at)}`}</p>

      <div className="card">
        <h2>הקשב לאורך הסשן</h2>
        <ScoreChart points={s.readings.map((r) => r.score)} />
      </div>

      {s.readings.length > 0 ? (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>#</th><th>זמן</th><th>מיקום בתוכן</th><th>ציון</th><th>רמה</th></tr></thead>
            <tbody>
              {s.readings.map((r, i) => {
                const l = levelFor(r.score);
                return (
                  <tr key={i} className={r.score < LOW_FOCUS_THRESHOLD ? 'row-low' : ''}>
                    <td>{i + 1}</td>
                    <td>{new Date(r.created_at).toLocaleTimeString('he-IL')}</td>
                    <td>{formatPosition(r.position, s.content_type)}</td>
                    <td><strong style={{ color: l?.color }}>{formatScore(r.score)}</strong></td>
                    <td>{l?.label}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="muted">בסשן הזה לא נשמרו מדידות (למשל אם הסשן הסתיים לפני הציון הראשון, או שלא זוהו פנים).</p>
      )}
      <p><Link className="btn btn-ghost" to={`/content/${s.content_id}`}>לצפות שוב בתוכן</Link></p>
    </section>
  );
}
