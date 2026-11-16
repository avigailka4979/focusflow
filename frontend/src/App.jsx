import { Link, Navigate, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './auth.jsx';
import Login from './pages/Login.jsx';
import Register from './pages/Register.jsx';
import Library from './pages/Library.jsx';
import ContentView from './pages/ContentView.jsx';
import History from './pages/History.jsx';
import SessionDetail from './pages/SessionDetail.jsx';
import Profile from './pages/Profile.jsx';

function Nav() {
  const { user, logout } = useAuth();
  return (
    <header className="topbar">
      <Link to={user ? '/library' : '/login'} className="brand" aria-label="FocusFlow - דף הבית">
        <img src="/favicon.svg" alt="" width="26" height="26" /> FocusFlow
      </Link>
      {user ? (
        <nav className="nav" aria-label="ניווט ראשי">
          <NavLink to="/library">הספרייה שלי</NavLink>
          <NavLink to="/history">היסטוריה</NavLink>
          <NavLink to="/profile">פרופיל</NavLink>
          <span className="nav-user" title={user.email}>שלום, {user.display_name}</span>
          <button type="button" className="btn btn-small btn-ghost" onClick={() => logout()}>התנתקות</button>
        </nav>
      ) : (
        <nav className="nav" aria-label="ניווט ראשי">
          <NavLink to="/login">התחברות</NavLink>
          <NavLink to="/register">הרשמה</NavLink>
        </nav>
      )}
    </header>
  );
}

function RequireAuth({ children }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <p className="muted center">טוען…</p>;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return children;
}

function GuestOnly({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <p className="muted center">טוען…</p>;
  if (user) return <Navigate to="/library" replace />;
  return children;
}

function NotFound() {
  return (
    <div className="card center">
      <h1>הדף לא נמצא</h1>
      <p>הכתובת שפתחת לא קיימת.</p>
      <Link className="btn" to="/">חזרה לדף הבית</Link>
    </div>
  );
}

export default function App() {
  const { user, loading } = useAuth();
  return (
    <>
      <Nav />
      <main className="container">
        <Routes>
          <Route path="/" element={loading ? null : <Navigate to={user ? '/library' : '/login'} replace />} />
          <Route path="/login" element={<GuestOnly><Login /></GuestOnly>} />
          <Route path="/register" element={<GuestOnly><Register /></GuestOnly>} />
          <Route path="/library" element={<RequireAuth><Library /></RequireAuth>} />
          <Route path="/content/:id" element={<RequireAuth><ContentView /></RequireAuth>} />
          <Route path="/history" element={<RequireAuth><History /></RequireAuth>} />
          <Route path="/history/:id" element={<RequireAuth><SessionDetail /></RequireAuth>} />
          <Route path="/profile" element={<RequireAuth><Profile /></RequireAuth>} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </main>
      <footer className="footer">FocusFlow · מדידת הקשב רצה בדפדפן שלך; הווידאו מהמצלמה לא נשלח לשרת.</footer>
    </>
  );
}
