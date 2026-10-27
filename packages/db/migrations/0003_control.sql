CREATE TABLE "adguard_sync" (
	"device_id" uuid PRIMARY KEY NOT NULL,
	"state" text NOT NULL,
	"applied" jsonb,
	"applied_at" timestamp with time zone,
	"confirmed_at" timestamp with time zone,
	"failures" smallint DEFAULT 0 NOT NULL,
	"last_error" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"child_id" uuid,
	"label" text NOT NULL,
	"type" text NOT NULL,
	"adguard_name" text NOT NULL,
	"identifiers" text[] NOT NULL,
	"last_seen_at" timestamp with time zone,
	"quiet_since" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "devices_has_identifier" CHECK (cardinality("devices"."identifiers") > 0)
);
--> statement-breakpoint
CREATE TABLE "grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"child_id" uuid NOT NULL,
	"target_kind" text NOT NULL,
	"target_id" uuid NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"source" text NOT NULL,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"approved_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "grants_order" CHECK ("grants"."ends_at" > "grants"."starts_at")
);
--> statement-breakpoint
CREATE TABLE "overrides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"child_id" uuid NOT NULL,
	"target_kind" text NOT NULL,
	"target_id" uuid,
	"type" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone,
	"overrides_bedtime" boolean DEFAULT false NOT NULL,
	"counts_against_allowance" boolean DEFAULT true NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_by" uuid,
	CONSTRAINT "overrides_type" CHECK ("overrides"."type" in ('allow', 'block', 'pause')),
	CONSTRAINT "overrides_target" CHECK (("overrides"."target_kind" = 'everything' and "overrides"."target_id" is null) or ("overrides"."target_kind" in ('service', 'group') and "overrides"."target_id" is not null)),
	CONSTRAINT "overrides_end" CHECK ("overrides"."ends_at" is not null or "overrides"."type" = 'pause')
);
--> statement-breakpoint
CREATE TABLE "policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"child_id" uuid NOT NULL,
	"service_id" uuid,
	"group_id" uuid,
	"default_state" text DEFAULT 'blocked' NOT NULL,
	"always_allowed" boolean DEFAULT false NOT NULL,
	"allowed_during_wind_down" boolean DEFAULT false NOT NULL,
	"earnable" boolean DEFAULT true NOT NULL,
	"daily_cap_minutes" smallint,
	"session_cap_minutes" smallint,
	CONSTRAINT "policies_one_target" CHECK (("policies"."service_id" is null) <> ("policies"."group_id" is null)),
	CONSTRAINT "policies_default" CHECK ("policies"."default_state" in ('blocked', 'allowed'))
);
--> statement-breakpoint
CREATE TABLE "querylog_cursor" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"read_until" timestamp with time zone NOT NULL,
	CONSTRAINT "querylog_cursor_single_row" CHECK ("querylog_cursor"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE "schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"child_id" uuid,
	"name" text NOT NULL,
	"weekdays" smallint[] NOT NULL,
	"blocks" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "service_group_members" (
	"group_id" uuid NOT NULL,
	"service_id" uuid NOT NULL,
	CONSTRAINT "service_group_members_group_id_service_id_pk" PRIMARY KEY("group_id","service_id")
);
--> statement-breakpoint
CREATE TABLE "service_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "services" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"name" text NOT NULL,
	"icon" text,
	"source" text NOT NULL,
	"adguard_id" text,
	"domains" text[] DEFAULT '{}'::text[] NOT NULL,
	"category" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "services_source" CHECK (("services"."source" = 'adguard' and "services"."adguard_id" is not null) or ("services"."source" = 'custom' and "services"."adguard_id" is null))
);
--> statement-breakpoint
CREATE TABLE "usage_minutes" (
	"device_id" uuid NOT NULL,
	"service_id" uuid NOT NULL,
	"minute" timestamp with time zone NOT NULL,
	"queries" smallint NOT NULL,
	CONSTRAINT "usage_minutes_device_id_service_id_minute_pk" PRIMARY KEY("device_id","service_id","minute")
);
--> statement-breakpoint
ALTER TABLE "adguard_sync" ADD CONSTRAINT "adguard_sync_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_child_id_people_id_fk" FOREIGN KEY ("child_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grants" ADD CONSTRAINT "grants_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grants" ADD CONSTRAINT "grants_child_id_people_id_fk" FOREIGN KEY ("child_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grants" ADD CONSTRAINT "grants_approved_by_people_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "overrides" ADD CONSTRAINT "overrides_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "overrides" ADD CONSTRAINT "overrides_child_id_people_id_fk" FOREIGN KEY ("child_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "overrides" ADD CONSTRAINT "overrides_created_by_people_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "overrides" ADD CONSTRAINT "overrides_ended_by_people_id_fk" FOREIGN KEY ("ended_by") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policies" ADD CONSTRAINT "policies_child_id_people_id_fk" FOREIGN KEY ("child_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policies" ADD CONSTRAINT "policies_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policies" ADD CONSTRAINT "policies_group_id_service_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."service_groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_child_id_people_id_fk" FOREIGN KEY ("child_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_group_members" ADD CONSTRAINT "service_group_members_group_id_service_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."service_groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_group_members" ADD CONSTRAINT "service_group_members_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_groups" ADD CONSTRAINT "service_groups_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "services" ADD CONSTRAINT "services_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_minutes" ADD CONSTRAINT "usage_minutes_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_minutes" ADD CONSTRAINT "usage_minutes_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "devices_adguard_name" ON "devices" USING btree ("adguard_name");--> statement-breakpoint
CREATE INDEX "grants_child_ends" ON "grants" USING btree ("child_id","ends_at");--> statement-breakpoint
CREATE INDEX "overrides_child_ends" ON "overrides" USING btree ("child_id","ends_at");--> statement-breakpoint
CREATE UNIQUE INDEX "policies_child_service" ON "policies" USING btree ("child_id","service_id");--> statement-breakpoint
CREATE UNIQUE INDEX "policies_child_group" ON "policies" USING btree ("child_id","group_id");--> statement-breakpoint
CREATE UNIQUE INDEX "services_household_adguard" ON "services" USING btree ("household_id","adguard_id");--> statement-breakpoint
CREATE INDEX "usage_minutes_minute" ON "usage_minutes" USING btree ("minute");