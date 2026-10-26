-- Database-level guards the brief asks for (Part 8), so no code path, script or hand-typed SQL
-- can get round them.

-- The last active owner of a household can never be deleted, demoted or deactivated.
CREATE FUNCTION protect_last_owner() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.role = 'owner' AND OLD.active AND (
       TG_OP = 'DELETE'
       OR (TG_OP = 'UPDATE' AND (NEW.role <> 'owner' OR NOT NEW.active))
     ) THEN
    -- Serialise owner changes per household, so two owners demoting each other at once cannot
    -- both pass the check below.
    PERFORM pg_advisory_xact_lock(hashtext('owners:' || OLD.household_id::text));
    IF NOT EXISTS (
      SELECT 1 FROM people
      WHERE household_id = OLD.household_id AND role = 'owner' AND active AND id <> OLD.id
    ) THEN
      RAISE EXCEPTION 'the last owner of a household cannot be removed, demoted or deactivated'
        USING ERRCODE = 'P0001';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER people_protect_last_owner
  BEFORE UPDATE OR DELETE ON people
  FOR EACH ROW EXECUTE FUNCTION protect_last_owner();
--> statement-breakpoint

-- Audit events are append-only. Retention (Phase 8) will get its own narrowly scoped function.
CREATE FUNCTION audit_events_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit events are append-only' USING ERRCODE = 'P0001';
END
$$;
--> statement-breakpoint
CREATE TRIGGER audit_events_no_update_or_delete
  BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION audit_events_append_only();
--> statement-breakpoint
CREATE TRIGGER audit_events_no_truncate
  BEFORE TRUNCATE ON audit_events
  FOR EACH STATEMENT EXECUTE FUNCTION audit_events_append_only();
