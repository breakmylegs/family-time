CREATE TABLE "worker_heartbeat" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"beat_at" timestamp with time zone NOT NULL,
	"commit" text NOT NULL,
	CONSTRAINT "worker_heartbeat_single_row" CHECK ("worker_heartbeat"."id" = 1)
);
