import { Router, Response } from 'express';
import { body, param, query as expressQuery, validationResult } from 'express-validator';
import { v4 as uuidv4 } from 'uuid';
import { query } from '../db/postgres';
import { authenticate, AuthenticatedRequest, logAction } from '../middleware/auth';
import { generateEvidenceHash, generateBlockHash } from '../utils/crypto';
import { logger } from '../utils/logger';

const router = Router();
router.use(authenticate);

// GET /api/investigations
router.get('/', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { status, priority, limit = 20, offset = 0 } = req.query;
    let sql = `
      SELECT i.*, 
        u1.full_name as created_by_name, 
        u2.full_name as assigned_to_name,
        COUNT(DISTINCT ie.id) as entity_count,
        COUNT(DISTINCT a.id) as alert_count
      FROM investigations i
      LEFT JOIN users u1 ON i.created_by = u1.id
      LEFT JOIN users u2 ON i.assigned_to = u2.id
      LEFT JOIN investigation_entities ie ON ie.investigation_id = i.id
      LEFT JOIN alerts a ON a.investigation_id = i.id AND a.is_acknowledged = false
    `;
    const params: unknown[] = [];
    const conditions: string[] = [];

    if (status) { conditions.push(`i.status = $${params.length + 1}`); params.push(status); }
    if (priority) { conditions.push(`i.priority = $${params.length + 1}`); params.push(priority); }

    // Non-admins can only see their own or assigned investigations
    if (req.user?.role === 'investigator') {
      conditions.push(`(i.created_by = $${params.length + 1} OR i.assigned_to = $${params.length + 1})`);
      params.push(req.user.id);
    }

    if (conditions.length > 0) sql += ` WHERE ${conditions.join(' AND ')}`;
    sql += ` GROUP BY i.id, u1.full_name, u2.full_name ORDER BY i.updated_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);

    const result = await query(sql, params);
    const countResult = await query('SELECT COUNT(*) FROM investigations');

    res.json({
      investigations: result.rows,
      total: parseInt(countResult.rows[0].count),
    });
  } catch (error) {
    logger.error('Get investigations error:', error);
    res.status(500).json({ error: 'Failed to fetch investigations' });
  }
});

// GET /api/investigations/officers — active officers available for case assignment
router.get('/officers', async (_req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const result = await query(
      `SELECT id, username, full_name, role, badge_number, department
       FROM users
       WHERE is_active = true AND role IN ('investigator', 'senior_investigator')
       ORDER BY full_name`
    );
    res.json({ officers: result.rows });
  } catch (error) {
    logger.error('Get officers error:', error);
    res.status(500).json({ error: 'Failed to fetch officers' });
  }
});

// GET /api/investigations/:id
router.get('/:id', param('id').trim().notEmpty(), async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) { res.status(400).json({ errors: errors.array() }); return; }
  
  try {
    const result = await query(
      `SELECT i.*, u1.full_name as created_by_name, u2.full_name as assigned_to_name
       FROM investigations i
       LEFT JOIN users u1 ON i.created_by = u1.id
       LEFT JOIN users u2 ON i.assigned_to = u2.id
      WHERE i.id::text = $1 OR i.case_number = $1`,
      [req.params.id]
    );

    if (result.rows.length === 0) { res.status(404).json({ error: 'Investigation not found' }); return; }

    const investigationId = result.rows[0].id;

    const entities = await query(
      'SELECT * FROM investigation_entities WHERE investigation_id = $1 ORDER BY added_at DESC',
      [investigationId]
    );

    const notes = await query(
      `SELECT n.*, u.full_name as author_name FROM investigation_notes n
       LEFT JOIN users u ON n.author_id = u.id
      WHERE n.investigation_id = $1 ORDER BY n.created_at DESC`,
      [investigationId]
    );

    const documents = await query(
      `SELECT d.*, u.full_name as uploaded_by_name 
       FROM documents d 
       LEFT JOIN users u ON d.uploaded_by = u.id
       WHERE d.investigation_id = $1 OR d.investigation_id = $2
       ORDER BY d.created_at DESC`,
      [investigationId, result.rows[0].case_number]
    );

    const entityIds = entities.rows.map((e: any) => e.entity_id).filter(Boolean);
    let evidenceSql = `
      SELECT el.*, u.full_name as created_by_name 
      FROM evidence_ledger el 
      LEFT JOIN users u ON el.created_by = u.id
      WHERE el.investigation_id = $1 OR el.investigation_id = $2
         OR el.block_data->>'investigation_id' = $1 OR el.block_data->>'case_number' = $2
         OR el.source_document IN (SELECT filename FROM documents WHERE investigation_id = $1 OR investigation_id = $2)
    `;
    const evParams: unknown[] = [investigationId, result.rows[0].case_number];
    if (entityIds.length > 0) {
      evidenceSql += ` OR el.entity_ref = ANY($3)`;
      evParams.push(entityIds);
    }
    evidenceSql += ` ORDER BY el.timestamp DESC`;

    const evidence = await query(evidenceSql, evParams);

    await logAction(req.user?.id, req.user?.username, 'VIEW_INVESTIGATION', 'investigation', req.params.id, `Viewed investigation ${req.params.id}`, req.ip || '', req.headers['user-agent'] || '', 'success');

    res.json({
      ...result.rows[0],
      entities: entities.rows,
      notes: notes.rows,
      documents: documents.rows,
      evidence: evidence.rows,
      source_count: documents.rows.length,
      evidence_count: evidence.rows.length,
    });
  } catch (error) {
    logger.error('Get investigation error:', error);
    res.status(500).json({ error: 'Failed to fetch investigation' });
  }
});

// POST /api/investigations
router.post(
  '/',
  [
    body('title').trim().notEmpty().withMessage('Title required').isLength({ max: 500 }),
    body('description').optional().trim(),
    body('priority').optional().isIn(['low', 'medium', 'high', 'critical']),
    body('tags').optional().isArray(),
    body('assignedTo').optional({ values: 'falsy' }).isUUID().withMessage('Assigned officer must be valid'),
  ],
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) { res.status(400).json({ errors: errors.array() }); return; }

    const { title, description, priority = 'medium', tags = [], assignedTo } = req.body;
    const caseNumber = `CASE-${new Date().getFullYear()}-${String(Math.floor(Math.random() * 90000) + 10000)}`;

    try {
      const result = await query(
        `INSERT INTO investigations (case_number, title, description, priority, tags, created_by, assigned_to, status)
         VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7, $6), 'active')
         RETURNING *`,
        [caseNumber, title, description, priority, tags, req.user?.id, assignedTo || null]
      );

      await logAction(req.user?.id, req.user?.username, 'CREATE_INVESTIGATION', 'investigation', result.rows[0].id, `Created investigation: ${title}`, req.ip || '', req.headers['user-agent'] || '', 'success');
      res.status(201).json(result.rows[0]);
    } catch (error) {
      logger.error('Create investigation error:', error);
      res.status(500).json({ error: 'Failed to create investigation' });
    }
  }
);

// PATCH /api/investigations/:id
router.patch('/:id', param('id').isUUID(), async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) { res.status(400).json({ errors: errors.array() }); return; }

  const { title, description, status, priority, tags } = req.body;
  try {
    const result = await query(
      `UPDATE investigations SET
        title = COALESCE($1, title),
        description = COALESCE($2, description),
        status = COALESCE($3, status),
        priority = COALESCE($4, priority),
        tags = COALESCE($5, tags),
        updated_at = NOW()
       WHERE id = $6 RETURNING *`,
      [title, description, status, priority, tags, req.params.id]
    );

    if (result.rows.length === 0) { res.status(404).json({ error: 'Investigation not found' }); return; }
    res.json(result.rows[0]);
  } catch (error) {
    logger.error('Update investigation error:', error);
    res.status(500).json({ error: 'Failed to update investigation' });
  }
});

// PATCH /api/investigations/:id/access — update clearance and access control settings
router.patch('/:id/access', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { accessControl } = req.body;
  if (!accessControl) {
    res.status(400).json({ error: 'accessControl object is required' });
    return;
  }

  try {
    const check = await query(
      'SELECT id, case_number, metadata FROM investigations WHERE id::text = $1 OR case_number = $1',
      [req.params.id]
    );

    if (check.rows.length === 0) {
      res.status(404).json({ error: 'Investigation not found' });
      return;
    }

    const currentMeta = check.rows[0].metadata || {};
    const updatedMeta = {
      ...currentMeta,
      access_control: {
        ...accessControl,
        updated_at: new Date().toISOString(),
        updated_by: req.user?.id,
        updated_by_name: req.user?.fullName || req.user?.username,
      },
    };

    const result = await query(
      `UPDATE investigations 
       SET metadata = $1, updated_at = NOW() 
       WHERE id = $2 
       RETURNING id, case_number, metadata, updated_at`,
      [JSON.stringify(updatedMeta), check.rows[0].id]
    );

    await logAction(
      req.user?.id,
      req.user?.username,
      'UPDATE_INVESTIGATION_ACCESS',
      'investigation',
      check.rows[0].id,
      `Updated access control for case ${check.rows[0].case_number} (Classification: ${accessControl.classification || 'UNSPECIFIED'})`,
      req.ip || '',
      req.headers['user-agent'] || '',
      'success',
      { accessControl }
    );

    res.json({
      message: 'Access control updated successfully',
      investigationId: check.rows[0].id,
      accessControl: result.rows[0].metadata?.access_control,
    });
  } catch (error) {
    logger.error('Update investigation access error:', error);
    res.status(500).json({ error: 'Failed to update investigation access control' });
  }
});


// POST /api/investigations/:id/entities
router.post('/:id/entities', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { entityId, entityType, entityLabel } = req.body;
  try {
    const result = await query(
      `INSERT INTO investigation_entities (investigation_id, entity_id, entity_type, entity_label, added_by)
       SELECT i.id, $2, $3, $4, $5
       FROM investigations i
       WHERE i.id::text = $1 OR i.case_number = $1
       ON CONFLICT DO NOTHING
       RETURNING *`,
      [req.params.id, entityId, entityType, entityLabel, req.user?.id]
    );
    res.status(201).json(result.rows[0] || { message: 'Entity already in investigation' });
  } catch (error) {
    logger.error('Add entity to investigation error:', error);
    res.status(500).json({ error: 'Failed to add entity' });
  }
});

// POST /api/investigations/:id/notes
router.post('/:id/notes', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { content, entityRef } = req.body;
  try {
    const result = await query(
      `INSERT INTO investigation_notes (investigation_id, author_id, content, entity_ref)
       SELECT i.id, $2, $3, $4
       FROM investigations i
       WHERE i.id::text = $1 OR i.case_number = $1
       RETURNING *`,
      [req.params.id, req.user?.id, content, entityRef]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    logger.error('Add note error:', error);
    res.status(500).json({ error: 'Failed to add note' });
  }
});

// GET /api/investigations/dashboard/stats
router.get('/dashboard/stats', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const [invStats, alertStats, entityStats] = await Promise.all([
      query(`SELECT 
        COUNT(*) FILTER (WHERE status = 'active') as active_investigations,
        COUNT(*) FILTER (WHERE status = 'closed') as closed_investigations,
        COUNT(*) FILTER (WHERE priority = 'critical') as critical_investigations,
        COUNT(*) as total_investigations
        FROM investigations`),
      query(`SELECT 
        COUNT(*) FILTER (WHERE is_acknowledged = false) as unacknowledged_alerts,
        COUNT(*) FILTER (WHERE severity = 'critical' AND is_acknowledged = false) as critical_alerts,
        COUNT(*) as total_alerts
        FROM alerts`),
      query(`SELECT COUNT(DISTINCT entity_id) as total_entities FROM investigation_entities`),
    ]);

    res.json({
      activeInvestigations: parseInt(invStats.rows[0].active_investigations),
      closedInvestigations: parseInt(invStats.rows[0].closed_investigations),
      criticalInvestigations: parseInt(invStats.rows[0].critical_investigations),
      totalInvestigations: parseInt(invStats.rows[0].total_investigations),
      unacknowledgedAlerts: parseInt(alertStats.rows[0].unacknowledged_alerts),
      criticalAlerts: parseInt(alertStats.rows[0].critical_alerts),
      totalAlerts: parseInt(alertStats.rows[0].total_alerts),
      totalEntities: parseInt(entityStats.rows[0].total_entities),
    });
  } catch (error) {
    logger.error('Dashboard stats error:', error);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

// GET /api/investigations/:id/sources
router.get('/:id/sources', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const invRes = await query('SELECT id, case_number FROM investigations WHERE id::text = $1 OR case_number = $1', [req.params.id]);
    if (invRes.rows.length === 0) { res.status(404).json({ error: 'Investigation not found' }); return; }
    const inv = invRes.rows[0];

    const result = await query(
      `SELECT d.*, u.full_name as uploaded_by_name
       FROM documents d
       LEFT JOIN users u ON d.uploaded_by = u.id
       WHERE d.investigation_id = $1 OR d.investigation_id = $2
       ORDER BY d.created_at DESC`,
      [inv.id, inv.case_number]
    );
    res.json({ sources: result.rows, total: result.rows.length });
  } catch (error) {
    logger.error('Get investigation sources error:', error);
    res.status(500).json({ error: 'Failed to fetch investigation sources' });
  }
});

// GET /api/investigations/:id/evidence
router.get('/:id/evidence', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const invRes = await query('SELECT id, case_number FROM investigations WHERE id::text = $1 OR case_number = $1', [req.params.id]);
    if (invRes.rows.length === 0) { res.status(404).json({ error: 'Investigation not found' }); return; }
    const inv = invRes.rows[0];

    const entities = await query('SELECT entity_id FROM investigation_entities WHERE investigation_id = $1', [inv.id]);
    const entityIds = entities.rows.map((e: any) => e.entity_id).filter(Boolean);

    let sql = `
      SELECT el.*, u.full_name as created_by_name
      FROM evidence_ledger el
      LEFT JOIN users u ON el.created_by = u.id
      WHERE el.investigation_id = $1 OR el.investigation_id = $2
         OR el.block_data->>'investigation_id' = $1 OR el.block_data->>'case_number' = $2
         OR el.source_document IN (SELECT filename FROM documents WHERE investigation_id = $1 OR investigation_id = $2)
    `;
    const params: unknown[] = [inv.id, inv.case_number];
    if (entityIds.length > 0) {
      sql += ` OR el.entity_ref = ANY($3)`;
      params.push(entityIds);
    }
    sql += ` ORDER BY el.timestamp DESC`;

    const result = await query(sql, params);
    res.json({ evidence: result.rows, total: result.rows.length });
  } catch (error) {
    logger.error('Get investigation evidence error:', error);
    res.status(500).json({ error: 'Failed to fetch investigation evidence' });
  }
});

// POST /api/investigations/:id/evidence
router.post('/:id/evidence', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { evidenceType, entityRef, sourceDocument, blockData } = req.body;
  try {
    const invRes = await query('SELECT id, case_number FROM investigations WHERE id::text = $1 OR case_number = $1', [req.params.id]);
    if (invRes.rows.length === 0) { res.status(404).json({ error: 'Investigation not found' }); return; }
    const inv = invRes.rows[0];

    const evidenceId = `EVD-${Date.now()}-${uuidv4().slice(0, 8).toUpperCase()}`;
    const timestamp = new Date().toISOString();

    const lastBlock = await query('SELECT data_hash FROM evidence_ledger ORDER BY record_number DESC LIMIT 1');
    const previousHash = lastBlock.rows[0]?.data_hash || '0000000000000000000000000000000000000000000000000000000000000000';
    const isGenesis = lastBlock.rows.length === 0;

    const fullBlockData = {
      ...(blockData || {}),
      evidenceId,
      investigationId: inv.id,
      caseNumber: inv.case_number,
      timestamp,
    };

    const dataHash = generateEvidenceHash(fullBlockData);
    const blockHash = generateBlockHash(evidenceId, dataHash, previousHash, timestamp);

    const result = await query(
      `INSERT INTO evidence_ledger (id, evidence_id, evidence_type, entity_ref, source_document, data_hash, previous_hash, block_data, created_by, is_genesis, investigation_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
      [uuidv4(), evidenceId, evidenceType || 'investigation_evidence', entityRef || null, sourceDocument || null, blockHash, previousHash, JSON.stringify(fullBlockData), req.user?.id, isGenesis, inv.id]
    );

    await logAction(req.user?.id, req.user?.username, 'CREATE_EVIDENCE', 'evidence', evidenceId, `Recorded evidence for ${inv.case_number}: ${evidenceId}`, req.ip || '', req.headers['user-agent'] || '', 'success');

    res.status(201).json(result.rows[0]);
  } catch (error) {
    logger.error('Create investigation evidence error:', error);
    res.status(500).json({ error: 'Failed to record evidence' });
  }
});

// POST /api/investigations/:id/documents — add/upload source document directly to this investigation
router.post('/:id/documents', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { documentType, content, originalName, title } = req.body;
  try {
    const invRes = await query('SELECT id, case_number FROM investigations WHERE id::text = $1 OR case_number = $1', [req.params.id]);
    if (invRes.rows.length === 0) { res.status(404).json({ error: 'Investigation not found' }); return; }
    const inv = invRes.rows[0];

    const documentId = uuidv4();
    const filename = originalName || `DOC-${Date.now()}-${documentId.slice(0, 6)}.txt`;

    // Simple entity extraction
    const personRegex = /(?:Mr\.?\s|Mrs\.?\s|Inspector\s)?([A-Z][a-z]+(?:\s[A-Z][a-z]+){0,2})/g;
    const phoneRegex = /(?:\+91[\s-]?)?[6-9]\d{9}|\d{10}/g;
    const entities: any[] = [];
    const pMatches = [...(content || '').matchAll(personRegex)];
    const phMatches = [...(content || '').matchAll(phoneRegex)];
    pMatches.forEach((m: any, i: number) => {
      if (m[1] && m[1].length > 2) entities.push({ id: `NLP-P-${i}`, type: 'Person', value: m[1], confidence: 0.85 });
    });
    phMatches.forEach((m: any, i: number) => {
      entities.push({ id: `NLP-PH-${i}`, type: 'Phone', value: m[0], confidence: 0.95 });
    });

    const docResult = await query(
      `INSERT INTO documents (id, investigation_id, filename, original_name, document_type, status, extracted_entities, extracted_relationships, analysis_metadata, uploaded_by)
       VALUES ($1, $2, $3, $4, $5, 'analyzed', $6, '[]', $7, $8) RETURNING *`,
      [
        documentId, inv.id, filename, title || originalName || filename,
        documentType || 'fir', JSON.stringify(entities),
        JSON.stringify({ rawContent: content || '', extractionMethod: 'NLP-NER-v1', processedAt: new Date().toISOString() }),
        req.user?.id,
      ]
    );

    // Auto-create cryptographic evidence block for this uploaded source
    const evidenceId = `EVD-DOC-${documentId.slice(0, 8).toUpperCase()}`;
    const timestamp = new Date().toISOString();
    const lastBlock = await query('SELECT data_hash FROM evidence_ledger ORDER BY record_number DESC LIMIT 1');
    const previousHash = lastBlock.rows[0]?.data_hash || '0000000000000000000000000000000000000000000000000000000000000000';
    const isGenesis = lastBlock.rows.length === 0;

    const blockData = { evidenceId, documentId, filename, investigationId: inv.id, caseNumber: inv.case_number, timestamp, snippet: (content || '').substring(0, 150) };
    const dataHash = generateEvidenceHash(blockData);
    const blockHash = generateBlockHash(evidenceId, dataHash, previousHash, timestamp);

    await query(
      `INSERT INTO evidence_ledger (id, evidence_id, evidence_type, entity_ref, source_document, data_hash, previous_hash, block_data, created_by, is_genesis, investigation_id)
       VALUES ($1, $2, 'document', $3, $4, $5, $6, $7, $8, $9, $10)`,
      [uuidv4(), evidenceId, documentId, filename, blockHash, previousHash, JSON.stringify(blockData), req.user?.id, isGenesis, inv.id]
    );

    await logAction(req.user?.id, req.user?.username, 'UPLOAD_DOCUMENT', 'document', documentId, `Uploaded source document to ${inv.case_number}: ${filename}`, req.ip || '', req.headers['user-agent'] || '', 'success');

    res.status(201).json({
      document: docResult.rows[0],
      evidenceId,
      extractedEntities: entities,
    });
  } catch (error) {
    logger.error('Add investigation document error:', error);
    res.status(500).json({ error: 'Failed to add source document' });
  }
});

export default router;
