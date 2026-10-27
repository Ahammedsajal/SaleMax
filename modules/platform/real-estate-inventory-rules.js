'use strict';

// Shared lifecycle rules for the physical unit and its independent listings.
// These rules do not replace transactional locks or authorization in the service.
const UNIT_STATES = new Set(['available', 'reserved', 'rented', 'unavailable']);
const LISTING_STATES = new Set(['draft', 'review', 'active', 'paused', 'reserved', 'rented', 'expired', 'withdrawn']);

function fail(code) {
  throw Object.assign(new Error(code), { code, status: 409 });
}

function validateUnitState(state) {
  if (!UNIT_STATES.has(state)) fail('INVALID_UNIT_STATUS');
  return state;
}

function validateListingState(state) {
  if (!LISTING_STATES.has(state)) fail('INVALID_LISTING_STATUS');
  return state;
}

function listingStateForUnit(unitState, listingState) {
  validateUnitState(unitState);
  validateListingState(listingState);
  if (unitState === 'rented' && listingState === 'reserved') return 'rented';
  if (unitState === 'unavailable' && listingState === 'reserved') return 'paused';
  // Never automatically republish a previously paused or withdrawn listing.
  if (listingState !== 'active') return listingState;
  if (unitState === 'available') return listingState;
  if (unitState === 'reserved') return 'reserved';
  if (unitState === 'rented') return 'rented';
  return 'paused';
}

function assertListingCanActivate(unitState) {
  validateUnitState(unitState);
  if (unitState !== 'available') fail('UNIT_NOT_AVAILABLE');
}

module.exports = { validateUnitState, validateListingState, listingStateForUnit, assertListingCanActivate };
