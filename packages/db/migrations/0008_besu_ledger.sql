CREATE TABLE "ledger_confirmations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contract_id" uuid NOT NULL,
	"ref_hash" text NOT NULL,
	"event" text NOT NULL,
	"child_address" text NOT NULL,
	"time" integer DEFAULT 0 NOT NULL,
	"money" integer DEFAULT 0 NOT NULL,
	"flex" integer DEFAULT 0 NOT NULL,
	"block_number" bigint NOT NULL,
	"log_index" integer NOT NULL,
	"tx_hash" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ledger_contracts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"address" text NOT NULL,
	"chain_id" integer NOT NULL,
	"version" text NOT NULL,
	"deployed_block" bigint NOT NULL,
	"indexed_block" bigint,
	"active" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ledger_tx" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"position" bigserial NOT NULL,
	"contract_id" uuid NOT NULL,
	"entry_id" uuid NOT NULL,
	"ref_hash" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"nonce" integer,
	"tx_hash" text,
	"block_number" bigint,
	"error" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ledger_tx_status" CHECK ("ledger_tx"."status" in ('pending', 'sent', 'mined', 'failed'))
);
--> statement-breakpoint
ALTER TABLE "ledger_confirmations" ADD CONSTRAINT "ledger_confirmations_contract_id_ledger_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."ledger_contracts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_tx" ADD CONSTRAINT "ledger_tx_contract_id_ledger_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."ledger_contracts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_tx" ADD CONSTRAINT "ledger_tx_entry_id_ledger_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."ledger_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_confirmations_log" ON "ledger_confirmations" USING btree ("contract_id","block_number","log_index");--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_confirmations_ref" ON "ledger_confirmations" USING btree ("contract_id","ref_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_contracts_address" ON "ledger_contracts" USING btree ("chain_id","address");--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_contracts_one_active" ON "ledger_contracts" USING btree ("active") WHERE "ledger_contracts"."active";--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_tx_contract_entry" ON "ledger_tx" USING btree ("contract_id","entry_id");--> statement-breakpoint
CREATE INDEX "ledger_tx_contract_status" ON "ledger_tx" USING btree ("contract_id","status","position");