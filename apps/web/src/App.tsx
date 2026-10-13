import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Layout } from './components/Layout';
import { Spinner } from './components/ui';
import { isConfigured } from './lib/backend';
import { useSession } from './lib/session';
import DashboardPage from './pages/DashboardPage';
import LoginPage from './pages/LoginPage';
import ProjectPage from './pages/ProjectPage';
import ProjectsPage from './pages/ProjectsPage';
import ResetPasswordPage from './pages/ResetPasswordPage';
import SettingsPage from './pages/SettingsPage';
import TemplatesPage from './pages/TemplatesPage';

function SetupRequired() {
  return (
    <div className="center-screen">
      <div className="card card-pad" style={{ maxWidth: 560 }}>
        <h1>Configuration required</h1>
        <p className="muted">
          This build has no Supabase connection. Set <span className="mono">VITE_SUPABASE_URL</span> and{' '}
          <span className="mono">VITE_SUPABASE_PUBLISHABLE_KEY</span> (public values only) and rebuild. See the README.
        </p>
      </div>
    </div>
  );
}

function NotAuthorized() {
  const { backend, refresh } = useSession();
  return (
    <div className="center-screen">
      <div className="card card-pad stack" style={{ maxWidth: 520 }}>
        <h1>Access denied</h1>
        <p className="muted">This account is signed in but is not authorized to use the ACAD Document Generator.</p>
        <div>
          <button
            className="btn btn-primary"
            onClick={async () => {
              await backend?.auth.signOut();
              await refresh();
            }}
          >
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const { loading, session, authorized } = useSession();
  const location = useLocation();
  if (!isConfigured()) return <SetupRequired />;
  if (location.pathname === '/reset-password') return <ResetPasswordPage />;
  if (loading) {
    return (
      <div className="center-screen">
        <Spinner label="Loading…" />
      </div>
    );
  }
  if (!session || session.needsMfa) {
    return (
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="*" element={<Navigate to="/login" replace state={{ from: location.pathname }} />} />
      </Routes>
    );
  }
  if (authorized === false) return <NotAuthorized />;
  if (authorized === null) {
    return (
      <div className="center-screen">
        <Spinner label="Checking access…" />
      </div>
    );
  }
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/projects" element={<ProjectsPage />} />
        <Route path="/projects/new" element={<ProjectPage />} />
        <Route path="/projects/:id" element={<ProjectPage />} />
        <Route path="/templates" element={<TemplatesPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/login" element={<Navigate to="/" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}
