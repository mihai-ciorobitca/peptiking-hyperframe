-- Keep historical jobs on Borumi; each worker can claim only its own provider.
CREATE OR REPLACE FUNCTION public.claim_borumi_video_edit_job(
  p_worker_id TEXT,
  p_lease_seconds INTEGER DEFAULT 120
)
RETURNS TABLE (
  job_id TEXT,
  user_id TEXT,
  user_email TEXT,
  operation TEXT,
  payload JSONB,
  attempts INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH candidate AS (
    SELECT j."id"
    FROM "AiVideoEditJob" j
    WHERE
      (j."status" = 'QUEUED'
      OR (j."status" = 'RUNNING' AND j."leaseExpiresAt" < NOW()))
      AND COALESCE(j."payload"->>'editor', 'borumi') = 'borumi'
      AND j."operation" IN ('EDIT_VIDEO', 'LIST_PROJECTS')
    ORDER BY j."createdAt" ASC
    FOR UPDATE SKIP LOCKED
    LIMIT 1
  ), updated AS (
    UPDATE "AiVideoEditJob" j
    SET
      "status" = 'RUNNING',
      "workerId" = p_worker_id,
      "attempts" = j."attempts" + 1,
      "progressStage" = 'claimed',
      "progressMessage" = 'Worker claimed the request',
      "progressPercent" = 1,
      "progressUpdatedAt" = NOW(),
      "claimedAt" = NOW(),
      "leaseExpiresAt" = NOW() + make_interval(secs => GREATEST(30, LEAST(p_lease_seconds, 900))),
      "startedAt" = COALESCE(j."startedAt", NOW()),
      "updatedAt" = NOW()
    FROM candidate
    WHERE j."id" = candidate."id"
    RETURNING j."id", j."userId", j."operation", j."payload", j."attempts"
  )
  SELECT updated."id", updated."userId", users."email", updated."operation", updated."payload", updated."attempts"
  FROM updated
  JOIN "User" users ON users."id" = updated."userId";
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_hyperframes_video_edit_job(
  p_worker_id TEXT,
  p_lease_seconds INTEGER DEFAULT 120
)
RETURNS TABLE (
  job_id TEXT,
  user_id TEXT,
  user_email TEXT,
  operation TEXT,
  payload JSONB,
  attempts INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH candidate AS (
    SELECT j."id"
    FROM "AiVideoEditJob" j
    WHERE
      (j."status" = 'QUEUED'
      OR (j."status" = 'RUNNING' AND j."leaseExpiresAt" < NOW()))
      AND COALESCE(j."payload"->>'editor', 'borumi') = 'hyperframes'
      AND j."operation" IN ('EDIT_VIDEO', 'LIST_PROJECTS')
    ORDER BY j."createdAt" ASC
    FOR UPDATE SKIP LOCKED
    LIMIT 1
  ), updated AS (
    UPDATE "AiVideoEditJob" j
    SET
      "status" = 'RUNNING',
      "workerId" = p_worker_id,
      "attempts" = j."attempts" + 1,
      "progressStage" = 'claimed',
      "progressMessage" = 'Worker claimed the request',
      "progressPercent" = 1,
      "progressUpdatedAt" = NOW(),
      "claimedAt" = NOW(),
      "leaseExpiresAt" = NOW() + make_interval(secs => GREATEST(30, LEAST(p_lease_seconds, 900))),
      "startedAt" = COALESCE(j."startedAt", NOW()),
      "updatedAt" = NOW()
    FROM candidate
    WHERE j."id" = candidate."id"
    RETURNING j."id", j."userId", j."operation", j."payload", j."attempts"
  )
  SELECT updated."id", updated."userId", users."email", updated."operation", updated."payload", updated."attempts"
  FROM updated
  JOIN "User" users ON users."id" = updated."userId";
END;
$$;

REVOKE ALL ON FUNCTION public.claim_borumi_video_edit_job(TEXT, INTEGER) FROM PUBLIC;
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN REVOKE ALL ON FUNCTION public.claim_borumi_video_edit_job(TEXT, INTEGER) FROM anon; END IF;
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN REVOKE ALL ON FUNCTION public.claim_borumi_video_edit_job(TEXT, INTEGER) FROM authenticated; END IF;
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN GRANT EXECUTE ON FUNCTION public.claim_borumi_video_edit_job(TEXT, INTEGER) TO service_role; END IF;
END $$;
REVOKE ALL ON FUNCTION public.claim_hyperframes_video_edit_job(TEXT, INTEGER) FROM PUBLIC;
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN REVOKE ALL ON FUNCTION public.claim_hyperframes_video_edit_job(TEXT, INTEGER) FROM anon; END IF;
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN REVOKE ALL ON FUNCTION public.claim_hyperframes_video_edit_job(TEXT, INTEGER) FROM authenticated; END IF;
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN GRANT EXECUTE ON FUNCTION public.claim_hyperframes_video_edit_job(TEXT, INTEGER) TO service_role; END IF;
END $$;
