-- Audit retention (Phase 8, ADR 0017). Audit events stay append-only, with one narrow exception:
-- the retention sweep may delete rows more than two years old, and only inside a transaction that
-- sets family_time.retention to 'on'. Updates and truncation are still refused. The function is
-- replaced in place, so the triggers from 0002 keep pointing at it and the previous image still runs.
CREATE OR REPLACE FUNCTION audit_events_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE'
     AND current_setting('family_time.retention', true) = 'on'
     AND OLD.at < now() - interval '730 days' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'audit events are append-only' USING ERRCODE = 'P0001';
END
$$;
