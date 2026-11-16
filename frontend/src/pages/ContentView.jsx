import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, tokenStore } from '../api.js';
import YouTubePlayer from '../components/YouTubePlayer.jsx';
import ScoreChart from '../components/ScoreChart.jsx';
import { FocusTracker, listCameras, WINDOW, FPS } from '../focus/tracker.js';
import { formatScore, levelFor, LOW_FOCUS_THRESHOLD, TYPE_LABELS } from '../util.js';

const STATUS_TEXT = {
  loading: 'מפעיל מצלמה וטוען את מודל הקשב… (בפעם הראשונה זה יכול לקחת כמה שניות)',
  collecting: 'אוסף נתוני פנים. הציון הראשון יופיע אחרי כעשר שניות של פנים מול המצלמה.',
  tracking: 'המדידה פעילה. ציון חדש בערך כל שתי שניות.',
  no_face: 'לא זוהו פנים. ודאו שהפנים מול המצלמה ושיש תאורה טובה. המדידה מושהית עד שהפנים יזוהו.',
  model_error: 'שגיאה בהרצת המודל. נסו לסיים את הסשן ולהתחיל מחדש.',
};

function cameraErrorText(err) {
  switch (err?.name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'לא ניתנה הרשאה למצלמה. אפשר לאשר גישה למצלמה בהגדרות הדפדפן (סמל המנעול ליד הכתובת) ולנסות שוב. אפשר גם להמשיך לצפות בלי מדידה.';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'לא נמצאה מצלמה. חברו מצלמה (או בחרו מצלמה אחרת) ונסו שוב.';
    case 'NotReadableError':
      return 'המצלמה תפוסה על ידי תוכנה אחרת. סגרו אותה ונסו שוב.';
    case 'ModelLoadError':
      return err.message;
    default:
      return `לא הצלחנו להתחיל את המדידה: ${err?.message || 'שגיאה לא ידועה'}`;
  }
}

function ScorePanel({ score, status, progress }) {
  const level = levelFor(score);
  const waiting = score === null;
  return (
    <div className="score-panel" aria-live="polite">
      <div className="score-head">
        <span className="score-label">ציון קשב</span>
        <span className="score-value" data-testid="focus-score" style={{ color: level?.color }}>
          {waiting ? '—' : formatScore(score)}
        </span>
        {level && <span className="score-level" style={{ background: level.color }}>{level.label}</span>}
      </div>
      <div className="meter" role="meter" aria-valuemin={0} aria-valuemax={1}
        aria-valuenow={waiting ? undefined : Number(score.toFixed(2))} aria-label="ציון קשב בין 0 ל-1">
        <div className="meter-fill" style={{ width: `${waiting ? 0 : score * 100}%`, background: level?.color }} />
        <div className="meter-threshold" style={{ insetInlineStart: `${LOW_FOCUS_THRESHOLD * 100}%` }} />
      </div>
      <p className="muted small">0 = לא קשוב או לא מול המצלמה, 1 = קשוב מאוד. מתחת ל-{LOW_FOCUS_THRESHOLD} נחשב קשב נמוך.</p>
      <p className={`status status-${status}`}>{STATUS_TEXT[status] || ''}</p>
      {status === 'collecting' && (
        <div className="progress" aria-label="איסוף נתונים לציון הראשון">
          <div style={{ width: `${Math.round(progress * 100)}%` }} />
          <span>{Math.round(progress * WINDOW)}/{WINDOW} פריימים (~{Math.max(0, Math.ceil((1 - progress) * WINDOW / FPS))} שנ')</span>
        </div>
      )}
    </div>
  );
}

export default function ContentView() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [content, setContent] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [phase, setPhase] = useState('idle'); // idle | starting | active | ending
  const [status, setStatus] = useState('');
  const [progress, setProgress] = useState(0);
  const [score, setScore] = useState(null);
  const [scores, setScores] = useState([]);
  const [alert, setAlert] = useState(null);   // {score, paused}
  const [error, setError] = useState('');
  const [cameras, setCameras] = useState([]);
  const [cameraId, setCameraId] = useState('');
  const [showPreview, setShowPreview] = useState(true);

  const videoRef = useRef(null);
  const trackerRef = useRef(null);
  const playerRef = useRef(null);
  const textRef = useRef(null);
  const sessionRef = useRef(null);
  const lowRef = useRef(0);
  const pauseBlockedUntil = useRef(0); // no auto-pause right after the user resumes
  const contentRef = useRef(null);

  useEffect(() => {
    setContent(null); setLoadError(null);
    api(`/content/${id}`)
      .then((c) => { setContent(c); contentRef.current = c; })
      .catch((err) => setLoadError(err));
  }, [id]);

  const position = useCallback(() => {
    if (contentRef.current?.type === 'youtube') return playerRef.current?.getPosition() || 0;
    const el = textRef.current;
    if (!el) return 0;
    const max = el.scrollHeight - el.clientHeight;
    return max > 0 ? Math.min(1, el.scrollTop / max) : 0;
  }, []);

  const onScore = useCallback(({ score: s, level }) => {
    const sid = sessionRef.current;
    if (!sid) return;
    setScore(s);
    setScores((prev) => [...prev, s]);
    api(`/sessions/${sid}/readings`, {
      method: 'POST', body: { position: Number(position().toFixed(2)), score: Number(s.toFixed(4)), level },
    }).catch(() => { /* a lost reading is not fatal */ });

    if (s < LOW_FOCUS_THRESHOLD) {
      lowRef.current += 1;
      // Intervention: after three low scores in a row (~6 s), pause the video,
      // but never within 30 s of the user resuming or dismissing the alert.
      const pause = lowRef.current >= 3 && contentRef.current?.type === 'youtube'
        && Date.now() > pauseBlockedUntil.current;
      if (pause) playerRef.current?.pause();
      setAlert((a) => ({ score: s, paused: Boolean(a?.paused || pause) }));
    } else {
      lowRef.current = 0;
      setAlert((a) => (a && !a.paused ? null : a));
    }
  }, [position]);

  // End an open session without waiting (tab closed / navigated away).
  const endQuietly = useCallback(() => {
    const sid = sessionRef.current;
    trackerRef.current?.stop();
    trackerRef.current = null;
    if (!sid) return;
    sessionRef.current = null;
    const token = tokenStore.get();
    try {
      fetch(`/api/sessions/${sid}/end`, {
        method: 'POST', keepalive: true, headers: token ? { Authorization: `Bearer ${token}` } : {},
      }).catch(() => {});
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    window.addEventListener('pagehide', endQuietly);
    return () => {
      window.removeEventListener('pagehide', endQuietly);
      endQuietly();
    };
  }, [endQuietly]);

  async function start() {
    setError(''); setAlert(null); setScore(null); setScores([]); setProgress(0);
    lowRef.current = 0;
    setPhase('starting');
    const tracker = new FocusTracker(videoRef.current, {
      onStatus: (s) => setStatus(s),
      onProgress: setProgress,
      onScore,
    });
    trackerRef.current = tracker;
    try {
      await tracker.start(cameraId || undefined);
      listCameras().then((list) => {
        setCameras(list);
        const active = tracker.stream?.getVideoTracks?.()[0]?.getSettings?.().deviceId;
        if (active) setCameraId(active);
      }).catch(() => {});
      const session = await api('/sessions', { method: 'POST', body: { content_id: id } });
      sessionRef.current = session.id;
      setPhase('active');
      if (contentRef.current?.type === 'youtube') playerRef.current?.play();
    } catch (err) {
      tracker.stop();
      trackerRef.current = null;
      setStatus('');
      setPhase('idle');
      setError(err?.status !== undefined ? err.message : cameraErrorText(err));
    }
  }

  async function end() {
    const sid = sessionRef.current;
    setPhase('ending');
    trackerRef.current?.stop();
    trackerRef.current = null;
    playerRef.current?.pause();
    sessionRef.current = null;
    try {
      await api(`/sessions/${sid}/end`, { method: 'POST' });
      navigate(`/history/${sid}`, { state: { justEnded: true } });
    } catch (err) {
      setError(err.message);
      setPhase('idle');
    }
  }

  async function changeCamera(e) {
    const newId = e.target.value;
    setCameraId(newId);
    if (trackerRef.current) {
      try {
        await trackerRef.current.switchCamera(newId);
      } catch (err) {
        setError(cameraErrorText(err));
      }
    }
  }

  if (loadError) {
    return (
      <div className="card center">
        <h1>{loadError.status === 404 ? 'הפריט לא נמצא' : 'שגיאה'}</h1>
        <p>{loadError.status === 404 ? 'הפריט לא קיים או שאין לך גישה אליו.' : loadError.message}</p>
        <Link className="btn" to="/library">חזרה לספרייה</Link>
      </div>
    );
  }
  if (!content) return <p className="muted center">טוען…</p>;

  const running = phase === 'active' || phase === 'starting';

  return (
    <div className="watch-layout">
      <section className="watch-main" aria-labelledby="content-title">
        <p className="crumbs"><Link to="/library">הספרייה שלי</Link> ‹ <span className={`badge badge-${content.type}`}>{TYPE_LABELS[content.type]}</span></p>
        <h1 id="content-title">{content.title}</h1>

        {alert && (
          <div className="alert alert-warn focus-alert" role="alert">
            <strong>נראה שהקשב ירד (ציון {formatScore(alert.score)}).</strong>{' '}
            {alert.paused ? 'עצרנו את הסרטון כדי שלא תפספס/י. ' : 'נסו להתרכז שוב או לקחת הפסקה קצרה. '}
            <span className="alert-actions">
              {content.type === 'youtube' && (
                <button type="button" className="btn btn-small" onClick={() => { playerRef.current?.rewind(15); setAlert(null); lowRef.current = 0; pauseBlockedUntil.current = Date.now() + 30000; }}>
                  חזרה 15 שניות אחורה
                </button>
              )}
              <button type="button" className="btn btn-small btn-ghost" onClick={() => {
                if (alert.paused) playerRef.current?.play();
                setAlert(null); lowRef.current = 0; pauseBlockedUntil.current = Date.now() + 30000;
              }}>
                {alert.paused ? 'המשך צפייה' : 'הבנתי'}
              </button>
            </span>
          </div>
        )}

        {content.type === 'youtube' ? (
          <YouTubePlayer ref={playerRef} videoId={content.youtube_id} title={content.title} />
        ) : (
          <article className="reader" ref={textRef} tabIndex={0} aria-label="הטקסט לקריאה">
            {content.source}
          </article>
        )}
      </section>

      <aside className="watch-side card" aria-labelledby="session-title">
        <h2 id="session-title">סשן מדידת קשב</h2>

        {phase === 'idle' && (
          <div className="consent">
            <p>כדי למדוד קשב, האתר משתמש במצלמה:</p>
            <ul>
              <li>הווידאו מעובד <strong>רק בדפדפן שלך</strong> ולא נשלח לשרת ולא נשמר.</li>
              <li>מהווידאו מחושבות נקודות פנים, ומהן ציון קשב בין 0 ל-1.</li>
              <li>רק הציון והמיקום בתוכן נשמרים בהיסטוריה שלך.</li>
              <li>המצלמה נכבית כשהסשן מסתיים.</li>
            </ul>
            {cameras.length > 1 && (
              <>
                <label htmlFor="camera-select-idle">מצלמה</label>
                <select id="camera-select-idle" value={cameraId} onChange={(e) => setCameraId(e.target.value)}>
                  {cameras.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                </select>
              </>
            )}
            <button type="button" className="btn btn-block" onClick={start}>
              אני מסכים/ה, הפעלת מצלמה והתחלת סשן
            </button>
            <p className="muted small">לא חובה: אפשר גם לצפות או לקרוא בלי מדידה.</p>
          </div>
        )}

        {error && <div className="alert alert-error" role="alert">{error}</div>}

        <div className={running ? 'camera-box' : 'camera-box hidden'}>
          <video ref={videoRef} className={showPreview ? 'preview' : 'preview invisible'} muted playsInline aria-label="תצוגה מקדימה של המצלמה" />
          {running && (
            <label className="check">
              <input type="checkbox" checked={showPreview} onChange={(e) => setShowPreview(e.target.checked)} /> הצג תצוגה מקדימה
            </label>
          )}
        </div>

        {running && (
          <>
            {cameras.length > 0 && (
              <>
                <label htmlFor="camera-select">מצלמה</label>
                <select id="camera-select" value={cameraId} onChange={changeCamera}>
                  {cameras.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                </select>
              </>
            )}
            <ScorePanel score={score} status={status} progress={progress} />
            {scores.length > 1 && <ScoreChart points={scores} height={110} />}
            <button type="button" className="btn btn-block btn-danger" onClick={end} disabled={phase !== 'active'}>
              סיום הסשן
            </button>
            <p className="muted small">בסיום הסשן תועבר/י לסיכום שלו בהיסטוריה.</p>
          </>
        )}
        {phase === 'ending' && <p className="muted">מסיים את הסשן…</p>}
      </aside>
    </div>
  );
}
