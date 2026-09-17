import React from 'react';
import { PhoneCall, Clock, Users, Smartphone, Cpu, AlertTriangle, ShieldCheck } from 'lucide-react';

export interface CDROverviewData {
  totalCalls: number;
  totalDuration: number;
  totalDurationFormatted: string;
  avgCallDuration: number;
  uniqueIMEICount: number;
  uniqueIMSICount: number;
  activePhoneNumbersCount: number;
  breakdown: {
    voiceCalls: number;
    smsMessages: number;
    nightCalls: number;
    nightCallPercentage: number;
    flaggedCalls: number;
  };
  dataSource: string;
  isSyntheticDemo: boolean;
  disclaimer?: string;
}

interface Props {
  data: CDROverviewData | null;
  loading: boolean;
}

export default function CDRStatsGrid({ data, loading }: Props) {
  if (loading) {
    return (
      <div className="grid-4" style={{ marginBottom: 24 }}>
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="card" style={{ padding: 20, minHeight: 110, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div className="loading-spinner" style={{ width: 24, height: 24 }} />
          </div>
        ))}
      </div>
    );
  }

  if (!data) {
    return (
      <div className="card" style={{ padding: 24, marginBottom: 24, textAlign: 'center', color: 'var(--text-muted)' }}>
        No CDR overview data available.
      </div>
    );
  }

  const statCards = [
    {
      label: 'Total Calls & SMS',
      value: data.totalCalls.toLocaleString(),
      sub: `${data.breakdown.voiceCalls} Calls · ${data.breakdown.smsMessages} SMS`,
      icon: PhoneCall,
      color: '#2563eb',
      bg: '#eff6ff',
      badge: `${data.breakdown.flaggedCalls} Flagged`,
      badgeType: data.breakdown.flaggedCalls > 0 ? 'badge-high' : 'badge-low',
    },
    {
      label: 'Cumulative Duration',
      value: data.totalDurationFormatted,
      sub: `Avg: ${data.avgCallDuration}s per connection`,
      icon: Clock,
      color: '#0891b2',
      bg: '#ecfeff',
      badge: `${data.breakdown.voiceCalls} Voice Sessions`,
      badgeType: 'badge-neutral',
    },
    {
      label: 'Active Phone Numbers',
      value: data.activePhoneNumbersCount.toString(),
      sub: 'Participating cellular subscribers',
      icon: Users,
      color: '#7c3aed',
      bg: '#f5f3ff',
      badge: 'Network Nodes',
      badgeType: 'badge-neutral',
    },
    {
      label: 'Unique Devices (IMEI)',
      value: data.uniqueIMEICount.toString(),
      sub: 'Distinct physical handsets',
      icon: Smartphone,
      color: '#ea580c',
      bg: '#fff7ed',
      badge: `${data.uniqueIMSICount} SIMs / IMSIs`,
      badgeType: 'badge-neutral',
    },
  ];

  return (
    <div style={{ marginBottom: 24 }}>
      {/* 4-Card Overview Grid */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
          gap: 16,
          marginBottom: 16,
        }}
      >
        {statCards.map((card, idx) => {
          const Icon = card.icon;
          return (
            <div
              key={idx}
              className="card"
              style={{
                padding: '18px 20px',
                display: 'flex',
                alignItems: 'flex-start',
                justifyContent: 'space-between',
                borderRadius: 'var(--radius-md)',
                boxShadow: 'var(--shadow-sm)',
                border: '1px solid var(--border-primary)',
                background: 'var(--bg-card)',
                transition: 'transform 150ms ease, box-shadow 150ms ease',
              }}
            >
              <div>
                <span
                  style={{
                    fontSize: '0.78rem',
                    fontWeight: 600,
                    textTransform: 'uppercase',
                    letterSpacing: '0.06em',
                    color: 'var(--text-muted)',
                    display: 'block',
                    marginBottom: 6,
                  }}
                >
                  {card.label}
                </span>
                <div
                  style={{
                    fontSize: '1.75rem',
                    fontWeight: 700,
                    color: 'var(--text-primary)',
                    fontFamily: 'var(--font-sans)',
                    lineHeight: 1.1,
                    marginBottom: 6,
                  }}
                >
                  {card.value}
                </div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-tertiary)', marginBottom: 8 }}>
                  {card.sub}
                </div>
                <span className={`badge ${card.badgeType}`} style={{ fontSize: '0.7rem' }}>
                  {card.badge}
                </span>
              </div>
              <div
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 10,
                  background: card.bg,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: card.color,
                  flexShrink: 0,
                }}
              >
                <Icon size={22} />
              </div>
            </div>
          );
        })}
      </div>

      {/* Forensic Intelligence Quick Bar */}
      <div
        style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--border-primary)',
          borderRadius: 'var(--radius-md)',
          padding: '12px 18px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 12,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div
            style={{
              width: 28,
              height: 28,
              borderRadius: 6,
              background: data.breakdown.nightCalls > 0 ? 'rgba(234, 88, 12, 0.12)' : 'rgba(22, 163, 74, 0.12)',
              color: data.breakdown.nightCalls > 0 ? '#ea580c' : '#16a34a',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {data.breakdown.nightCalls > 0 ? <AlertTriangle size={16} /> : <ShieldCheck size={16} />}
          </div>
          <div>
            <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)' }}>
              Nocturnal Window Analysis (00:00–05:00 UTC):
            </span>{' '}
            <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
              <strong>{data.breakdown.nightCalls} calls</strong> ({data.breakdown.nightCallPercentage}% of total traffic)
            </span>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className={`badge ${data.breakdown.nightCallPercentage > 10 ? 'badge-critical' : 'badge-medium'}`}>
            {data.breakdown.nightCallPercentage > 10 ? 'Unusual Nocturnal Spike' : 'Monitored Activity'}
          </span>
          <span className="badge badge-neutral" style={{ fontFamily: 'var(--font-mono)' }}>
            Source: {data.dataSource}
          </span>
        </div>
      </div>
    </div>
  );
}
