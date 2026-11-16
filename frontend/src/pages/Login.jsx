import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth.jsx';

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState(location.state?.email || '');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const notice = location.state?.notice;

  async function submit(e) {
    e.preventDefault();
    setError('');
    if (!email.trim() || !password) {
      setError('יש למלא אימייל וסיסמה');
      return;
    }
    setBusy(true);
    try {
      await login(email.trim(), password);
      navigate(location.state?.from || '/library', { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-wrap">
      <form className="card auth-card" onSubmit={submit} noValidate>
        <h1>התחברות</h1>
        <p className="muted">התחברו כדי לראות את הספרייה שלכם ולהתחיל סשן מדידה.</p>
        {notice && <div className="alert alert-info" role="status">{notice}</div>}
        {error && <div className="alert alert-error" role="alert">{error}</div>}
        <label htmlFor="login-email">אימייל</label>
        <input id="login-email" name="email" type="email" autoComplete="email" dir="ltr"
          value={email} onChange={(e) => setEmail(e.target.value)} required />
        <label htmlFor="login-password">סיסמה</label>
        <input id="login-password" name="password" type="password" autoComplete="current-password" dir="ltr"
          value={password} onChange={(e) => setPassword(e.target.value)} required />
        <button className="btn btn-block" type="submit" disabled={busy}>{busy ? 'מתחבר…' : 'התחברות'}</button>
        <p className="center">אין לך חשבון? <Link to="/register">להרשמה</Link></p>
      </form>
    </div>
  );
}
