import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import cytoscape from 'cytoscape';
import type { Core, NodeSingular, EdgeSingular } from 'cytoscape';
import coseBilkent from 'cytoscape-cose-bilkent';
import {
  Search, ZoomIn, ZoomOut, Maximize2, RefreshCw, Filter,
  Download, Info, X, ChevronRight, Loader, Network, GitBranch,
  Eye, EyeOff, Tag, Compass, Sparkles, Layers, SlidersHorizontal, Check
} from 'lucide-react';
import api from '../lib/api';
import { ALL_ENTITIES, GRAPH_EDGES, FIR_RECORDS } from '../data/dataset';
import {
  NODE_COLORS,
  NODE_SHAPES,
  NODE_ICONS,
  getGraphStylesheet,
  getLayoutConfig,
} from '../components/graph/graphConfig';

// Register cytoscape-cose-bilkent once
try {
  cytoscape.use(coseBilkent);
} catch {
  // already registered
}

interface GraphNode {
  id: string;
  nodeType: string;
  name?: string;
  number?: string;
  licensePlate?: string;
  accountNumber?: string;
  degree?: number;
  [key: string]: unknown;
}

interface GraphEdge {
  id?: string;
  source: string;
  target: string;
  type: string;
  confidence?: number;
  timestamp?: string;
  relSource?: string;
  recordRef?: string;
}

function getNodeLabel(node: GraphNode): string {
  return (node.name || node.number || node.licensePlate || node.accountNumber || node.id || '').substring(0, 24);
}

export default function NetworkGraphPage() {
  const [searchParams] = useSearchParams();
  const investigationCase = searchParams.get('investigation');
  const entityIdParam = searchParams.get('entityId') || searchParams.get('entity');
  const entityTypeParam = searchParams.get('entityType') || 'Person';

  const cyRef = useRef<HTMLDivElement>(null);
  const cyInstance = useRef<Core | null>(null);

  // Loading & Selection States
  const [loading, setLoading] = useState(false);
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<GraphEdge | null>(null);
  const [focusedNodeId, setFocusedNodeId] = useState<string | null>(null);

  // Search & Navigation
  const [searchTerm, setSearchTerm] = useState('');
  const [searchFilterType, setSearchFilterType] = useState('');
  const [searchFeedback, setSearchFeedback] = useState<string | null>(null);

  // Graph Metrics
  const [nodeCount, setNodeCount] = useState(0);
  const [edgeCount, setEdgeCount] = useState(0);
  const [componentCount, setComponentCount] = useState(1);
  const [entityTypeCounts, setEntityTypeCounts] = useState<Record<string, number>>({});

  // View Controls
  const [activeLayout, setActiveLayout] = useState('cose-bilkent');
  const [showLabels, setShowLabels] = useState(true);
  const [showEdgeLabels, setShowEdgeLabels] = useState(false);
  const [hiddenTypes, setHiddenTypes] = useState<Set<string>>(new Set());

  // Path Finder State
  const [pathMode, setPathMode] = useState(false);
  const [pathNodes, setPathNodes] = useState<GraphNode[]>([]);
  const [pathLoading, setPathLoading] = useState(false);
  const [pathResult, setPathResult] = useState<any[] | null>(null);

  // Master Graph Data Cache
  const masterNodesRef = useRef<GraphNode[]>([]);
  const masterEdgesRef = useRef<GraphEdge[]>([]);

  // --------------------------------------------------------------------------
  // Initialize Cytoscape Instance (Called Once)
  // --------------------------------------------------------------------------
  const initCytoscape = useCallback(() => {
    if (!cyRef.current) return null;

    if (cyInstance.current) {
      cyInstance.current.destroy();
    }

    const cy = cytoscape({
      container: cyRef.current,
      style: getGraphStylesheet(true, false),
      layout: { name: 'preset' },
      wheelSensitivity: 0.25,
      minZoom: 0.1,
      maxZoom: 4,
    });

    // Node Tap (Selection & Neighborhood Focus Mode)
    cy.on('tap', 'node', (evt) => {
      const node = evt.target;
      const data = node.data();

      setSelectedNode(data);
      setSelectedEdge(null);
      setFocusedNodeId(node.id());

      if (pathMode) {
        setPathNodes((prev) => {
          if (prev.length === 0) return [data];
          if (prev.length === 1) {
            if (prev[0].id === data.id) return prev;
            return [...prev, data];
          }
          return [data];
        });
      }

      // Enter Focus Mode: Highlight selected node and 1-hop direct neighborhood
      cy.batch(() => {
        cy.elements().removeClass('highlighted dimmed selected-node');
        node.addClass('selected-node highlighted');

        const neighborhood = node.closedNeighborhood();
        cy.elements().not(neighborhood).addClass('dimmed');
        neighborhood.addClass('highlighted');
      });
    });

    // Edge Tap
    cy.on('tap', 'edge', (evt) => {
      const edge = evt.target;
      setSelectedEdge(edge.data());
      setSelectedNode(null);
      setFocusedNodeId(null);

      cy.batch(() => {
        cy.elements().removeClass('highlighted dimmed selected-node');
        edge.addClass('highlighted');
        edge.connectedNodes().addClass('highlighted');
        cy.elements().not(edge.union(edge.connectedNodes())).addClass('dimmed');
      });
    });

    // Canvas Tap (Reset Focus on Background Click)
    cy.on('tap', (evt) => {
      if (evt.target === cy) {
        resetFocus();
      }
    });

    cyInstance.current = cy;
    return cy;
  }, [pathMode]);

  // --------------------------------------------------------------------------
  // Reset Focus / Restore Full Graph
  // --------------------------------------------------------------------------
  const resetFocus = useCallback(() => {
    setSelectedNode(null);
    setSelectedEdge(null);
    setFocusedNodeId(null);
    setSearchFeedback(null);

    if (cyInstance.current) {
      cyInstance.current.batch(() => {
        cyInstance.current?.elements().removeClass('highlighted dimmed selected-node path-highlight');
      });
    }
  }, []);

  // --------------------------------------------------------------------------
  // Run Layout with Auto-Fit
  // --------------------------------------------------------------------------
  const runLayout = useCallback((layoutName: string) => {
    if (!cyInstance.current) return;
    const cy = cyInstance.current;
    const config = getLayoutConfig(layoutName);

    try {
      const layout = cy.layout(config as any);
      layout.run();
    } catch (err) {
      console.warn('Layout execution error, falling back to cose:', err);
      cy.layout({ name: 'cose', animate: true, animationDuration: 600 } as any).run();
    }
  }, []);

  // --------------------------------------------------------------------------
  // Render Graph Data with Degree Computation & Clustering
  // --------------------------------------------------------------------------
  const renderGraph = useCallback((cy: Core, nodes: GraphNode[], edges: GraphEdge[]) => {
    masterNodesRef.current = nodes;
    masterEdgesRef.current = edges;

    cy.elements().remove();

    const nodeIds = new Set(nodes.map((n) => n.id));
    const validEdges = edges.filter(
      (e) => e && e.source && e.target && nodeIds.has(e.source) && nodeIds.has(e.target)
    );

    // Compute Degree Connectivity for each node
    const degreeMap = new Map<string, number>();
    validEdges.forEach((e) => {
      degreeMap.set(e.source, (degreeMap.get(e.source) || 0) + 1);
      degreeMap.set(e.target, (degreeMap.get(e.target) || 0) + 1);
    });

    // Count entities by type
    const counts: Record<string, number> = {};
    nodes.forEach((n) => {
      counts[n.nodeType] = (counts[n.nodeType] || 0) + 1;
    });
    setEntityTypeCounts(counts);

    const cyNodes = nodes.map((n) => {
      const deg = degreeMap.get(n.id) || 0;
      return {
        group: 'nodes' as const,
        data: {
          id: n.id,
          label: getNodeLabel(n),
          nodeType: n.nodeType,
          degree: deg,
          isHighConnectivity: deg >= 6,
          ...n,
        },
      };
    });

    const cyEdges = validEdges.map((e, i) => ({
      group: 'edges' as const,
      data: {
        id: e.id || `edge-${i}-${e.source}-${e.target}`,
        source: e.source,
        target: e.target,
        type: e.type,
        confidence: e.confidence || 0.85,
        label: e.type ? e.type.replace(/_/g, ' ') : '',
        relSource: e.relSource,
        recordRef: e.recordRef,
        timestamp: e.timestamp,
      },
    }));

    cy.batch(() => {
      cy.add([...cyNodes, ...cyEdges]);
    });

    // Calculate connected components count
    try {
      const components = cy.elements().components();
      setComponentCount(components.length);
    } catch {
      setComponentCount(1);
    }

    setNodeCount(cyNodes.length);
    setEdgeCount(cyEdges.length);

    // Run CoSE-Bilkent clustering layout
    runLayout(activeLayout);

    // If focused on an entity from URL query, zoom to it
    if (entityIdParam) {
      setTimeout(() => {
        const target = cy.$(`node[id = "${entityIdParam}"]`);
        if (target && target.length > 0) {
          setSelectedNode(target.data());
          setFocusedNodeId(target.id());
          cy.batch(() => {
            cy.elements().removeClass('highlighted dimmed selected-node');
            target.addClass('selected-node highlighted');
            const neighborhood = target.closedNeighborhood();
            cy.elements().not(neighborhood).addClass('dimmed');
            neighborhood.addClass('highlighted');
          });
          cy.animate({ center: { eles: target }, zoom: 1.4, duration: 400 });
        }
      }, 700);
    }
  }, [activeLayout, entityIdParam, runLayout]);

  // --------------------------------------------------------------------------
  // Fallbacks: Investigation, Entity, and Master Graph
  // --------------------------------------------------------------------------
  const renderInvestigationFallback = useCallback((cy: Core, caseRef: string) => {
    const normalized = caseRef.trim().toLowerCase();
    const targetFir = FIR_RECORDS.find(
      (f) =>
        f.id.toLowerCase() === normalized ||
        f.firNumber.toLowerCase() === normalized ||
        f.firNumber.toLowerCase().replace('fir-', 'case-') === normalized ||
        normalized.includes(f.id.toLowerCase()) ||
        normalized.includes(f.firNumber.toLowerCase())
    ) || FIR_RECORDS[0];

    const linkedIds = new Set<string>(targetFir.linkedEntities || []);
    linkedIds.add(targetFir.id);

    GRAPH_EDGES.forEach((e) => {
      if (linkedIds.has(e.source)) linkedIds.add(e.target);
      if (linkedIds.has(e.target)) linkedIds.add(e.source);
    });

    const demoNodes: GraphNode[] = (ALL_ENTITIES as any[])
      .filter((e) => linkedIds.has(e.id))
      .map((e) => ({
        id: e.id,
        nodeType: e.nodeType,
        name: e.name || e.number || e.licensePlate || e.accountNumber || e.id,
        ...e,
      }));

    if (!demoNodes.some((n) => n.id === targetFir.id)) {
      demoNodes.push({
        id: targetFir.id,
        nodeType: 'Case',
        name: targetFir.firNumber,
        firNumber: targetFir.firNumber,
        ...targetFir,
      });
    }

    const nodeIds = new Set(demoNodes.map((n) => n.id));
    const demoEdges: GraphEdge[] = GRAPH_EDGES.filter(
      (e) => nodeIds.has(e.source) && nodeIds.has(e.target)
    ).map((e, i) => ({
      id: `e-inv-${i}`,
      source: e.source,
      target: e.target,
      type: e.type,
      confidence: e.confidence,
      relSource: (e as any).source_ref || 'CASE_INTELLIGENCE_LINK',
    }));

    (targetFir.linkedEntities || []).forEach((entityId, idx) => {
      if (nodeIds.has(entityId)) {
        const hasEdge = demoEdges.some(
          (e) => (e.source === entityId && e.target === targetFir.id) || (e.source === targetFir.id && e.target === entityId)
        );
        if (!hasEdge) {
          demoEdges.push({
            id: `fir-link-${idx}`,
            source: entityId,
            target: targetFir.id,
            type: 'APPEARED_IN_CASE',
            confidence: 0.99,
            relSource: targetFir.firNumber,
          });
        }
      }
    });

    renderGraph(cy, demoNodes, demoEdges);
  }, [renderGraph]);

  const renderEntityFallback = useCallback((cy: Core, entityId: string, fallbackType: string) => {
    const focusIds = new Set<string>([entityId]);

    GRAPH_EDGES.forEach((e) => {
      if (e.source === entityId) focusIds.add(e.target);
      if (e.target === entityId) focusIds.add(e.source);
    });

    const firstHop = Array.from(focusIds);
    for (const id of firstHop) {
      if (focusIds.size >= 50) break;
      GRAPH_EDGES.forEach((e) => {
        if (focusIds.size >= 50) return;
        if (e.source === id) focusIds.add(e.target);
        if (e.target === id) focusIds.add(e.source);
      });
    }

    const demoNodes: GraphNode[] = (ALL_ENTITIES as any[])
      .filter((e) => focusIds.has(e.id))
      .map((e) => ({
        id: e.id,
        nodeType: e.nodeType,
        name: e.name || e.number || e.licensePlate || e.accountNumber || e.id,
        ...e,
      }));

    if (!demoNodes.some((n) => n.id === entityId)) {
      demoNodes.push({
        id: entityId,
        nodeType: fallbackType || 'Person',
        name: entityId,
      });
      focusIds.add(entityId);
    }

    const nodeIds = new Set(demoNodes.map((n) => n.id));
    const demoEdges: GraphEdge[] = GRAPH_EDGES.filter(
      (e) => nodeIds.has(e.source) && nodeIds.has(e.target)
    ).map((e, i) => ({
      id: `e-ent-${i}`,
      source: e.source,
      target: e.target,
      type: e.type,
      confidence: e.confidence,
      relSource: (e as any).source_ref || 'ENTITY_EXPANSION',
    }));

    renderGraph(cy, demoNodes, demoEdges);
  }, [renderGraph]);

  const renderDemoGraph = useCallback((cy: Core) => {
    const demoNodes: GraphNode[] = (ALL_ENTITIES as any[]).map((e) => ({
      id: e.id,
      nodeType: e.nodeType,
      name: e.name || e.number || e.licensePlate || e.accountNumber || e.id,
      ...e,
    }));

    const demoEdges = GRAPH_EDGES.map((e, i) => ({
      id: `e-${i}`,
      source: e.source,
      target: e.target,
      type: e.type,
      confidence: e.confidence,
      relSource: (e as any).source_ref || 'LAW_ENFORCEMENT_RECORDS',
    }));

    renderGraph(cy, demoNodes, demoEdges);
  }, [renderGraph]);

  const loadNetwork = useCallback(async (cy?: Core) => {
    const instance = cy || cyInstance.current;
    if (!instance) return;
    setLoading(true);

    let fetchedNodes: GraphNode[] | null = null;
    let fetchedEdges: GraphEdge[] | null = null;

    try {
      const res = investigationCase
        ? await api.get(`/api/graph/investigation/${encodeURIComponent(investigationCase)}`)
        : entityIdParam
        ? await api.get(`/api/entities/${encodeURIComponent(entityTypeParam)}/${encodeURIComponent(entityIdParam)}/network?depth=2&limit=80`)
        : await api.get('/api/entities/Person/P001/network?depth=2&limit=100');

      if (res.data?.nodes && res.data.nodes.length > 0) {
        fetchedNodes = res.data.nodes;
        fetchedEdges = res.data.edges || [];
      }
    } catch {
      // Offline / synthetic fallback
    } finally {
      setLoading(false);
    }

    if (fetchedNodes && fetchedNodes.length > 0) {
      renderGraph(instance, fetchedNodes, fetchedEdges || []);
    } else {
      if (investigationCase) {
        renderInvestigationFallback(instance, investigationCase);
      } else if (entityIdParam) {
        renderEntityFallback(instance, entityIdParam, entityTypeParam);
      } else {
        renderDemoGraph(instance);
      }
    }
  }, [investigationCase, entityIdParam, entityTypeParam, renderGraph, renderInvestigationFallback, renderEntityFallback, renderDemoGraph]);

  // Initial Load
  useEffect(() => {
    const cy = initCytoscape();
    if (!cy) return;
    loadNetwork(cy);
  }, [investigationCase, entityIdParam, entityTypeParam]);

  // Update styles when label toggles change without reloading canvas
  useEffect(() => {
    if (!cyInstance.current) return;
    cyInstance.current.style(getGraphStylesheet(showLabels, showEdgeLabels) as any);
  }, [showLabels, showEdgeLabels]);

  // --------------------------------------------------------------------------
  // Entity Type Filtering (Without corrupting graph data)
  // --------------------------------------------------------------------------
  const toggleTypeFilter = (type: string) => {
    if (!cyInstance.current) return;
    const cy = cyInstance.current;

    const nextHidden = new Set(hiddenTypes);
    if (nextHidden.has(type)) {
      nextHidden.delete(type);
    } else {
      nextHidden.add(type);
    }
    setHiddenTypes(nextHidden);

    cy.batch(() => {
      cy.nodes().forEach((n) => {
        const nodeType = n.data('nodeType');
        if (nextHidden.has(nodeType)) {
          n.style('display', 'none');
        } else {
          n.style('display', 'element');
        }
      });
    });

    // Update connected components metric for visible nodes
    try {
      const visibleComponents = cy.elements(':visible').components();
      setComponentCount(visibleComponents.length);
    } catch {
      // noop
    }
  };

  const resetFilters = () => {
    if (!cyInstance.current) return;
    setHiddenTypes(new Set());
    cyInstance.current.batch(() => {
      cyInstance.current?.elements().style('display', 'element');
    });
    try {
      setComponentCount(cyInstance.current.elements().components().length);
    } catch {}
  };

  // --------------------------------------------------------------------------
  // Enhanced Search with Animated Focus & Neighborhood Zoom
  // --------------------------------------------------------------------------
  const handleSearch = () => {
    setSearchFeedback(null);
    if (!searchTerm || !cyInstance.current) return;
    const cy = cyInstance.current;
    const term = searchTerm.trim().toLowerCase();

    // 1. Search existing canvas nodes
    const matchedNode = cy.nodes().filter((n) => {
      const data = n.data();
      const label = (data.label || data.name || data.number || data.licensePlate || data.accountNumber || data.id || '').toLowerCase();
      const matchesText = label.includes(term) || n.id().toLowerCase() === term;
      if (searchFilterType) {
        return matchesText && data.nodeType === searchFilterType;
      }
      return matchesText;
    });

    if (matchedNode && matchedNode.length > 0) {
      const target = matchedNode[0];
      setSelectedNode(target.data());
      setSelectedEdge(null);
      setFocusedNodeId(target.id());

      cy.batch(() => {
        cy.elements().removeClass('highlighted dimmed selected-node');
        target.addClass('selected-node highlighted');
        const neighborhood = target.closedNeighborhood();
        cy.elements().not(neighborhood).addClass('dimmed');
        neighborhood.addClass('highlighted');
      });

      cy.animate({
        center: { eles: target },
        zoom: 1.5,
        duration: 450,
      });

      setSearchFeedback(`Focused: ${getNodeLabel(target.data())} (${target.data('nodeType')})`);
      return;
    }

    // 2. Fallback check in master entity directory
    const directoryMatch = (ALL_ENTITIES as any[]).find((e) => {
      const label = (e.name || e.number || e.licensePlate || e.accountNumber || e.id || '').toLowerCase();
      const matchesText = label.includes(term) || e.id.toLowerCase() === term;
      if (searchFilterType) {
        return matchesText && e.nodeType === searchFilterType;
      }
      return matchesText;
    });

    if (directoryMatch) {
      renderEntityFallback(cy, directoryMatch.id, directoryMatch.nodeType);
      setSearchFeedback(`Loaded entity network for: ${directoryMatch.name || directoryMatch.id}`);
    } else {
      setSearchFeedback(`Entity "${searchTerm}" not found in current network graph.`);
    }
  };

  // --------------------------------------------------------------------------
  // Enhanced Path Finder with Amber Highlights & Step Sequence
  // --------------------------------------------------------------------------
  const findPath = async () => {
    if (pathNodes.length < 2 || !cyInstance.current) return;
    setPathLoading(true);
    setSearchFeedback(null);
    const cy = cyInstance.current;
    const [from, to] = pathNodes;

    try {
      let paths: any[] = [];
      try {
        const res = await api.post('/api/graph/path', {
          fromId: from.id,
          fromType: from.nodeType,
          toId: to.id,
          toType: to.nodeType,
          maxHops: 6,
        });
        if (res.data?.paths && res.data.paths.length > 0) {
          paths = res.data.paths;
        }
      } catch {
        // API offline -> fall back to Cytoscape's local A* search
      }

      // Local Cytoscape A* Algorithm Fallback
      if (paths.length === 0) {
        const fromEle = cy.$(`node[id = "${from.id}"]`);
        const toEle = cy.$(`node[id = "${to.id}"]`);
        if (fromEle.length > 0 && toEle.length > 0) {
          const aStarResult = cy.elements().aStar({
            root: fromEle,
            goal: toEle,
            directed: false,
          });

          if (aStarResult.found) {
            const pathEles = aStarResult.path;
            const pathNodeList: any[] = [];
            const pathEdgeList: any[] = [];

            pathEles.forEach((ele: any) => {
              if (ele.isNode()) pathNodeList.push(ele.data());
              if (ele.isEdge()) pathEdgeList.push(ele.data());
            });

            paths = [
              {
                length: pathEdgeList.length,
                nodes: pathNodeList,
                edges: pathEdgeList,
                disclaimer: 'Calculated via topological graph traversal.',
              },
            ];
          }
        }
      }

      setPathResult(paths);

      // Strongly Highlight Path in Graph
      if (paths.length > 0) {
        const bestPath = paths[0];
        const pathNodeIds = new Set<string>();
        bestPath.nodes?.forEach((n: any) => pathNodeIds.add(n.id));

        cy.batch(() => {
          cy.elements().removeClass('path-highlight highlighted dimmed selected-node');

          // Dim all nodes not on path
          cy.nodes().forEach((n) => {
            if (pathNodeIds.has(n.id())) {
              n.addClass('path-highlight');
            } else {
              n.addClass('dimmed');
            }
          });

          // Highlight edges on path
          cy.edges().forEach((e) => {
            if (pathNodeIds.has(e.source().id()) && pathNodeIds.has(e.target().id())) {
              e.addClass('path-highlight');
            } else {
              e.addClass('dimmed');
            }
          });
        });

        const pathElements = cy.$('.path-highlight');
        if (pathElements.length > 0) {
          cy.animate({
            fit: { eles: pathElements, padding: 60 },
            duration: 400,
          });
        }
      } else {
        setSearchFeedback('No connected path found between selected entities.');
      }
    } finally {
      setPathLoading(false);
    }
  };

  // --------------------------------------------------------------------------
  // Expand Node Connections
  // --------------------------------------------------------------------------
  const expandNode = async (node: GraphNode) => {
    if (!cyInstance.current || !node.nodeType) return;
    setLoading(true);
    try {
      const res = await api.post('/api/graph/expand', { nodeId: node.id, nodeType: node.nodeType, limit: 25 });
      const { nodes = [], edges = [] } = res.data || {};
      const existingIds = new Set(cyInstance.current.nodes().map((n) => n.id()));

      const newNodes = nodes.filter((n: GraphNode) => !existingIds.has(n.id));
      const newCyNodes = newNodes.map((n: GraphNode) => ({
        data: {
          id: n.id,
          label: getNodeLabel(n),
          nodeType: n.nodeType,
          degree: 1,
          ...n,
        },
      }));

      const allKnownIds = new Set([...existingIds, ...newNodes.map((n: GraphNode) => n.id)]);
      const validNewEdges = edges.filter(
        (e: GraphEdge) => e && e.source && e.target && allKnownIds.has(e.source) && allKnownIds.has(e.target)
      );
      const newEdges = validNewEdges.map((e: GraphEdge, i: number) => ({
        data: {
          id: e.id || `expand-${i}-${e.source}-${e.target}`,
          source: e.source,
          target: e.target,
          label: e.type?.replace(/_/g, ' '),
          ...e,
        },
      }));

      cyInstance.current.batch(() => {
        cyInstance.current?.add([...newCyNodes, ...newEdges]);
      });

      setNodeCount(cyInstance.current.nodes().length);
      setEdgeCount(cyInstance.current.edges().length);
      runLayout(activeLayout);
    } catch {
      // no-op
    } finally {
      setLoading(false);
    }
  };

  const exportGraph = () => {
    if (!cyInstance.current) return;
    const png = cyInstance.current.png({ output: 'blob', scale: 2, bg: '#ffffff' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(png);
    a.download = `crimegraph-network-${Date.now()}.png`;
    a.click();
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - var(--topbar-height) - 40px)', gap: 10 }}>
      {/* Investigation / Entity Context Disclaimer */}
      {investigationCase && (
        <div className="ai-disclaimer" style={{ padding: '6px 14px', fontSize: '0.78rem' }}>
          Focused investigation graph: <strong>{investigationCase}</strong>. Clustered network showing connected entities, communications, and associations.
        </div>
      )}
      {entityIdParam && (
        <div className="ai-disclaimer" style={{ padding: '6px 14px', fontSize: '0.78rem' }}>
          Focused entity network: <strong>{entityTypeParam} · {entityIdParam}</strong>. Exploring multi-hop associations and communication links.
        </div>
      )}

      {/* Main Graph Toolbar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 10,
          background: 'var(--bg-card)',
          padding: '10px 14px',
          borderRadius: 'var(--radius-md)',
          border: '1px solid var(--border-primary)',
          boxShadow: 'var(--shadow-sm)',
        }}
      >
        {/* Left: Title & Search */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginRight: 6 }}>
            <Network size={18} color="var(--accent-primary)" />
            <span style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)' }}>
              Network Analysis
            </span>
          </div>

          {/* Search Box */}
          <div style={{ display: 'flex', gap: 6, flex: 1, maxWidth: 440 }}>
            <select
              value={searchFilterType}
              onChange={(e) => setSearchFilterType(e.target.value)}
              style={{
                width: 110,
                fontSize: '0.8rem',
                padding: '5px 8px',
                borderRadius: 6,
                border: '1px solid var(--border-primary)',
                background: 'var(--bg-elevated)',
                color: 'var(--text-primary)',
                outline: 'none',
              }}
            >
              <option value="">All Types</option>
              {Object.keys(NODE_COLORS).map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>

            <div style={{ position: 'relative', flex: 1 }}>
              <Search size={13} style={{ position: 'absolute', left: 9, top: 9, color: 'var(--text-muted)' }} />
              <input
                type="text"
                placeholder="Search entity name, phone, plate, ID..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                style={{
                  width: '100%',
                  padding: '6px 8px 6px 28px',
                  fontSize: '0.8rem',
                  borderRadius: 6,
                  border: '1px solid var(--border-primary)',
                  background: 'var(--bg-elevated)',
                  color: 'var(--text-primary)',
                  outline: 'none',
                }}
              />
            </div>
            <button className="btn btn-primary btn-sm" onClick={handleSearch}>
              Search
            </button>
          </div>
        </div>

        {/* Right: Controls & Toggles */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          {/* Layout Selector */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <Compass size={14} color="var(--text-muted)" />
            <select
              value={activeLayout}
              onChange={(e) => {
                const layout = e.target.value;
                setActiveLayout(layout);
                runLayout(layout);
              }}
              style={{
                fontSize: '0.78rem',
                padding: '5px 8px',
                borderRadius: 6,
                border: '1px solid var(--border-primary)',
                background: 'var(--bg-elevated)',
                color: 'var(--text-primary)',
                outline: 'none',
              }}
              title="Change Graph Layout Algorithm"
            >
              <option value="cose-bilkent">Smart Cluster (Bilkent)</option>
              <option value="cose">Spring Force (CoSE)</option>
              <option value="concentric">Concentric (Connectivity)</option>
              <option value="breadthfirst">Breadth-First (Tree)</option>
              <option value="circle">Circular</option>
            </select>
          </div>

          <button
            className="btn btn-secondary btn-sm"
            onClick={() => runLayout(activeLayout)}
            title="Auto-arrange nodes and compact empty space"
          >
            <Sparkles size={13} style={{ marginRight: 4 }} />
            Auto Layout
          </button>

          {/* Reset Focus */}
          {focusedNodeId && (
            <button
              className="btn btn-secondary btn-sm"
              onClick={resetFocus}
              style={{ background: '#fef3c7', color: '#92400e', borderColor: '#fcd34d' }}
              title="Restore full graph visibility"
            >
              <X size={13} style={{ marginRight: 4 }} />
              Reset Focus
            </button>
          )}

          {/* Labels Toggle */}
          <button
            className={`btn btn-sm ${showLabels ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setShowLabels((v) => !v)}
            title="Show or hide entity names on canvas"
          >
            {showLabels ? <Eye size={13} /> : <EyeOff size={13} />}
            <span style={{ marginLeft: 4 }}>Labels</span>
          </button>

          {/* Edge Labels Toggle */}
          <button
            className={`btn btn-sm ${showEdgeLabels ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setShowEdgeLabels((v) => !v)}
            title="Show or hide relationship labels on edges"
          >
            <Tag size={13} style={{ marginRight: 4 }} />
            Rel Labels
          </button>

          {/* Path Finder Toggle */}
          <button
            className={`btn btn-sm ${pathMode ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => {
              setPathMode((v) => !v);
              setPathNodes([]);
              setPathResult(null);
              resetFocus();
            }}
            title="Trace connection path between two nodes"
          >
            <GitBranch size={13} style={{ marginRight: 4 }} />
            Path Finder
          </button>

          {/* Viewport Actions */}
          <div style={{ display: 'flex', gap: 2, marginLeft: 4 }}>
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => cyInstance.current?.zoom({ level: (cyInstance.current?.zoom() || 1) * 1.25 })}
              title="Zoom In"
              style={{ padding: '5px 8px' }}
            >
              <ZoomIn size={14} />
            </button>
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => cyInstance.current?.zoom({ level: (cyInstance.current?.zoom() || 1) * 0.8 })}
              title="Zoom Out"
              style={{ padding: '5px 8px' }}
            >
              <ZoomOut size={14} />
            </button>
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => cyInstance.current?.fit(undefined, 40)}
              title="Fit Entire Graph to View"
              style={{ padding: '5px 8px' }}
            >
              <Maximize2 size={14} />
            </button>
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => loadNetwork()}
              title="Reload Network Data"
              style={{ padding: '5px 8px' }}
            >
              <RefreshCw size={14} />
            </button>
            <button
              className="btn btn-secondary btn-sm"
              onClick={exportGraph}
              title="Export High-Res PNG"
              style={{ padding: '5px 8px' }}
            >
              <Download size={14} />
            </button>
          </div>
        </div>
      </div>

      {/* Search Feedback Banner */}
      {searchFeedback && (
        <div
          style={{
            padding: '6px 14px',
            background: searchFeedback.includes('not found') ? '#fef2f2' : '#eff6ff',
            border: `1px solid ${searchFeedback.includes('not found') ? '#fecaca' : '#bfdbfe'}`,
            borderRadius: 6,
            fontSize: '0.78rem',
            color: searchFeedback.includes('not found') ? '#dc2626' : '#1d4ed8',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <span>{searchFeedback}</span>
          <button
            onClick={() => setSearchFeedback(null)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit' }}
          >
            ✕
          </button>
        </div>
      )}

      {/* Entity Filter Bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          flexWrap: 'wrap',
          background: 'var(--bg-card)',
          padding: '6px 12px',
          borderRadius: 'var(--radius-sm)',
          border: '1px solid var(--border-primary)',
          fontSize: '0.75rem',
        }}
      >
        <span style={{ fontWeight: 600, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 4, marginRight: 4 }}>
          <Filter size={12} /> Entity Filters:
        </span>
        {Object.entries(NODE_COLORS).map(([type, color]) => {
          const isHidden = hiddenTypes.has(type);
          const count = entityTypeCounts[type] || 0;
          return (
            <button
              key={type}
              onClick={() => toggleTypeFilter(type)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 5,
                padding: '3px 8px',
                borderRadius: 4,
                border: `1px solid ${isHidden ? 'var(--border-primary)' : color}`,
                background: isHidden ? 'var(--bg-secondary)' : `${color}15`,
                color: isHidden ? 'var(--text-muted)' : 'var(--text-primary)',
                cursor: 'pointer',
                fontSize: '0.72rem',
                fontWeight: 500,
                opacity: isHidden ? 0.6 : 1,
                transition: 'all 150ms ease',
              }}
              title={isHidden ? `Show ${type} nodes` : `Hide ${type} nodes`}
            >
              <span style={{ width: 7, height: 7, borderRadius: 2, background: color }} />
              <span>{type}</span>
              <span style={{ fontSize: '0.65rem', opacity: 0.8 }}>({count})</span>
            </button>
          );
        })}

        {hiddenTypes.size > 0 && (
          <button
            onClick={resetFilters}
            className="btn btn-secondary btn-sm"
            style={{ padding: '2px 8px', fontSize: '0.7rem', marginLeft: 'auto' }}
          >
            Reset Filters
          </button>
        )}
      </div>

      {/* Path Finder Interaction Bar */}
      {pathMode && (
        <div
          style={{
            padding: '10px 14px',
            background: 'rgba(37, 99, 235, 0.08)',
            border: '1px solid rgba(37, 99, 235, 0.25)',
            borderRadius: 'var(--radius-sm)',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            flexWrap: 'wrap',
          }}
        >
          <GitBranch size={16} color="var(--accent-primary)" />
          <span style={{ fontSize: '0.825rem', color: 'var(--text-primary)' }}>
            <strong>Path Analysis:</strong> Click <strong>Source Node</strong>, then click <strong>Destination Node</strong> on the canvas to compute shortest connectivity path.
          </span>
          {pathNodes.map((n, i) => (
            <span key={i} className="badge badge-info" style={{ fontSize: '0.72rem' }}>
              {i === 0 ? 'Source (A):' : 'Destination (B):'} {getNodeLabel(n)} ({n.nodeType})
            </span>
          ))}
          {pathNodes.length === 2 && (
            <button className="btn btn-primary btn-sm" onClick={findPath} disabled={pathLoading}>
              {pathLoading ? <Loader size={13} className="loading-spinner" /> : 'Trace Path'}
            </button>
          )}
          {pathResult && (
            <span style={{ fontSize: '0.78rem', fontWeight: 600, color: pathResult.length > 0 ? '#16a34a' : '#dc2626' }}>
              {pathResult.length > 0 ? `✓ Connection Path Identified (${pathResult[0].length} hops)` : '✗ No path found'}
            </span>
          )}
        </div>
      )}

      {/* Main Canvas & Detail Sidebar Area */}
      <div style={{ flex: 1, display: 'flex', gap: 10, minHeight: 0 }}>
        {/* Canvas Container */}
        <div
          className="graph-container"
          style={{
            flex: 1,
            position: 'relative',
            background: '#f8fafc',
            border: '1px solid var(--border-primary)',
            borderRadius: 'var(--radius-md)',
            overflow: 'hidden',
          }}
        >
          {loading && (
            <div
              style={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 12,
                background: 'rgba(255, 255, 255, 0.75)',
                zIndex: 100,
              }}
            >
              <div className="loading-spinner" style={{ width: 36, height: 36, borderWidth: 3 }} />
              <span style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                Organizing network topology...
              </span>
            </div>
          )}

          <div ref={cyRef} style={{ width: '100%', height: '100%' }} />

          {/* Bottom Graph Stats & Legal Disclaimer */}
          <div
            style={{
              position: 'absolute',
              bottom: 12,
              left: 12,
              right: 12,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              pointerEvents: 'none',
              flexWrap: 'wrap',
              gap: 8,
            }}
          >
            <div
              style={{
                padding: '5px 12px',
                background: 'rgba(255, 255, 255, 0.95)',
                border: '1px solid var(--border-primary)',
                borderRadius: 6,
                fontSize: '0.72rem',
                color: 'var(--text-secondary)',
                boxShadow: 'var(--shadow-sm)',
                pointerEvents: 'auto',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
              }}
            >
              <span><strong>{nodeCount}</strong> Nodes</span>
              <span>•</span>
              <span><strong>{edgeCount}</strong> Relationships</span>
              <span>•</span>
              <span><strong>{componentCount}</strong> Network Clusters</span>
              {hiddenTypes.size > 0 && (
                <>
                  <span>•</span>
                  <span style={{ color: '#ea580c' }}>({hiddenTypes.size} Types Filtered)</span>
                </>
              )}
            </div>

            <div
              className="ai-disclaimer"
              style={{
                padding: '4px 10px',
                fontSize: '0.7rem',
                pointerEvents: 'auto',
                boxShadow: 'var(--shadow-sm)',
              }}
            >
              Graph shows analytical relationships — not proof of wrongdoing
            </div>
          </div>

          {/* Quick Node Type Legend (Top Left Overlay) */}
          <div
            style={{
              position: 'absolute',
              top: 12,
              left: 12,
              background: 'rgba(255, 255, 255, 0.96)',
              border: '1px solid var(--border-primary)',
              borderRadius: 8,
              padding: '8px 10px',
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
              boxShadow: 'var(--shadow-sm)',
              pointerEvents: 'auto',
              maxHeight: 200,
              overflowY: 'auto',
            }}
          >
            <span style={{ fontSize: '0.65rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
              Legend
            </span>
            {Object.entries(NODE_COLORS).map(([type, color]) => (
              <div
                key={type}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  fontSize: '0.7rem',
                  color: 'var(--text-secondary)',
                }}
              >
                <span style={{ width: 7, height: 7, borderRadius: 2, background: color }} />
                <span>{NODE_ICONS[type]} {type}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Right Inspection Panel (Selected Node, Edge, or Path Result) */}
        {(selectedNode || selectedEdge || (pathResult && pathResult.length > 0)) && (
          <div
            className="slide-in-right"
            style={{
              width: 330,
              flexShrink: 0,
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
              overflowY: 'auto',
              maxHeight: '100%',
            }}
          >
            {/* Selected Node Details Card */}
            {selectedNode && (
              <div className="card" style={{ padding: 16 }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 12 }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                      <span style={{ fontSize: '1.2rem' }}>{NODE_ICONS[selectedNode.nodeType]}</span>
                      <span
                        className="badge"
                        style={{
                          background: `${NODE_COLORS[selectedNode.nodeType]}20`,
                          color: NODE_COLORS[selectedNode.nodeType],
                          fontWeight: 700,
                        }}
                      >
                        {selectedNode.nodeType}
                      </span>
                      {selectedNode.isHighConnectivity && (
                        <span className="badge badge-info" style={{ fontSize: '0.65rem' }}>
                          High connectivity
                        </span>
                      )}
                    </div>
                    <h3 style={{ fontSize: '1rem', fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>
                      {getNodeLabel(selectedNode)}
                    </h3>
                  </div>

                  <button className="btn btn-ghost btn-sm" onClick={resetFocus} title="Close & Reset Focus">
                    <X size={14} />
                  </button>
                </div>

                {/* Node Degree Metric */}
                <div
                  style={{
                    background: 'var(--bg-elevated)',
                    borderRadius: 6,
                    padding: '6px 10px',
                    fontSize: '0.75rem',
                    marginBottom: 10,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                  }}
                >
                  <span style={{ color: 'var(--text-muted)' }}>Network Connections:</span>
                  <strong style={{ color: 'var(--text-primary)' }}>
                    {selectedNode.degree || 0} Incident Edges
                  </strong>
                </div>

                {/* Properties List */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginBottom: 14 }}>
                  {Object.entries(selectedNode)
                    .filter(([k]) => !['id', 'nodeType', 'createdAt', 'degree', 'isHighConnectivity'].includes(k))
                    .filter(([, v]) => v !== null && v !== undefined && v !== '')
                    .map(([k, v]) => (
                      <div key={k} style={{ display: 'flex', gap: 8, fontSize: '0.78rem' }}>
                        <span style={{ color: 'var(--text-muted)', textTransform: 'capitalize', width: 95, flexShrink: 0 }}>
                          {k.replace(/([A-Z])/g, ' $1').toLowerCase()}
                        </span>
                        <span style={{ color: 'var(--text-secondary)', wordBreak: 'break-word', flex: 1 }}>
                          {String(v)}
                        </span>
                      </div>
                    ))}
                </div>

                {/* Actions */}
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <button className="btn btn-primary btn-sm" onClick={() => expandNode(selectedNode)}>
                    <ChevronRight size={12} /> Expand Connections
                  </button>
                  <button className="btn btn-secondary btn-sm" onClick={resetFocus}>
                    Reset Focus
                  </button>
                  <a
                    href={`/entities/${selectedNode.nodeType}/${selectedNode.id}`}
                    className="btn btn-secondary btn-sm"
                    target="_blank"
                    rel="noreferrer"
                  >
                    <Info size={12} /> Profile
                  </a>
                </div>
              </div>
            )}

            {/* Selected Edge Details Card */}
            {selectedEdge && (
              <div className="card" style={{ padding: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                  <span style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                    Relationship Details
                  </span>
                  <button className="btn btn-ghost btn-sm" onClick={() => setSelectedEdge(null)}>
                    <X size={14} />
                  </button>
                </div>

                <div
                  style={{
                    padding: '8px 10px',
                    background: 'var(--bg-elevated)',
                    borderRadius: 6,
                    textAlign: 'center',
                    fontSize: '0.85rem',
                    fontWeight: 700,
                    color: 'var(--accent-primary)',
                    marginBottom: 10,
                  }}
                >
                  {selectedEdge.type?.replace(/_/g, ' ')}
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: '0.78rem' }}>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <span style={{ color: 'var(--text-muted)', width: 90, flexShrink: 0 }}>Endpoints:</span>
                    <span style={{ color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
                      {selectedEdge.source} → {selectedEdge.target}
                    </span>
                  </div>
                  {selectedEdge.confidence && (
                    <div style={{ display: 'flex', gap: 8 }}>
                      <span style={{ color: 'var(--text-muted)', width: 90 }}>Confidence:</span>
                      <strong style={{ color: '#16a34a' }}>{Math.round(Number(selectedEdge.confidence) * 100)}%</strong>
                    </div>
                  )}
                  {selectedEdge.timestamp && (
                    <div style={{ display: 'flex', gap: 8 }}>
                      <span style={{ color: 'var(--text-muted)', width: 90 }}>Timestamp:</span>
                      <span>{new Date(selectedEdge.timestamp).toLocaleString()}</span>
                    </div>
                  )}
                  {selectedEdge.relSource && (
                    <div style={{ display: 'flex', gap: 8 }}>
                      <span style={{ color: 'var(--text-muted)', width: 90 }}>Source:</span>
                      <span>{selectedEdge.relSource}</span>
                    </div>
                  )}
                  {selectedEdge.recordRef && (
                    <div style={{ display: 'flex', gap: 8 }}>
                      <span style={{ color: 'var(--text-muted)', width: 90 }}>Record Ref:</span>
                      <span style={{ fontFamily: 'var(--font-mono)' }}>{selectedEdge.recordRef}</span>
                    </div>
                  )}
                </div>

                <div className="ai-disclaimer" style={{ marginTop: 12, fontSize: '0.7rem' }}>
                  Relationship shown is based on recorded telecom or case data.
                </div>
              </div>
            )}

            {/* Path Finder Sequence Card */}
            {pathResult && pathResult.length > 0 && (
              <div className="card" style={{ padding: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                  <span style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                    Connectivity Path Sequence
                  </span>
                  <button className="btn btn-ghost btn-sm" onClick={() => { setPathResult(null); resetFocus(); }}>
                    <X size={14} />
                  </button>
                </div>

                {pathResult.map((path: any, i: number) => (
                  <div key={i}>
                    <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginBottom: 8 }}>
                      Path Distance: <strong>{path.length} hops</strong> ({path.nodes?.length || 0} entities)
                    </div>

                    {/* Step-by-step sequential breadcrumb chain */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10 }}>
                      {path.nodes?.map((n: any, j: number) => {
                        const nextEdge = path.edges?.[j];
                        return (
                          <div key={j}>
                            <div
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 6,
                                padding: '6px 10px',
                                background: '#ffffff',
                                border: '1px solid #f59e0b',
                                borderRadius: 6,
                                fontSize: '0.78rem',
                              }}
                            >
                              <span>{NODE_ICONS[n.nodeType]}</span>
                              <strong style={{ color: 'var(--text-primary)' }}>{n.name || n.id}</strong>
                              <span
                                className="badge"
                                style={{
                                  fontSize: '0.62rem',
                                  background: `${NODE_COLORS[n.nodeType]}18`,
                                  color: NODE_COLORS[n.nodeType],
                                  marginLeft: 'auto',
                                }}
                              >
                                {n.nodeType}
                              </span>
                            </div>

                            {j < (path.nodes.length - 1) && (
                              <div
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  gap: 4,
                                  padding: '3px 0',
                                  fontSize: '0.7rem',
                                  color: '#d97706',
                                  fontWeight: 600,
                                }}
                              >
                                ↓ {nextEdge?.type ? nextEdge.type.replace(/_/g, ' ') : 'CONNECTED_TO'}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>

                    <div className="ai-disclaimer" style={{ fontSize: '0.7rem' }}>
                      {path.disclaimer || 'Topological traversal lead — requires corroboration.'}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
