CREATE TABLE "allowances" (
	"child_id" uuid PRIMARY KEY NOT NULL,
	"weekly_minutes" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "completions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"child_id" uuid NOT NULL,
	"logged_at" timestamp with time zone NOT NULL,
	"photo_path" text,
	"status" text DEFAULT 'waiting' NOT NULL,
	"note" text,
	"paid" jsonb,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	CONSTRAINT "completions_status" CHECK ("completions"."status" in ('waiting', 'approved', 'not-yet'))
);
--> statement-breakpoint
CREATE TABLE "goals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"child_id" uuid NOT NULL,
	"title" text NOT NULL,
	"target_pence" integer NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ledger_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"seq" bigint NOT NULL,
	"child_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"time" integer DEFAULT 0 NOT NULL,
	"money" integer DEFAULT 0 NOT NULL,
	"flex" integer DEFAULT 0 NOT NULL,
	"ref" text NOT NULL,
	"reason" text NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"by_person_id" uuid,
	"at" timestamp with time zone NOT NULL,
	"prev_hash" text NOT NULL,
	"hash" text NOT NULL,
	"block_number" bigint,
	"tx_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ledger_entries_kind" CHECK ("ledger_entries"."kind" in ('allowance', 'award', 'spend', 'refund', 'convert', 'close', 'payout', 'reversal'))
);
--> statement-breakpoint
CREATE TABLE "reduction_plans" (
	"child_id" uuid PRIMARY KEY NOT NULL,
	"step_minutes" integer NOT NULL,
	"every_weeks" smallint NOT NULL,
	"floor_minutes" integer NOT NULL,
	"next_step_on" date NOT NULL,
	"agreed_step_on" date,
	"agreed_by" uuid,
	"agreed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"child_id" uuid NOT NULL,
	"target_kind" text NOT NULL,
	"target_id" uuid NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"minutes" integer NOT NULL,
	"detail" text,
	"asked_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'waiting' NOT NULL,
	"as_extra" boolean DEFAULT false NOT NULL,
	"grant_id" uuid,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	CONSTRAINT "requests_status" CHECK ("requests"."status" in ('waiting', 'approved', 'not-yet')),
	CONSTRAINT "requests_minutes" CHECK ("requests"."minutes" > 0)
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"child_id" uuid,
	"title" text NOT NULL,
	"picture" text DEFAULT 'star' NOT NULL,
	"reward_type" text NOT NULL,
	"amount" integer DEFAULT 0 NOT NULL,
	"recurrence" jsonb DEFAULT '{"kind":"daily"}'::jsonb NOT NULL,
	"age_band" text,
	"needs_photo" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tasks_reward" CHECK ("tasks"."reward_type" in ('money', 'flex', 'time', 'praise')),
	CONSTRAINT "tasks_amount" CHECK (("tasks"."reward_type" = 'praise' and "tasks"."amount" = 0) or ("tasks"."reward_type" <> 'praise' and "tasks"."amount" > 0))
);
--> statement-breakpoint
ALTER TABLE "allowances" ADD CONSTRAINT "allowances_child_id_people_id_fk" FOREIGN KEY ("child_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "completions" ADD CONSTRAINT "completions_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "completions" ADD CONSTRAINT "completions_child_id_people_id_fk" FOREIGN KEY ("child_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "completions" ADD CONSTRAINT "completions_decided_by_people_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_child_id_people_id_fk" FOREIGN KEY ("child_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_child_id_people_id_fk" FOREIGN KEY ("child_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_by_person_id_people_id_fk" FOREIGN KEY ("by_person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reduction_plans" ADD CONSTRAINT "reduction_plans_child_id_people_id_fk" FOREIGN KEY ("child_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reduction_plans" ADD CONSTRAINT "reduction_plans_agreed_by_people_id_fk" FOREIGN KEY ("agreed_by") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requests" ADD CONSTRAINT "requests_child_id_people_id_fk" FOREIGN KEY ("child_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requests" ADD CONSTRAINT "requests_grant_id_grants_id_fk" FOREIGN KEY ("grant_id") REFERENCES "public"."grants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requests" ADD CONSTRAINT "requests_decided_by_people_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_child_id_people_id_fk" FOREIGN KEY ("child_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_created_by_people_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "completions_child_status" ON "completions" USING btree ("child_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_entries_household_seq" ON "ledger_entries" USING btree ("household_id","seq");--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_entries_household_ref" ON "ledger_entries" USING btree ("household_id","ref");--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_entries_hash" ON "ledger_entries" USING btree ("hash");--> statement-breakpoint
CREATE INDEX "ledger_entries_child_at" ON "ledger_entries" USING btree ("child_id","at");--> statement-breakpoint
CREATE INDEX "tasks_household" ON "tasks" USING btree ("household_id");