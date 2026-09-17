import type { Stylesheet, NodeSingular } from 'cytoscape';

export const NODE_COLORS: Record<string, string> = {
  Person: '#2563eb', // Blue
  Phone: '#16a34a', // Green
  Vehicle: '#ea580c', // Orange
  Organization: '#7c3aed', // Purple
  Location: '#dc2626', // Red
  Account: '#ca8a04', // Amber/Yellow
  Case: '#0891b2', // Cyan
  Event: '#db2777', // Pink
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

// Calculate node size based on degree of connectivity (clamp between 32px and 54px)
export function getNodeSize(ele: NodeSingular): number {
  const degree = ele.degree ? ele.degree() : (ele.data('degree') || 1);
  return Math.min(54, Math.max(32, 32 + degree * 2.2));
}

// Generate Cytoscape Stylesheet with dynamic label visibility & high-contrast outlines
export function getGraphStylesheet(showLabels: boolean = true, showEdgeLabels: boolean = false): Stylesheet[] {
  return [
    // Base Node Style
    {
      selector: 'node',
      style: {
        'background-color': (ele: NodeSingular) => NODE_COLORS[ele.data('nodeType')] || '#64748b',
        'shape': (ele: NodeSingular) => (NODE_SHAPES[ele.data('nodeType')] || 'ellipse') as any,
        'width': (ele: NodeSingular) => getNodeSize(ele),
        'height': (ele: NodeSingular) => getNodeSize(ele),
        'label': showLabels ? 'data(label)' : '',
        'color': '#0f172a',
        'font-size': '11px',
        'font-family': 'Inter, -apple-system, BlinkMacSystemFont, sans-serif',
        'font-weight': '600',
        'text-valign': 'bottom',
        'text-halign': 'center',
        'text-margin-y': 5,
        'text-max-width': '95px',
        'text-wrap': 'ellipsis',
        'text-outline-color': '#ffffff',
        'text-outline-width': 2.5,
        'text-outline-opacity': 1,
        'border-width': 2.5,
        'border-color': '#ffffff',
        'border-opacity': 1,
        'transition-property': 'background-color, border-color, border-width, width, height, opacity',
        'transition-duration': 200,
        'cursor': 'pointer',
      },
    },

    // High Connectivity Node Badge / Border (Degree >= 6)
    {
      selector: 'node[degree >= 6]',
      style: {
        'border-width': 3.5,
        'border-color': '#ffffff',
      },
    },

    // Selected Node Style (Focus Ring)
    {
      selector: 'node:selected, node.selected-node',
      style: {
        'border-width': 4.5,
        'border-color': '#0f172a',
        'width': (ele: NodeSingular) => getNodeSize(ele) + 8,
        'height': (ele: NodeSingular) => getNodeSize(ele) + 8,
        'font-size': '13px',
        'font-weight': '700',
        'text-outline-width': 3,
        'z-index': 999,
        'opacity': 1,
      },
    },

    // Highlighted / Focused Node Style
    {
      selector: 'node.highlighted',
      style: {
        'opacity': 1,
        'border-width': 3.5,
        'border-color': '#0f172a',
        'z-index': 100,
      },
    },

    // Path Highlight Node Style
    {
      selector: 'node.path-highlight',
      style: {
        'border-width': 4.5,
        'border-color': '#f59e0b',
        'background-color': '#f59e0b',
        'color': '#92400e',
        'font-weight': '700',
        'font-size': '12px',
        'text-outline-color': '#ffffff',
        'text-outline-width': 3,
        'z-index': 500,
        'opacity': 1,
      },
    },

    // Dimmed / Muted Node Style
    {
      selector: 'node.dimmed',
      style: {
        'opacity': 0.15,
        'label': '',
      },
    },

    // Base Edge Style
    {
      selector: 'edge',
      style: {
        'width': 1.6,
        'line-color': '#94a3b8',
        'target-arrow-color': '#94a3b8',
        'target-arrow-shape': 'triangle',
        'arrow-scale': 0.85,
        'curve-style': 'bezier',
        'label': showEdgeLabels ? 'data(label)' : '',
        'color': '#475569',
        'font-size': '9px',
        'font-weight': '600',
        'text-background-color': '#ffffff',
        'text-background-opacity': 0.92,
        'text-background-padding': '2px',
        'edge-text-rotation': 'autorotate',
        'opacity': 0.55,
        'transition-property': 'line-color, width, opacity',
        'transition-duration': 200,
      },
    },

    // Edge Hover Style
    {
      selector: 'edge:hover',
      style: {
        'width': 2.5,
        'line-color': '#2563eb',
        'target-arrow-color': '#2563eb',
        'opacity': 0.9,
        'label': 'data(label)',
        'z-index': 50,
      },
    },

    // Edge Selected Style
    {
      selector: 'edge:selected',
      style: {
        'line-color': '#2563eb',
        'target-arrow-color': '#2563eb',
        'width': 3,
        'opacity': 1,
        'label': 'data(label)',
        'z-index': 100,
      },
    },

    // Edge Highlighted Style (Connecting to Selected/Focused Node)
    {
      selector: 'edge.highlighted',
      style: {
        'line-color': '#2563eb',
        'target-arrow-color': '#2563eb',
        'width': 2.5,
        'opacity': 1,
        'label': 'data(label)',
        'z-index': 80,
      },
    },

    // Edge Path Highlight Style
    {
      selector: 'edge.path-highlight',
      style: {
        'line-color': '#f59e0b',
        'target-arrow-color': '#f59e0b',
        'width': 3.5,
        'opacity': 1,
        'label': 'data(label)',
        'z-index': 500,
      },
    },

    // Dimmed Edge Style
    {
      selector: 'edge.dimmed',
      style: {
        'opacity': 0.08,
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
        idealEdgeLength: 80,
        edgeElasticity: 0.45,
        nodeRepulsion: 5500,
        gravity: 0.35,
        numIter: 2500,
        tile: true,
        tilingPaddingVertical: 30,
        tilingPaddingHorizontal: 30,
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
        componentSpacing: 80,
        nodeRepulsion: () => 6000,
        idealEdgeLength: () => 85,
        edgeElasticity: () => 100,
        gravity: 0.3,
        numIter: 1000,
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
        minNodeSpacing: 50,
      };

    case 'breadthfirst':
      return {
        name: 'breadthfirst',
        fit: true,
        directed: true,
        padding: 40,
        animate: true,
        animationDuration: 600,
        spacingFactor: 1.25,
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
