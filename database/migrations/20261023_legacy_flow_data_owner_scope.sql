-- Keep existing Flow Builder state owner-scoped and index the composite lookup.
ALTER TABLE flow_data
  ADD KEY idx_flow_data_owner_unique (uid(191), uniqueId(191));
