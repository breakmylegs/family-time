-- The ledger is append-only (ADR 0012). Corrections are new entries that reverse an earlier one;
-- nothing may change or remove a row, whatever path the change comes from. The Besu indexer
-- (Phase 5) inserts rows with their block number; it never updates them either.
CREATE FUNCTION ledger_entries_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'the ledger is append-only: add a reversal instead' USING ERRCODE = 'P0001';
END
$$;
--> statement-breakpoint
CREATE TRIGGER ledger_entries_no_update_or_delete
  BEFORE UPDATE OR DELETE ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION ledger_entries_append_only();
--> statement-breakpoint
CREATE TRIGGER ledger_entries_no_truncate
  BEFORE TRUNCATE ON ledger_entries
  FOR EACH STATEMENT EXECUTE FUNCTION ledger_entries_append_only();
