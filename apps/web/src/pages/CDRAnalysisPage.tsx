import React, { useState, useEffect } from 'react';
import {
  Radio,
  PhoneCall,
  Users,
  Search,
  RefreshCw,
  Upload,
  Clock,
  ArrowRight,
  ShieldCheck,
  AlertTriangle,
  FileSpreadsheet,
  CheckCircle2,
  XCircle,
  HelpCircle,
} from 'lucide-react';
import api from '../lib/api';
import CDRStatsGrid, { type CDROverviewData } from '../components/cdr/CDRStatsGrid';
import CDRHeatmap, { type CDRTimelineData } from '../components/cdr/CDRHeatmap';
import CDRImeiSwaps, { type CDRImeiSwapsData } from '../components/cdr/CDRImeiSwaps';

interface ContactSummary {
  target: {
    number: string;
    name: string;
    entityId: string;
    operator: string;
    circle: string;
  };
  summary: {
    totalCalls: number;
    totalDuration: number;
    totalDurationFormatted: string;
    uniqueContactsCount: number;
    incomingCalls: number;
    outgoingCalls: number;
    incomingRatio: number;
    outgoingRatio: number;
  };
  topContacts: Array<{
    contactPhone: string;
    contactName: string;
    contactEntityId: string;
    contactOperator: string;
    contactCircle: string;
    callFrequency: number;
    incomingCalls: number;
    outgoingCalls: number;
    totalDuration: number;
    totalDurationFormatted: string;
    avgDuration: number;
    latestActivity: string;
    isFlagged: boolean;
    flagReasons: string[];
  }>;
}

interface CommonContactsData {
  targetA: { number: string; name: string; entityId: string };
  targetB: { number: string; name: string; entityId: string };
  directCommunication: {
    hasDirectCalls: boolean;
    directCallsCount: number;
    directDurationFormatted: string;
  };
  commonContactsSummary: {
    commonContactsCount: number;
    totalIntermediaryCalls: number;
    highRiskRelaysCount: number;
  };
  intermediaries: Array<{
    intermediaryNumber: string;
    intermediaryName: string;
    entityId: string;
    operator: string;
    targetAStats: { calls: number; durationFormatted: string; lastContact: string };
    targetBStats: { calls: number; durationFormatted: string; lastContact: string };
    totalCombinedCalls: number;
    totalCombinedDurationFormatted: string;
    timeDifferenceBetweenLastContactsHours: number;
    isCoordinatedRelay: boolean;
    intermediaryRole: string;
    riskLevel: 'CRITICAL' | 'HIGH' | 'MEDIUM';
    forensicAssessment: string;
  }>;
}

export default function CDRAnalysisPage() {
  // State for Overview, Timeline, IMEI Swaps
  const [overviewData, setOverviewData] = useState<CDROverviewData | null>(null);
  const [timelineData, setTimelineData] = useState<CDRTimelineData | null>(null);
  const [imeiData, setImeiData] = useState<CDRImeiSwapsData | null>(null);
  const [loadingOverview, setLoadingOverview] = useState(true);

  // State for Contact Analysis
  const [selectedTarget, setSelectedTarget] = useState('9876543210'); // Default Arjun Mehta
  const [contactData, setContactData] = useState<ContactSummary | null>(null);
  const [loadingContacts, setLoadingContacts] = useState(false);

  // State for Common Contacts Discovery
  const [commonTargetA, setCommonTargetA] = useState('9876543210'); // Arjun Mehta
  const [commonTargetB, setCommonTargetB] = useState('9871234567'); // Vikram Sinha
  const [commonContacts, setCommonContacts] = useState<CommonContactsData | null>(null);
  const [loadingCommon, setLoadingCommon] = useState(false);

  // State for Upload Simulator Modal
  const [showSimulateModal, setShowSimulateModal] = useState(false);
  const [simulatePayload, setSimulatePayload] = useState('');
  const [simulationResult, setSimulationResult] = useState<any>(null);
  const [simulating, setSimulating] = useState(false);
  const [simulateError, setSimulateError] = useState('');

  // Predefined target contacts for quick selection
  const quickTargetPicks = [
    { number: '9876543210', label: 'Arjun Mehta (Target A)', entityId: 'P001' },
    { number: '8987654321', label: 'Ravi Kumar (POI)', entityId: 'P009' },
    { number: '9450123456', label: 'Ramesh Gupta (Kanpur)', entityId: 'P003' },
    { number: '9871234567', label: 'Vikram Sinha (Target B)', entityId: 'P002' },
    { number: '7777888899', label: 'Burner SIM (Unregistered)', entityId: 'PH011' },
    { number: '9815123456', label: 'Kuldeep Nanda (Amritsar)', entityId: 'P022' },
  ];

  // Fetch baseline CDR intelligence data
  const loadIntelligence = async () => {
    setLoadingOverview(true);
    try {
      const [overviewRes, timelineRes, imeiRes] = await Promise.all([
        api.get('/api/cdr/overview'),
        api.get('/api/cdr/timeline'),
        api.get('/api/cdr/imei-swaps'),
      ]);
      setOverviewData(overviewRes.data);
      setTimelineData(timelineRes.data);
      setImeiData(imeiRes.data);
    } catch (err) {
      console.error('Failed to load CDR intelligence:', err);
    } finally {
      setLoadingOverview(false);
    }
  };

  // Fetch Target Contact Analysis
  const fetchTargetContacts = async (numberOrId: string) => {
    setLoadingContacts(true);
    try {
      const res = await api.get(`/api/cdr/contacts/${encodeURIComponent(numberOrId)}`);
      setContactData(res.data);
    } catch (err) {
      console.error('Failed to fetch contact analysis:', err);
    } finally {
      setLoadingContacts(false);
    }
  };

  // Fetch Common Contacts
  const fetchCommonContacts = async (targetA: string, targetB: string) => {
    setLoadingCommon(true);
    try {
      const res = await api.get(`/api/cdr/common-contacts?targetA=${encodeURIComponent(targetA)}&targetB=${encodeURIComponent(targetB)}`);
      setCommonContacts(res.data);
    } catch (err) {
      console.error('Failed to fetch common contacts:', err);
    } finally {
      setLoadingCommon(false);
    }
  };

  useEffect(() => {
    loadIntelligence();
  }, []);

  useEffect(() => {
    if (selectedTarget) {
      fetchTargetContacts(selectedTarget);
    }
  }, [selectedTarget]);

  useEffect(() => {
    if (commonTargetA && commonTargetB) {
      fetchCommonContacts(commonTargetA, commonTargetB);
    }
  }, [commonTargetA, commonTargetB]);

  // Load Preset Synthetic Data for Simulator
  const loadPresetSimulation = (type: 'smuggling' | 'hawala') => {
    if (type === 'smuggling') {
      const sample = [
        { callerNumber: '9876543210', calleeNumber: '9450123456', duration: 420, timestamp: '2026-09-17T01:30:00Z', imei: '356234100034567', towerLocation: 'Mumbai-Port Area' },
        { callerNumber: '9450123456', calleeNumber: '8987654321', duration: 310, timestamp: '2026-09-17T02:15:00Z', imei: '359876500012345', towerLocation: 'Kanpur-Freight Hub' },
        { callerNumber: '8987654321', calleeNumber: '7777888899', duration: 540, timestamp: '2026-09-17T03:00:00Z', imei: '864209000011223', towerLocation: 'Patna-Junction' },
        { callerNumber: '7777888899', calleeNumber: '9815123456', duration: 280, timestamp: '2026-09-17T03:45:00Z', imei: '864209000011223', towerLocation: 'Varanasi-Terminal' },
      ];
      setSimulatePayload(JSON.stringify(sample, null, 2));
    } else {
      const sample = [
        { callerNumber: '8987654321', calleeNumber: '9815123456', duration: 250, timestamp: '2026-09-17T11:00:00Z', imei: '356234108765432', towerLocation: 'Amritsar-Katra' },
        { callerNumber: '8987654321', calleeNumber: '9815123456', duration: 320, timestamp: '2026-09-17T14:30:00Z', imei: '357777888899990', towerLocation: 'Amritsar-Exchange' },
        { callerNumber: '8987654321', calleeNumber: '9815123456', duration: 400, timestamp: '2026-09-17T18:00:00Z', imei: '864209000011223', towerLocation: 'Ludhiana-Industrial' },
      ];
      setSimulatePayload(JSON.stringify(sample, null, 2));
    }
  };

  const handleRunSimulation = async () => {
    setSimulateError('');
    setSimulationResult(null);
    let parsed: any;
    try {
      parsed = JSON.parse(simulatePayload);
    } catch {
      setSimulateError('Invalid JSON format. Please ensure input is a valid JSON array.');
      return;
    }

    if (!Array.isArray(parsed)) {
      setSimulateError('Payload must be a JSON array of CDR records.');
      return;
    }

    setSimulating(true);
    try {
      const res = await api.post('/api/cdr/upload-simulate', {
        records: parsed,
        scenarioName: 'Investigator Ad-Hoc Telecom Batch',
      });
      setSimulationResult(res.data);
    } catch (err: any) {
      setSimulateError(err.response?.data?.error || 'Failed to simulate CDR analysis.');
    } finally {
      setSimulating(false);
    }
  };

  return (
    <div className="fade-in" style={{ paddingBottom: 40 }}>
      {/* Page Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 16,
          marginBottom: 20,
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: 8,
                background: 'linear-gradient(135deg, #2563eb, #1d4ed8)',
                color: '#ffffff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Radio size={20} />
            </div>
            <h1 style={{ fontSize: '1.45rem', fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>
              CDR & Telecom Forensics Intelligence
            </h1>
          </div>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', margin: 0 }}>
            Call Detail Record ingestion, nocturnal spike anomaly detection, IMEI/IMSI swap tracking, and common contact discovery
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button className="btn btn-secondary btn-sm" onClick={loadIntelligence} disabled={loadingOverview}>
            <RefreshCw size={14} className={loadingOverview ? 'animate-spin' : ''} style={{ marginRight: 6 }} />
            Refresh Data
          </button>
          <button
            className="btn btn-primary btn-sm"
            onClick={() => {
              loadPresetSimulation('smuggling');
              setShowSimulateModal(true);
            }}
          >
            <Upload size={14} style={{ marginRight: 6 }} />
            Simulate CDR Upload
          </button>
        </div>
      </div>

      {/* Synthetic Demo Data Banner */}
      <div className="ai-disclaimer" style={{ marginBottom: 20 }}>
        🔒 <strong>SYNTHETIC TELECOM FORENSICS TESTBED (NCRB SIH 2026):</strong> All records, phone numbers, IMEIs, IMSIs, and cell tower coordinates shown are synthetically generated for demonstration and analytical pattern validation. No real civilian or law enforcement private data is used.
      </div>

      {/* Section A: CDR Overview */}
      <CDRStatsGrid data={overviewData} loading={loadingOverview} />

      {/* Section B: Call Activity (24-Hour Timeline & Nocturnal Surge Detection) */}
      <CDRHeatmap data={timelineData} loading={loadingOverview} />

      {/* Section C: Contact Analysis */}
      <div className="card" style={{ padding: 24, marginBottom: 24, borderRadius: 'var(--radius-md)' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 16,
            marginBottom: 20,
          }}
        >
          <div>
            <h2 style={{ fontSize: '1.15rem', fontWeight: 600, color: 'var(--text-primary)', margin: 0, marginBottom: 4 }}>
              Target Contact Analysis & Call Ratios
            </h2>
            <p style={{ fontSize: '0.825rem', color: 'var(--text-muted)', margin: 0 }}>
              Deep-dive into directional communications, call frequencies, durations, and top contacts for a selected subscriber
            </p>
          </div>

          {/* Quick Target Picker */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 500 }}>Select Target:</span>
            <select
              value={selectedTarget}
              onChange={(e) => setSelectedTarget(e.target.value)}
              style={{
                padding: '6px 12px',
                fontSize: '0.825rem',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--border-primary)',
                background: 'var(--bg-elevated)',
                color: 'var(--text-primary)',
                fontWeight: 600,
                outline: 'none',
              }}
            >
              {quickTargetPicks.map((pick) => (
                <option key={pick.number} value={pick.number}>
                  {pick.label} — {pick.number}
                </option>
              ))}
            </select>
          </div>
        </div>

        {loadingContacts ? (
          <div style={{ padding: 30, textAlign: 'center' }}>
            <div className="loading-spinner" style={{ margin: '0 auto 10px' }} />
            <p style={{ fontSize: '0.825rem', color: 'var(--text-muted)' }}>Analyzing contacts for {selectedTarget}...</p>
          </div>
        ) : contactData ? (
          <div>
            {/* Target Summary Row */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                gap: 12,
                background: 'var(--bg-elevated)',
                padding: '14px 18px',
                borderRadius: 'var(--radius-sm)',
                marginBottom: 20,
                border: '1px solid var(--border-primary)',
              }}
            >
              <div>
                <span style={{ fontSize: '0.72rem', textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: 600, display: 'block' }}>
                  Target Subscriber
                </span>
                <span style={{ fontSize: '1.05rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                  {contactData.target.name}
                </span>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-tertiary)' }}>
                  {contactData.target.number} ({contactData.target.operator} · {contactData.target.circle})
                </div>
              </div>

              <div>
                <span style={{ fontSize: '0.72rem', textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: 600, display: 'block' }}>
                  Total Sessions & Duration
                </span>
                <span style={{ fontSize: '1.05rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                  {contactData.summary.totalCalls} Calls
                </span>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-tertiary)' }}>
                  {contactData.summary.totalDurationFormatted} logged
                </div>
              </div>

              <div>
                <span style={{ fontSize: '0.72rem', textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: 600, display: 'block' }}>
                  Directional Ratio
                </span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                  <span style={{ fontSize: '0.8rem', color: '#16a34a', fontWeight: 600 }}>
                    In: {contactData.summary.incomingRatio}%
                  </span>
                  <span style={{ color: 'var(--text-muted)' }}>|</span>
                  <span style={{ fontSize: '0.8rem', color: '#2563eb', fontWeight: 600 }}>
                    Out: {contactData.summary.outgoingRatio}%
                  </span>
                </div>
                {/* Visual Ratio Bar */}
                <div style={{ height: 6, background: '#2563eb', borderRadius: 3, overflow: 'hidden', marginTop: 4, display: 'flex' }}>
                  <div style={{ width: `${contactData.summary.incomingRatio}%`, background: '#16a34a' }} />
                </div>
              </div>

              <div>
                <span style={{ fontSize: '0.72rem', textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: 600, display: 'block' }}>
                  Distinct Contacts
                </span>
                <span style={{ fontSize: '1.05rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                  {contactData.summary.uniqueContactsCount} Associates
                </span>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-tertiary)' }}>
                  Ranked by frequency below
                </div>
              </div>
            </div>

            {/* Top Contacts Table */}
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.825rem' }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid var(--border-primary)', textAlign: 'left' }}>
                    <th style={{ padding: '8px 10px', color: 'var(--text-muted)', fontWeight: 600 }}>Associate</th>
                    <th style={{ padding: '8px 10px', color: 'var(--text-muted)', fontWeight: 600 }}>Number / Operator</th>
                    <th style={{ padding: '8px 10px', color: 'var(--text-muted)', fontWeight: 600 }}>Total Calls</th>
                    <th style={{ padding: '8px 10px', color: 'var(--text-muted)', fontWeight: 600 }}>In / Out</th>
                    <th style={{ padding: '8px 10px', color: 'var(--text-muted)', fontWeight: 600 }}>Total Duration</th>
                    <th style={{ padding: '8px 10px', color: 'var(--text-muted)', fontWeight: 600 }}>Latest Activity</th>
                    <th style={{ padding: '8px 10px', color: 'var(--text-muted)', fontWeight: 600 }}>Forensic Status</th>
                  </tr>
                </thead>
                <tbody>
                  {contactData.topContacts.map((contact, cIdx) => (
                    <tr
                      key={cIdx}
                      style={{
                        borderBottom: '1px solid var(--border-secondary)',
                        background: cIdx % 2 === 0 ? 'transparent' : 'var(--bg-elevated)',
                      }}
                    >
                      <td style={{ padding: '10px 10px' }}>
                        <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{contact.contactName}</div>
                        <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{contact.contactEntityId}</span>
                      </td>
                      <td style={{ padding: '10px 10px', fontFamily: 'var(--font-mono)' }}>
                        <div>{contact.contactPhone}</div>
                        <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                          {contact.contactOperator} · {contact.contactCircle}
                        </span>
                      </td>
                      <td style={{ padding: '10px 10px', fontWeight: 700 }}>{contact.callFrequency}</td>
                      <td style={{ padding: '10px 10px' }}>
                        <span style={{ color: '#16a34a' }}>{contact.incomingCalls} in</span> /{' '}
                        <span style={{ color: '#2563eb' }}>{contact.outgoingCalls} out</span>
                      </td>
                      <td style={{ padding: '10px 10px' }}>
                        <div>{contact.totalDurationFormatted}</div>
                        <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Avg: {contact.avgDuration}s</span>
                      </td>
                      <td style={{ padding: '10px 10px', color: 'var(--text-secondary)' }}>
                        {new Date(contact.latestActivity).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}
                      </td>
                      <td style={{ padding: '10px 10px' }}>
                        {contact.isFlagged ? (
                          <span className="badge badge-critical" title={contact.flagReasons.join(', ')}>
                            FLAGGED POI
                          </span>
                        ) : (
                          <span className="badge badge-low">Normal</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}
      </div>

      {/* Section D: IMEI/IMSI Swap Detection */}
      <CDRImeiSwaps data={imeiData} loading={loadingOverview} />

      {/* Section E: Common Contact Discovery */}
      <div className="card" style={{ padding: 24, marginBottom: 24, borderRadius: 'var(--radius-md)' }}>
        <div style={{ marginBottom: 18 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <h2 style={{ fontSize: '1.15rem', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
              Common Contact & Intermediary Discovery
            </h2>
            <span className="badge badge-info" style={{ fontSize: '0.72rem' }}>
              Dual-Target Link Analysis
            </span>
          </div>
          <p style={{ fontSize: '0.825rem', color: 'var(--text-muted)', margin: 0 }}>
            Identify mutual communication brokers and intermediaries connecting two targets of interest
          </p>
        </div>

        {/* Dual Target Selectors */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
            gap: 16,
            background: 'var(--bg-elevated)',
            padding: 16,
            borderRadius: 'var(--radius-sm)',
            marginBottom: 20,
            border: '1px solid var(--border-primary)',
          }}
        >
          <div>
            <label style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: 6 }}>
              TARGET A:
            </label>
            <select
              value={commonTargetA}
              onChange={(e) => setCommonTargetA(e.target.value)}
              style={{
                width: '100%',
                padding: '8px 12px',
                fontSize: '0.85rem',
                borderRadius: 6,
                border: '1px solid var(--border-primary)',
                background: '#ffffff',
                fontWeight: 600,
              }}
            >
              {quickTargetPicks.map((p) => (
                <option key={p.number} value={p.number}>
                  {p.label} ({p.number})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: 6 }}>
              TARGET B:
            </label>
            <select
              value={commonTargetB}
              onChange={(e) => setCommonTargetB(e.target.value)}
              style={{
                width: '100%',
                padding: '8px 12px',
                fontSize: '0.85rem',
                borderRadius: 6,
                border: '1px solid var(--border-primary)',
                background: '#ffffff',
                fontWeight: 600,
              }}
            >
              {quickTargetPicks.map((p) => (
                <option key={p.number} value={p.number}>
                  {p.label} ({p.number})
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Intermediaries Results */}
        {loadingCommon ? (
          <div style={{ padding: 30, textAlign: 'center' }}>
            <div className="loading-spinner" style={{ margin: '0 auto 10px' }} />
            <p style={{ fontSize: '0.825rem', color: 'var(--text-muted)' }}>Calculating mutual intermediaries...</p>
          </div>
        ) : commonContacts ? (
          <div>
            {/* Direct Link Banner */}
            <div
              style={{
                padding: '10px 16px',
                borderRadius: 6,
                background: commonContacts.directCommunication.hasDirectCalls
                  ? 'rgba(37, 99, 235, 0.08)'
                  : 'var(--bg-elevated)',
                border: '1px solid var(--border-primary)',
                marginBottom: 16,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: 8,
                fontSize: '0.825rem',
              }}
            >
              <div>
                <strong>Direct Link:</strong>{' '}
                {commonContacts.directCommunication.hasDirectCalls ? (
                  <span style={{ color: '#2563eb', fontWeight: 600 }}>
                    YES — {commonContacts.directCommunication.directCallsCount} direct calls recorded between Target A & B ({commonContacts.directCommunication.directDurationFormatted})
                  </span>
                ) : (
                  <span style={{ color: 'var(--text-muted)' }}>No direct communication recorded between targets.</span>
                )}
              </div>
              <span className="badge badge-neutral">
                {commonContacts.commonContactsSummary.commonContactsCount} Mutual Intermediaries Found
              </span>
            </div>

            {/* Intermediary Cards */}
            {commonContacts.intermediaries.length === 0 ? (
              <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', textAlign: 'center', padding: 20 }}>
                No mutual contacts found between the selected targets.
              </p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {commonContacts.intermediaries.map((item, idx) => (
                  <div
                    key={idx}
                    style={{
                      background: '#ffffff',
                      border: '1px solid var(--border-primary)',
                      borderLeft: `4px solid ${
                        item.riskLevel === 'CRITICAL'
                          ? '#dc2626'
                          : item.riskLevel === 'HIGH'
                          ? '#ea580c'
                          : '#2563eb'
                      }`,
                      borderRadius: 'var(--radius-sm)',
                      padding: '16px 18px',
                      boxShadow: 'var(--shadow-sm)',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        marginBottom: 10,
                        flexWrap: 'wrap',
                        gap: 8,
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span
                          className={`badge ${
                            item.riskLevel === 'CRITICAL'
                              ? 'badge-critical'
                              : item.riskLevel === 'HIGH'
                              ? 'badge-high'
                              : 'badge-info'
                          }`}
                        >
                          {item.riskLevel} RELAY
                        </span>
                        <span style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                          {item.intermediaryName}
                        </span>
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                          ({item.intermediaryNumber})
                        </span>
                        <span className="badge badge-neutral" style={{ fontSize: '0.7rem' }}>
                          {item.intermediaryRole.replace(/_/g, ' ')}
                        </span>
                      </div>

                      <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                        Combined Volume: <strong>{item.totalCombinedCalls} calls</strong> ({item.totalCombinedDurationFormatted})
                      </div>
                    </div>

                    <p style={{ fontSize: '0.825rem', color: 'var(--text-secondary)', lineHeight: 1.5, marginBottom: 12 }}>
                      {item.forensicAssessment}
                    </p>

                    {/* Dual Interaction Cards */}
                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
                        gap: 12,
                        background: 'var(--bg-elevated)',
                        padding: '10px 14px',
                        borderRadius: 6,
                      }}
                    >
                      <div>
                        <span style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                          Communication with Target A ({commonContacts.targetA.name})
                        </span>
                        <div style={{ fontSize: '0.825rem', marginTop: 2 }}>
                          <strong>{item.targetAStats.calls} calls</strong> ({item.targetAStats.durationFormatted})
                        </div>
                        <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                          Last: {new Date(item.targetAStats.lastContact).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}
                        </div>
                      </div>

                      <div>
                        <span style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                          Communication with Target B ({commonContacts.targetB.name})
                        </span>
                        <div style={{ fontSize: '0.825rem', marginTop: 2 }}>
                          <strong>{item.targetBStats.calls} calls</strong> ({item.targetBStats.durationFormatted})
                        </div>
                        <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                          Last: {new Date(item.targetBStats.lastContact).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : null}
      </div>

      {/* Section F: CDR Batch Upload & Simulator Modal */}
      {showSimulateModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: 20,
          }}
        >
          <div
            className="card"
            style={{
              width: '100%',
              maxWidth: 750,
              maxHeight: '90vh',
              overflowY: 'auto',
              padding: 24,
              borderRadius: 'var(--radius-md)',
              background: '#ffffff',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <div>
                <h3 style={{ fontSize: '1.2rem', fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>
                  Simulate CDR Batch Analysis
                </h3>
                <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: 0 }}>
                  Upload synthetic CDR records for in-memory forensic evaluation without database persistence
                </p>
              </div>
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => {
                  setShowSimulateModal(false);
                  setSimulationResult(null);
                }}
              >
                ✕ Close
              </button>
            </div>

            {/* Presets */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
              <button className="btn btn-secondary btn-sm" onClick={() => loadPresetSimulation('smuggling')}>
                Load Scenario: Nocturnal Corridor Spikes
              </button>
              <button className="btn btn-secondary btn-sm" onClick={() => loadPresetSimulation('hawala')}>
                Load Scenario: SIM-Hopping Chain
              </button>
            </div>

            {/* Textarea */}
            <div style={{ marginBottom: 14 }}>
              <label style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: 6 }}>
                Synthetic CDR Records (JSON Array):
              </label>
              <textarea
                rows={8}
                value={simulatePayload}
                onChange={(e) => setSimulatePayload(e.target.value)}
                style={{
                  width: '100%',
                  fontFamily: 'var(--font-mono)',
                  fontSize: '0.78rem',
                  padding: 10,
                  borderRadius: 6,
                  border: '1px solid var(--border-primary)',
                  background: 'var(--bg-elevated)',
                  outline: 'none',
                }}
              />
            </div>

            {simulateError && (
              <div style={{ padding: '8px 12px', borderRadius: 6, background: '#fef2f2', color: '#dc2626', fontSize: '0.8rem', marginBottom: 14 }}>
                {simulateError}
              </div>
            )}

            {/* Run Button */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
              <button className="btn btn-primary" onClick={handleRunSimulation} disabled={simulating || !simulatePayload.trim()}>
                {simulating ? 'Analyzing Batch...' : 'Run Forensic Simulation'}
              </button>
            </div>

            {/* Simulation Results Preview */}
            {simulationResult && (
              <div
                style={{
                  background: 'var(--bg-elevated)',
                  borderRadius: 'var(--radius-sm)',
                  padding: 16,
                  border: '1px solid var(--border-primary)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                  <CheckCircle2 size={18} color="#16a34a" />
                  <span style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                    Forensics Simulation Report — {simulationResult.scenarioName}
                  </span>
                </div>

                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
                    gap: 10,
                    marginBottom: 12,
                    fontSize: '0.78rem',
                  }}
                >
                  <div className="card" style={{ padding: 8 }}>
                    <span style={{ color: 'var(--text-muted)' }}>Valid Records:</span>
                    <div style={{ fontSize: '1.1rem', fontWeight: 700 }}>{simulationResult.recordsProcessed}</div>
                  </div>
                  <div className="card" style={{ padding: 8 }}>
                    <span style={{ color: 'var(--text-muted)' }}>Duration:</span>
                    <div style={{ fontSize: '1.1rem', fontWeight: 700 }}>{simulationResult.forensicsReport.totalDurationFormatted}</div>
                  </div>
                  <div className="card" style={{ padding: 8 }}>
                    <span style={{ color: 'var(--text-muted)' }}>Participants:</span>
                    <div style={{ fontSize: '1.1rem', fontWeight: 700 }}>{simulationResult.forensicsReport.uniqueParticipants}</div>
                  </div>
                  <div className="card" style={{ padding: 8 }}>
                    <span style={{ color: 'var(--text-muted)' }}>Night Calls:</span>
                    <div style={{ fontSize: '1.1rem', fontWeight: 700, color: simulationResult.forensicsReport.nightCallsCount > 0 ? '#ea580c' : 'inherit' }}>
                      {simulationResult.forensicsReport.nightCallsCount}
                    </div>
                  </div>
                </div>

                {simulationResult.forensicsReport.detectedHardwareSwapsCount > 0 && (
                  <div style={{ marginTop: 8, padding: '8px 12px', background: '#fff7ed', borderRadius: 6, fontSize: '0.78rem', color: '#c2410c' }}>
                    ⚠️ <strong>{simulationResult.forensicsReport.detectedHardwareSwapsCount} Hardware Swap(s) Detected</strong> in batch!
                  </div>
                )}

                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 10 }}>
                  {simulationResult.simulationNotice}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
