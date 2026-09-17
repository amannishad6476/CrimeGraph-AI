import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import cytoscape from 'cytoscape';
import type { Core, NodeSingular, EdgeSingular } from 'cytoscape';
import coseBilkent from 'cytoscape-cose-bilkent';
import {
  Search, ZoomIn, ZoomOut, Maximize2, RefreshCw, Filter,
  Download, Info, X, ChevronRight, Loader, Network, GitBranch,
  Eye, EyeOff, Tag, Compass, Sparkles, SlidersHorizontal, Check,
  Target, Focus, Layers, ShieldCheck
} from 'lucide-react';
import api from '../lib/api';
import { ALL_ENTITIES, GRAPH_EDGES, FIR_RECORDS } from '../data/dataset';
import {
  NODE_COLORS,
  NODE_SHAPES,
  NODE_ICONS,
  getNodeSize,
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
  firNumber?: string;
  degree?: number;
  fullLabel?: string;
  label?: string;
  isHighConnectivity?: boolean;
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
  hasDirection?: boolean;
  directed?: boolean;
  [key: string]: unknown;
}

interface TooltipInfo {
  x: number;
  y: number;
  node?: GraphNode;
  edge?: GraphEdge;
}

// Directional relationship types in crime & intelligence networks
const DIRECTIONAL_TYPES = new Set([
  'CALLS', 'TRANSFERRED_TO', 'FINANCIAL_TRANSACTION',
  'APPEARED_IN_CASE', 'LOCATED_AT', 'WORKS_FOR', 'OWNS', 'FILED_AGAINST'
]);

function isEdgeDirectional(edge: Partial<GraphEdge>): boolean {
  if (edge.directed === false) return false;
  if (edge.directed === true) return true;
  if (edge.hasDirection !== undefined) return Boolean(edge.hasDirection);
  return DIRECTIONAL_TYPES.has(edge.type || '');
}

function getNodeFullLabel(node: Partial<GraphNode>): string {
  return String(node.name || node.number || node.licensePlate || node.accountNumber || node.firNumber || node.id || '');
}

function getNodeLabel(node: Partial<GraphNode>): string {
  const full = getNodeFullLabel(node);
  if (full.length > 20) {
    return `${full.substring(0, 18)}…`;
  }
  return full;
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

  // Search & Feedback
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

  // Interactive Tooltip on Hover
  const [hoverTooltip, setHoverTooltip] = useState<TooltipInfo | null>(null);

  // Path Finder State
  const [pathMode, setPathMode] = useState(false);
  const [pathNodes, setPathNodes] = useState<GraphNode[]>([]);
  const [pathLoading, setPathLoading] = useState(false);
  const [pathResult, setPathResult] = useState<any[] | null>(null);

  // Master Graph Data Cache
  const masterNodesRef = useRef<GraphNode[]>([]);
  const masterEdgesRef = useRef<GraphEdge[]>([]);

  // --------------------------------------------------------------------------
  // Apply Hierarchical Focus Mode (Target, 1-Hop, 2-Hop, Dim Rest)
  // --------------------------------------------------------------------------
  const applyFocusMode = useCallback((nodeEle: NodeSingular) => {
    if (!cyInstance.current) return;
    const cy = cyInstance.current;
    const targetData = nodeEle.data() as GraphNode;

    setSelectedNode(targetData);
    setSelectedEdge(null);
    setFocusedNodeId(nodeEle.id());

    // 1-hop neighborhood
    const hop1Neighborhood = nodeEle.neighborhood();
    const hop1Nodes = hop1Neighborhood.nodes();
    const hop1Edges = nodeEle.connectedEdges();

    // 2-hop neighborhood: neighbors of hop-1 nodes excluding center and hop-1
    const closedHop1 = nodeEle.closedNeighborhood();
    const hop2Nodes = closedHop1.neighborhood().nodes().difference(closedHop1);
    const hop2Edges = hop1Nodes.connectedEdges().difference(hop1Edges);

    cy.batch(() => {
      // Clear previous states
      cy.elements().removeClass(
        'selected-node hop-1 hop-2 highlighted hop-1-edge hop-2-edge dimmed path-highlight'
      );

      // Mute everything by default
      cy.elements().addClass('dimmed');

      // Unmute and highlight 2-hop secondary tier
      hop2Nodes.removeClass('dimmed').addClass('hop-2');
      hop2Edges.removeClass('dimmed').addClass('hop-2-edge');

      // Unmute and highlight 1-hop primary tier
      hop1Nodes.removeClass('dimmed').addClass('hop-1');
      hop1Edges.removeClass('dimmed').addClass('hop-1-edge');

      // Target node in the absolute focus center
      nodeEle.removeClass('dimmed').addClass('selected-node');
    });
  }, []);

  // --------------------------------------------------------------------------
  // Reset Focus / Restore Complete Graph
  // --------------------------------------------------------------------------
  const resetFocus = useCallback(() => {
    setSelectedNode(null);
    setSelectedEdge(null);
    setFocusedNodeId(null);
    setSearchFeedback(null);

    if (cyInstance.current) {
      cyInstance.current.batch(() => {
        cyInstance.current?.elements().removeClass(
          'selected-node hop-1 hop-2 highlighted hop-1-edge hop-2-edge dimmed path-highlight'
        );
      });
    }
  }, []);

  // --------------------------------------------------------------------------
  // Focus on currently selected node with smooth viewport center
  // --------------------------------------------------------------------------
  const focusSelected = useCallback(() => {
    if (!cyInstance.current || !selectedNode) return;
    const cy = cyInstance.current;
    const target = cy.$(`node[id = "${selectedNode.id}"]`);
    if (target.length > 0) {
      applyFocusMode(target[0]);
      cy.animate({
        center: { eles: target[0] },
        zoom: Math.min(1.8, Math.max(1.25, cy.zoom())),
        duration: 400,
      });
    }
  }, [selectedNode, applyFocusMode]);

  // --------------------------------------------------------------------------
  // Run Layout with Error Guard
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
      cy.layout({ name: 'cose', animate: true, animationDuration: 600, padding: 40 } as any).run();
    }
  }, []);

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
      wheelSensitivity: 0.2,
      minZoom: 0.15,
      maxZoom: 3.5,
    });

    // Node Tap -> Select and apply Focus Mode
    cy.on('tap', 'node', (evt) => {
      const node = evt.target;
      const data = node.data() as GraphNode;

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

      applyFocusMode(node);
    });

    // Edge Tap -> Inspect relationship
    cy.on('tap', 'edge', (evt) => {
      const edge = evt.target;
      setSelectedEdge(edge.data());
      setSelectedNode(null);
      setFocusedNodeId(null);

      cy.batch(() => {
        cy.elements().removeClass(
          'selected-node hop-1 hop-2 highlighted hop-1-edge hop-2-edge dimmed path-highlight'
        );
        edge.addClass('highlighted');
        edge.connectedNodes().addClass('highlighted');
        cy.elements().not(edge.union(edge.connectedNodes())).addClass('dimmed');
      });
    });

    // Canvas Tap -> Reset Focus on Background Click
    cy.on('tap', (evt) => {
      if (evt.target === cy) {
        resetFocus();
      }
    });

    // Tooltip Hover Handlers
    cy.on('mouseover', 'node', (evt) => {
      const node = evt.target;
      const renderedPos = node.renderedPosition();
      const containerRect = cyRef.current?.getBoundingClientRect();
      if (containerRect) {
        setHoverTooltip({
          x: containerRect.left + renderedPos.x,
          y: containerRect.top + renderedPos.y - 20,
          node: node.data() as GraphNode,
        });
      }
    });

    cy.on('mouseout', 'node', () => {
      setHoverTooltip(null);
    });

    cy.on('pan zoom drag', () => {
      setHoverTooltip(null);
    });

    cyInstance.current = cy;
    return cy;
  }, [pathMode, applyFocusMode, resetFocus]);

  // --------------------------------------------------------------------------
  // Render Graph Data with Degree Computation & Deterministic Grouping
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
      const fullLabel = getNodeFullLabel(n);
      return {
        group: 'nodes' as const,
        data: {
          id: n.id,
          label: getNodeLabel(n),
          fullLabel: fullLabel,
          nodeType: n.nodeType,
          degree: deg,
          isHighConnectivity: deg >= 6,
          ...n,
        },
      };
    });

    const cyEdges = validEdges.map((e, i) => {
      const hasDir = isEdgeDirectional(e);
      return {
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
          hasDirection: hasDir,
        },
      };
    });

    cy.batch(() => {
      cy.add([...cyNodes, ...cyEdges]);
    });

    // Calculate connected components
    try {
      const components = cy.elements().components();
      setComponentCount(components.length);
    } catch {
      setComponentCount(1);
    }

    setNodeCount(cyNodes.length);
    setEdgeCount(cyEdges.length);

    // Run CoSE-Bilkent compact layout
    runLayout(activeLayout);

    // If focused on an entity from URL query, zoom to it with Focus Mode
    if (entityIdParam) {
      setTimeout(() => {
        const target = cy.$(`node[id = "${entityIdParam}"]`);
        if (target && target.length > 0) {
          applyFocusMode(target[0]);
          cy.animate({ center: { eles: target[0] }, zoom: 1.45, duration: 400 });
        }
      }, 700);
    }
  }, [activeLayout, entityIdParam, runLayout, applyFocusMode]);

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
      hasDirection: isEdgeDirectional(e),
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
            hasDirection: true,
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
      hasDirection: isEdgeDirectional(e),
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
      hasDirection: isEdgeDirectional(e),
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

  // Initial Load with proper cleanup
  useEffect(() => {
    const cy = initCytoscape();
    if (!cy) return;
    loadNetwork(cy);

    return () => {
      if (cyInstance.current) {
        cyInstance.current.destroy();
        cyInstance.current = null;
      }
    };
  }, [investigationCase, entityIdParam, entityTypeParam]);

  // Dynamic Label Style Update
  useEffect(() => {
    if (!cyInstance.current) return;
    cyInstance.current.style(getGraphStylesheet(showLabels, showEdgeLabels) as any);
  }, [showLabels, showEdgeLabels]);

  // --------------------------------------------------------------------------
  // Non-Destructive Entity Type Filtering
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
  // Enhanced Search with Automatic Focus Mode and Smooth Pan
  // --------------------------------------------------------------------------
  const handleSearch = () => {
    setSearchFeedback(null);
    if (!searchTerm || !cyInstance.current) return;
    const cy = cyInstance.current;
    const term = searchTerm.trim().toLowerCase();

    // 1. Check existing canvas nodes
    const matchedNode = cy.nodes().filter((n) => {
      const data = n.data();
      const name = (data.name || '').toLowerCase();
      const number = (data.number || '').toLowerCase();
      const plate = (data.licensePlate || '').toLowerCase();
      const acc = (data.accountNumber || '').toLowerCase();
      const fir = (data.firNumber || '').toLowerCase();
      const id = n.id().toLowerCase();
      const matchesText =
        name.includes(term) ||
        number.includes(term) ||
        plate.includes(term) ||
        acc.includes(term) ||
        fir.includes(term) ||
        id === term;

      if (searchFilterType) {
        return matchesText && data.nodeType === searchFilterType;
      }
      return matchesText;
    });

    if (matchedNode && matchedNode.length > 0) {
      const target = matchedNode[0];
      applyFocusMode(target);

      cy.animate({
        center: { eles: target },
        zoom: 1.5,
        duration: 450,
      });

      setSearchFeedback(`Focused: ${getNodeFullLabel(target.data())} (${target.data('nodeType')})`);
      return;
    }

    // 2. Check master entity directory
    const directoryMatch = (ALL_ENTITIES as any[]).find((e) => {
      const name = (e.name || '').toLowerCase();
      const number = (e.number || '').toLowerCase();
      const plate = (e.licensePlate || '').toLowerCase();
      const acc = (e.accountNumber || '').toLowerCase();
      const id = e.id.toLowerCase();
      const matchesText =
        name.includes(term) ||
        number.includes(term) ||
        plate.includes(term) ||
        acc.includes(term) ||
        id === term;

      if (searchFilterType) {
        return matchesText && e.nodeType === searchFilterType;
      }
      return matchesText;
    });

    if (directoryMatch) {
      renderEntityFallback(cy, directoryMatch.id, directoryMatch.nodeType);
      setSearchFeedback(`Loaded network for: ${directoryMatch.name || directoryMatch.id}`);
    } else {
      setSearchFeedback(`Entity "${searchTerm}" not found in current network.`);
    }
  };

  // --------------------------------------------------------------------------
  // Enhanced Path Finder with Amber Glow and Step Sequence
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
        // Fallback to local Cytoscape A* search
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
          cy.elements().removeClass(
            'selected-node hop-1 hop-2 highlighted hop-1-edge hop-2-edge dimmed path-highlight'
          );

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
          fullLabel: getNodeFullLabel(n),
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
          hasDirection: isEdgeDirectional(e),
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
    const png = cyInstance.current.png({ output: 'blob', scale: 2, bg: '#090d16' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(png);
    a.download = `crimegraph-network-${Date.now()}.png`;
    a.click();
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - var(--topbar-height) - 36px)', gap: 10 }}>
      {/* Context Banner if opened from Investigation or Entity Detail */}
      {investigationCase && (
        <div
          style={{
            padding: '7px 14px',
            fontSize: '0.8rem',
            background: 'rgba(15, 23, 42, 0.85)',
            border: '1px solid rgba(56, 189, 248, 0.3)',
            borderRadius: 'var(--radius-sm)',
            color: '#e2e8f0',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <Network size={14} color="#38bdf8" />
          <span>
            Focused Investigation Network: <strong style={{ color: '#38bdf8' }}>{investigationCase}</strong> — Clustered topology showing connected entities and recorded communications.
          </span>
        </div>
      )}
      {entityIdParam && (
        <div
          style={{
            padding: '7px 14px',
            fontSize: '0.8rem',
            background: 'rgba(15, 23, 42, 0.85)',
            border: '1px solid rgba(56, 189, 248, 0.3)',
            borderRadius: 'var(--radius-sm)',
            color: '#e2e8f0',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <Focus size={14} color="#38bdf8" />
          <span>
            Focused Entity Network: <strong style={{ color: '#38bdf8' }}>{entityTypeParam} · {entityIdParam}</strong> — Multi-hop associations and communication links.
          </span>
        </div>
      )}

      {/* Main Graph Toolbar (Dark Glassmorphic UI) */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 10,
          background: 'rgba(15, 23, 42, 0.94)',
          backdropFilter: 'blur(10px)',
          padding: '10px 14px',
          borderRadius: 'var(--radius-md)',
          border: '1px solid rgba(255, 255, 255, 0.12)',
          boxShadow: '0 4px 20px rgba(0, 0, 0, 0.3)',
        }}
      >
        {/* Left: Title & Search Bar */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginRight: 6 }}>
            <Network size={18} color="#38bdf8" />
            <span style={{ fontSize: '0.95rem', fontWeight: 700, color: '#f8fafc', letterSpacing: '-0.01em' }}>
              Relationship Graph
            </span>
          </div>

          {/* Search Box */}
          <div style={{ display: 'flex', gap: 6, flex: 1, maxWidth: 460 }}>
            <select
              value={searchFilterType}
              onChange={(e) => setSearchFilterType(e.target.value)}
              style={{
                width: 110,
                fontSize: '0.78rem',
                padding: '5px 8px',
                borderRadius: 6,
                border: '1px solid rgba(255, 255, 255, 0.15)',
                background: '#1e293b',
                color: '#f1f5f9',
                outline: 'none',
              }}
            >
              <option value="">All Types</option>
              {Object.keys(NODE_COLORS).map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>

            <div style={{ position: 'relative', flex: 1 }}>
              <Search size={13} style={{ position: 'absolute', left: 9, top: 9, color: '#94a3b8' }} />
              <input
                type="text"
                placeholder="Search person, phone, plate, account, ID..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                style={{
                  width: '100%',
                  padding: '6px 8px 6px 28px',
                  fontSize: '0.8rem',
                  borderRadius: 6,
                  border: '1px solid rgba(255, 255, 255, 0.15)',
                  background: '#1e293b',
                  color: '#f8fafc',
                  outline: 'none',
                }}
              />
            </div>
            <button
              className="btn btn-primary btn-sm"
              onClick={handleSearch}
              style={{ padding: '5px 12px', fontSize: '0.78rem' }}
            >
              Search
            </button>
          </div>
        </div>

        {/* Right: Layout, Focus, Labels & Viewport Controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          {/* Layout Selector */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <Compass size={14} color="#94a3b8" />
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
                border: '1px solid rgba(255, 255, 255, 0.15)',
                background: '#1e293b',
                color: '#f1f5f9',
                outline: 'none',
              }}
              title="Change Graph Layout Algorithm"
            >
              <option value="cose-bilkent">Compact Cluster (Bilkent)</option>
              <option value="cose">Spring Force (CoSE)</option>
              <option value="concentric">Concentric (Connectivity)</option>
              <option value="breadthfirst">Breadth-First (Tree)</option>
              <option value="circle">Circular</option>
            </select>
          </div>

          <button
            className="btn btn-secondary btn-sm"
            onClick={() => runLayout(activeLayout)}
            style={{
              background: '#1e293b',
              color: '#e2e8f0',
              borderColor: 'rgba(255, 255, 255, 0.15)',
            }}
            title="Auto-arrange connected nodes and minimize whitespace"
          >
            <Sparkles size={13} style={{ marginRight: 4, color: '#38bdf8' }} />
            Auto Layout
          </button>

          {/* Focus Selected */}
          {selectedNode && (
            <button
              className="btn btn-sm"
              onClick={focusSelected}
              style={{
                background: 'rgba(56, 189, 248, 0.2)',
                color: '#38bdf8',
                borderColor: '#38bdf8',
              }}
              title="Center and isolate selected entity with 1-hop & 2-hop neighborhood"
            >
              <Focus size={13} style={{ marginRight: 4 }} />
              Focus Selected
            </button>
          )}

          {/* Reset Focus */}
          {focusedNodeId && (
            <button
              className="btn btn-sm"
              onClick={resetFocus}
              style={{
                background: 'rgba(245, 158, 11, 0.18)',
                color: '#fbbf24',
                borderColor: 'rgba(245, 158, 11, 0.4)',
              }}
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
            style={!showLabels ? { background: '#1e293b', color: '#94a3b8', borderColor: 'rgba(255, 255, 255, 0.15)' } : {}}
            title="Show or hide entity names on canvas"
          >
            {showLabels ? <Eye size={13} /> : <EyeOff size={13} />}
            <span style={{ marginLeft: 4 }}>Labels</span>
          </button>

          {/* Edge Labels Toggle */}
          <button
            className={`btn btn-sm ${showEdgeLabels ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setShowEdgeLabels((v) => !v)}
            style={!showEdgeLabels ? { background: '#1e293b', color: '#94a3b8', borderColor: 'rgba(255, 255, 255, 0.15)' } : {}}
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
            style={!pathMode ? { background: '#1e293b', color: '#94a3b8', borderColor: 'rgba(255, 255, 255, 0.15)' } : {}}
            title="Trace shortest connection path between two nodes"
          >
            <GitBranch size={13} style={{ marginRight: 4 }} />
            Path Finder
          </button>

          {/* Viewport Zoom & Export Actions */}
          <div style={{ display: 'flex', gap: 2, marginLeft: 4 }}>
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => cyInstance.current?.zoom({ level: (cyInstance.current?.zoom() || 1) * 1.25 })}
              title="Zoom In"
              style={{ padding: '5px 8px', background: '#1e293b', color: '#e2e8f0', borderColor: 'rgba(255, 255, 255, 0.15)' }}
            >
              <ZoomIn size={14} />
            </button>
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => cyInstance.current?.zoom({ level: (cyInstance.current?.zoom() || 1) * 0.8 })}
              title="Zoom Out"
              style={{ padding: '5px 8px', background: '#1e293b', color: '#e2e8f0', borderColor: 'rgba(255, 255, 255, 0.15)' }}
            >
              <ZoomOut size={14} />
            </button>
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => cyInstance.current?.fit(undefined, 40)}
              title="Fit Entire Graph to View"
              style={{ padding: '5px 8px', background: '#1e293b', color: '#e2e8f0', borderColor: 'rgba(255, 255, 255, 0.15)' }}
            >
              <Maximize2 size={14} />
            </button>
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => loadNetwork()}
              title="Reload Network Data"
              style={{ padding: '5px 8px', background: '#1e293b', color: '#e2e8f0', borderColor: 'rgba(255, 255, 255, 0.15)' }}
            >
              <RefreshCw size={14} />
            </button>
            <button
              className="btn btn-secondary btn-sm"
              onClick={exportGraph}
              title="Export High-Res PNG"
              style={{ padding: '5px 8px', background: '#1e293b', color: '#e2e8f0', borderColor: 'rgba(255, 255, 255, 0.15)' }}
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
            background: searchFeedback.includes('not found') ? 'rgba(239, 68, 68, 0.15)' : 'rgba(56, 189, 248, 0.15)',
            border: `1px solid ${searchFeedback.includes('not found') ? 'rgba(239, 68, 68, 0.4)' : 'rgba(56, 189, 248, 0.4)'}`,
            borderRadius: 6,
            fontSize: '0.8rem',
            color: searchFeedback.includes('not found') ? '#fca5a5' : '#7dd3fc',
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
          background: 'rgba(15, 23, 42, 0.90)',
          backdropFilter: 'blur(8px)',
          padding: '6px 12px',
          borderRadius: 'var(--radius-sm)',
          border: '1px solid rgba(255, 255, 255, 0.10)',
          fontSize: '0.75rem',
        }}
      >
        <span style={{ fontWeight: 600, color: '#94a3b8', display: 'flex', alignItems: 'center', gap: 4, marginRight: 4 }}>
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
                border: `1px solid ${isHidden ? 'rgba(255, 255, 255, 0.1)' : `${color}80`}`,
                background: isHidden ? 'rgba(30, 41, 59, 0.4)' : `${color}20`,
                color: isHidden ? '#64748b' : '#f8fafc',
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
            style={{
              padding: '2px 8px',
              fontSize: '0.7rem',
              marginLeft: 'auto',
              background: '#1e293b',
              color: '#e2e8f0',
              borderColor: 'rgba(255, 255, 255, 0.15)',
            }}
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
            background: 'rgba(245, 158, 11, 0.12)',
            border: '1px solid rgba(245, 158, 11, 0.35)',
            borderRadius: 'var(--radius-sm)',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            flexWrap: 'wrap',
          }}
        >
          <GitBranch size={16} color="#fbbf24" />
          <span style={{ fontSize: '0.825rem', color: '#fef3c7' }}>
            <strong>Path Analysis:</strong> Click <strong>Source Node</strong>, then click <strong>Destination Node</strong> on the canvas to compute shortest connectivity path.
          </span>
          {pathNodes.map((n, i) => (
            <span
              key={i}
              style={{
                fontSize: '0.72rem',
                padding: '3px 8px',
                borderRadius: 4,
                background: i === 0 ? 'rgba(56, 189, 248, 0.2)' : 'rgba(245, 158, 11, 0.25)',
                color: i === 0 ? '#7dd3fc' : '#fde68a',
                border: `1px solid ${i === 0 ? '#38bdf8' : '#f59e0b'}`,
              }}
            >
              {i === 0 ? 'Source (A):' : 'Destination (B):'} {getNodeLabel(n)} ({n.nodeType})
            </span>
          ))}
          {pathNodes.length === 2 && (
            <button className="btn btn-primary btn-sm" onClick={findPath} disabled={pathLoading}>
              {pathLoading ? <Loader size={13} className="loading-spinner" /> : 'Trace Path'}
            </button>
          )}
          {pathResult && (
            <span style={{ fontSize: '0.78rem', fontWeight: 600, color: pathResult.length > 0 ? '#4ade80' : '#f87171' }}>
              {pathResult.length > 0 ? `✓ Connection Path Identified (${pathResult[0].length} hops)` : '✗ No connected path found'}
            </span>
          )}
        </div>
      )}

      {/* Main Canvas & Detail Sidebar Area */}
      <div style={{ flex: 1, display: 'flex', gap: 10, minHeight: 0 }}>
        {/* Canvas Container with Developer-Grade Dark Background */}
        <div
          className="graph-container"
          style={{
            flex: 1,
            position: 'relative',
            background: '#090d16',
            backgroundImage: 'radial-gradient(rgba(255, 255, 255, 0.08) 1px, transparent 1px)',
            backgroundSize: '24px 24px',
            border: '1px solid rgba(255, 255, 255, 0.12)',
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
                background: 'rgba(9, 13, 22, 0.85)',
                backdropFilter: 'blur(4px)',
                zIndex: 100,
              }}
            >
              <div className="loading-spinner" style={{ width: 36, height: 36, borderWidth: 3 }} />
              <span style={{ color: '#94a3b8', fontSize: '0.85rem' }}>
                Organizing network topology...
              </span>
            </div>
          )}

          <div ref={cyRef} style={{ width: '100%', height: '100%' }} />

          {/* Interactive Floating Hover Tooltip */}
          {hoverTooltip && hoverTooltip.node && (
            <div
              style={{
                position: 'fixed',
                left: hoverTooltip.x,
                top: hoverTooltip.y,
                transform: 'translate(-50%, -100%)',
                background: 'rgba(15, 23, 42, 0.96)',
                border: '1px solid rgba(56, 189, 248, 0.4)',
                borderRadius: 6,
                padding: '6px 10px',
                fontSize: '0.75rem',
                color: '#f8fafc',
                boxShadow: '0 8px 24px rgba(0, 0, 0, 0.5)',
                pointerEvents: 'none',
                zIndex: 2000,
                whiteSpace: 'nowrap',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                <span>{NODE_ICONS[hoverTooltip.node.nodeType]}</span>
                <strong style={{ color: '#38bdf8' }}>{hoverTooltip.node.nodeType}</strong>
                <span style={{ color: '#94a3b8', fontSize: '0.7rem' }}>
                  ({hoverTooltip.node.degree || 0} connections)
                </span>
              </div>
              <div style={{ fontWeight: 600, color: '#ffffff' }}>
                {getNodeFullLabel(hoverTooltip.node)}
              </div>
            </div>
          )}

          {/* Bottom Graph Stats & Neutral Analytics Disclaimer */}
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
                padding: '6px 14px',
                background: 'rgba(15, 23, 42, 0.92)',
                border: '1px solid rgba(255, 255, 255, 0.12)',
                borderRadius: 6,
                fontSize: '0.75rem',
                color: '#cbd5e1',
                boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
                pointerEvents: 'auto',
                display: 'flex',
                alignItems: 'center',
                gap: 10,
              }}
            >
              <span><strong style={{ color: '#f8fafc' }}>{nodeCount}</strong> Nodes</span>
              <span style={{ color: '#475569' }}>•</span>
              <span><strong style={{ color: '#f8fafc' }}>{edgeCount}</strong> Relationships</span>
              <span style={{ color: '#475569' }}>•</span>
              <span><strong style={{ color: '#f8fafc' }}>{componentCount}</strong> Clusters</span>
              {selectedNode && (
                <>
                  <span style={{ color: '#475569' }}>•</span>
                  <span style={{ color: '#38bdf8' }}>
                    Selected: <strong>{getNodeLabel(selectedNode)}</strong> ({selectedNode.degree || 0} direct connections{selectedNode.degree && selectedNode.degree >= 6 ? ' · High connectivity' : ''})
                  </span>
                </>
              )}
              {hiddenTypes.size > 0 && (
                <>
                  <span style={{ color: '#475569' }}>•</span>
                  <span style={{ color: '#f97316' }}>({hiddenTypes.size} Types Filtered)</span>
                </>
              )}
            </div>

            <div
              style={{
                padding: '5px 12px',
                background: 'rgba(15, 23, 42, 0.92)',
                border: '1px solid rgba(255, 255, 255, 0.12)',
                borderRadius: 6,
                fontSize: '0.72rem',
                color: '#94a3b8',
                pointerEvents: 'auto',
                boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              <ShieldCheck size={13} color="#94a3b8" />
              <span>Graph shows analytical relationships — not proof of wrongdoing</span>
            </div>
          </div>

          {/* Entity Type Legend Overlay (Top Left) */}
          <div
            style={{
              position: 'absolute',
              top: 12,
              left: 12,
              background: 'rgba(15, 23, 42, 0.92)',
              border: '1px solid rgba(255, 255, 255, 0.12)',
              borderRadius: 8,
              padding: '8px 12px',
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
              boxShadow: '0 4px 16px rgba(0, 0, 0, 0.3)',
              pointerEvents: 'auto',
              maxHeight: 220,
              overflowY: 'auto',
            }}
          >
            <span style={{ fontSize: '0.65rem', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Legend
            </span>
            {Object.entries(NODE_COLORS).map(([type, color]) => (
              <div
                key={type}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  fontSize: '0.72rem',
                  color: '#cbd5e1',
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
              <div
                style={{
                  background: 'rgba(15, 23, 42, 0.95)',
                  border: '1px solid rgba(255, 255, 255, 0.12)',
                  borderRadius: 'var(--radius-md)',
                  padding: 16,
                  boxShadow: '0 8px 24px rgba(0, 0, 0, 0.4)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 12 }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                      <span style={{ fontSize: '1.2rem' }}>{NODE_ICONS[selectedNode.nodeType]}</span>
                      <span
                        className="badge"
                        style={{
                          background: `${NODE_COLORS[selectedNode.nodeType]}25`,
                          color: NODE_COLORS[selectedNode.nodeType],
                          borderColor: `${NODE_COLORS[selectedNode.nodeType]}60`,
                          fontWeight: 700,
                        }}
                      >
                        {selectedNode.nodeType}
                      </span>
                      {selectedNode.isHighConnectivity && (
                        <span
                          style={{
                            fontSize: '0.65rem',
                            padding: '2px 6px',
                            borderRadius: 4,
                            background: 'rgba(56, 189, 248, 0.2)',
                            color: '#38bdf8',
                            border: '1px solid rgba(56, 189, 248, 0.4)',
                            fontWeight: 600,
                          }}
                        >
                          High connectivity
                        </span>
                      )}
                    </div>
                    <h3 style={{ fontSize: '1.05rem', fontWeight: 700, margin: 0, color: '#f8fafc', wordBreak: 'break-word' }}>
                      {getNodeFullLabel(selectedNode)}
                    </h3>
                  </div>

                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={resetFocus}
                    title="Close & Reset Focus"
                    style={{ color: '#94a3b8' }}
                  >
                    <X size={14} />
                  </button>
                </div>

                {/* Node Degree Metric */}
                <div
                  style={{
                    background: '#1e293b',
                    borderRadius: 6,
                    padding: '8px 12px',
                    fontSize: '0.75rem',
                    marginBottom: 12,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    border: '1px solid rgba(255, 255, 255, 0.08)',
                  }}
                >
                  <span style={{ color: '#94a3b8' }}>Network Connections:</span>
                  <strong style={{ color: '#38bdf8' }}>
                    {selectedNode.degree || 0} Incident Edges
                  </strong>
                </div>

                {/* Properties List */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 14 }}>
                  {Object.entries(selectedNode)
                    .filter(([k]) => !['id', 'nodeType', 'createdAt', 'degree', 'isHighConnectivity', 'fullLabel', 'label'].includes(k))
                    .filter(([, v]) => v !== null && v !== undefined && v !== '')
                    .map(([k, v]) => (
                      <div key={k} style={{ display: 'flex', gap: 8, fontSize: '0.78rem' }}>
                        <span style={{ color: '#94a3b8', textTransform: 'capitalize', width: 95, flexShrink: 0 }}>
                          {k.replace(/([A-Z])/g, ' $1').toLowerCase()}
                        </span>
                        <span style={{ color: '#e2e8f0', wordBreak: 'break-word', flex: 1 }}>
                          {String(v)}
                        </span>
                      </div>
                    ))}
                </div>

                {/* Focus, Expand & Profile Actions */}
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={focusSelected}
                    style={{ padding: '5px 10px', fontSize: '0.75rem' }}
                  >
                    <Focus size={12} style={{ marginRight: 4 }} /> Focus Selected
                  </button>
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={() => expandNode(selectedNode)}
                    style={{
                      padding: '5px 10px',
                      fontSize: '0.75rem',
                      background: '#1e293b',
                      color: '#e2e8f0',
                      borderColor: 'rgba(255, 255, 255, 0.15)',
                    }}
                  >
                    <ChevronRight size={12} /> Expand
                  </button>
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={resetFocus}
                    style={{
                      padding: '5px 10px',
                      fontSize: '0.75rem',
                      background: '#1e293b',
                      color: '#94a3b8',
                      borderColor: 'rgba(255, 255, 255, 0.15)',
                    }}
                  >
                    Reset
                  </button>
                  <a
                    href={`/entities/${selectedNode.nodeType}/${selectedNode.id}`}
                    className="btn btn-secondary btn-sm"
                    target="_blank"
                    rel="noreferrer"
                    style={{
                      padding: '5px 10px',
                      fontSize: '0.75rem',
                      background: '#1e293b',
                      color: '#e2e8f0',
                      borderColor: 'rgba(255, 255, 255, 0.15)',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 4,
                    }}
                  >
                    <Info size={12} /> Profile
                  </a>
                </div>
              </div>
            )}

            {/* Selected Edge Details Card */}
            {selectedEdge && (
              <div
                style={{
                  background: 'rgba(15, 23, 42, 0.95)',
                  border: '1px solid rgba(255, 255, 255, 0.12)',
                  borderRadius: 'var(--radius-md)',
                  padding: 16,
                  boxShadow: '0 8px 24px rgba(0, 0, 0, 0.4)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                  <span style={{ fontSize: '0.85rem', fontWeight: 700, color: '#f8fafc' }}>
                    Relationship Details
                  </span>
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => setSelectedEdge(null)}
                    style={{ color: '#94a3b8' }}
                  >
                    <X size={14} />
                  </button>
                </div>

                <div
                  style={{
                    padding: '8px 10px',
                    background: '#1e293b',
                    borderRadius: 6,
                    textAlign: 'center',
                    fontSize: '0.85rem',
                    fontWeight: 700,
                    color: '#38bdf8',
                    marginBottom: 10,
                    border: '1px solid rgba(56, 189, 248, 0.3)',
                  }}
                >
                  {selectedEdge.type?.replace(/_/g, ' ')}
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: '0.78rem' }}>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <span style={{ color: '#94a3b8', width: 90, flexShrink: 0 }}>Endpoints:</span>
                    <span style={{ color: '#e2e8f0', fontFamily: 'var(--font-mono)' }}>
                      {selectedEdge.source} {selectedEdge.hasDirection ? '→' : '—'} {selectedEdge.target}
                    </span>
                  </div>
                  {selectedEdge.confidence && (
                    <div style={{ display: 'flex', gap: 8 }}>
                      <span style={{ color: '#94a3b8', width: 90 }}>Confidence:</span>
                      <strong style={{ color: '#4ade80' }}>{Math.round(Number(selectedEdge.confidence) * 100)}%</strong>
                    </div>
                  )}
                  {selectedEdge.timestamp && (
                    <div style={{ display: 'flex', gap: 8 }}>
                      <span style={{ color: '#94a3b8', width: 90 }}>Timestamp:</span>
                      <span style={{ color: '#cbd5e1' }}>{new Date(selectedEdge.timestamp).toLocaleString()}</span>
                    </div>
                  )}
                  {selectedEdge.relSource && (
                    <div style={{ display: 'flex', gap: 8 }}>
                      <span style={{ color: '#94a3b8', width: 90 }}>Source:</span>
                      <span style={{ color: '#cbd5e1' }}>{selectedEdge.relSource}</span>
                    </div>
                  )}
                  {selectedEdge.recordRef && (
                    <div style={{ display: 'flex', gap: 8 }}>
                      <span style={{ color: '#94a3b8', width: 90 }}>Record Ref:</span>
                      <span style={{ fontFamily: 'var(--font-mono)', color: '#cbd5e1' }}>{selectedEdge.recordRef}</span>
                    </div>
                  )}
                </div>

                <div
                  style={{
                    marginTop: 12,
                    padding: '6px 10px',
                    borderRadius: 4,
                    background: 'rgba(255, 255, 255, 0.05)',
                    fontSize: '0.7rem',
                    color: '#94a3b8',
                  }}
                >
                  Relationship is extracted from verified telecom or case intelligence records.
                </div>
              </div>
            )}

            {/* Path Finder Sequence Card */}
            {pathResult && pathResult.length > 0 && (
              <div
                style={{
                  background: 'rgba(15, 23, 42, 0.95)',
                  border: '1px solid rgba(245, 158, 11, 0.35)',
                  borderRadius: 'var(--radius-md)',
                  padding: 16,
                  boxShadow: '0 8px 24px rgba(0, 0, 0, 0.4)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                  <span style={{ fontSize: '0.85rem', fontWeight: 700, color: '#fbbf24' }}>
                    Connectivity Path Sequence
                  </span>
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => { setPathResult(null); resetFocus(); }}
                    style={{ color: '#94a3b8' }}
                  >
                    <X size={14} />
                  </button>
                </div>

                {pathResult.map((path: any, i: number) => (
                  <div key={i}>
                    <div style={{ fontSize: '0.78rem', color: '#cbd5e1', marginBottom: 8 }}>
                      Distance: <strong style={{ color: '#fbbf24' }}>{path.length} hops</strong> ({path.nodes?.length || 0} entities)
                    </div>

                    {/* Step-by-step breadcrumb sequence */}
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
                                background: '#1e293b',
                                border: '1px solid #f59e0b',
                                borderRadius: 6,
                                fontSize: '0.78rem',
                              }}
                            >
                              <span style={{ fontSize: '0.7rem', color: '#fbbf24', fontWeight: 700 }}>#{j + 1}</span>
                              <span>{NODE_ICONS[n.nodeType]}</span>
                              <strong style={{ color: '#f8fafc' }}>{n.name || n.id}</strong>
                              <span
                                className="badge"
                                style={{
                                  fontSize: '0.62rem',
                                  background: `${NODE_COLORS[n.nodeType]}25`,
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
                                  color: '#fbbf24',
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

                    <div
                      style={{
                        padding: '6px 10px',
                        borderRadius: 4,
                        background: 'rgba(255, 255, 255, 0.05)',
                        fontSize: '0.7rem',
                        color: '#94a3b8',
                      }}
                    >
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
