import { Router, Response } from 'express';
import { authenticate, AuthenticatedRequest } from '../middleware/auth';
import { runCypherQuery } from '../db/neo4j';
import { logger } from '../utils/logger';
import {
  SYNTHETIC_CDR_DATASET,
  SYNTHETIC_PHONE_DIRECTORY,
  SyntheticCDRRecord,
} from './cdrData';

const router = Router();
router.use(authenticate);

// Helper function to format duration in human-readable format
function formatDuration(seconds: number): string {
  if (!seconds || seconds <= 0) return '0s';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = Math.floor(seconds % 60);

  const parts: string[] = [];
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (remainingSeconds > 0 || parts.length === 0) parts.push(`${remainingSeconds}s`);
  return parts.join(' ');
}

// Helper to look up phone or entity info
function resolveParty(
  phoneOrId: string
): { number: string; name: string; entityId: string; operator: string; circle: string } {
  // If phoneOrId matches a known directory phone directly
  if (SYNTHETIC_PHONE_DIRECTORY[phoneOrId]) {
    const entry = SYNTHETIC_PHONE_DIRECTORY[phoneOrId];
    return {
      number: entry.number,
      name: entry.name || 'Unknown Subscriber',
      entityId: entry.entityId || 'E-UNKNOWN',
      operator: entry.operator,
      circle: entry.circle,
    };
  }

  // Check if it's an entity ID like P001, PH001
  for (const entry of Object.values(SYNTHETIC_PHONE_DIRECTORY)) {
    if (entry.entityId?.toLowerCase() === phoneOrId.toLowerCase()) {
      return {
        number: entry.number,
        name: entry.name || 'Unknown Subscriber',
        entityId: entry.entityId,
        operator: entry.operator,
        circle: entry.circle,
      };
    }
  }

  // Fallback
  return {
    number: phoneOrId,
    name: `Unknown (${phoneOrId.slice(-4)})`,
    entityId: `E-${phoneOrId.slice(-4)}`,
    operator: 'Cellular Network',
    circle: 'National',
  };
}

// ============================================================================
// 1. GET /api/cdr/overview
// Total calls, total duration, unique IMEI count, unique IMSI/SIM count, active phone numbers
// ============================================================================
router.get('/overview', async (_req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    let source: 'live_graph' | 'synthetic_telecom_store' = 'synthetic_telecom_store';
    let records = SYNTHETIC_CDR_DATASET;

    // Attempt to query live Neo4j communication records if available
    try {
      const graphResult = await runCypherQuery(`
        MATCH ()-[r:CALLS|MESSAGES]->()
        RETURN count(r) as totalCalls, sum(toFloat(r.duration)) as totalDuration
      `);
      const totalCallsGraph = graphResult.records[0]?.get('totalCalls')?.toNumber 
        ? graphResult.records[0].get('totalCalls').toNumber() 
        : Number(graphResult.records[0]?.get('totalCalls') || 0);

      if (totalCallsGraph > 0) {
        source = 'live_graph';
      }
    } catch {
      // Fallback to rich synthetic store
      source = 'synthetic_telecom_store';
    }

    // Compute metrics across CDR dataset
    const totalCalls = records.length;
    const totalDuration = records.reduce((sum, r) => sum + (r.duration || 0), 0);

    const imeis = new Set<string>();
    const imsis = new Set<string>();
    const activePhoneNumbers = new Set<string>();
    let voiceCount = 0;
    let smsCount = 0;
    let nightCallCount = 0;

    records.forEach((r) => {
      if (r.callerNumber) activePhoneNumbers.add(r.callerNumber);
      if (r.calleeNumber) activePhoneNumbers.add(r.calleeNumber);
      if (r.imei) imeis.add(r.imei);
      if (r.imsi) imsis.add(r.imsi);
      if (r.callType === 'SMS') smsCount++;
      else voiceCount++;

      // Check night window (00:00 to 05:00 UTC/IST)
      const callHour = new Date(r.timestamp).getUTCHours();
      if (callHour >= 0 && callHour < 5) {
        nightCallCount++;
      }
    });

    res.json({
      totalCalls,
      totalDuration,
      totalDurationFormatted: formatDuration(totalDuration),
      avgCallDuration: totalCalls > 0 ? Math.round(totalDuration / totalCalls) : 0,
      uniqueIMEICount: imeis.size,
      uniqueIMSICount: imsis.size,
      activePhoneNumbersCount: activePhoneNumbers.size,
      breakdown: {
        voiceCalls: voiceCount,
        smsMessages: smsCount,
        nightCalls: nightCallCount,
        nightCallPercentage: totalCalls > 0 ? Number(((nightCallCount / totalCalls) * 100).toFixed(1)) : 0,
        flaggedCalls: records.filter((r) => r.flagged).length,
      },
      dataSource: source,
      isSyntheticDemo: true,
      disclaimer: 'SYNTHETIC TELECOM INTELLIGENCE: Generated for law enforcement simulation and analysis. No real CDR data.',
    });
  } catch (error) {
    logger.error('CDR overview error:', error);
    res.status(500).json({ error: 'Failed to generate CDR overview' });
  }
});

// ============================================================================
// 2. GET /api/cdr/timeline
// Hourly call activity from 00:00 to 23:00, call count, duration, identify unusual activity 00:00–05:00
// ============================================================================
router.get('/timeline', async (_req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const records = SYNTHETIC_CDR_DATASET;

    // Initialize 24-hour buckets
    const hourlyData: Array<{
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
    }> = Array.from({ length: 24 }, (_, i) => {
      const hourStr = `${i.toString().padStart(2, '0')}:00`;
      const isNight = i >= 0 && i < 5;
      return {
        hourIndex: i,
        hour: hourStr,
        callCount: 0,
        duration: 0,
        durationFormatted: '0s',
        isNightWindow: isNight,
        voiceCount: 0,
        smsCount: 0,
        anomalyScore: 0,
        anomalyStatus: 'NORMAL',
        calls: [],
      };
    });

    // Populate buckets
    records.forEach((r) => {
      const date = new Date(r.timestamp);
      const hour = date.getUTCHours();
      if (hour >= 0 && hour < 24) {
        const bucket = hourlyData[hour];
        bucket.callCount++;
        bucket.duration += r.duration || 0;
        if (r.callType === 'SMS') bucket.smsCount++;
        else bucket.voiceCount++;

        bucket.calls.push({
          callId: r.callId,
          caller: r.callerName ? `${r.callerName} (${r.callerNumber})` : r.callerNumber,
          callee: r.calleeName ? `${r.calleeName} (${r.calleeNumber})` : r.calleeNumber,
          timestamp: r.timestamp,
          duration: r.duration,
          flagged: r.flagged,
          flagReason: r.flagReason,
        });
      }
    });

    // Compute anomaly scores and format durations
    let nightTotalCalls = 0;
    let nightTotalDuration = 0;
    let daytimeTotalCalls = 0;

    hourlyData.forEach((b) => {
      b.durationFormatted = formatDuration(b.duration);
      if (b.isNightWindow) {
        nightTotalCalls += b.callCount;
        nightTotalDuration += b.duration;
        // In standard telecommunications baseline, 00:00–05:00 represents < 5% of traffic.
        // If night calls exceed 2 in an hour, it flags as high anomalous surge.
        if (b.callCount >= 2) {
          b.anomalyScore = Math.min(0.95, 0.5 + b.callCount * 0.15);
          b.anomalyStatus = 'HIGH_SURGE';
        } else if (b.callCount > 0) {
          b.anomalyScore = 0.55;
          b.anomalyStatus = 'ELEVATED';
        }
      } else {
        daytimeTotalCalls += b.callCount;
      }
    });

    const totalCalls = records.length;
    const nightPercentage = totalCalls > 0 ? Number(((nightTotalCalls / totalCalls) * 100).toFixed(1)) : 0;
    const unusualNightActivityDetected = nightTotalCalls >= 4;

    res.json({
      hourlyDistribution: hourlyData,
      nightWindowAssessment: {
        window: '00:00 - 05:00 UTC',
        totalNightCalls: nightTotalCalls,
        totalNightDuration: nightTotalDuration,
        totalNightDurationFormatted: formatDuration(nightTotalDuration),
        nightTrafficPercentage: nightPercentage,
        baselineExpectedPercentage: '3.5%',
        deviation: `${(nightPercentage / 3.5).toFixed(1)}x expected baseline volume`,
        isUnusualActivity: unusualNightActivityDetected,
        severity: unusualNightActivityDetected ? 'CRITICAL' : 'LOW',
        summary: unusualNightActivityDetected
          ? `Suspicious nocturnal surge detected: ${nightTotalCalls} calls recorded between 00:00 and 05:00 (${nightPercentage}% of total activity). Telephony traffic in this window exhibits coordinated burst patterns between persons of interest.`
          : 'Night activity within baseline operational parameters.',
        recommendation: unusualNightActivityDetected
          ? 'Cross-reference nocturnal call timestamps with tower geolocation data to evaluate off-hours meeting coordination.'
          : 'Maintain periodic surveillance monitoring.',
      },
      peakHour: hourlyData.reduce((prev, curr) => (curr.callCount > prev.callCount ? curr : prev), hourlyData[0]),
      dataSource: 'synthetic_telecom_store',
      isSyntheticDemo: true,
    });
  } catch (error) {
    logger.error('CDR timeline error:', error);
    res.status(500).json({ error: 'Failed to generate CDR timeline' });
  }
});

// ============================================================================
// 3. GET /api/cdr/contacts/:phoneOrEntityId
// Top contacts, incoming/outgoing calls, call frequency, total duration, latest activity
// ============================================================================
router.get('/contacts/:phoneOrEntityId', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { phoneOrEntityId } = req.params;

  if (!phoneOrEntityId || phoneOrEntityId.trim() === '') {
    res.status(400).json({ error: 'Phone number or entity ID required' });
    return;
  }

  try {
    const target = resolveParty(phoneOrEntityId.trim());
    const targetNumber = target.number;
    const records = SYNTHETIC_CDR_DATASET;

    // Filter relevant calls involving the target
    const relevantCalls = records.filter(
      (r) =>
        r.callerNumber === targetNumber ||
        r.calleeNumber === targetNumber ||
        (r.callerEntityId && r.callerEntityId.toLowerCase() === phoneOrEntityId.toLowerCase()) ||
        (r.calleeEntityId && r.calleeEntityId.toLowerCase() === phoneOrEntityId.toLowerCase())
    );

    const contactMap = new Map<
      string,
      {
        contactPhone: string;
        contactName: string;
        contactEntityId: string;
        contactOperator: string;
        contactCircle: string;
        callFrequency: number;
        incomingCalls: number;
        outgoingCalls: number;
        totalDuration: number;
        avgDuration: number;
        latestActivity: string;
        firstActivity: string;
        callTypes: { voice: number; sms: number };
        isFlagged: boolean;
        flagReasons: string[];
      }
    >();

    let totalIncoming = 0;
    let totalOutgoing = 0;
    let totalTargetDuration = 0;

    relevantCalls.forEach((r) => {
      const isCaller = r.callerNumber === targetNumber || r.callerEntityId?.toLowerCase() === phoneOrEntityId.toLowerCase();
      const partnerNumber = isCaller ? r.calleeNumber : r.callerNumber;
      const partnerInfo = resolveParty(partnerNumber);

      if (isCaller) totalOutgoing++;
      else totalIncoming++;

      totalTargetDuration += r.duration || 0;

      let contact = contactMap.get(partnerNumber);
      if (!contact) {
        contact = {
          contactPhone: partnerNumber,
          contactName: partnerInfo.name,
          contactEntityId: partnerInfo.entityId,
          contactOperator: partnerInfo.operator,
          contactCircle: partnerInfo.circle,
          callFrequency: 0,
          incomingCalls: 0,
          outgoingCalls: 0,
          totalDuration: 0,
          avgDuration: 0,
          latestActivity: r.timestamp,
          firstActivity: r.timestamp,
          callTypes: { voice: 0, sms: 0 },
          isFlagged: false,
          flagReasons: [],
        };
        contactMap.set(partnerNumber, contact);
      }

      contact.callFrequency++;
      contact.totalDuration += r.duration || 0;
      if (isCaller) {
        contact.outgoingCalls++; // Target initiated call to contact
      } else {
        contact.incomingCalls++; // Contact initiated call to target
      }

      if (r.callType === 'SMS') contact.callTypes.sms++;
      else contact.callTypes.voice++;

      if (r.flagged) {
        contact.isFlagged = true;
        if (r.flagReason && !contact.flagReasons.includes(r.flagReason)) {
          contact.flagReasons.push(r.flagReason);
        }
      }

      // Update timestamps
      if (new Date(r.timestamp).getTime() > new Date(contact.latestActivity).getTime()) {
        contact.latestActivity = r.timestamp;
      }
      if (new Date(r.timestamp).getTime() < new Date(contact.firstActivity).getTime()) {
        contact.firstActivity = r.timestamp;
      }
    });

    // Calculate averages and sort by frequency descending
    const topContacts = Array.from(contactMap.values())
      .map((c) => ({
        ...c,
        avgDuration: c.callFrequency > 0 ? Math.round(c.totalDuration / c.callFrequency) : 0,
        totalDurationFormatted: formatDuration(c.totalDuration),
      }))
      .sort((a, b) => b.callFrequency - a.callFrequency);

    const totalCalls = relevantCalls.length;
    const incomingRatio = totalCalls > 0 ? Number(((totalIncoming / totalCalls) * 100).toFixed(1)) : 0;
    const outgoingRatio = totalCalls > 0 ? Number(((totalOutgoing / totalCalls) * 100).toFixed(1)) : 0;

    res.json({
      target: {
        number: target.number,
        name: target.name,
        entityId: target.entityId,
        operator: target.operator,
        circle: target.circle,
      },
      summary: {
        totalCalls,
        totalDuration: totalTargetDuration,
        totalDurationFormatted: formatDuration(totalTargetDuration),
        uniqueContactsCount: topContacts.length,
        incomingCalls: totalIncoming,
        outgoingCalls: totalOutgoing,
        incomingRatio,
        outgoingRatio,
      },
      topContacts,
      isSyntheticDemo: true,
      dataSource: 'synthetic_telecom_store',
    });
  } catch (error) {
    logger.error('CDR contacts analysis error:', error);
    res.status(500).json({ error: 'Failed to analyze target contacts' });
  }
});

// ============================================================================
// 4. GET /api/cdr/imei-swaps
// Detect multiple SIMs using same IMEI, detect one SIM moving between multiple IMEIs
// ============================================================================
router.get('/imei-swaps', async (_req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const records = SYNTHETIC_CDR_DATASET;

    // 1. Group by IMEI -> find distinct SIMs / Phone Numbers
    const imeiMap = new Map<
      string,
      {
        imei: string;
        phoneNumbers: Set<string>;
        imsis: Set<string>;
        records: SyntheticCDRRecord[];
        firstSeen: string;
        lastSeen: string;
      }
    >();

    // 2. Group by SIM (Phone Number / IMSI) -> find distinct IMEIs
    const simMap = new Map<
      string,
      {
        phoneNumber: string;
        imeis: Set<string>;
        imsis: Set<string>;
        records: SyntheticCDRRecord[];
        firstSeen: string;
        lastSeen: string;
      }
    >();

    records.forEach((r) => {
      // Check caller
      if (r.imei && r.callerNumber) {
        // IMEI map
        let imeiEntry = imeiMap.get(r.imei);
        if (!imeiEntry) {
          imeiEntry = {
            imei: r.imei,
            phoneNumbers: new Set(),
            imsis: new Set(),
            records: [],
            firstSeen: r.timestamp,
            lastSeen: r.timestamp,
          };
          imeiMap.set(r.imei, imeiEntry);
        }
        imeiEntry.phoneNumbers.add(r.callerNumber);
        if (r.imsi) imeiEntry.imsis.add(r.imsi);
        imeiEntry.records.push(r);
        if (new Date(r.timestamp).getTime() < new Date(imeiEntry.firstSeen).getTime()) imeiEntry.firstSeen = r.timestamp;
        if (new Date(r.timestamp).getTime() > new Date(imeiEntry.lastSeen).getTime()) imeiEntry.lastSeen = r.timestamp;

        // SIM map
        let simEntry = simMap.get(r.callerNumber);
        if (!simEntry) {
          simEntry = {
            phoneNumber: r.callerNumber,
            imeis: new Set(),
            imsis: new Set(),
            records: [],
            firstSeen: r.timestamp,
            lastSeen: r.timestamp,
          };
          simMap.set(r.callerNumber, simEntry);
        }
        simEntry.imeis.add(r.imei);
        if (r.imsi) simEntry.imsis.add(r.imsi);
        simEntry.records.push(r);
        if (new Date(r.timestamp).getTime() < new Date(simEntry.firstSeen).getTime()) simEntry.firstSeen = r.timestamp;
        if (new Date(r.timestamp).getTime() > new Date(simEntry.lastSeen).getTime()) simEntry.lastSeen = r.timestamp;
      }
    });

    // Detect Multi-SIM on Same Handset (Device Sharing)
    const deviceSharingDetections = Array.from(imeiMap.values())
      .filter((entry) => entry.phoneNumbers.size >= 2)
      .map((entry) => {
        const associatedSims = Array.from(entry.phoneNumbers).map((num) => {
          const info = resolveParty(num);
          return {
            number: num,
            name: info.name,
            entityId: info.entityId,
            operator: info.operator,
          };
        });

        const swapSeverity = entry.phoneNumbers.size >= 3 ? 'CRITICAL' : 'HIGH';

        return {
          detectionType: 'DEVICE_SHARING_MULTIPLE_SIMS',
          imei: entry.imei,
          deviceModel: entry.imei.startsWith('86') ? 'Burner / Tactical GSM Handset' : 'Smartphone / 4G Terminal',
          simCount: entry.phoneNumbers.size,
          associatedSims,
          associatedImsis: Array.from(entry.imsis),
          firstSeen: entry.firstSeen,
          lastSeen: entry.lastSeen,
          totalCallsObserved: entry.records.length,
          severity: swapSeverity,
          evidenceNote: `Device IMEI ${entry.imei} was operated by ${entry.phoneNumbers.size} distinct SIM cards (${associatedSims.map((s) => s.name).join(', ')}). High probability of operational handset sharing or burner handset reuse across suspects.`,
        };
      });

    // Detect Single SIM Moving Between Handsets (SIM Hopping)
    const simHoppingDetections = Array.from(simMap.values())
      .filter((entry) => entry.imeis.size >= 2)
      .map((entry) => {
        const subscriberInfo = resolveParty(entry.phoneNumber);
        const imeisList = Array.from(entry.imeis);
        const swapSeverity = imeisList.length >= 3 ? 'CRITICAL' : 'HIGH';

        return {
          detectionType: 'SIM_HOPPING_MULTIPLE_DEVICES',
          phoneNumber: entry.phoneNumber,
          subscriberName: subscriberInfo.name,
          entityId: subscriberInfo.entityId,
          operator: subscriberInfo.operator,
          deviceCount: imeisList.length,
          associatedImeis: imeisList,
          associatedImsis: Array.from(entry.imsis),
          firstSeen: entry.firstSeen,
          lastSeen: entry.lastSeen,
          totalCallsObserved: entry.records.length,
          severity: swapSeverity,
          evidenceNote: `Subscriber ${subscriberInfo.name} (${entry.phoneNumber}) rotated between ${imeisList.length} distinct physical handsets within observation period. Indicates evasion tactics or rapid hardware discard.`,
        };
      });

    res.json({
      summary: {
        totalAnomaliesDetected: deviceSharingDetections.length + simHoppingDetections.length,
        deviceSharingCasesCount: deviceSharingDetections.length,
        simHoppingCasesCount: simHoppingDetections.length,
        criticalCasesCount:
          deviceSharingDetections.filter((d) => d.severity === 'CRITICAL').length +
          simHoppingDetections.filter((d) => d.severity === 'CRITICAL').length,
      },
      deviceSharing: deviceSharingDetections,
      simHopping: simHoppingDetections,
      isSyntheticDemo: true,
      dataSource: 'synthetic_telecom_store',
      disclaimer: 'IMEI/IMSI Swap anomalies flagged via cryptographic hardware binding heuristics. Requires investigator corroboration.',
    });
  } catch (error) {
    logger.error('CDR IMEI swaps error:', error);
    res.status(500).json({ error: 'Failed to analyze IMEI/IMSI swap anomalies' });
  }
});

// ============================================================================
// 5. GET /api/cdr/common-contacts
// Accept two target phone numbers/entities, find common contacts/intermediaries, return relationship details
// ============================================================================
router.get('/common-contacts', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const targetA = (req.query.targetA as string)?.trim() || '9876543210'; // Default Arjun Mehta
  const targetB = (req.query.targetB as string)?.trim() || '9871234567'; // Default Vikram Sinha

  if (!targetA || !targetB) {
    res.status(400).json({ error: 'targetA and targetB query parameters are required' });
    return;
  }

  try {
    const partyA = resolveParty(targetA);
    const partyB = resolveParty(targetB);
    const records = SYNTHETIC_CDR_DATASET;

    // Helper to find contacts for a given number
    const getContactStats = (targetNum: string) => {
      const statsMap = new Map<
        string,
        {
          callsWithTarget: number;
          durationWithTarget: number;
          lastInteraction: string;
          firstInteraction: string;
          incomingCount: number;
          outgoingCount: number;
        }
      >();

      records.forEach((r) => {
        const isCaller = r.callerNumber === targetNum;
        const isCallee = r.calleeNumber === targetNum;
        if (isCaller || isCallee) {
          const otherNumber = isCaller ? r.calleeNumber : r.callerNumber;
          // Ignore direct calls between targetA and targetB when looking for intermediaries
          if (otherNumber === targetNum) return;

          let s = statsMap.get(otherNumber);
          if (!s) {
            s = {
              callsWithTarget: 0,
              durationWithTarget: 0,
              lastInteraction: r.timestamp,
              firstInteraction: r.timestamp,
              incomingCount: 0,
              outgoingCount: 0,
            };
            statsMap.set(otherNumber, s);
          }

          s.callsWithTarget++;
          s.durationWithTarget += r.duration || 0;
          if (isCaller) s.outgoingCount++;
          else s.incomingCount++;

          if (new Date(r.timestamp).getTime() > new Date(s.lastInteraction).getTime()) {
            s.lastInteraction = r.timestamp;
          }
          if (new Date(r.timestamp).getTime() < new Date(s.firstInteraction).getTime()) {
            s.firstInteraction = r.timestamp;
          }
        }
      });

      return statsMap;
    };

    const contactsOfA = getContactStats(partyA.number);
    const contactsOfB = getContactStats(partyB.number);

    // Direct calls between Target A and Target B
    const directCalls = records.filter(
      (r) =>
        (r.callerNumber === partyA.number && r.calleeNumber === partyB.number) ||
        (r.callerNumber === partyB.number && r.calleeNumber === partyA.number)
    );

    // Find intersection (common contacts)
    const commonNumbers: string[] = [];
    contactsOfA.forEach((_, num) => {
      if (contactsOfB.has(num) && num !== partyA.number && num !== partyB.number) {
        commonNumbers.push(num);
      }
    });

    const intermediaries = commonNumbers.map((num) => {
      const info = resolveParty(num);
      const statsA = contactsOfA.get(num)!;
      const statsB = contactsOfB.get(num)!;
      const totalCalls = statsA.callsWithTarget + statsB.callsWithTarget;
      const totalDuration = statsA.durationWithTarget + statsB.durationWithTarget;

      // Check proximity of communications: were calls with A and B close in time?
      const timeDiffHours = Math.abs(
        (new Date(statsA.lastInteraction).getTime() - new Date(statsB.lastInteraction).getTime()) /
          (1000 * 60 * 60)
      );

      const isHighFrequencyIntermediary = totalCalls >= 3;
      const isCoordinatedRelay = timeDiffHours <= 4;

      return {
        intermediaryNumber: num,
        intermediaryName: info.name,
        entityId: info.entityId,
        operator: info.operator,
        circle: info.circle,
        targetAStats: {
          calls: statsA.callsWithTarget,
          duration: statsA.durationWithTarget,
          durationFormatted: formatDuration(statsA.durationWithTarget),
          lastContact: statsA.lastInteraction,
          incomingFromTarget: statsA.outgoingCount, // outgoing from target = incoming to intermediary
          outgoingToTarget: statsA.incomingCount,
        },
        targetBStats: {
          calls: statsB.callsWithTarget,
          duration: statsB.durationWithTarget,
          durationFormatted: formatDuration(statsB.durationWithTarget),
          lastContact: statsB.lastInteraction,
          incomingFromTarget: statsB.outgoingCount,
          outgoingToTarget: statsB.incomingCount,
        },
        totalCombinedCalls: totalCalls,
        totalCombinedDuration: totalDuration,
        totalCombinedDurationFormatted: formatDuration(totalDuration),
        timeDifferenceBetweenLastContactsHours: Number(timeDiffHours.toFixed(1)),
        isCoordinatedRelay,
        intermediaryRole: isCoordinatedRelay
          ? 'SUSPECTED_RELAY_BROKER'
          : isHighFrequencyIntermediary
          ? 'FREQUENT_MUTUAL_ASSOCIATE'
          : 'CASUAL_MUTUAL_CONTACT',
        riskLevel: isCoordinatedRelay ? 'CRITICAL' : isHighFrequencyIntermediary ? 'HIGH' : 'MEDIUM',
        forensicAssessment: `Intermediary ${info.name} (${num}) maintained active communication with both Target A and Target B (${statsA.callsWithTarget} calls with Target A, ${statsB.callsWithTarget} calls with Target B). Last mutual interactions occurred within ${timeDiffHours.toFixed(1)} hours of each other.`,
      };
    }).sort((a, b) => b.totalCombinedCalls - a.totalCombinedCalls);

    res.json({
      targetA: partyA,
      targetB: partyB,
      directCommunication: {
        hasDirectCalls: directCalls.length > 0,
        directCallsCount: directCalls.length,
        directDuration: directCalls.reduce((s, c) => s + (c.duration || 0), 0),
        directDurationFormatted: formatDuration(directCalls.reduce((s, c) => s + (c.duration || 0), 0)),
      },
      commonContactsSummary: {
        commonContactsCount: intermediaries.length,
        totalIntermediaryCalls: intermediaries.reduce((s, i) => s + i.totalCombinedCalls, 0),
        highRiskRelaysCount: intermediaries.filter((i) => i.riskLevel === 'CRITICAL').length,
      },
      intermediaries,
      isSyntheticDemo: true,
      dataSource: 'synthetic_telecom_store',
    });
  } catch (error) {
    logger.error('CDR common contacts error:', error);
    res.status(500).json({ error: 'Failed to find common contacts' });
  }
});

// ============================================================================
// 6. POST /api/cdr/upload-simulate
// Accept synthetic/demo CDR data, validate input, analyze it, do NOT require real data
// ============================================================================
router.post('/upload-simulate', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { records, scenarioName } = req.body;

    if (!records || !Array.isArray(records)) {
      res.status(400).json({
        error: 'Invalid CDR batch payload: "records" must be an array of CDR records.',
      });
      return;
    }

    if (records.length === 0) {
      res.status(400).json({
        error: 'Cannot simulate empty CDR batch. Please provide at least one synthetic CDR record.',
      });
      return;
    }

    if (records.length > 2000) {
      res.status(400).json({
        error: 'Simulation batch size exceeds 2000 records. Please truncate or paginate.',
      });
      return;
    }

    // Validate and sanitize records
    const validRecords: SyntheticCDRRecord[] = [];
    const validationErrors: string[] = [];

    records.forEach((raw, idx) => {
      const callerNumber = String(raw.callerNumber || raw.caller || '').trim();
      const calleeNumber = String(raw.calleeNumber || raw.callee || '').trim();
      const duration = Number(raw.duration ?? 0);
      const timestamp = raw.timestamp ? String(raw.timestamp) : new Date().toISOString();

      if (!callerNumber || !calleeNumber) {
        validationErrors.push(`Row ${idx + 1}: Missing callerNumber or calleeNumber.`);
        return;
      }

      if (isNaN(duration) || duration < 0) {
        validationErrors.push(`Row ${idx + 1}: Duration must be a non-negative number.`);
        return;
      }

      // Validate date
      if (isNaN(new Date(timestamp).getTime())) {
        validationErrors.push(`Row ${idx + 1}: Invalid ISO timestamp format.`);
        return;
      }

      validRecords.push({
        callId: raw.callId || `SIM-CDR-${Date.now()}-${idx + 1}`,
        callerNumber,
        calleeNumber,
        callerName: raw.callerName || undefined,
        calleeName: raw.calleeName || undefined,
        duration: Math.round(duration),
        timestamp,
        callType: raw.callType === 'SMS' ? 'SMS' : 'VOICE_OUT',
        imei: raw.imei ? String(raw.imei).trim() : undefined,
        imsi: raw.imsi ? String(raw.imsi).trim() : undefined,
        towerLocation: raw.towerLocation ? String(raw.towerLocation) : undefined,
        flagged: Boolean(raw.flagged),
        flagReason: raw.flagReason ? String(raw.flagReason) : undefined,
      });
    });

    if (validRecords.length === 0) {
      res.status(400).json({
        error: 'All submitted records failed validation.',
        validationErrors: validationErrors.slice(0, 10),
      });
      return;
    }

    // Run in-memory forensics engine on validRecords
    const totalCalls = validRecords.length;
    const totalDuration = validRecords.reduce((sum, r) => sum + r.duration, 0);
    const uniqueNumbers = new Set<string>();
    const uniqueImeis = new Set<string>();
    const uniqueImsis = new Set<string>();
    let nightCallsCount = 0;

    const hourlyCounts = new Array(24).fill(0);

    validRecords.forEach((r) => {
      uniqueNumbers.add(r.callerNumber);
      uniqueNumbers.add(r.calleeNumber);
      if (r.imei) uniqueImeis.add(r.imei);
      if (r.imsi) uniqueImsis.add(r.imsi);

      const h = new Date(r.timestamp).getUTCHours();
      if (h >= 0 && h < 24) {
        hourlyCounts[h]++;
        if (h >= 0 && h < 5) nightCallsCount++;
      }
    });

    // Detect swaps within the simulated batch
    const imeiToNumbers = new Map<string, Set<string>>();
    validRecords.forEach((r) => {
      if (r.imei && r.callerNumber) {
        if (!imeiToNumbers.has(r.imei)) imeiToNumbers.set(r.imei, new Set());
        imeiToNumbers.get(r.imei)!.add(r.callerNumber);
      }
    });

    const detectedSwapsInBatch: Array<{ imei: string; count: number; numbers: string[] }> = [];
    imeiToNumbers.forEach((nums, imei) => {
      if (nums.size >= 2) {
        detectedSwapsInBatch.push({
          imei,
          count: nums.size,
          numbers: Array.from(nums),
        });
      }
    });

    res.json({
      simulationStatus: 'SUCCESS',
      scenarioName: scenarioName || 'Synthetic Telecom Forensic Batch',
      recordsProcessed: totalCalls,
      recordsRejected: validationErrors.length,
      validationErrors: validationErrors.slice(0, 5),
      forensicsReport: {
        totalCalls,
        totalDuration,
        totalDurationFormatted: formatDuration(totalDuration),
        uniqueParticipants: uniqueNumbers.size,
        uniqueDevices: uniqueImeis.size,
        uniqueSims: uniqueImsis.size,
        nightCallsCount,
        nightActivityFlag: nightCallsCount >= 2,
        detectedHardwareSwapsCount: detectedSwapsInBatch.length,
        detectedSwaps: detectedSwapsInBatch,
        hourlyDistribution: hourlyCounts.map((count, hour) => ({
          hour: `${hour.toString().padStart(2, '0')}:00`,
          calls: count,
          isNight: hour < 5,
        })),
      },
      isSyntheticDemo: true,
      simulationNotice:
        'Analyzed strictly in volatile memory. No records were persisted to external databases or logged to system disk.',
    });
  } catch (error) {
    logger.error('CDR upload-simulate error:', error);
    res.status(500).json({ error: 'Failed to process simulated CDR upload' });
  }
});

export default router;
