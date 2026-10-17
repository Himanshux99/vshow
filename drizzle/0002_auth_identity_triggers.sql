-- Identity consistency between Better Auth's account record and Vshow's local user (auth_account.account_id
-- is the OIDC `sub`; app_user.vauth_subject is its denormalised copy). Enforced in the database so it holds
-- inside the same transaction as the insert, whatever application code does. Additive: nothing is removed.

-- 1. Linking a vauth account binds its subject to the local user. A conflict (the user is already bound to a
--    different subject) aborts the whole statement, and with it the surrounding transaction. A subject that
--    belongs to another user is rejected by app_user.vauth_subject's unique constraint (and by the account
--    table's own unique constraint). No subject value appears in the error text.
CREATE FUNCTION vshow_bind_vauth_subject() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.provider_id = 'voss' THEN
    UPDATE app_user
       SET vauth_subject = NEW.account_id
     WHERE id = NEW.user_id
       AND (vauth_subject IS NULL OR vauth_subject = NEW.account_id);
    IF NOT FOUND THEN
      RAISE EXCEPTION 'vauth identity conflict for local user' USING ERRCODE = '23505';
    END IF;
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER auth_account_bind_vauth_subject
  AFTER INSERT ON auth_account
  FOR EACH ROW EXECUTE FUNCTION vshow_bind_vauth_subject();
--> statement-breakpoint

-- 2. Once set, a local user's vauth subject can never be changed or cleared (an identity is never re-pointed).
CREATE FUNCTION vshow_protect_vauth_subject() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.vauth_subject IS NOT NULL AND NEW.vauth_subject IS DISTINCT FROM OLD.vauth_subject THEN
    RAISE EXCEPTION 'app_user.vauth_subject is immutable once set' USING ERRCODE = '23000';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER app_user_protect_vauth_subject
  BEFORE UPDATE OF vauth_subject ON app_user
  FOR EACH ROW EXECUTE FUNCTION vshow_protect_vauth_subject();
--> statement-breakpoint

-- 3. An account row's identity (who it belongs to, which provider, which subject) is immutable. Only
--    non-identity columns such as updated_at may change.
CREATE FUNCTION vshow_protect_account_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.provider_id IS DISTINCT FROM OLD.provider_id
     OR NEW.account_id IS DISTINCT FROM OLD.account_id THEN
    RAISE EXCEPTION 'auth_account identity is immutable' USING ERRCODE = '23000';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER auth_account_protect_identity
  BEFORE UPDATE ON auth_account
  FOR EACH ROW EXECUTE FUNCTION vshow_protect_account_identity();
