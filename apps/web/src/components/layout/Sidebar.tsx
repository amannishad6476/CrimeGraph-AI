import { useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, FolderOpen, Network, Users, FileText,
  Bell, Clock, Bot, Shield, BookOpen, Activity, Database, Server, Sliders, Radio,
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { canManageDatabases, canViewAuditLogs, isInspectorRole } from '../../lib/permissions';

const navItems = [
  { path: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, section: 'main' },
  { path: '/inspector', label: 'Inspector Home', icon: Users, section: 'main', inspectorOnly: true },
  { path: '/investigations', label: 'Investigations', icon: FolderOpen, section: 'main' },
  { path: '/network', label: 'Network Graph', icon: Network, section: 'analysis' },
  { path: '/database', label: 'Database Explorer', icon: Database, section: 'analysis' },
  { path: '/entities', label: 'Entities', icon: Users, section: 'analysis' },
  { path: '/timeline', label: 'Timeline', icon: Clock, section: 'analysis' },
  { path: '/cdr-analysis', label: 'CDR Analysis', icon: Radio, section: 'analysis' },
  { path: '/alerts', label: 'Alerts', icon: Bell, section: 'intel' },
  { path: '/documents', label: 'Documents', icon: FileText, section: 'intel', hideForAdmin: true },
  { path: '/data-sources', label: 'Data Sources', icon: Server, section: 'tools' },
  { path: '/ai-assistant', label: 'AI Assistant', icon: Bot, section: 'tools' },
  { path: '/evidence', label: 'Evidence', icon: Shield, section: 'tools' },
  { path: '/audit', label: 'Audit Logs', icon: BookOpen, section: 'tools', adminOnly: true },
  { path: '/users', label: 'User Management', icon: Sliders, section: 'tools', adminOnly: true },
];

const sections = [
  { key: 'main', label: 'Investigation' },
  { key: 'analysis', label: 'Analysis' },
  { key: 'intel', label: 'Intelligence' },
  { key: 'tools', label: 'System & Tools' },
];

const nodeColors: Record<string, string> = {
  Person: '#3b82f6', Phone: '#22c55e', Vehicle: '#f97316',
  Organization: '#8b5cf6', Location: '#ef4444', Account: '#eab308',
  Case: '#06b6d4', Event: '#ec4899',
};


export default function Sidebar() {
  const { user } = useAuth();
  const location = useLocation();

  // Investigation context
  const investigationMatch = location.pathname.match(/^\/investigations\/([^/]+)$/);
  const isInvestigationDetail = Boolean(investigationMatch);
  const investigationId = investigationMatch
    ? decodeURIComponent(investigationMatch[1])
    : ['/network', '/timeline', '/ai-assistant'].includes(location.pathname)
      ? new URLSearchParams(location.search).get('investigation')
      : null;
  const currentInvestigationTab = new URLSearchParams(location.search).get('tab') || 'overview';

  // Entity context
  const entityMatch = location.pathname.match(/^\/entities\/([^/]+)\/([^/]+)$/);
  const isEntityDetail = Boolean(entityMatch);
  const entityType = entityMatch
    ? decodeURIComponent(entityMatch[1])
    : ['/network', '/timeline'].includes(location.pathname)
      ? new URLSearchParams(location.search).get('entityType')
      : null;
  const entityId = entityMatch
    ? decodeURIComponent(entityMatch[2])
    : ['/network', '/timeline'].includes(location.pathname)
      ? new URLSearchParams(location.search).get('entityId') || new URLSearchParams(location.search).get('entity')
      : null;
  const currentEntityTab = new URLSearchParams(location.search).get('tab') || 'details';

  // Evidence context
  const evidenceMatch = location.pathname.match(/^\/evidence\/([^/]+)$/);
  const isEvidenceDetail = Boolean(evidenceMatch);
  const evidenceId = evidenceMatch
    ? decodeURIComponent(evidenceMatch[1])
    : null;
  const currentEvidenceTab = new URLSearchParams(location.search).get('tab') || 'details';

  const isEvidenceContext = Boolean(isEvidenceDetail && evidenceId);
  const isEntityContext = Boolean(!isEvidenceContext && entityType && entityId && (isEntityDetail || !investigationId));
  const isInvestigationContext = Boolean(!isEvidenceContext && investigationId && !isEntityDetail);

  const investigationItems = investigationId ? [
    { path: `/investigations/${encodeURIComponent(investigationId)}?tab=overview`, label: 'Overview', icon: FolderOpen },
    { path: `/investigations/${encodeURIComponent(investigationId)}?tab=entities`, label: 'Entities', icon: Users },
    { path: `/investigations/${encodeURIComponent(investigationId)}?tab=sources`, label: 'Sources', icon: FileText },
    { path: `/investigations/${encodeURIComponent(investigationId)}?tab=evidence`, label: 'Evidence', icon: Shield },
    { path: `/investigations/${encodeURIComponent(investigationId)}?tab=notes`, label: 'Notes', icon: FileText },
    { path: `/investigations/${encodeURIComponent(investigationId)}?tab=timeline`, label: 'Timeline', icon: Clock },
    { path: `/network?investigation=${encodeURIComponent(investigationId)}`, label: 'Network Graph', icon: Network },
    { path: `/ai-assistant?investigation=${encodeURIComponent(investigationId)}`, label: 'AI Assistant', icon: Bot },
    { path: `/investigations/${encodeURIComponent(investigationId)}?tab=settings`, label: 'Access & Settings', icon: Sliders },
  ] : [];

  const entityItems = (entityType && entityId) ? [
    {
      path: `/entities/${encodeURIComponent(entityType)}/${encodeURIComponent(entityId)}?tab=details`,
      label: 'Known Details',
      icon: FileText,
      tab: 'details',
    },
    {
      path: `/entities/${encodeURIComponent(entityType)}/${encodeURIComponent(entityId)}?tab=relationships`,
      label: 'Relationships',
      icon: Users,
      tab: 'relationships',
    },
    {
      path: `/entities/${encodeURIComponent(entityType)}/${encodeURIComponent(entityId)}?tab=potential-links`,
      label: 'Potential Links',
      icon: Bot,
      tab: 'potential-links',
    },
    {
      path: `/entities/${encodeURIComponent(entityType)}/${encodeURIComponent(entityId)}?tab=evidence`,
      label: 'Evidence & Ledger',
      icon: Shield,
      tab: 'evidence',
    },
    {
      path: `/network?entityType=${encodeURIComponent(entityType)}&entityId=${encodeURIComponent(entityId)}`,
      label: 'Network Graph',
      icon: Network,
      pagePath: '/network',
    },
    {
      path: `/timeline?entity=${encodeURIComponent(entityId)}&entityType=${encodeURIComponent(entityType)}`,
      label: 'Timeline Events',
      icon: Clock,
      pagePath: '/timeline',
    },
    {
      path: `/entities/${encodeURIComponent(entityType)}/${encodeURIComponent(entityId)}?tab=settings`,
      label: 'Access & Settings',
      icon: Sliders,
      tab: 'settings',
    },
  ] : [];

  const evidenceItems = evidenceId ? [
    {
      path: `/evidence/${encodeURIComponent(evidenceId)}?tab=details`,
      label: 'Block Details',
      icon: FileText,
      tab: 'details',
    },
    {
      path: `/evidence/${encodeURIComponent(evidenceId)}?tab=chain`,
      label: 'Hash Chain',
      icon: Shield,
      tab: 'chain',
    },
    {
      path: `/evidence/${encodeURIComponent(evidenceId)}?tab=verify`,
      label: 'Integrity Proof',
      icon: Activity,
      tab: 'verify',
    },
    {
      path: `/evidence/${encodeURIComponent(evidenceId)}?tab=entity`,
      label: 'Linked Entity',
      icon: Users,
      tab: 'entity',
    },
    {
      path: `/evidence/${encodeURIComponent(evidenceId)}?tab=source`,
      label: 'Source Material',
      icon: FileText,
      tab: 'source',
    },
    {
      path: `/evidence/${encodeURIComponent(evidenceId)}?tab=audit`,
      label: 'Court Certificate',
      icon: BookOpen,
      tab: 'audit',
    },
    {
      path: `/evidence/${encodeURIComponent(evidenceId)}?tab=settings`,
      label: 'Access & Settings',
      icon: Sliders,
      tab: 'settings',
    },
  ] : [];

  const grouped = sections.map(s => ({
    ...s,
    items: navItems.filter(i =>
      i.section === s.key &&
      (!i.adminOnly || canViewAuditLogs(user?.role)) &&
      (!i.hideForAdmin || user?.role !== 'administrator') &&
      (!i.inspectorOnly || isInspectorRole(user?.role)) &&
      (i.path !== '/database' && i.path !== '/data-sources' || canManageDatabases(user?.role))
    ),
  }));

  const [expanded, setExpanded] = useState(false);

  // Label fade style — visible only when expanded
  const labelStyle: React.CSSProperties = {
    opacity: expanded ? 1 : 0,
    maxWidth: expanded ? 200 : 0,
    overflow: 'hidden',
    whiteSpace: 'nowrap',
    transition: 'opacity 180ms ease, max-width 220ms ease',
    pointerEvents: 'none',
  };

  // Section header fade
  const sectionHeaderStyle: React.CSSProperties = {
    opacity: expanded ? 1 : 0,
    height: expanded ? 'auto' : 0,
    overflow: 'hidden',
    transition: 'opacity 150ms ease',
    padding: expanded ? '10px 10px 4px' : '0 10px',
    fontSize: '0.67rem', fontWeight: 700,
    textTransform: 'uppercase', letterSpacing: '0.1em',
    color: '#8c95a1ff',
    whiteSpace: 'nowrap',
  };

  // Nav item padding — centred icon when collapsed
  const navItemPad = expanded ? '8px 10px' : '8px 0';
  const navItemJustify = expanded ? 'flex-start' : 'center';
  const navItemGap = expanded ? 9 : 0;
  const navIconSize = expanded ? 17 : 19;

  return (
    <nav
      className={`sidebar${expanded ? ' expanded' : ''}`}
      onMouseEnter={() => setExpanded(true)}
      onMouseLeave={() => setExpanded(false)}
    >


      {/* Nav */}
      <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', padding: '8px 4px' }}>

        {/* Evidence Context Navigation */}
        {isEvidenceContext && evidenceId && (
          <div style={{ marginBottom: expanded ? 10 : 0, paddingBottom: expanded ? 8 : 0, transition: 'all 220ms ease' }}>


            <NavLink
              to="/evidence"
              style={{ display: 'flex', alignItems: 'center', justifyContent: navItemJustify, gap: navItemGap, padding: navItemPad, borderRadius: 8, fontSize: '0.95rem', fontWeight: 500, textDecoration: 'none', marginBottom: 2, color: '#475569', transition: 'padding 220ms ease, justify-content 220ms ease, gap 220ms ease' }}
            >
              <Shield size={navIconSize} style={{ color: '#94a3b8', flexShrink: 0, transition: 'all 200ms ease' }} />
              <span style={labelStyle}>All Evidence</span>
            </NavLink>
            {evidenceItems.map(item => (
              <NavLink
                key={item.path}
                to={item.path}
                style={() => {
                  const itemIsActive = isEvidenceDetail && currentEvidenceTab === item.tab;
                  return {
                    display: 'flex', alignItems: 'center', justifyContent: navItemJustify, gap: navItemGap,
                    padding: navItemPad, borderRadius: 8,
                    fontSize: '0.95rem', fontWeight: 500, textDecoration: 'none', marginBottom: 2,
                    color: itemIsActive ? '#059669' : '#475569',
                    background: itemIsActive ? 'rgba(5, 150, 105, 0.08)' : 'transparent',
                    border: itemIsActive ? '1px solid rgba(5, 150, 105, 0.25)' : '1px solid transparent',
                    transition: 'padding 220ms ease, gap 220ms ease',
                  };
                }}
              >
                {() => {
                  const itemIsActive = isEvidenceDetail && currentEvidenceTab === item.tab;
                  return (
                    <>
                      <item.icon size={navIconSize} style={{ color: itemIsActive ? '#059669' : '#94a3b8', flexShrink: 0, transition: 'all 200ms ease' }} />
                      <span style={labelStyle}>{item.label}</span>
                    </>
                  );
                }}
              </NavLink>
            ))}
          </div>
        )}

        {/* Entity Context Navigation */}
        {!isEvidenceContext && isEntityContext && entityType && entityId && (
          <div style={{ marginBottom: expanded ? 10 : 0, paddingBottom: expanded ? 8 : 0, transition: 'all 220ms ease' }}>


            <NavLink
              to="/entities"
              style={{ display: 'flex', alignItems: 'center', justifyContent: navItemJustify, gap: navItemGap, padding: navItemPad, borderRadius: 8, fontSize: '0.95rem', fontWeight: 500, textDecoration: 'none', marginBottom: 2, color: '#475569', transition: 'padding 220ms ease, gap 220ms ease' }}
            >
              <Users size={navIconSize} style={{ color: '#94a3b8', flexShrink: 0, transition: 'all 200ms ease' }} />
              <span style={labelStyle}>All Entities</span>
            </NavLink>
            {entityItems.map(item => (
              <NavLink
                key={item.path}
                to={item.path}
                style={({ isActive }) => {
                  const itemIsActive = item.tab
                    ? isEntityDetail && currentEntityTab === item.tab
                    : (item.pagePath ? location.pathname === item.pagePath : isActive);
                  const activeColor = nodeColors[entityType] || '#2563eb';
                  return {
                    display: 'flex', alignItems: 'center', justifyContent: navItemJustify, gap: navItemGap,
                    padding: navItemPad, borderRadius: 8,
                    fontSize: '0.95rem', fontWeight: 500, textDecoration: 'none', marginBottom: 2,
                    color: itemIsActive ? activeColor : '#475569',
                    background: itemIsActive ? `${activeColor}12` : 'transparent',
                    border: itemIsActive ? `1px solid ${activeColor}40` : '1px solid transparent',
                    transition: 'padding 220ms ease, gap 220ms ease',
                  };
                }}
              >
                {({ isActive }) => {
                  const itemIsActive = item.tab
                    ? isEntityDetail && currentEntityTab === item.tab
                    : (item.pagePath ? location.pathname === item.pagePath : isActive);
                  const activeColor = nodeColors[entityType] || '#2563eb';
                  return (
                    <>
                      <item.icon size={navIconSize} style={{ color: itemIsActive ? activeColor : '#94a3b8', flexShrink: 0, transition: 'all 200ms ease' }} />
                      <span style={labelStyle}>{item.label}</span>
                    </>
                  );
                }}
              </NavLink>
            ))}
          </div>
        )}

        {/* Investigation Context Navigation */}
        {!isEvidenceContext && !isEntityContext && isInvestigationContext && investigationId && (
          <div style={{ marginBottom: expanded ? 10 : 0, paddingBottom: expanded ? 8 : 0, transition: 'all 220ms ease' }}>

            <NavLink
              to="/investigations"
              style={{ display: 'flex', alignItems: 'center', justifyContent: navItemJustify, gap: navItemGap, padding: navItemPad, borderRadius: 8, fontSize: '0.95rem', fontWeight: 500, textDecoration: 'none', marginBottom: 2, color: '#475569', transition: 'padding 220ms ease, gap 220ms ease' }}
            >
              <FolderOpen size={navIconSize} style={{ color: '#94a3b8', flexShrink: 0, transition: 'all 200ms ease' }} />
              <span style={labelStyle}>All Investigations</span>
            </NavLink>
            {investigationItems.map(item => (
              <NavLink
                key={item.path}
                to={item.path}
                style={({ isActive }) => {
                  const itemTab = new URL(item.path, window.location.origin).searchParams.get('tab');
                  const itemIsActive = itemTab ? isInvestigationDetail && currentInvestigationTab === itemTab : isActive;
                  return {
                    display: 'flex', alignItems: 'center', justifyContent: navItemJustify, gap: navItemGap,
                    padding: navItemPad, borderRadius: 8,
                    fontSize: '0.95rem', fontWeight: 500, textDecoration: 'none', marginBottom: 2,
                    color: itemIsActive ? '#7c3aed' : '#475569',
                    background: itemIsActive ? '#f5f3ff' : 'transparent',
                    border: itemIsActive ? '1px solid #ddd6fe' : '1px solid transparent',
                    transition: 'padding 220ms ease, gap 220ms ease',
                  };
                }}
              >
                {({ isActive }) => {
                  const itemTab = new URL(item.path, window.location.origin).searchParams.get('tab');
                  const itemIsActive = itemTab ? isInvestigationDetail && currentInvestigationTab === itemTab : isActive;
                  return (
                    <>
                      <item.icon size={navIconSize} style={{ color: itemIsActive ? '#7c3aed' : '#94a3b8', flexShrink: 0, transition: 'all 200ms ease' }} />
                      <span style={labelStyle}>{item.label}</span>
                    </>
                  );
                }}
              </NavLink>
            ))}
          </div>
        )}

        {/* Default Navigation Sections */}
        {!isEvidenceContext && !isEntityContext && !isInvestigationContext && grouped.map(section => (
          <div key={section.key} style={{ marginBottom: expanded ? 4 : 0, transition: 'margin-bottom 220ms ease' }}>
            <div style={sectionHeaderStyle}>{section.label}</div>
            {section.items.map(item => (
              <NavLink
                key={item.path}
                to={item.path}
                title={!expanded ? item.label : undefined}
                style={({ isActive }) => ({
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: navItemJustify,
                  gap: navItemGap,
                  padding: navItemPad,
                  borderRadius: 8,
                  fontSize: '0.95rem',
                  fontWeight: 500,
                  textDecoration: 'none',
                  transition: 'all 150ms ease, padding 220ms ease, gap 220ms ease',
                  marginBottom: 2,
                  color: isActive ? '#2563eb' : '#475569',
                  background: isActive ? '#eff6ff' : 'transparent',
                  border: isActive ? '1px solid #bfdbfe' : '1px solid transparent',
                })}
              >
                {({ isActive }) => (
                  <>
                    <item.icon size={navIconSize} style={{ color: isActive ? '#2563eb' : '#94a3b8', flexShrink: 0, transition: 'all 200ms ease' }} />
                    <span style={labelStyle}>{item.label}</span>
                  </>
                )}
              </NavLink>
            ))}
          </div>
        ))}
      </div>
    </nav>
  );
}
