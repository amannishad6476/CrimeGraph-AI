import neo4j, { Driver, Session, QueryResult } from 'neo4j-driver';
import { logger } from '../utils/logger';

let driver: Driver;

export async function initNeo4j(): Promise<void> {
  driver = neo4j.driver(
    process.env.NEO4J_URI || 'bolt://localhost:7687',
    neo4j.auth.basic(
      process.env.NEO4J_USER || 'neo4j',
      process.env.NEO4J_PASSWORD || 'crimegraph_neo4j'
    ),
    {
      maxConnectionPoolSize: 50,
      connectionAcquisitionTimeout: 5000,
    }
  );

  await driver.verifyConnectivity();
  logger.info('Neo4j connectivity verified');

  const session = driver.session();
  try {
    await createConstraints(session);
    await createIndexes(session);
  } finally {
    await session.close();
  }
}

export function getNeo4jDriver(): Driver {
  if (!driver) throw new Error('Neo4j not initialized');
  return driver;
}

export function getNeo4jSession(): Session {
  return driver.session();
}

async function createConstraints(session: Session): Promise<void> {
  const constraints = [
    'CREATE CONSTRAINT person_id IF NOT EXISTS FOR (p:Person) REQUIRE p.id IS UNIQUE',
    'CREATE CONSTRAINT phone_id IF NOT EXISTS FOR (p:Phone) REQUIRE p.id IS UNIQUE',
    'CREATE CONSTRAINT vehicle_id IF NOT EXISTS FOR (v:Vehicle) REQUIRE v.id IS UNIQUE',
    'CREATE CONSTRAINT org_id IF NOT EXISTS FOR (o:Organization) REQUIRE o.id IS UNIQUE',
    'CREATE CONSTRAINT location_id IF NOT EXISTS FOR (l:Location) REQUIRE l.id IS UNIQUE',
    'CREATE CONSTRAINT account_id IF NOT EXISTS FOR (a:Account) REQUIRE a.id IS UNIQUE',
    'CREATE CONSTRAINT case_id IF NOT EXISTS FOR (c:Case) REQUIRE c.id IS UNIQUE',
    'CREATE CONSTRAINT event_id IF NOT EXISTS FOR (e:Event) REQUIRE e.id IS UNIQUE',
  ];

  for (const constraint of constraints) {
    try {
      await session.run(constraint);
    } catch {
      // constraint may already exist
    }
  }
  logger.info('Neo4j constraints created');
}

async function createIndexes(session: Session): Promise<void> {
  const indexes = [
    'CREATE INDEX person_name IF NOT EXISTS FOR (p:Person) ON (p.name)',
    'CREATE INDEX person_alias IF NOT EXISTS FOR (p:Person) ON (p.alias)',
    'CREATE INDEX phone_number IF NOT EXISTS FOR (p:Phone) ON (p.number)',
    'CREATE INDEX vehicle_plate IF NOT EXISTS FOR (v:Vehicle) ON (v.licensePlate)',
    'CREATE INDEX location_name IF NOT EXISTS FOR (l:Location) ON (l.name)',
    'CREATE INDEX org_name IF NOT EXISTS FOR (o:Organization) ON (o.name)',
    'CREATE INDEX account_number IF NOT EXISTS FOR (a:Account) ON (a.accountNumber)',
  ];

  for (const idx of indexes) {
    try {
      await session.run(idx);
    } catch {
      // index may already exist
    }
  }
  logger.info('Neo4j indexes created');
}

export async function runCypherQuery(
  cypher: string,
  params?: Record<string, unknown>
): Promise<QueryResult> {
  const session = getNeo4jSession();
  try {
    return await session.run(cypher, params);
  } finally {
    await session.close();
  }
}

export async function closeNeo4j(): Promise<void> {
  if (driver) {
    await driver.close();
  }
}
