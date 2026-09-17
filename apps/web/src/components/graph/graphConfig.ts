import type { Stylesheet, NodeSingular, EdgeSingular } from 'cytoscape';

export const NODE_COLORS: Record<string, string> = {
  Person: '#3b82f6', // Blue
  Phone: '#10b981', // Emerald Green
  Vehicle: '#f97316', // Orange
  Organization: '#8b5cf6', // Violet / Purple
  Location: '#ef4444', // Crimson / Red
  Account: '#eab308', // Amber / Gold
  Case: '#06b6d4', // Cyan
  Event: '#ec4899', // Rose / Pink
};

export const NODE_SHAPES: Record<string, string> = {
  Person: 'ellipse',
  Phone: 'round-rectangle',
  Vehicle: 'diamond',
  Organization: 'hexagon',
  Location: 'octagon',
  Account: 'rectangle',
  Case: 'cut-rectangle',
  Event: 'vee',
};

export const NODE_ICONS: Record<string, string> = {
  Person: '👤',
  Phone: '📱',
  Vehicle: '🚗',
  Organization: '🏢',
  Location: '📍',
  Account: '💳',
  Case: '📋',
  Event: '📅',
};

// Calculate node size based strictly on degree of connectivity (clamped between 34px and 58px)
// Neutral analytical sizing — NEVER represents guilt, criminality, or risk
export function getNodeSize(ele: NodeSingular): number {
  const degree = ele.degree ? ele.degree() : (ele.data('degree') || 1);
  return Math.min(58, Math.max(34, 34 + Math.min(degree, 10) * 2.4));
}

// Generate Cytoscape Stylesheet with high-contrast dark theme and readable typography
export function getGraphStylesheet(showLabels: boolean = true, showEdgeLabels: boolean = false): Stylesheet[] {
  return [
    // Base Node Style (Professional Dark Theme)
    {
      selector: 'node',
      style: {
        'background-color': (ele: NodeSingular) => NODE_COLORS[ele.data('nodeType')] || '#64748b',
        'shape': (ele: NodeSingular) => (NODE_SHAPES[ele.data('nodeType')] || 'ellipse') as any,
        'width': (ele: NodeSingular) => getNodeSize(ele),
        'height': (ele: NodeSingular) => getNodeSize(ele),
        'label': showLabels ? 'data(label)' : '',
        'color': '#f8fafc',
        'font-size': '11px',
        'font-family': 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        'font-weight': '600',
        'text-valign': 'bottom',
        'text-halign': 'center',
        'text-margin-y': 6,
        'text-max-width': '105px',
        'text-wrap': 'ellipsis',
        'text-outline-color': '#090d16',
        'text-outline-width': 3,
        'text-outline-opacity': 0.95,
        'border-width': 2.5,
        'border-color': 'rgba(255, 255, 255, 0.85)',
        'border-opacity': 0.9,
        'transition-property': 'background-color, border-color, border-width, width, height, opacity',
        'transition-duration': 200,
        'cursor': 'pointer',
      },
    },

    // High Connectivity Node Badge / Border (Degree >= 6) — Neutral Analytical Terminology
    {
      selector: 'node[degree >= 6]',
      style: {
        'border-width': 3.5,
        'border-color': '#ffffff',
        'border-opacity': 1,
      },
    },

    // Selected Node Style (Visual Center & Glowing Focus Ring)
    {
      selector: 'node:selected, node.selected-node',
      style: {
        'border-width': 4.5,
        'border-color': '#38bdf8',
        'width': (ele: NodeSingular) => getNodeSize(ele) + 8,
        'height': (ele: NodeSingular) => getNodeSize(ele) + 8,
        'font-size': '13px',
        'font-weight': '700',
        'color': '#ffffff',
        'text-outline-color': '#0369a1',
        'text-outline-width': 3.5,
        'z-index': 999,
        'opacity': 1,
      },
    },

    // Hop-1 Direct Neighbors Style (Focus Mode)
    {
      selector: 'node.hop-1',
      style: {
        'opacity': 1,
        'border-width': 3,
        'border-color': '#60a5fa',
        'z-index': 150,
      },
    },

    // Hop-2 Related Nodes Style (Focus Mode)
    {
      selector: 'node.hop-2',
      style: {
        'opacity': 0.85,
        'border-width': 2,
        'border-color': 'rgba(255, 255, 255, 0.45)',
        'z-index': 100,
      },
    },

    // Highlighted Node Style (Generic)
    {
      selector: 'node.highlighted',
      style: {
        'opacity': 1,
        'border-width': 3.5,
        'border-color': '#38bdf8',
        'z-index': 120,
      },
    },

    // Path Highlight Node Style
    {
      selector: 'node.path-highlight',
      style: {
        'border-width': 4.5,
        'border-color': '#fbbf24',
        'background-color': '#f59e0b',
        'color': '#ffffff',
        'font-weight': '700',
        'font-size': '12px',
        'text-outline-color': '#78350f',
        'text-outline-width': 3.5,
        'z-index': 500,
        'opacity': 1,
      },
    },

    // Dimmed / Muted Node Style
    {
      selector: 'node.dimmed',
      style: {
        'opacity': 0.10,
        'label': '',
      },
    },

    // Node Hover State (Full Label Inspection)
    {
      selector: 'node:hover',
      style: {
        'label': 'data(fullLabel)',
        'text-max-width': '220px',
        'text-wrap': 'wrap',
        'font-size': '12px',
        'z-index': 1000,
      },
    },

    // Base Edge Style (Clean, Visible, Connected)
    {
      selector: 'edge',
      style: {
        'width': 2,
        'line-color': '#64748b',
        'target-arrow-color': '#64748b',
        'target-arrow-shape': (ele: EdgeSingular) => (ele.data('hasDirection') ? 'triangle' : 'none'),
        'arrow-scale': 0.8,
        'curve-style': 'bezier',
        'label': showEdgeLabels ? 'data(label)' : '',
        'color': '#cbd5e1',
        'font-size': '9px',
        'font-weight': '600',
        'text-background-color': '#0f172a',
        'text-background-opacity': 0.92,
        'text-background-padding': '2px',
        'edge-text-rotation': 'autorotate',
        'opacity': 0.65,
        'transition-property': 'line-color, target-arrow-color, width, opacity',
        'transition-duration': 200,
      },
    },

    // Edge Hover Style
    {
      selector: 'edge:hover',
      style: {
        'width': 3.2,
        'line-color': '#38bdf8',
        'target-arrow-color': '#38bdf8',
        'opacity': 1,
        'label': 'data(label)',
        'z-index': 50,
      },
    },

    // Edge Selected Style
    {
      selector: 'edge:selected',
      style: {
        'line-color': '#38bdf8',
        'target-arrow-color': '#38bdf8',
        'width': 3.5,
        'opacity': 1,
        'label': 'data(label)',
        'z-index': 100,
      },
    },

    // Hop-1 / Primary Highlighted Edge
    {
      selector: 'edge.highlighted, edge.hop-1-edge',
      style: {
        'line-color': '#38bdf8',
        'target-arrow-color': '#38bdf8',
        'width': 3,
        'opacity': 0.95,
        'label': showEdgeLabels ? 'data(label)' : '',
        'z-index': 80,
      },
    },

    // Hop-2 / Secondary Highlighted Edge
    {
      selector: 'edge.hop-2-edge',
      style: {
        'line-color': '#93c5fd',
        'target-arrow-color': '#93c5fd',
        'width': 2,
        'opacity': 0.6,
        'z-index': 60,
      },
    },

    // Edge Path Highlight Style
    {
      selector: 'edge.path-highlight',
      style: {
        'line-color': '#fbbf24',
        'target-arrow-color': '#fbbf24',
        'width': 4,
        'opacity': 1,
        'label': 'data(label)',
        'z-index': 500,
      },
    },

    // Dimmed Edge Style
    {
      selector: 'edge.dimmed',
      style: {
        'opacity': 0.06,
        'label': '',
      },
    },
  ];
}

// Layout Configuration Presets
export function getLayoutConfig(layoutName: string) {
  switch (layoutName) {
    case 'cose-bilkent':
    default:
      return {
        name: 'cose-bilkent',
        refresh: 30,
        fit: true,
        padding: 40,
        randomize: false,
        nodeDimensionsIncludeLabels: true,
        idealEdgeLength: 65,
        edgeElasticity: 0.65,
        nodeRepulsion: 4500,
        gravity: 0.4,
        numIter: 2500,
        tile: true,
        tilingPaddingVertical: 20,
        tilingPaddingHorizontal: 20,
        gravityRangeCompound: 1.5,
        gravityCompound: 1.0,
        gravityRange: 3.8,
        initialEnergyOnIncremental: 0.5,
      };

    case 'cose':
      return {
        name: 'cose',
        animate: true,
        animationDuration: 700,
        fit: true,
        padding: 40,
        componentSpacing: 60,
        nodeRepulsion: () => 4500,
        idealEdgeLength: () => 70,
        edgeElasticity: () => 120,
        gravity: 0.35,
        numIter: 1200,
      };

    case 'concentric':
      return {
        name: 'concentric',
        fit: true,
        padding: 50,
        animate: true,
        animationDuration: 600,
        concentric: (node: NodeSingular) => {
          return node.degree ? node.degree() : 1;
        },
        levelWidth: () => 2,
        minNodeSpacing: 45,
      };

    case 'breadthfirst':
      return {
        name: 'breadthfirst',
        fit: true,
        directed: true,
        padding: 40,
        animate: true,
        animationDuration: 600,
        spacingFactor: 1.15,
      };

    case 'circle':
      return {
        name: 'circle',
        fit: true,
        padding: 40,
        animate: true,
        animationDuration: 600,
      };
  }
}
