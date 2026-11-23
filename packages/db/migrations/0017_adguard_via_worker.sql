CREATE TABLE "discovery_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"device_id" uuid NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"result" jsonb,
	"error" text,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "worker_heartbeat" ADD COLUMN "adguard_seen_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "discovery_requests" ADD CONSTRAINT "discovery_requests_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "discovery_requests_at" ON "discovery_requests" USING btree ("requested_at");