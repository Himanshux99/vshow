CREATE TABLE "app_role" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" varchar(100) NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "app_role_code_unique" UNIQUE("code"),
	CONSTRAINT "app_role_code_valid" CHECK ("code" IN ('CONVENER', 'REVIEWER', 'SERVER_ROOM_MANAGER', 'ADMIN'))
);
--> statement-breakpoint
CREATE TABLE "app_user" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(320) NOT NULL,
	"display_name" varchar(200) NOT NULL,
	"vauth_subject" varchar(255),
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "app_user_email_unique" UNIQUE("email"),
	CONSTRAINT "app_user_vauth_subject_unique" UNIQUE("vauth_subject"),
	CONSTRAINT "app_user_email_normalized" CHECK ("app_user"."email" = lower(btrim("app_user"."email")))
);
--> statement-breakpoint
CREATE TABLE "user_role" (
	"user_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	"assigned_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_role_user_id_role_id_pk" PRIMARY KEY("user_id","role_id")
);
--> statement-breakpoint
CREATE TABLE "committee" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(200) NOT NULL,
	"code" varchar(80) NOT NULL,
	"description" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "committee_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "committee_membership" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"committee_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"membership_type" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"assigned_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "committee_membership_committee_user_unique" UNIQUE("committee_id","user_id"),
	CONSTRAINT "committee_membership_type_valid" CHECK ("membership_type" IN ('CONVENER', 'MEMBER'))
);
--> statement-breakpoint
CREATE TABLE "screen" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(200) NOT NULL,
	"code" varchar(80) NOT NULL,
	"location_description" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"external_player_ref" varchar(255),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "screen_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "media_version" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"submission_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"object_key" varchar(1024) NOT NULL,
	"original_filename" varchar(255) NOT NULL,
	"content_type" varchar(150) NOT NULL,
	"size_bytes" bigint NOT NULL,
	"checksum_sha256" varchar(64),
	"uploaded_by_user_id" uuid NOT NULL,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"change_note" text,
	CONSTRAINT "media_version_object_key_unique" UNIQUE("object_key"),
	CONSTRAINT "media_version_submission_number_unique" UNIQUE("submission_id","version_number"),
	CONSTRAINT "media_version_id_submission_unique" UNIQUE("id","submission_id"),
	CONSTRAINT "media_version_size_positive" CHECK ("media_version"."size_bytes" > 0),
	CONSTRAINT "media_version_number_positive" CHECK ("media_version"."version_number" >= 1)
);
--> statement-breakpoint
CREATE TABLE "screen_request" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"submission_id" uuid NOT NULL,
	"screen_id" uuid NOT NULL,
	"slot_number" integer DEFAULT 1 NOT NULL,
	"preferred_start_at" timestamp with time zone,
	"preferred_end_at" timestamp with time zone,
	"request_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "screen_request_submission_screen_slot_unique" UNIQUE("submission_id","screen_id","slot_number"),
	CONSTRAINT "screen_request_slot_positive" CHECK ("screen_request"."slot_number" >= 1),
	CONSTRAINT "screen_request_window_valid" CHECK ("screen_request"."preferred_start_at" IS NULL OR "screen_request"."preferred_end_at" IS NULL OR "screen_request"."preferred_end_at" > "screen_request"."preferred_start_at")
);
--> statement-breakpoint
CREATE TABLE "submission" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reference_code" varchar(40) NOT NULL,
	"committee_id" uuid NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"title" varchar(200) NOT NULL,
	"description" text,
	"workflow_status" text NOT NULL,
	"current_version_id" uuid,
	"submitted_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "submission_reference_code_unique" UNIQUE("reference_code"),
	CONSTRAINT "submission_workflow_status_valid" CHECK ("workflow_status" IN ('DRAFT', 'PENDING_REVIEW', 'CHANGES_REQUESTED', 'APPROVED', 'REJECTED', 'CANCELLED'))
);
--> statement-breakpoint
CREATE TABLE "audit_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_user_id" uuid,
	"action" varchar(100) NOT NULL,
	"entity_type" varchar(80) NOT NULL,
	"entity_id" uuid NOT NULL,
	"submission_id" uuid,
	"metadata" jsonb,
	"ip_hash" varchar(128),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review_decision" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"submission_id" uuid NOT NULL,
	"media_version_id" uuid NOT NULL,
	"reviewer_user_id" uuid NOT NULL,
	"decision" text NOT NULL,
	"comment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "review_decision_decision_valid" CHECK ("decision" IN ('APPROVED', 'REJECTED', 'CHANGES_REQUESTED')),
	CONSTRAINT "review_decision_changes_need_comment" CHECK ("review_decision"."decision" <> 'CHANGES_REQUESTED' OR ("review_decision"."comment" IS NOT NULL AND btrim("review_decision"."comment") <> ''))
);
--> statement-breakpoint
CREATE TABLE "schedule_entry" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"submission_id" uuid NOT NULL,
	"media_version_id" uuid NOT NULL,
	"screen_id" uuid NOT NULL,
	"status" text NOT NULL,
	"actual_start_at" timestamp with time zone,
	"actual_end_at" timestamp with time zone,
	"external_schedule_ref" varchar(255),
	"manager_note" text,
	"created_by_user_id" uuid NOT NULL,
	"updated_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "schedule_entry_status_valid" CHECK ("status" IN ('NOT_SCHEDULED', 'SCHEDULED', 'PLAYING_CONFIRMED', 'COMPLETED', 'CANCELLED')),
	CONSTRAINT "schedule_entry_window_valid" CHECK ("schedule_entry"."actual_start_at" IS NULL OR "schedule_entry"."actual_end_at" IS NULL OR "schedule_entry"."actual_end_at" > "schedule_entry"."actual_start_at")
);
--> statement-breakpoint
ALTER TABLE "user_role" ADD CONSTRAINT "user_role_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_role" ADD CONSTRAINT "user_role_role_id_app_role_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."app_role"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_role" ADD CONSTRAINT "user_role_assigned_by_user_id_app_user_id_fk" FOREIGN KEY ("assigned_by_user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "committee_membership" ADD CONSTRAINT "committee_membership_committee_id_committee_id_fk" FOREIGN KEY ("committee_id") REFERENCES "public"."committee"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "committee_membership" ADD CONSTRAINT "committee_membership_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "committee_membership" ADD CONSTRAINT "committee_membership_assigned_by_user_id_app_user_id_fk" FOREIGN KEY ("assigned_by_user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_version" ADD CONSTRAINT "media_version_submission_id_submission_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."submission"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_version" ADD CONSTRAINT "media_version_uploaded_by_user_id_app_user_id_fk" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "screen_request" ADD CONSTRAINT "screen_request_submission_id_submission_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."submission"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "screen_request" ADD CONSTRAINT "screen_request_screen_id_screen_id_fk" FOREIGN KEY ("screen_id") REFERENCES "public"."screen"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submission" ADD CONSTRAINT "submission_committee_id_committee_id_fk" FOREIGN KEY ("committee_id") REFERENCES "public"."committee"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submission" ADD CONSTRAINT "submission_created_by_user_id_app_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submission" ADD CONSTRAINT "submission_current_version_fk" FOREIGN KEY ("current_version_id","id") REFERENCES "public"."media_version"("id","submission_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_event" ADD CONSTRAINT "audit_event_actor_user_id_app_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_event" ADD CONSTRAINT "audit_event_submission_id_submission_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."submission"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_decision" ADD CONSTRAINT "review_decision_submission_id_submission_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."submission"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_decision" ADD CONSTRAINT "review_decision_reviewer_user_id_app_user_id_fk" FOREIGN KEY ("reviewer_user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_decision" ADD CONSTRAINT "review_decision_version_fk" FOREIGN KEY ("media_version_id","submission_id") REFERENCES "public"."media_version"("id","submission_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_entry" ADD CONSTRAINT "schedule_entry_submission_id_submission_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."submission"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_entry" ADD CONSTRAINT "schedule_entry_screen_id_screen_id_fk" FOREIGN KEY ("screen_id") REFERENCES "public"."screen"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_entry" ADD CONSTRAINT "schedule_entry_created_by_user_id_app_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_entry" ADD CONSTRAINT "schedule_entry_updated_by_user_id_app_user_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_entry" ADD CONSTRAINT "schedule_entry_version_fk" FOREIGN KEY ("media_version_id","submission_id") REFERENCES "public"."media_version"("id","submission_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "media_version_submission_number_idx" ON "media_version" USING btree ("submission_id","version_number" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "screen_request_screen_window_idx" ON "screen_request" USING btree ("screen_id","preferred_start_at","preferred_end_at");--> statement-breakpoint
CREATE INDEX "submission_status_updated_idx" ON "submission" USING btree ("workflow_status","updated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "submission_committee_created_idx" ON "submission" USING btree ("committee_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "submission_creator_created_idx" ON "submission" USING btree ("created_by_user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_event_submission_created_idx" ON "audit_event" USING btree ("submission_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_event_actor_created_idx" ON "audit_event" USING btree ("actor_user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "review_decision_submission_created_idx" ON "review_decision" USING btree ("submission_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "review_decision_version_created_idx" ON "review_decision" USING btree ("media_version_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "schedule_entry_screen_status_start_idx" ON "schedule_entry" USING btree ("screen_id","status","actual_start_at");--> statement-breakpoint
CREATE INDEX "schedule_entry_submission_created_idx" ON "schedule_entry" USING btree ("submission_id","created_at" DESC NULLS LAST);