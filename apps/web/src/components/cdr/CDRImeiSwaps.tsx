import React, { useState } from 'react';
import { Smartphone, Shuffle, AlertTriangle, ShieldAlert, Cpu, Calendar, Search, ArrowRight, User } from 'lucide-react';

export interface DeviceSharingDetection {
  detectionType: string;
  imei: string;
  deviceModel: string;
  simCount: number;
  associatedSims: Array<{
    number: string;
    name: string;
    entityId: string;
    operator: string;
  }>;
  associatedImsis: string[];
  firstSeen: string;
  lastSeen: string;
  totalCallsObserved: number;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM';
  evidenceNote: string;
}

export interface SimHoppingDetection {
  detectionType: string;
  phoneNumber: string;
  subscriberName: string;
  entityId: string;
  operator: string;
  deviceCount: number;
  associatedImeis: string[];
  associatedImsis: string[];
  firstSeen: string;
  lastSeen: string;
  totalCallsObserved: number;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM';
  evidenceNote: string;
}

export interface CDRImeiSwapsData {
  summary: {
    totalAnomaliesDetected: number;
    deviceSharingCasesCount: number;
    simHoppingCasesCount: number;
    criticalCasesCount: number;
  };
  deviceSharing: DeviceSharingDetection[];
  simHopping: SimHoppingDetection[];
  isSyntheticDemo: boolean;
  dataSource: string;
  disclaimer: string;
}

interface Props {
  data: CDRImeiSwapsData | null;
  loading: boolean;
}

export default function CDRImeiSwaps({ data, loading }: Props) {
  const [activeTab, setActiveTab] = useState<'all' | 'deviceSharing' | 'simHopping'>('all');
  const [searchTerm, setSearchTerm] = useState('');

  if (loading) {
    return (
      <div className="card" style={{ padding: 40, textAlign: 'center', marginBottom: 24 }}>
        <div className="loading-spinner" style={{ margin: '0 auto 12px' }} />
        <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>Analyzing IMEI hardware & SIM bindings...</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="card" style={{ padding: 30, textAlign: 'center', color: 'var(--text-muted)', marginBottom: 24 }}>
        No IMEI/IMSI swap anomalies detected.
      </div>
    );
  }

  const { deviceSharing, simHopping, summary } = data;

  const filteredDeviceSharing = deviceSharing.filter(
    (d) =>
      d.imei.toLowerCase().includes(searchTerm.toLowerCase()) ||
      d.associatedSims.some((s) => s.name.toLowerCase().includes(searchTerm.toLowerCase()) || s.number.includes(searchTerm))
  );

  const filteredSimHopping = simHopping.filter(
    (s) =>
      s.phoneNumber.includes(searchTerm) ||
      s.subscriberName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      s.associatedImeis.some((imei) => imei.includes(searchTerm))
  );

  return (
    <div className="card" style={{ padding: 24, marginBottom: 24, borderRadius: 'var(--radius-md)' }}>
      {/* Section Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 16,
          marginBottom: 18,
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <h2 style={{ fontSize: '1.15rem', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
              IMEI & IMSI Swap Forensics
            </h2>
            <span className="badge badge-critical" style={{ fontSize: '0.72rem' }}>
              {summary.totalAnomaliesDetected} Anomalies Detected
            </span>
          </div>
          <p style={{ fontSize: '0.825rem', color: 'var(--text-muted)', margin: 0 }}>
            Automated detection of shared hardware terminals and rapid handset rotation (Burner evasion patterns)
          </p>
        </div>

        {/* Search */}
        <div style={{ position: 'relative', width: 220 }}>
          <Search size={14} style={{ position: 'absolute', left: 10, top: 10, color: 'var(--text-muted)' }} />
          <input
            type="text"
            placeholder="Search IMEI or phone..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            style={{
              width: '100%',
              padding: '7px 10px 7px 32px',
              fontSize: '0.8rem',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--border-primary)',
              background: 'var(--bg-elevated)',
              outline: 'none',
            }}
          />
        </div>
      </div>

      {/* Tabs */}
      <div
        style={{
          display: 'flex',
          gap: 8,
          borderBottom: '1px solid var(--border-primary)',
          paddingBottom: 10,
          marginBottom: 16,
          flexWrap: 'wrap',
        }}
      >
        <button
          className={`btn btn-sm ${activeTab === 'all' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setActiveTab('all')}
        >
          All Anomalies ({summary.totalAnomaliesDetected})
        </button>
        <button
          className={`btn btn-sm ${activeTab === 'deviceSharing' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setActiveTab('deviceSharing')}
        >
          <Smartphone size={13} style={{ marginRight: 4 }} />
          Multiple SIMs on Single IMEI ({summary.deviceSharingCasesCount})
        </button>
        <button
          className={`btn btn-sm ${activeTab === 'simHopping' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setActiveTab('simHopping')}
        >
          <Shuffle size={13} style={{ marginRight: 4 }} />
          Single SIM on Multiple IMEIs ({summary.simHoppingCasesCount})
        </button>
      </div>

      {/* Content */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {/* Category 1: Multiple SIMs on Single IMEI */}
        {(activeTab === 'all' || activeTab === 'deviceSharing') && (
          <div>
            {activeTab === 'all' && (
              <h3 style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
                <Smartphone size={16} color="var(--accent-primary)" />
                Device Sharing: Multiple SIMs Operating on Single IMEI ({filteredDeviceSharing.length})
              </h3>
            )}

            {filteredDeviceSharing.length === 0 ? (
              <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>No device sharing anomalies match query.</p>
            ) : (
              filteredDeviceSharing.map((item, idx) => (
                <div
                  key={`ds-${idx}`}
                  style={{
                    background: '#ffffff',
                    border: '1px solid var(--border-primary)',
                    borderLeft: `4px solid ${item.severity === 'CRITICAL' ? '#dc2626' : '#ea580c'}`,
                    borderRadius: 'var(--radius-sm)',
                    padding: '16px 18px',
                    marginBottom: 10,
                    boxShadow: 'var(--shadow-sm)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, flexWrap: 'wrap', gap: 8 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span className={`badge ${item.severity === 'CRITICAL' ? 'badge-critical' : 'badge-high'}`}>
                        {item.severity} SEVERITY
                      </span>
                      <span style={{ fontSize: '0.95rem', fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>
                        IMEI: {item.imei}
                      </span>
                      <span className="badge badge-neutral" style={{ fontSize: '0.72rem' }}>
                        {item.deviceModel}
                      </span>
                    </div>

                    <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                      First: {new Date(item.firstSeen).toLocaleDateString()} · Last: {new Date(item.lastSeen).toLocaleDateString()}
                    </div>
                  </div>

                  {/* Evidence Narrative */}
                  <p style={{ fontSize: '0.825rem', color: 'var(--text-secondary)', lineHeight: 1.5, marginBottom: 12 }}>
                    {item.evidenceNote}
                  </p>

                  {/* Associated SIMs List */}
                  <div
                    style={{
                      background: 'var(--bg-elevated)',
                      borderRadius: 6,
                      padding: '10px 14px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 6,
                    }}
                  >
                    <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                      Associated Operating SIM Cards ({item.simCount})
                    </span>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                      {item.associatedSims.map((sim, sIdx) => (
                        <div
                          key={sIdx}
                          style={{
                            background: '#ffffff',
                            border: '1px solid var(--border-primary)',
                            borderRadius: 4,
                            padding: '4px 10px',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 6,
                            fontSize: '0.78rem',
                          }}
                        >
                          <User size={12} color="var(--accent-primary)" />
                          <strong>{sim.name}</strong>
                          <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>
                            ({sim.number})
                          </span>
                          <span className="badge badge-neutral" style={{ fontSize: '0.65rem' }}>
                            {sim.operator}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {/* Category 2: Single SIM on Multiple IMEIs */}
        {(activeTab === 'all' || activeTab === 'simHopping') && (
          <div style={{ marginTop: activeTab === 'all' ? 12 : 0 }}>
            {activeTab === 'all' && (
              <h3 style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
                <Shuffle size={16} color="#7c3aed" />
                SIM Hopping: Single Subscriber Operating Across Multiple Handsets ({filteredSimHopping.length})
              </h3>
            )}

            {filteredSimHopping.length === 0 ? (
              <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>No SIM hopping anomalies match query.</p>
            ) : (
              filteredSimHopping.map((item, idx) => (
                <div
                  key={`sh-${idx}`}
                  style={{
                    background: '#ffffff',
                    border: '1px solid var(--border-primary)',
                    borderLeft: `4px solid ${item.severity === 'CRITICAL' ? '#dc2626' : '#7c3aed'}`,
                    borderRadius: 'var(--radius-sm)',
                    padding: '16px 18px',
                    marginBottom: 10,
                    boxShadow: 'var(--shadow-sm)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, flexWrap: 'wrap', gap: 8 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span className={`badge ${item.severity === 'CRITICAL' ? 'badge-critical' : 'badge-high'}`}>
                        {item.severity} SEVERITY
                      </span>
                      <span style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                        {item.subscriberName}
                      </span>
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                        ({item.phoneNumber})
                      </span>
                      <span className="badge badge-neutral" style={{ fontSize: '0.72rem' }}>
                        {item.operator}
                      </span>
                    </div>

                    <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                      Total Handsets: <strong>{item.deviceCount} IMEIs</strong>
                    </div>
                  </div>

                  {/* Evidence Narrative */}
                  <p style={{ fontSize: '0.825rem', color: 'var(--text-secondary)', lineHeight: 1.5, marginBottom: 12 }}>
                    {item.evidenceNote}
                  </p>

                  {/* Associated IMEIs List */}
                  <div
                    style={{
                      background: 'var(--bg-elevated)',
                      borderRadius: 6,
                      padding: '10px 14px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 6,
                    }}
                  >
                    <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                      Physical Handsets Observed ({item.deviceCount})
                    </span>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                      {item.associatedImeis.map((imei, iIdx) => (
                        <div
                          key={iIdx}
                          style={{
                            background: '#ffffff',
                            border: '1px solid var(--border-primary)',
                            borderRadius: 4,
                            padding: '4px 10px',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 6,
                            fontSize: '0.78rem',
                          }}
                        >
                          <Cpu size={12} color="#7c3aed" />
                          <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{imei}</span>
                          <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>
                            Device #{iIdx + 1}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
