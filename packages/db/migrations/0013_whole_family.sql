CREATE TABLE "challenge_ticks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"challenge_id" uuid NOT NULL,
	"by_person_id" uuid NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "family_challenges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"title" text NOT NULL,
	"target" smallint NOT NULL,
	"week" text NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "parent_screen_time" (
	"person_id" uuid NOT NULL,
	"week" text NOT NULL,
	"minutes" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "parent_screen_time_person_id_week_pk" PRIMARY KEY("person_id","week")
);
--> statement-breakpoint
ALTER TABLE "goals" ADD COLUMN "match_percent" smallint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "challenge_ticks" ADD CONSTRAINT "challenge_ticks_challenge_id_family_challenges_id_fk" FOREIGN KEY ("challenge_id") REFERENCES "public"."family_challenges"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "challenge_ticks" ADD CONSTRAINT "challenge_ticks_by_person_id_people_id_fk" FOREIGN KEY ("by_person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "family_challenges" ADD CONSTRAINT "family_challenges_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "family_challenges" ADD CONSTRAINT "family_challenges_created_by_people_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parent_screen_time" ADD CONSTRAINT "parent_screen_time_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;