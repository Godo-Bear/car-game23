-- Races can be on different circuits now; existing results were all on the Tokyo circuit.
ALTER TABLE race_results ADD COLUMN track TEXT NOT NULL DEFAULT 'tokyo';
