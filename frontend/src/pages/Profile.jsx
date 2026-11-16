import { useState } from 'react';
import { api, tokenStore } from '../api.js';
import { useAuth } from '../auth.jsx';
import { formatDate } from '../util.js';
import { passwordHint } from './Register.jsx';

export default function Profile() {
  const { user, setUser, logout, dropSession } = useAuth();
  const [name, setName] = useState(user.display_name);
  const [nameMsg, setNameMsg] = useState(null);
  const [pw, setPw] = useState({ current_password: '', new_password: '', confirm: '' });
  const [pwMsg, setPwMsg] = useState(null);
  const [del, setDel] = useState({ open: false, text: '' });
  const [delMsg, setDelMsg] = useState(null);

  async function saveName(e) {
    e.preventDefault();
    setNameMsg(null);
    if (!name.trim()) { setNameMsg({ err: true, text: 'יש למלא שם תצוגה' }); return; }
    try {
      const me = await api('/users/me', { method: 'PATCH', body: { display_name: name.trim() } });
      setUser(me);
      setNameMsg({ err: false, text: 'שם התצוגה עודכן' });
    } catch (err) {
      setNameMsg({ err: true, text: err.message });
    }
  }

  async function changePassword(e) {
    e.preventDefault();
    setPwMsg(null);
    if (!pw.current_password || !pw.new_password) { setPwMsg({ err: true, text: 'יש למלא את הסיסמה הנוכחית והחדשה' }); return; }
    const hint = passwordHint(pw.new_password);
    if (hint) { setPwMsg({ err: true, text: `הסיסמה החדשה חלשה מדי: ${hint}` }); return; }
    if (pw.new_password !== pw.confirm) { setPwMsg({ err: true, text: 'אימות הסיסמה לא תואם' }); return; }
    try {
      await api('/users/me/password', { method: 'POST', body: { current_password: pw.current_password, new_password: pw.new_password } });
      // The server invalidates all existing tokens after a password change.
      tokenStore.clear();
      dropSession('הסיסמה הוחלפה. מטעמי אבטחה, התחברו מחדש עם הסיסמה החדשה.');
    } catch (err) {
      setPwMsg({ err: true, text: err.message });
    }
  }

  async function deleteAccount() {
    setDelMsg(null);
    try {
      await api('/users/me', { method: 'DELETE' });
      tokenStore.clear();
      dropSession('החשבון וכל הנתונים שלו נמחקו.');
    } catch (err) {
      setDelMsg(err.message);
    }
  }

  return (
    <section aria-labelledby="prof-title" className="narrow">
      <h1 id="prof-title">הפרופיל שלי</h1>
      <div className="card">
        <h2>פרטים</h2>
        <p><span className="muted">אימייל:</span> <span dir="ltr">{user.email}</span></p>
        <p><span className="muted">נרשמת:</span> {formatDate(user.created_at)}</p>
        <form onSubmit={saveName} noValidate>
          <label htmlFor="prof-name">שם תצוגה</label>
          <input id="prof-name" value={name} maxLength={50} onChange={(e) => setName(e.target.value)} />
          {nameMsg && <div className={`alert ${nameMsg.err ? 'alert-error' : 'alert-success'}`} role="status">{nameMsg.text}</div>}
          <button className="btn" type="submit">שמירת שם</button>
        </form>
      </div>

      <form className="card" onSubmit={changePassword} noValidate>
        <h2>החלפת סיסמה</h2>
        <label htmlFor="pw-cur">סיסמה נוכחית</label>
        <input id="pw-cur" type="password" dir="ltr" autoComplete="current-password" value={pw.current_password}
          onChange={(e) => setPw({ ...pw, current_password: e.target.value })} />
        <label htmlFor="pw-new">סיסמה חדשה</label>
        <input id="pw-new" type="password" dir="ltr" autoComplete="new-password" value={pw.new_password}
          onChange={(e) => setPw({ ...pw, new_password: e.target.value })} />
        <small className="muted">לפחות 8 תווים, כולל אות וספרה. אחרי ההחלפה יש להתחבר מחדש.</small>
        <label htmlFor="pw-confirm">אימות סיסמה חדשה</label>
        <input id="pw-confirm" type="password" dir="ltr" autoComplete="new-password" value={pw.confirm}
          onChange={(e) => setPw({ ...pw, confirm: e.target.value })} />
        {pwMsg && <div className={`alert ${pwMsg.err ? 'alert-error' : 'alert-success'}`} role="alert">{pwMsg.text}</div>}
        <button className="btn" type="submit">החלפת סיסמה</button>
      </form>

      <div className="card danger-zone">
        <h2>מחיקת חשבון</h2>
        <p>מחיקת החשבון מוחקת לצמיתות את כל התוכן, הסשנים והמדידות שלך. אי אפשר לבטל.</p>
        {!del.open ? (
          <button type="button" className="btn btn-danger" onClick={() => setDel({ open: true, text: '' })}>מחיקת החשבון</button>
        ) : (
          <div>
            <label htmlFor="del-confirm">כדי לאשר, הקלידו <strong>מחק</strong></label>
            <input id="del-confirm" value={del.text} onChange={(e) => setDel({ ...del, text: e.target.value })} />
            <div className="row-actions">
              <button type="button" className="btn btn-danger" disabled={del.text.trim() !== 'מחק'} onClick={deleteAccount}>
                מחיקה לצמיתות
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => setDel({ open: false, text: '' })}>ביטול</button>
            </div>
          </div>
        )}
        {delMsg && <div className="alert alert-error" role="alert">{delMsg}</div>}
      </div>
      <p><button type="button" className="btn btn-ghost" onClick={() => logout()}>התנתקות</button></p>
    </section>
  );
}
