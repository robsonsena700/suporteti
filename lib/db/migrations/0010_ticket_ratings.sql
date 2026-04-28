DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'ratings'
  ) AND NOT EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'ticket_ratings'
  ) THEN
    ALTER TABLE public.ratings RENAME TO ticket_ratings;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'ticket_ratings'
  ) THEN
    CREATE TABLE public.ticket_ratings (
      id serial PRIMARY KEY,
      ticket_id integer NOT NULL UNIQUE REFERENCES public.tickets(id) ON DELETE CASCADE,
      rating integer NOT NULL,
      reason_low_rating text,
      comment text,
      created_at timestamptz NOT NULL DEFAULT now()
    );
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'ticket_ratings' AND column_name = 'score'
  ) THEN
    ALTER TABLE public.ticket_ratings RENAME COLUMN score TO rating;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'ticket_ratings' AND column_name = 'feedback'
  ) THEN
    ALTER TABLE public.ticket_ratings RENAME COLUMN feedback TO comment;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'ticket_ratings' AND column_name = 'reason_low_rating'
  ) THEN
    ALTER TABLE public.ticket_ratings ADD COLUMN reason_low_rating text;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'ticket_ratings' AND column_name = 'user_id'
  ) THEN
    ALTER TABLE public.ticket_ratings DROP COLUMN user_id;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'ticket_ratings_rating_range'
  ) THEN
    ALTER TABLE public.ticket_ratings
      ADD CONSTRAINT ticket_ratings_rating_range CHECK (rating >= 1 AND rating <= 5);
  END IF;
END $$;
