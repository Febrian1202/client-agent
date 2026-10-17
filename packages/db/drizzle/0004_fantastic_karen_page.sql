CREATE TABLE "agent_runs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"task_id" bigint,
	"provider" varchar(100) NOT NULL,
	"model" varchar(255) NOT NULL,
	"system_version" varchar(50) DEFAULT 'v1.0' NOT NULL,
	"input" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"output" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"prompt_tokens" integer,
	"completion_tokens" integer,
	"total_tokens" integer,
	"duration_ms" integer NOT NULL,
	"status" varchar(50) DEFAULT 'success' NOT NULL,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_task_id_agent_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."agent_tasks"("id") ON DELETE no action ON UPDATE no action;