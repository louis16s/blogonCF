CREATE TABLE IF NOT EXISTS `article_heading_jobs` (
  `page_id` text PRIMARY KEY NOT NULL,
  `version` text NOT NULL,
  `queue_json` text NOT NULL,
  `headings_json` text NOT NULL,
  `updated_at` integer NOT NULL
);
