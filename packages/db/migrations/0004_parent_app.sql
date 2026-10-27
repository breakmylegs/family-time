CREATE TABLE "help_feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid,
	"topic_id" text NOT NULL,
	"helpful" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "push_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_sent_at" timestamp with time zone,
	"failures" smallint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session_endings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"child_id" uuid NOT NULL,
	"ref" text NOT NULL,
	"ended_at" timestamp with time zone NOT NULL,
	"mood" text NOT NULL,
	"by_person_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "session_endings_mood" CHECK ("session_endings"."mood" in ('calm', 'grumble', 'meltdown'))
);
--> statement-breakpoint
ALTER TABLE "people" ADD COLUMN "pronouns" text;--> statement-breakpoint
ALTER TABLE "help_feedback" ADD CONSTRAINT "help_feedback_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_endings" ADD CONSTRAINT "session_endings_child_id_people_id_fk" FOREIGN KEY ("child_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_endings" ADD CONSTRAINT "session_endings_by_person_id_people_id_fk" FOREIGN KEY ("by_person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "push_subscriptions_endpoint" ON "push_subscriptions" USING btree ("endpoint");--> statement-breakpoint
CREATE INDEX "push_subscriptions_person" ON "push_subscriptions" USING btree ("person_id");--> statement-breakpoint
CREATE UNIQUE INDEX "session_endings_child_ref" ON "session_endings" USING btree ("child_id","ref");--> statement-breakpoint
ALTER TABLE "people" ADD CONSTRAINT "people_pronouns" CHECK ("people"."pronouns" is null or "people"."pronouns" in ('he', 'she', 'they'));