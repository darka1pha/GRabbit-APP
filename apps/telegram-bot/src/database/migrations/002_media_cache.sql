CREATE TABLE IF NOT EXISTS media_cache (
  platform VARCHAR(32) NOT NULL,
  media_id VARCHAR(128) NOT NULL,
  format VARCHAR(16) NOT NULL,
  quality_id VARCHAR(128) NOT NULL,
  telegram_file_id TEXT NOT NULL,
  file_size_bytes BIGINT,
  duration_seconds INT,
  title TEXT,
  author TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (platform, media_id, format, quality_id)
);

CREATE INDEX IF NOT EXISTS idx_media_cache_lookup
  ON media_cache(platform, media_id, format, quality_id);

