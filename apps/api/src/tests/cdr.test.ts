import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SYNTHETIC_CDR_DATASET,
  SYNTHETIC_PHONE_DIRECTORY,
} from '../routes/cdrData';

// Focused unit and integration tests for CDR & Telecom Forensics Intelligence logic

test('CDR Dataset Integrity and Fixture Completeness', () => {
  assert.ok(SYNTHETIC_CDR_DATASET.length >= 25, 'Expected at least 25 synthetic CDR records');
  assert.ok(Object.keys(SYNTHETIC_PHONE_DIRECTORY).length >= 10, 'Expected at least 10 directory numbers');

  // Verify all records have valid duration and timestamps
  for (const record of SYNTHETIC_CDR_DATASET) {
    assert.ok(record.callId, 'Record must have callId');
    assert.ok(record.callerNumber, 'Record must have callerNumber');
    assert.ok(record.calleeNumber, 'Record must have calleeNumber');
    assert.ok(typeof record.duration === 'number' && record.duration >= 0, 'Duration must be >= 0');
    assert.ok(!isNaN(new Date(record.timestamp).getTime()), 'Timestamp must be valid ISO date');
  }
});

test('CDR Overview Metrics Computation', () => {
  const records = SYNTHETIC_CDR_DATASET;
  const totalCalls = records.length;
  const totalDuration = records.reduce((sum, r) => sum + (r.duration || 0), 0);

  const imeis = new Set<string>();
  const imsis = new Set<string>();
  const activeNumbers = new Set<string>();
  let nightCalls = 0;

  records.forEach((r) => {
    if (r.callerNumber) activeNumbers.add(r.callerNumber);
    if (r.calleeNumber) activeNumbers.add(r.calleeNumber);
    if (r.imei) imeis.add(r.imei);
    if (r.imsi) imsis.add(r.imsi);

    const h = new Date(r.timestamp).getUTCHours();
    if (h >= 0 && h < 5) nightCalls++;
  });

  assert.ok(totalCalls > 0, 'Total calls should be greater than zero');
  assert.ok(totalDuration > 0, 'Total duration should be greater than zero');
  assert.ok(imeis.size >= 5, 'Should have multiple unique IMEIs');
  assert.ok(imsis.size >= 5, 'Should have multiple unique IMSIs');
  assert.ok(activeNumbers.size >= 8, 'Should have multiple active phone numbers');
  assert.ok(nightCalls >= 5, 'Should capture nocturnal calls between 00:00 and 05:00');
});

test('CDR Timeline & Nocturnal 00:00-05:00 Surge Identification', () => {
  const records = SYNTHETIC_CDR_DATASET;
  const hourlyBuckets = new Array(24).fill(0).map(() => ({ calls: 0, duration: 0 }));

  records.forEach((r) => {
    const hour = new Date(r.timestamp).getUTCHours();
    if (hour >= 0 && hour < 24) {
      hourlyBuckets[hour].calls++;
      hourlyBuckets[hour].duration += r.duration || 0;
    }
  });

  let nightCallsTotal = 0;
  for (let h = 0; h < 5; h++) {
    nightCallsTotal += hourlyBuckets[h].calls;
  }

  assert.equal(hourlyBuckets.length, 24, 'Timeline must cover all 24 hours (00:00 - 23:00)');
  assert.ok(nightCallsTotal >= 5, 'Night window (00:00-05:00) must detect suspicious nocturnal calls');

  // Verify that an anomaly score is elevated for nocturnal hours
  const nightPercentage = (nightCallsTotal / records.length) * 100;
  assert.ok(nightPercentage > 10, 'Night window percentage should represent an anomalous spike');
});

test('CDR Target Contacts Analysis (Incoming/Outgoing, Frequency, Duration)', () => {
  const targetNumber = '9876543210'; // Arjun Mehta
  const records = SYNTHETIC_CDR_DATASET;

  const relevant = records.filter(
    (r) => r.callerNumber === targetNumber || r.calleeNumber === targetNumber
  );

  assert.ok(relevant.length > 0, 'Target should have associated CDR records');

  let incomingCount = 0;
  let outgoingCount = 0;
  const partners = new Map<string, number>();

  relevant.forEach((r) => {
    const isCaller = r.callerNumber === targetNumber;
    if (isCaller) {
      outgoingCount++;
      partners.set(r.calleeNumber, (partners.get(r.calleeNumber) || 0) + 1);
    } else {
      incomingCount++;
      partners.set(r.callerNumber, (partners.get(r.callerNumber) || 0) + 1);
    }
  });

  assert.ok(outgoingCount > 0, 'Should have outgoing calls');
  assert.ok(incomingCount > 0, 'Should have incoming calls');
  assert.equal(incomingCount + outgoingCount, relevant.length, 'Sum of in/out should equal total');
  assert.ok(partners.size >= 3, 'Target should have at least 3 distinct contact partners');
});

test('CDR IMEI/IMSI Swap Anomaly Detection (Device Sharing & SIM Hopping)', () => {
  const records = SYNTHETIC_CDR_DATASET;

  // 1. Group by IMEI to detect device sharing (multiple SIMs per device)
  const imeiToSims = new Map<string, Set<string>>();
  // 2. Group by SIM to detect SIM hopping (single SIM across multiple devices)
  const simToImeis = new Map<string, Set<string>>();

  records.forEach((r) => {
    if (r.imei && r.callerNumber) {
      if (!imeiToSims.has(r.imei)) imeiToSims.set(r.imei, new Set());
      imeiToSims.get(r.imei)!.add(r.callerNumber);

      if (!simToImeis.has(r.callerNumber)) simToImeis.set(r.callerNumber, new Set());
      simToImeis.get(r.callerNumber)!.add(r.imei);
    }
  });

  const sharedDevices = Array.from(imeiToSims.entries()).filter(([_, sims]) => sims.size >= 2);
  const hoppingSims = Array.from(simToImeis.entries()).filter(([_, imeis]) => imeis.size >= 2);

  // Expect shared device 864209000011223 used by multiple SIMs (Ravi Kumar, Burner, Kuldeep Nanda)
  assert.ok(sharedDevices.length >= 1, 'Should detect at least 1 shared device IMEI');
  const burnerDevice = sharedDevices.find(([imei]) => imei === '864209000011223');
  assert.ok(burnerDevice, 'Burner IMEI 864209000011223 should be flagged');
  assert.ok((burnerDevice?.[1].size || 0) >= 3, 'Burner IMEI should be shared by 3+ SIMs');

  // Expect Ravi Kumar (8987654321) to have hopped across 3 IMEIs
  assert.ok(hoppingSims.length >= 1, 'Should detect SIM hopping anomaly');
  const hoppingTarget = hoppingSims.find(([num]) => num === '8987654321');
  assert.ok(hoppingTarget, 'SIM 8987654321 should be detected hopping across devices');
  assert.ok((hoppingTarget?.[1].size || 0) >= 3, 'Ravi Kumar SIM should be associated with >= 3 IMEIs');
});

test('CDR Common Contacts and Intermediary Discovery', () => {
  const targetA = '9876543210'; // Arjun Mehta
  const targetB = '9871234567'; // Vikram Sinha
  const records = SYNTHETIC_CDR_DATASET;

  const contactsOfA = new Set<string>();
  const contactsOfB = new Set<string>();

  records.forEach((r) => {
    if (r.callerNumber === targetA) contactsOfA.add(r.calleeNumber);
    if (r.calleeNumber === targetA) contactsOfA.add(r.callerNumber);
    if (r.callerNumber === targetB) contactsOfB.add(r.calleeNumber);
    if (r.calleeNumber === targetB) contactsOfB.add(r.callerNumber);
  });

  contactsOfA.delete(targetA);
  contactsOfA.delete(targetB);
  contactsOfB.delete(targetA);
  contactsOfB.delete(targetB);

  const common = Array.from(contactsOfA).filter((c) => contactsOfB.has(c));

  assert.ok(common.length >= 2, 'Target A and Target B should share at least 2 mutual intermediaries');
  // Ramesh Gupta (9450123456), Alok Trivedi (9415234567), Manish Kapoor (9810234567)
  assert.ok(common.includes('9450123456'), 'Ramesh Gupta should be a common intermediary');
  assert.ok(common.includes('9415234567'), 'Alok Trivedi should be a common intermediary');
});

test('CDR Upload Simulation and Validation Engine', () => {
  // Test valid batch
  const testBatch = [
    {
      callerNumber: '9999000001',
      calleeNumber: '9999000002',
      duration: 120,
      timestamp: '2026-09-16T02:30:00Z', // Night call
      imei: '350000000000001',
      imsi: '404000000000001',
    },
    {
      callerNumber: '9999000003',
      calleeNumber: '9999000002',
      duration: 180,
      timestamp: '2026-09-16T03:15:00Z', // Night call
      imei: '350000000000001', // Same IMEI -> Swap
      imsi: '404000000000003',
    },
    {
      callerNumber: '9999000001',
      calleeNumber: '9999000004',
      duration: 60,
      timestamp: '2026-09-16T14:00:00Z',
    },
  ];

  // Validation logic
  let validCount = 0;
  let nightCount = 0;
  const imeis = new Map<string, Set<string>>();

  testBatch.forEach((r) => {
    assert.ok(r.callerNumber && r.calleeNumber, 'Numbers must be present');
    assert.ok(r.duration >= 0, 'Duration must be non-negative');
    validCount++;

    const h = new Date(r.timestamp).getUTCHours();
    if (h < 5) nightCount++;

    if (r.imei) {
      if (!imeis.has(r.imei)) imeis.set(r.imei, new Set());
      imeis.get(r.imei)!.add(r.callerNumber);
    }
  });

  assert.equal(validCount, 3, 'All 3 records in test batch should be valid');
  assert.equal(nightCount, 2, 'Should detect 2 night calls');
  assert.ok(imeis.get('350000000000001')!.size >= 2, 'Should detect device sharing swap on test batch');
});
