/*
# Create trip_sessions child table for multi-session billing

## Purpose
Allows a single trip/billing entry to contain multiple work sessions, each with its own
in-time, out-time, hour meter readings, and remarks. Batha remains a single field on the
parent trip. The rental amount is calculated from the combined duration of all sessions.

## New Tables
- `trip_sessions`
  - `id` (uuid, primary key)
  - `trip_id` (uuid, FK to trips.id ON DELETE CASCADE)
  - `session_number` (int, which session: 1, 2, 3...)
  - `in_time` (timestamptz, when session started)
  - `out_time` (timestamptz, when session ended)
  - `opening_hour_meter` (numeric, optional)
  - `closing_hour_meter` (numeric, optional)
  - `remarks` (text, optional per-session notes)
  - `duration_minutes` (int, calculated duration in minutes)
  - `created_at` (timestamptz)
  - `updated_at` (timestamptz)

## Existing Data
- Existing trips have single-session data in the trips table (in_time, out_time, etc.).
  Those columns are NOT removed — they continue to work for existing records.
  New multi-session trips will store sessions in trip_sessions and leave the trips
  columns as a summary/legacy fallback (first session's time or combined).

## Security
- RLS enabled, policies scoped to authenticated users (app has sign-in).
*/

CREATE TABLE IF NOT EXISTS trip_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id uuid NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  session_number int NOT NULL DEFAULT 1,
  in_time timestamptz,
  out_time timestamptz,
  opening_hour_meter numeric,
  closing_hour_meter numeric,
  remarks text,
  duration_minutes int NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_trip_sessions_trip_id ON trip_sessions(trip_id);
CREATE INDEX IF NOT EXISTS idx_trip_sessions_session_number ON trip_sessions(session_number);

ALTER TABLE trip_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_trip_sessions" ON trip_sessions;
CREATE POLICY "select_own_trip_sessions" ON trip_sessions FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM trips WHERE trips.id = trip_sessions.trip_id)
  );

DROP POLICY IF EXISTS "insert_own_trip_sessions" ON trip_sessions;
CREATE POLICY "insert_own_trip_sessions" ON trip_sessions FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM trips WHERE trips.id = trip_sessions.trip_id)
  );

DROP POLICY IF EXISTS "update_own_trip_sessions" ON trip_sessions;
CREATE POLICY "update_own_trip_sessions" ON trip_sessions FOR UPDATE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM trips WHERE trips.id = trip_sessions.trip_id)
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM trips WHERE trips.id = trip_sessions.trip_id)
  );

DROP POLICY IF EXISTS "delete_own_trip_sessions" ON trip_sessions;
CREATE POLICY "delete_own_trip_sessions" ON trip_sessions FOR DELETE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM trips WHERE trips.id = trip_sessions.trip_id)
  );
