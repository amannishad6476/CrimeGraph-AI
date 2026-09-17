import dns from 'dns';
dns.setDefaultResultOrder('ipv4first');

import express from 'express';
import http from 'http';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import morgan from 'morgan';
import { Server as SocketIOServer } from 'socket.io';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(__dirname, '../.env') });

import { rateLimiter } from './middleware/rateLimiter';
import { errorHandler } from './middleware/errorHandler';
import { requestLogger } from './middleware/requestLogger';
import authRoutes from './routes/auth';
import investigationRoutes from './routes/investigations';
import entityRoutes from './routes/entities';
import graphRoutes from './routes/graph';
import documentRoutes from './routes/documents';
import alertRoutes from './routes/alerts';
import timelineRoutes from './routes/timeline';
import evidenceRoutes from './routes/evidence';
import auditRoutes from './routes/audit';
import analyticsRoutes from './routes/analytics';
import aiRoutes from './routes/ai';
import databaseRoutes from './routes/database';
import cdrRoutes from './routes/cdr';
import { logger } from './utils/logger';
import { initPostgres } from './db/postgres';
import { initNeo4j } from './db/neo4j';

const app = express();
const server = http.createServer(app);
const io = new SocketIOServer(server, {
  cors: {
    origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
    methods: ['GET', 'POST'],
    credentials: true,
  },
});

// Security middleware
app.use(helmet({
  contentSecurityPolicy: false, // handled at frontend
}));
app.use(cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.use(compression());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(morgan('combined', { stream: { write: (msg) => logger.http(msg.trim()) } }));
app.use(requestLogger);
app.use(rateLimiter);

// Static files for uploads
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// Health check
app.get('/health', (_req, res) => {
  res.json({ 
    status: 'ok', 
    service: 'CrimeGraph AI API',
    version: '1.0.0',
    timestamp: new Date().toISOString() 
  });
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/investigations', investigationRoutes);
app.use('/api/entities', entityRoutes);
app.use('/api/graph', graphRoutes);
app.use('/api/documents', documentRoutes);
app.use('/api/alerts', alertRoutes);
app.use('/api/timeline', timelineRoutes);
app.use('/api/evidence', evidenceRoutes);
app.use('/api/audit', auditRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/database', databaseRoutes);
app.use('/api/cdr', cdrRoutes);

// 404 handler
app.use((_req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// Error handler
app.use(errorHandler);

// Socket.IO connection
io.on('connection', (socket) => {
  logger.info(`Socket connected: ${socket.id}`);
  
  socket.on('join:investigation', (investigationId: string) => {
    socket.join(`investigation:${investigationId}`);
    logger.info(`Socket ${socket.id} joined investigation ${investigationId}`);
  });

  socket.on('disconnect', () => {
    logger.info(`Socket disconnected: ${socket.id}`);
  });
});

export { io };

// Start server
const PORT = parseInt(process.env.PORT || '3001', 10);

async function startServer() {
  try {
    try {
      await initPostgres();
      logger.info('✅ PostgreSQL connected');
    } catch (pgErr) {
      logger.warn('⚠️ Default PostgreSQL connection failed/skipped: ' + (pgErr as Error).message);
    }
    
    try {
      await initNeo4j();
      logger.info('✅ Neo4j connected');
    } catch (neoErr) {
      logger.warn('⚠️ Neo4j connection optional/skipped: ' + (neoErr as Error).message);
    }

    server.listen(PORT, () => {
      logger.info(`🚀 CrimeGraph AI API running on port ${PORT}`);
      logger.info(`📊 Environment: ${process.env.NODE_ENV}`);
    });
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();
