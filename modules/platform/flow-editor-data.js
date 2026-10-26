'use strict';

// Older generated graphs may have execution data but no canvas coordinates.
// Repair the API representation without changing persisted workflow behavior.
function normalizeFlowEditorData(value) {
  const graph = typeof value === 'string' ? JSON.parse(value) : value;
  if (!graph || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) throw new Error('INVALID_FLOW_GRAPH');
  const nodes = graph.nodes.map((node, index) => {
    if (!node || typeof node.id !== 'string') throw new Error('INVALID_FLOW_NODE');
    const valid = Number.isFinite(node.position?.x) && Number.isFinite(node.position?.y);
    if (valid) return node;
    const priorEdge = graph.edges.find(edge => edge.target === node.id);
    const prior = graph.nodes.find(item => item.id === priorEdge?.source && Number.isFinite(item.position?.x) && Number.isFinite(item.position?.y));
    return { ...node, position: { x: prior ? prior.position.x + 360 : (index % 6) * 380, y: prior ? prior.position.y + 240 : Math.floor(index / 6) * 300 } };
  });
  return { ...graph, nodes };
}
module.exports = { normalizeFlowEditorData };
