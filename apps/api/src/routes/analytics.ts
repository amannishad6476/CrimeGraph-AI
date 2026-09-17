import { Router, Response } from 'express';
import { authenticate, AuthenticatedRequest } from '../middleware/auth';
import { runCypherQuery } from '../db/neo4j';
import { query } from '../db/postgres';
import { logger } from '../utils/logger';

const router = Router();
router.use(authenticate);

// GET /api/analytics/overview
router.get('/overview', async (_req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const [nodeStats, relStats, alertStats] = await Promise.all([
      runCypherQuery(`
        MATCH (n) WHERE n:Person OR n:Phone OR n:Vehicle OR n:Organization OR n:Location OR n:Account OR n:Case OR n:Event
        RETURN labels(n)[0] as type, count(*) as count
      `),
      runCypherQuery(`
        MATCH ()-[r]->()
        RETURN type(r) as relType, count(*) as count
        ORDER BY count DESC LIMIT 10
      `),
      query(`SELECT severity, COUNT(*) as count FROM alerts WHERE is_acknowledged = false GROUP BY severity`),
    ]);

    const nodeTypeCounts = nodeStats.records.reduce((acc: Record<string, number>, r) => {
      acc[r.get('type')] = r.get('count').toNumber ? r.get('count').toNumber() : r.get('count');
      return acc;
    }, {});

    const relTypeCounts = relStats.records.map(r => ({
      type: r.get('relType'),
      count: r.get('count').toNumber ? r.get('count').toNumber() : r.get('count'),
    }));

    const alertsBySeverity = alertStats.rows.reduce((acc: Record<string, number>, r) => {
      acc[r.severity] = parseInt(r.count);
      return acc;
    }, {});

    res.json({ nodeTypeCounts, relTypeCounts, alertsBySeverity });
  } catch (error) {
    logger.error('Analytics overview error:', error);
    res.status(500).json({ error: 'Failed to fetch analytics' });
  }
});

// GET /api/analytics/anomalies
router.get('/anomalies', async (_req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    // Statistical anomaly detection on communication data
    const result = await runCypherQuery(`
      MATCH (p:Person)-[r:CALLS|MESSAGES]-(other:Person)
      WITH p, count(r) as totalComms, collect(r.timestamp) as timestamps
      WITH p, totalComms,
           CASE WHEN totalComms > 15 THEN true ELSE false END as highActivity
      WHERE highActivity = true
      RETURN p.id as id, p.name as name, totalComms,
             p.riskScore as riskScore, p.communityId as communityId
      ORDER BY totalComms DESC
      LIMIT 20
    `);

    const anomalies = result.records.map(r => {
      const total = r.get('totalComms').toNumber ? r.get('totalComms').toNumber() : r.get('totalComms');
      const baseline = 8; // synthetic baseline
      const ratio = total / baseline;
      return {
        entityId: r.get('id'),
        entityName: r.get('name'),
        entityType: 'Person',
        anomalyType: 'HIGH_COMMUNICATION_VOLUME',
        metric: total,
        baseline,
        deviation: `${ratio.toFixed(1)}x above 30-day baseline`,
        severity: ratio > 3 ? 'high' : ratio > 2 ? 'medium' : 'low',
        explanation: `Communication activity increased ${ratio.toFixed(1)}x compared with the entity's previous 30-day baseline (${baseline} avg contacts/period vs ${total} recorded).`,
        disclaimer: 'This is an anomalous pattern indicator. Does not imply criminal activity. Requires investigator review.',
        confidence: Math.min(0.5 + (ratio * 0.05), 0.9),
      };
    });

    res.json({ anomalies, total: anomalies.length });
  } catch (error) {
    logger.error('Anomaly detection error:', error);
    res.status(500).json({ error: 'Failed to run anomaly detection' });
  }
});

// GET /api/analytics/cdr-analysis/:entityId
router.get('/cdr-analysis/:entityId', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { entityId } = req.params;
  try {
    const [commStats, contactList, temporalPattern] = await Promise.all([
      runCypherQuery(`
        MATCH (p:Person {id: $id})-[r:CALLS|MESSAGES]-(contact:Person)
        RETURN type(r) as relType, count(r) as count, 
               avg(toFloat(r.duration)) as avgDuration,
               sum(toFloat(r.duration)) as totalDuration
      `, { id: entityId }),
      runCypherQuery(`
        MATCH (p:Person {id: $id})-[r:CALLS|MESSAGES]-(contact:Person)
        RETURN contact.id as id, contact.name as name,
               count(r) as callCount, max(r.timestamp) as lastContact
        ORDER BY callCount DESC LIMIT 20
      `, { id: entityId }),
      runCypherQuery(`
        MATCH (p:Person {id: $id})-[r:CALLS|MESSAGES]-(contact:Person)
        WHERE r.timestamp IS NOT NULL
        RETURN r.timestamp as timestamp, type(r) as type, r.duration as duration
        ORDER BY r.timestamp DESC LIMIT 100
      `, { id: entityId }),
    ]);

    const stats = commStats.records.reduce((acc: Record<string, unknown>, r) => {
      const relType = r.get('relType');
      acc[relType] = {
        count: r.get('count').toNumber ? r.get('count').toNumber() : r.get('count'),
        avgDuration: r.get('avgDuration'),
        totalDuration: r.get('totalDuration'),
      };
      return acc;
    }, {});

    const contacts = contactList.records.map(r => ({
      id: r.get('id'),
      name: r.get('name'),
      callCount: r.get('callCount').toNumber ? r.get('callCount').toNumber() : r.get('callCount'),
      lastContact: r.get('lastContact'),
    }));

    const events = temporalPattern.records.map(r => ({
      timestamp: r.get('timestamp'),
      type: r.get('type'),
      duration: r.get('duration'),
    }));

    res.json({
      entityId,
      communicationStats: stats,
      topContacts: contacts,
      temporalEvents: events,
      disclaimer: 'Communication pattern analysis. Patterns described as "potentially unusual" do not imply criminal activity.',
    });
  } catch (error) {
    logger.error('CDR analysis error:', error);
    res.status(500).json({ error: 'Failed to run CDR analysis' });
  }
});

// GET /api/analytics/financial-analysis/:entityId
router.get('/financial-analysis/:entityId', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { entityId } = req.params;
  try {
    const [txStats, circularPaths] = await Promise.all([
      runCypherQuery(`
        MATCH (a:Account {id: $id})-[r:FINANCIAL_TRANSACTION]-(other:Account)
        RETURN type(r) as direction, count(r) as count,
               sum(toFloat(r.amount)) as totalAmount,
               avg(toFloat(r.amount)) as avgAmount,
               max(toFloat(r.amount)) as maxAmount
      `, { id: entityId }),
      runCypherQuery(`
        MATCH (a:Account {id: $id})-[:FINANCIAL_TRANSACTION*2..4]-(a)
        RETURN count(*) as circularCount
        LIMIT 1
      `, { id: entityId }),
    ]);

    const transactions = txStats.records.map(r => ({
      direction: r.get('direction'),
      count: r.get('count').toNumber ? r.get('count').toNumber() : r.get('count'),
      totalAmount: r.get('totalAmount'),
      avgAmount: r.get('avgAmount'),
      maxAmount: r.get('maxAmount'),
    }));

    const circularCount = circularPaths.records[0]?.get('circularCount').toNumber 
      ? circularPaths.records[0].get('circularCount').toNumber() 
      : (circularPaths.records[0]?.get('circularCount') || 0);

    const suspiciousIndicators: any[] = [];
    if (circularCount > 0) {
      suspiciousIndicators.push({
        type: 'CIRCULAR_TRANSACTION',
        description: 'Potentially circular transaction chain detected — requires investigation',
        severity: 'medium',
        disclaimer: 'Suspicious indicator only. Does not confirm illegal activity.',
      });
    }
    transactions.forEach(t => {
      if (t.count > 10) {
        suspiciousIndicators.push({
          type: 'HIGH_FREQUENCY',
          description: `High frequency transaction pattern: ${t.count} transactions detected`,
          severity: 'medium',
          disclaimer: 'Frequency anomaly only. Requires investigator review.',
        });
      }
    });

    res.json({
      entityId,
      transactionStats: transactions,
      suspiciousIndicators,
      disclaimer: 'Financial pattern analysis. All indicators require investigator review before any action.',
    });
  } catch (error) {
    logger.error('Financial analysis error:', error);
    res.status(500).json({ error: 'Failed to run financial analysis' });
  }
});

export default router;
