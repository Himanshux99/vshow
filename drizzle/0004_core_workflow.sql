-- Core workflow foundation (Phase 1): immutable submission revisions, upload reservations, resubmission link,
-- reference codes, and database-level append-only / review / reservation guards. Additive, forward-only.
-- NOTE: review_decision.revision_id is NOT NULL with no default, so this migration FAILS (and changes nothing)
-- on a database that already holds review decisions. No such database exists yet; do not "fix" that by adding a
-- default: pre-existing decisions would have no revision to point at.

CREATE TABLE "reference_counter" (
	"year" integer PRIMARY KEY NOT NULL,
	"last_value" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "submission_revision" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"submission_id" uuid NOT NULL,
	"revision_number" integer NOT NULL,
	"title" varchar(200) NOT NULL,
	"description" text,
	"media_version_id" uuid NOT NULL,
	"requested_windows" jsonb NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "submission_revision_number_unique" UNIQUE("submission_id","revision_number"),
	CONSTRAINT "submission_revision_id_submission_unique" UNIQUE("id","submission_id"),
	CONSTRAINT "submission_revision_id_version_unique" UNIQUE("id","media_version_id"),
	CONSTRAINT "submission_revision_number_positive" CHECK ("submission_revision"."revision_number" >= 1),
	CONSTRAINT "submission_revision_windows_array" CHECK (jsonb_typeof("submission_revision"."requested_windows") = 'array')
);
--> statement-breakpoint
CREATE TABLE "upload_reservation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"submission_id" uuid NOT NULL,
	"staging_key" varchar(1024) NOT NULL,
	"final_key" varchar(1024) NOT NULL,
	"declared_content_type" varchar(150) NOT NULL,
	"declared_size_bytes" bigint NOT NULL,
	"original_filename" varchar(255) NOT NULL,
	"reserved_by_user_id" uuid NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"failure_reason" varchar(100),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"finalized_at" timestamp with time zone,
	CONSTRAINT "upload_reservation_staging_key_unique" UNIQUE("staging_key"),
	CONSTRAINT "upload_reservation_final_key_unique" UNIQUE("final_key"),
	CONSTRAINT "upload_reservation_status_valid" CHECK ("status" IN ('PENDING', 'FINALIZED', 'REJECTED', 'EXPIRED')),
	CONSTRAINT "upload_reservation_size_positive" CHECK ("upload_reservation"."declared_size_bytes" > 0),
	CONSTRAINT "upload_reservation_expiry_after_creation" CHECK ("upload_reservation"."expires_at" > "upload_reservation"."created_at")
);
--> statement-breakpoint
ALTER TABLE "review_decision" DROP CONSTRAINT "review_decision_changes_need_comment";--> statement-breakpoint
ALTER TABLE "media_version" ADD COLUMN "storage_etag" varchar(128);--> statement-breakpoint
ALTER TABLE "submission" ADD COLUMN "current_revision_id" uuid;--> statement-breakpoint
ALTER TABLE "submission" ADD COLUMN "resubmission_of_id" uuid;--> statement-breakpoint
ALTER TABLE "review_decision" ADD COLUMN "revision_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "submission_revision" ADD CONSTRAINT "submission_revision_submission_id_submission_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."submission"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submission_revision" ADD CONSTRAINT "submission_revision_created_by_user_id_app_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submission_revision" ADD CONSTRAINT "submission_revision_version_fk" FOREIGN KEY ("media_version_id","submission_id") REFERENCES "public"."media_version"("id","submission_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upload_reservation" ADD CONSTRAINT "upload_reservation_submission_id_submission_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."submission"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upload_reservation" ADD CONSTRAINT "upload_reservation_reserved_by_user_id_app_user_id_fk" FOREIGN KEY ("reserved_by_user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "submission_revision_submission_number_idx" ON "submission_revision" USING btree ("submission_id","revision_number" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "upload_reservation_submission_status_idx" ON "upload_reservation" USING btree ("submission_id","status");--> statement-breakpoint
ALTER TABLE "submission" ADD CONSTRAINT "submission_current_revision_fk" FOREIGN KEY ("current_revision_id","id") REFERENCES "public"."submission_revision"("id","submission_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submission" ADD CONSTRAINT "submission_resubmission_of_fk" FOREIGN KEY ("resubmission_of_id") REFERENCES "public"."submission"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_decision" ADD CONSTRAINT "review_decision_revision_fk" FOREIGN KEY ("revision_id","submission_id") REFERENCES "public"."submission_revision"("id","submission_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_decision" ADD CONSTRAINT "review_decision_revision_version_fk" FOREIGN KEY ("revision_id","media_version_id") REFERENCES "public"."submission_revision"("id","media_version_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "submission_resubmission_of_idx" ON "submission" USING btree ("resubmission_of_id");--> statement-breakpoint
CREATE INDEX "review_decision_revision_created_idx" ON "review_decision" USING btree ("revision_id","created_at" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE "submission" ADD CONSTRAINT "submission_resubmission_not_self" CHECK ("submission"."resubmission_of_id" IS NULL OR "submission"."resubmission_of_id" <> "submission"."id");--> statement-breakpoint
ALTER TABLE "review_decision" ADD CONSTRAINT "review_decision_reason_required" CHECK ("review_decision"."decision" NOT IN ('CHANGES_REQUESTED', 'REJECTED') OR ("review_decision"."comment" IS NOT NULL AND btrim("review_decision"."comment") <> ''));


--> statement-breakpoint
-- ---------------------------------------------------------------------------------------------------------
-- Integrity enforced in the database, so it holds whatever application code (or a future bug) does.

-- 1. Append-only history. Media versions, review decisions, audit events and submission revisions can be INSERTED
--    but never updated or deleted. (Corrections are new rows; nothing is silently rewritten.)
CREATE FUNCTION vshow_forbid_modification() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only: a % is not allowed', TG_TABLE_NAME, lower(TG_OP) USING ERRCODE = '23000';
END
$$;
--> statement-breakpoint
CREATE TRIGGER media_version_append_only BEFORE UPDATE OR DELETE ON media_version
  FOR EACH ROW EXECUTE FUNCTION vshow_forbid_modification();
--> statement-breakpoint
CREATE TRIGGER review_decision_append_only BEFORE UPDATE OR DELETE ON review_decision
  FOR EACH ROW EXECUTE FUNCTION vshow_forbid_modification();
--> statement-breakpoint
CREATE TRIGGER audit_event_append_only BEFORE UPDATE OR DELETE ON audit_event
  FOR EACH ROW EXECUTE FUNCTION vshow_forbid_modification();
--> statement-breakpoint
CREATE TRIGGER submission_revision_append_only BEFORE UPDATE OR DELETE ON submission_revision
  FOR EACH ROW EXECUTE FUNCTION vshow_forbid_modification();
--> statement-breakpoint

-- 2. A review decision may only be recorded for the submission's CURRENT revision while it is PENDING_REVIEW, and
--    never by the person who created the submission. (The application checks the same under a row lock; this is the
--    backstop that makes a stale approval or a self-approval impossible even if that check had a bug.)
CREATE FUNCTION vshow_guard_review_decision() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  s record;
BEGIN
  SELECT current_revision_id, created_by_user_id, workflow_status INTO s FROM submission WHERE id = NEW.submission_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'review decision refers to an unknown submission' USING ERRCODE = '23000';
  END IF;
  IF s.workflow_status <> 'PENDING_REVIEW' THEN
    RAISE EXCEPTION 'only a submission pending review can be decided' USING ERRCODE = '23000';
  END IF;
  IF NEW.revision_id IS DISTINCT FROM s.current_revision_id THEN
    RAISE EXCEPTION 'a review decision must reference the current revision' USING ERRCODE = '23000';
  END IF;
  IF NEW.reviewer_user_id = s.created_by_user_id THEN
    RAISE EXCEPTION 'a reviewer cannot decide on their own submission' USING ERRCODE = '23000';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER review_decision_guard BEFORE INSERT ON review_decision
  FOR EACH ROW EXECUTE FUNCTION vshow_guard_review_decision();
--> statement-breakpoint

-- 3. An upload reservation is finished once it leaves PENDING: it can never be finalized twice, revived, or deleted.
CREATE FUNCTION vshow_guard_upload_reservation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'upload_reservation rows cannot be deleted' USING ERRCODE = '23000';
  END IF;
  IF OLD.status <> 'PENDING' THEN
    RAISE EXCEPTION 'a finished upload reservation cannot change' USING ERRCODE = '23000';
  END IF;
  IF NEW.id <> OLD.id OR NEW.submission_id <> OLD.submission_id OR NEW.staging_key <> OLD.staging_key
     OR NEW.final_key <> OLD.final_key OR NEW.declared_content_type <> OLD.declared_content_type
     OR NEW.declared_size_bytes <> OLD.declared_size_bytes OR NEW.reserved_by_user_id <> OLD.reserved_by_user_id THEN
    RAISE EXCEPTION 'an upload reservation''s identity is immutable' USING ERRCODE = '23000';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER upload_reservation_guard BEFORE UPDATE OR DELETE ON upload_reservation
  FOR EACH ROW EXECUTE FUNCTION vshow_guard_upload_reservation();
--> statement-breakpoint

-- 4. Reference codes VS-YYYY-NNNNNN. One counter row per year; the upsert takes a row lock, so concurrent
--    submissions are serialised and can never receive the same number. The number is returned inside the caller's
--    transaction: if that transaction rolls back, the number is not consumed.
CREATE FUNCTION vshow_next_reference_code(p_year integer) RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  n integer;
BEGIN
  INSERT INTO reference_counter (year, last_value) VALUES (p_year, 1)
  ON CONFLICT (year) DO UPDATE SET last_value = reference_counter.last_value + 1
  RETURNING last_value INTO n;
  RETURN 'VS-' || p_year::text || '-' || lpad(n::text, 6, '0');
END
$$;
