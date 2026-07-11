# AI categorization

Automated transaction categorization is not currently part of the product. The prior Eve task channel, workflow-run table, trace route, autonomous categorization tool, and Transactions-page entry points were removed.

Users can categorize transactions manually or ask Ask Penge to propose categorization changes. Ask Penge writes remain bound to an exact per-call Eve approval and the normal domain guards.

A future automated categorization feature should use a lightweight app-visible status row and cursor without mirroring Eve's event stream. It must keep model work outside Zero mutators, derive scope at an authenticated server boundary, require current categorization revisions, and preserve imported bank evidence.
