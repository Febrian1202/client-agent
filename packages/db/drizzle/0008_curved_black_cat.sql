CREATE TABLE "client_memories" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"client_id" bigint NOT NULL,
	"type" varchar(32) NOT NULL,
	"category" varchar(64) NOT NULL,
	"content" text NOT NULL,
	"source" varchar(64) DEFAULT 'user_note' NOT NULL,
	"confidence" varchar(32) DEFAULT 'high' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "client_memories" ADD CONSTRAINT "client_memories_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;