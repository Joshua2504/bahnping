CREATE TABLE "trip_stops" (
	"trip_id" uuid NOT NULL,
	"seq" smallint NOT NULL,
	"eva_nr" text,
	"name" text NOT NULL,
	"lat" double precision,
	"lon" double precision,
	"scheduled_arrival" timestamp with time zone,
	"actual_arrival" timestamp with time zone,
	"scheduled_departure" timestamp with time zone,
	"actual_departure" timestamp with time zone,
	"track_scheduled" text,
	"track_actual" text,
	"passed" boolean,
	"position_status" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trip_stops_trip_id_seq_pk" PRIMARY KEY("trip_id","seq")
);
--> statement-breakpoint
ALTER TABLE "samples" ADD COLUMN "ice_next_state" text;--> statement-breakpoint
ALTER TABLE "samples" ADD COLUMN "ice_remaining_s" integer;--> statement-breakpoint
ALTER TABLE "samples" ADD COLUMN "ice_internet" text;--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "ice_tzn" text;--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "ice_series" text;--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "trip_date" text;--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "origin_name" text;--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "destination_name" text;--> statement-breakpoint
ALTER TABLE "trip_stops" ADD CONSTRAINT "trip_stops_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "trips_tzn_idx" ON "trips" USING btree ("ice_tzn");