import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api.js';

export function passwordHint(pw) {
  if (pw.length < 8) return 'לפחות 8 תווים';
  if (!/[A-Za-z\u0590-\u05FF]/.test(pw) || !/\d/.test(pw)) return 'צריך לפחות אות אחת וספרה אחת';
  return '';
}

export default function Register() {
  const navigate = useNavigate();
  const [form, setForm] = useState({ display_name: '', email: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const hint = form.password ? passwordHint(form.password) : '';

  async function submit(e) {
    e.preventDefault();
    setError('');
    if (!form.display_name.trim() || !form.email.trim() || !form.password) {
      setError('יש למלא את כל השדות');
      return;
    }
    const problem = passwordHint(form.password);
    if (problem) {
      setError(`הסיסמה חלשה מדי: ${problem}`);
      return;
    }
    setBusy(true);
    try {
      await api('/auth/register', {
        method: 'POST', auth: false,
        body: { display_name: form.display_name.trim(), email: form.email.trim(), password: form.password },
      });
      navigate('/login', {
        replace: true,
        state: { notice: 'נרשמת בהצלחה! עכשיו התחברו עם האימייל והסיסמה שבחרתם.', email: form.email.trim() },
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-wrap">
      <form className="card auth-card" onSubmit={submit} noValidate>
        <h1>הרשמה</h1>
        <p className="muted">יוצרים חשבון חדש בכמה שניות.</p>
        {error && <div className="alert alert-error" role="alert">{error}</div>}
        <label htmlFor="reg-name">שם תצוגה</label>
        <input id="reg-name" name="display_name" autoComplete="nickname" maxLength={50}
          value={form.display_name} onChange={set('display_name')} required />
        <label htmlFor="reg-email">אימייל</label>
        <input id="reg-email" name="email" type="email" autoComplete="email" dir="ltr"
          value={form.email} onChange={set('email')} required />
        <label htmlFor="reg-password">סיסמה</label>
        <input id="reg-password" name="password" type="password" autoComplete="new-password" dir="ltr"
          value={form.password} onChange={set('password')} required aria-describedby="pw-help" />
        <small id="pw-help" className={hint ? 'hint-bad' : 'muted'}>
          {hint ? `הסיסמה עדיין חלשה: ${hint}` : 'לפחות 8 תווים, כולל אות וספרה.'}
        </small>
        <button className="btn btn-block" type="submit" disabled={busy}>{busy ? 'נרשם…' : 'הרשמה'}</button>
        <p className="center">כבר רשומים? <Link to="/login">להתחברות</Link></p>
      </form>
    </div>
  );
}
