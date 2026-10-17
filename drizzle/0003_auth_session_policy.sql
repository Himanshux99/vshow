-- Session policy enforced in the database, so it holds whatever application code (or a future bug) does.
-- Additive: creates functions and triggers only.

-- 1. Absolute session lifetime: a session can never expire later than 30 days after it was CREATED, however
--    often Better Auth's sliding refresh extends it. created_at itself can never be changed.
CREATE FUNCTION vshow_cap_session_lifetime() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'auth_session.created_at is immutable' USING ERRCODE = '23000';
  END IF;
  NEW.expires_at := LEAST(NEW.expires_at, NEW.created_at + interval '30 days');
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER auth_session_cap_lifetime
  BEFORE INSERT OR UPDATE ON auth_session
  FOR EACH ROW EXECUTE FUNCTION vshow_cap_session_lifetime();
--> statement-breakpoint

-- 2. Deactivating a user ends all of their sessions immediately (they are expired, so Better Auth rejects
--    them). Reactivation does not resurrect them: the user signs in again.
CREATE FUNCTION vshow_expire_sessions_on_deactivation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE auth_session
     SET expires_at = LEAST(expires_at, now() - interval '1 second')
   WHERE user_id = NEW.id;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER app_user_expire_sessions_on_deactivation
  AFTER UPDATE OF is_active ON app_user
  FOR EACH ROW
  WHEN (OLD.is_active AND NOT NEW.is_active)
  EXECUTE FUNCTION vshow_expire_sessions_on_deactivation();
