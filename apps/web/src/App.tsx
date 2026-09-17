import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { DatabaseProvider } from './contexts/DatabaseContext';
import AddDatabaseModal from './components/database/AddDatabaseModal';
import AppLayout from './components/layout/AppLayout';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import InvestigationsPage from './pages/InvestigationsPage';
import InvestigationDetailPage from './pages/InvestigationDetailPage';
import NetworkGraphPage from './pages/NetworkGraphPage';
import EntitiesPage from './pages/EntitiesPage';
import EntityDetailPage from './pages/EntityDetailPage';
import DocumentsPage from './pages/DocumentsPage';
import AlertsPage from './pages/AlertsPage';
import TimelinePage from './pages/TimelinePage';
import AIAssistantPage from './pages/AIAssistantPage';
import EvidencePage from './pages/EvidencePage';
import EvidenceDetailPage from './pages/EvidenceDetailPage';
import AuditLogsPage from './pages/AuditLogsPage';
import DatabasePage from './pages/DatabasePage';
import DataSourcesPage from './pages/DataSourcesPage';
import InspectorHomePage from './pages/InspectorHomePage';
import UserManagementPage from './pages/UserManagementPage';
import CDRAnalysisPage from './pages/CDRAnalysisPage';
import { isInspectorRole } from './lib/permissions';

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();
  if (isLoading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: 'var(--bg-primary)' }}>
      <div className="loading-spinner" style={{ width: 40, height: 40, borderWidth: 3 }} />
    </div>
  );
  return isAuthenticated ? <>{children}</> : <Navigate to="/login" replace />;
}

function RootRedirect() {
  const { user } = useAuth();
  return <Navigate to={isInspectorRole(user?.role) ? '/inspector' : '/dashboard'} replace />;
}

export default function App() {
  return (
    <AuthProvider>
      <DatabaseProvider>
        <AddDatabaseModal />
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/" element={
            <RequireAuth>
              <AppLayout />
            </RequireAuth>
          }>
            <Route index element={<RootRedirect />} />
            <Route path="inspector" element={<InspectorHomePage />} />
            <Route path="dashboard" element={<DashboardPage />} />
            <Route path="investigations" element={<InvestigationsPage />} />
            <Route path="investigations/:id" element={<InvestigationDetailPage />} />
            <Route path="network" element={<NetworkGraphPage />} />
            <Route path="entities" element={<EntitiesPage />} />
            <Route path="entities/:type/:id" element={<EntityDetailPage />} />
            <Route path="documents" element={<DocumentsPage />} />
            <Route path="alerts" element={<AlertsPage />} />
            <Route path="timeline" element={<TimelinePage />} />
            <Route path="cdr-analysis" element={<CDRAnalysisPage />} />
            <Route path="ai-assistant" element={<AIAssistantPage />} />
            <Route path="evidence" element={<EvidencePage />} />
            <Route path="evidence/:id" element={<EvidenceDetailPage />} />
            <Route path="audit" element={<AuditLogsPage />} />
            <Route path="database" element={<DatabasePage />} />
            <Route path="data-sources" element={<DataSourcesPage />} />
            <Route path="datasources" element={<Navigate to="/data-sources" replace />} />
            <Route path="users" element={<UserManagementPage />} />
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Route>
        </Routes>
      </DatabaseProvider>
    </AuthProvider>
  );
}
