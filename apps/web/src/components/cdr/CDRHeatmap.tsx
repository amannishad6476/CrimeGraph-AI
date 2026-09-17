import React, { useState } from 'react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Cell,
  ReferenceArea,
} from 'recharts';
import { Moon, AlertTriangle, Clock, BarChart2, Zap } from 'lucide-react';

export interface HourlyBucket {
  hourIndex: number;
  hour: string;
  callCount: number;
  duration: number;
  durationFormatted: string;
  isNightWindow: boolean;
  voiceCount: number;
  smsCount: number;
  anomalyScore: number;
  anomalyStatus: 'NORMAL' | 'ELEVATED' | 'HIGH_SURGE';
  calls: Array<{
    callId: string;
    caller: string;
    callee: string;
    timestamp: string;
    duration: number;
    flagged?: boolean;
    flagReason?: string;
  }>;
}

export interface CDRTimelineData {
  hourlyDistribution: HourlyBucket[];
  nightWindowAssessment: {
    window: string;
    totalNightCalls: number;
    totalNightDuration: number;
    totalNightDurationFormatted: string;
    nightTrafficPercentage: number;
    baselineExpectedPercentage: string;
    deviation: string;
    isUnusualActivity: boolean;
    severity: 'CRITICAL' | 'HIGH' | 'LOW';
    summary: string;
    recommendation: string;
  };
  peakHour: HourlyBucket;
  dataSource: string;
  isSyntheticDemo: boolean;
}

interface Props {
  data: CDRTimelineData | null;
  loading: boolean;
}

export default function CDRHeatmap({ data, loading }: Props) {
  const [metric, setMetric] = useState<'volume' | 'duration'>('volume');
  const [selectedHour, setSelectedHour] = useState<HourlyBucket | null>(null);

  if (loading) {
    return (
      <div className="card" style={{ padding: 40, textAlign: 'center', marginBottom: 24 }}>
        <div className="loading-spinner" style={{ margin: '0 auto 12px' }} />
        <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>Loading 24-hour CDR temporal distribution...</p>
      </div>
    );
  }

  if (!data || !data.hourlyDistribution) {
    return (
      <div className="card" style={{ padding: 30, textAlign: 'center', color: 'var(--text-muted)', marginBottom: 24 }}>
        No timeline data available.
      </div>
    );
  }

  const { hourlyDistribution, nightWindowAssessment, peakHour } = data;

  // Format data for recharts
  const chartData = hourlyDistribution.map((h) => ({
    hour: h.hour,
    hourIndex: h.hourIndex,
    calls: h.callCount,
    durationMinutes: Number((h.duration / 60).toFixed(1)),
    durationSeconds: h.duration,
    durationFormatted: h.durationFormatted,
    isNight: h.isNightWindow,
    status: h.anomalyStatus,
  }));

  const activeHourDetails = selectedHour || hourlyDistribution.find((h) => h.isNightWindow && h.callCount > 0) || peakHour;

  return (
    <div className="card" style={{ padding: 24, marginBottom: 24, borderRadius: 'var(--radius-md)' }}>
      {/* Header & Controls */}
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
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <h2 style={{ fontSize: '1.15rem', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
              24-Hour Call Activity Timeline
            </h2>
            <span className="badge badge-info" style={{ fontSize: '0.72rem' }}>
              00:00 – 23:00 Cycle
            </span>
          </div>
          <p style={{ fontSize: '0.825rem', color: 'var(--text-muted)', margin: 0 }}>
            Hourly volume and duration distribution with automated 00:00–05:00 nocturnal anomaly detection
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div
            style={{
              display: 'flex',
              background: 'var(--bg-secondary)',
              borderRadius: 'var(--radius-sm)',
              padding: 2,
            }}
          >
            <button
              className={`btn btn-sm ${metric === 'volume' ? 'btn-primary' : ''}`}
              style={{
                background: metric === 'volume' ? 'var(--accent-primary)' : 'transparent',
                color: metric === 'volume' ? '#fff' : 'var(--text-secondary)',
                border: 'none',
                padding: '4px 12px',
                fontSize: '0.78rem',
                cursor: 'pointer',
              }}
              onClick={() => setMetric('volume')}
            >
              <BarChart2 size={13} style={{ marginRight: 4 }} />
              Call Volume
            </button>
            <button
              className={`btn btn-sm ${metric === 'duration' ? 'btn-primary' : ''}`}
              style={{
                background: metric === 'duration' ? 'var(--accent-primary)' : 'transparent',
                color: metric === 'duration' ? '#fff' : 'var(--text-secondary)',
                border: 'none',
                padding: '4px 12px',
                fontSize: '0.78rem',
                cursor: 'pointer',
              }}
              onClick={() => setMetric('duration')}
            >
              <Clock size={13} style={{ marginRight: 4 }} />
              Call Duration
            </button>
          </div>
        </div>
      </div>

      {/* Alert Banner: Nocturnal Anomaly (00:00-05:00) */}
      {nightWindowAssessment.isUnusualActivity && (
        <div
          style={{
            background: 'rgba(234, 88, 12, 0.08)',
            border: '1px solid rgba(234, 88, 12, 0.35)',
            borderLeft: '4px solid #ea580c',
            borderRadius: 'var(--radius-sm)',
            padding: '14px 18px',
            marginBottom: 20,
            display: 'flex',
            alignItems: 'flex-start',
            gap: 14,
          }}
        >
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: '50%',
              background: 'rgba(234, 88, 12, 0.2)',
              color: '#ea580c',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
              marginTop: 2,
            }}
          >
            <Moon size={18} />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <span style={{ fontSize: '0.9rem', fontWeight: 700, color: '#c2410c' }}>
                Unusual Nocturnal Telephony Spike (00:00–05:00 Window)
              </span>
              <span className="badge badge-critical" style={{ fontSize: '0.7rem' }}>
                {nightWindowAssessment.severity} ANOMALY
              </span>
              <span className="badge badge-neutral" style={{ fontSize: '0.7rem' }}>
                {nightWindowAssessment.deviation}
              </span>
            </div>
            <p style={{ fontSize: '0.825rem', color: 'var(--text-secondary)', lineHeight: 1.5, margin: 0, marginBottom: 6 }}>
              {nightWindowAssessment.summary}
            </p>
            <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
              <strong>Investigator Action:</strong> {nightWindowAssessment.recommendation}
            </div>
          </div>
        </div>
      )}

      {/* Legend & Summary Metrics */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 12,
          padding: '8px 12px',
          background: 'var(--bg-elevated)',
          borderRadius: 'var(--radius-sm)',
          marginBottom: 16,
          fontSize: '0.8rem',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 12, height: 12, borderRadius: 2, background: '#ea580c' }} />
            <span style={{ color: 'var(--text-secondary)' }}>
              Nocturnal Window (00:00–05:00) — <strong>High Risk</strong>
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 12, height: 12, borderRadius: 2, background: '#2563eb' }} />
            <span style={{ color: 'var(--text-secondary)' }}>Standard Daytime/Evening Activity</span>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 14, color: 'var(--text-tertiary)' }}>
          <span>
            Night Volume: <strong style={{ color: '#ea580c' }}>{nightWindowAssessment.totalNightCalls} calls</strong>
          </span>
          <span>
            Night Duration: <strong>{nightWindowAssessment.totalNightDurationFormatted}</strong>
          </span>
          <span>
            Peak Hour: <strong>{peakHour.hour} ({peakHour.callCount} calls)</strong>
          </span>
        </div>
      </div>

      {/* 24-Hour Bar Chart */}
      <div style={{ height: 260, width: '100%', marginBottom: 20 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={chartData}
            margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
            onClick={(e) => {
              if (e && e.activePayload && e.activePayload.length > 0) {
                const hourIndex = e.activePayload[0].payload.hourIndex;
                setSelectedHour(hourlyDistribution[hourIndex]);
              }
            }}
          >
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border-secondary)" />
            <XAxis
              dataKey="hour"
              tick={{ fontSize: 11, fill: 'var(--text-muted)' }}
              tickLine={false}
              axisLine={{ stroke: 'var(--border-primary)' }}
            />
            <YAxis
              tick={{ fontSize: 11, fill: 'var(--text-muted)' }}
              tickLine={false}
              axisLine={{ stroke: 'var(--border-primary)' }}
              allowDecimals={false}
            />
            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload || !payload.length) return null;
                const d = payload[0].payload;
                return (
                  <div
                    style={{
                      background: '#ffffff',
                      padding: '10px 14px',
                      borderRadius: 8,
                      border: '1px solid var(--border-primary)',
                      boxShadow: 'var(--shadow-md)',
                      fontSize: '0.8rem',
                    }}
                  >
                    <div style={{ fontWeight: 700, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span>Hour: {d.hour}</span>
                      {d.isNight && (
                        <span className="badge badge-critical" style={{ fontSize: '0.65rem' }}>
                          NOCTURNAL
                        </span>
                      )}
                    </div>
                    <div style={{ color: 'var(--text-secondary)' }}>
                      Call Volume: <strong>{d.calls} calls</strong>
                    </div>
                    <div style={{ color: 'var(--text-secondary)' }}>
                      Duration: <strong>{d.durationFormatted}</strong> ({d.durationMinutes} mins)
                    </div>
                    {d.status === 'HIGH_SURGE' && (
                      <div style={{ color: '#c2410c', marginTop: 4, fontSize: '0.72rem', fontWeight: 600 }}>
                        ⚠️ Nocturnal Communication Surge
                      </div>
                    )}
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: 4 }}>
                      Click bar to inspect recorded call sessions
                    </div>
                  </div>
                );
              }}
            />
            {/* Highlight Nocturnal Window background */}
            <ReferenceArea x1="00:00" x2="05:00" fill="rgba(234, 88, 12, 0.08)" strokeOpacity={0.3} />
            <Bar dataKey={metric === 'volume' ? 'calls' : 'durationMinutes'} radius={[4, 4, 0, 0]}>
              {chartData.map((entry, index) => {
                let barColor = '#2563eb';
                if (entry.isNight) {
                  barColor = entry.calls > 0 ? '#ea580c' : 'rgba(234, 88, 12, 0.3)';
                }
                if (selectedHour && selectedHour.hour === entry.hour) {
                  barColor = '#7c3aed';
                }
                return <Cell key={`cell-${index}`} fill={barColor} cursor="pointer" />;
              })}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Selected Hour Call Drill-down */}
      {activeHourDetails && (
        <div
          style={{
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border-primary)',
            borderRadius: 'var(--radius-sm)',
            padding: '14px 18px',
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
              <Zap size={16} color="var(--accent-primary)" />
              <span style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                Recorded Activity for {activeHourDetails.hour}
              </span>
              <span className="badge badge-neutral">
                {activeHourDetails.callCount} calls ({activeHourDetails.durationFormatted})
              </span>
              {activeHourDetails.isNightWindow && (
                <span className="badge badge-high" style={{ fontSize: '0.7rem' }}>
                  Nocturnal Window
                </span>
              )}
            </div>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              Showing {activeHourDetails.calls.length} logged sessions
            </span>
          </div>

          {activeHourDetails.calls.length === 0 ? (
            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: 0 }}>
              No calls recorded during this hour.
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {activeHourDetails.calls.map((c) => (
                <div
                  key={c.callId}
                  style={{
                    background: '#ffffff',
                    border: '1px solid var(--border-primary)',
                    borderRadius: 6,
                    padding: '8px 12px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    flexWrap: 'wrap',
                    gap: 8,
                    fontSize: '0.8rem',
                  }}
                >
                  <div>
                    <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, color: 'var(--accent-primary)' }}>
                      {c.callId}
                    </span>
                    <span style={{ margin: '0 8px', color: 'var(--text-muted)' }}>•</span>
                    <span style={{ color: 'var(--text-primary)' }}>
                      <strong>{c.caller}</strong> → <strong>{c.callee}</strong>
                    </span>
                    {c.flagReason && (
                      <span
                        style={{
                          marginLeft: 8,
                          fontSize: '0.72rem',
                          color: '#c2410c',
                          background: 'rgba(234, 88, 12, 0.1)',
                          padding: '1px 6px',
                          borderRadius: 4,
                        }}
                      >
                        ⚠️ {c.flagReason}
                      </span>
                    )}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--text-muted)' }}>
                    <span>{new Date(c.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
                    <span>{c.duration}s</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
