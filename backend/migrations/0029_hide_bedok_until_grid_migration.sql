-- Keep Bedok out of Grid's operational outlet list and all-outlet analytics
-- until its planned Grid POS migration.  The UUID targets only HAC Bedok;
-- explicitly querying historical records remains possible for reconciliation.
UPDATE outlets
SET is_hidden = true
WHERE id = '2b029d9a-cc3c-4c29-8993-c1688a309a29';
