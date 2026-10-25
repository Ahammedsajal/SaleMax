'use strict';

function conditionEdge(edges, sourceNodeId, sourceHandle) {
  return (edges || []).find(edge => edge.source === sourceNodeId && edge.sourceHandle === sourceHandle) || null;
}

module.exports = { conditionEdge };
