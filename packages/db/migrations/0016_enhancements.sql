CREATE TABLE "journal" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"child_id" uuid NOT NULL,
	"text" text NOT NULL,
	"picture" text DEFAULT 'star' NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"praise" text,
	"praised_by" uuid,
	"praised_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "mood_checks" (
	"child_id" uuid NOT NULL,
	"month" text NOT NULL,
	"rating" smallint NOT NULL,
	"note" text,
	"by" uuid NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mood_checks_child_id_month_pk" PRIMARY KEY("child_id","month"),
	CONSTRAINT "mood_checks_rating" CHECK ("mood_checks"."rating" between 1 and 5)
);
--> statement-breakpoint
CREATE TABLE "rule_asks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"child_id" uuid NOT NULL,
	"text" text NOT NULL,
	"asked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"answer" text,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	CONSTRAINT "rule_asks_status" CHECK ("rule_asks"."status" in ('open', 'review', 'answered'))
);
--> statement-breakpoint
CREATE TABLE "skills" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"child_id" uuid NOT NULL,
	"title" text NOT NULL,
	"picture" text DEFAULT 'star' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"mastered_at" timestamp with time zone,
	"confirmed_by" uuid,
	"removed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "unmanaged_time" (
	"child_id" uuid NOT NULL,
	"week" text NOT NULL,
	"minutes" integer NOT NULL,
	"by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "unmanaged_time_child_id_week_pk" PRIMARY KEY("child_id","week")
);
--> statement-breakpoint
ALTER TABLE "people" ADD COLUMN "age_band" text;--> statement-breakpoint
ALTER TABLE "people" ADD COLUMN "setup_done" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "journal" ADD CONSTRAINT "journal_child_id_people_id_fk" FOREIGN KEY ("child_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal" ADD CONSTRAINT "journal_praised_by_people_id_fk" FOREIGN KEY ("praised_by") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mood_checks" ADD CONSTRAINT "mood_checks_child_id_people_id_fk" FOREIGN KEY ("child_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mood_checks" ADD CONSTRAINT "mood_checks_by_people_id_fk" FOREIGN KEY ("by") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule_asks" ADD CONSTRAINT "rule_asks_child_id_people_id_fk" FOREIGN KEY ("child_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule_asks" ADD CONSTRAINT "rule_asks_decided_by_people_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skills" ADD CONSTRAINT "skills_child_id_people_id_fk" FOREIGN KEY ("child_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skills" ADD CONSTRAINT "skills_confirmed_by_people_id_fk" FOREIGN KEY ("confirmed_by") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unmanaged_time" ADD CONSTRAINT "unmanaged_time_child_id_people_id_fk" FOREIGN KEY ("child_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unmanaged_time" ADD CONSTRAINT "unmanaged_time_by_people_id_fk" FOREIGN KEY ("by") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "journal_child" ON "journal" USING btree ("child_id","at");--> statement-breakpoint
CREATE INDEX "rule_asks_child" ON "rule_asks" USING btree ("child_id","status");--> statement-breakpoint
CREATE INDEX "skills_child" ON "skills" USING btree ("child_id");