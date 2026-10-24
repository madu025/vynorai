--
-- PostgreSQL database dump
--


-- Dumped from database version 16.15
-- Dumped by pg_dump version 16.15

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: vynor_touch_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.vynor_touch_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at := to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS');
  RETURN NEW;
END;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: admin_staff; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.admin_staff (
    id text NOT NULL,
    name character varying(128) NOT NULL,
    email character varying(255) NOT NULL,
    role character varying(32) DEFAULT 'admin'::character varying NOT NULL,
    created_by character varying(128),
    created_at text DEFAULT to_char((now() AT TIME ZONE 'UTC'::text), 'YYYY-MM-DD HH24:MI:SS'::text),
    CONSTRAINT admin_staff_role_check CHECK (((role)::text = ANY ((ARRAY['super_admin'::character varying, 'admin'::character varying, 'support'::character varying])::text[])))
);


--
-- Name: background_artifacts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.background_artifacts (
    id text NOT NULL,
    task_id text NOT NULL,
    artifact_type character varying(32) NOT NULL,
    storage_path text NOT NULL,
    sha256 character varying(64) NOT NULL,
    bytes bigint NOT NULL,
    key_version character varying(32) NOT NULL,
    expires_at text NOT NULL,
    deleted_at text,
    created_at text DEFAULT to_char((now() AT TIME ZONE 'UTC'::text), 'YYYY-MM-DD HH24:MI:SS'::text) NOT NULL
);


--
-- Name: background_billing_ledger; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.background_billing_ledger (
    id text NOT NULL,
    task_id text NOT NULL,
    user_id text NOT NULL,
    event_type character varying(32) NOT NULL,
    credits bigint NOT NULL,
    idempotency_key character varying(160) NOT NULL,
    metadata text DEFAULT '{}'::text NOT NULL,
    created_at text DEFAULT to_char((now() AT TIME ZONE 'UTC'::text), 'YYYY-MM-DD HH24:MI:SS'::text) NOT NULL
);


--
-- Name: background_consent; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.background_consent (
    user_id text NOT NULL,
    policy_version character varying(32) NOT NULL,
    client character varying(64) NOT NULL,
    ip_digest character varying(64) NOT NULL,
    accepted_at text DEFAULT to_char((now() AT TIME ZONE 'UTC'::text), 'YYYY-MM-DD HH24:MI:SS'::text) NOT NULL
);


--
-- Name: background_task_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.background_task_events (
    id text NOT NULL,
    task_id text NOT NULL,
    sequence bigint NOT NULL,
    event_type character varying(64) NOT NULL,
    message text NOT NULL,
    data text DEFAULT '{}'::text NOT NULL,
    created_at text DEFAULT to_char((now() AT TIME ZONE 'UTC'::text), 'YYYY-MM-DD HH24:MI:SS'::text) NOT NULL
);


--
-- Name: background_tasks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.background_tasks (
    id text NOT NULL,
    user_id text NOT NULL,
    status character varying(32) NOT NULL,
    prompt text,
    language character varying(16) DEFAULT 'en'::character varying NOT NULL,
    project_fingerprint character varying(64) NOT NULL,
    manifest_digest character varying(64) NOT NULL,
    estimate_credits bigint NOT NULL,
    cap_credits bigint NOT NULL,
    used_credits bigint DEFAULT 0 NOT NULL,
    model_credits bigint DEFAULT 0 NOT NULL,
    compute_credits bigint DEFAULT 0 NOT NULL,
    refund_credits bigint DEFAULT 0 NOT NULL,
    quota_reservation_id text,
    quote_id text NOT NULL,
    idempotency_key character varying(128) NOT NULL,
    priority smallint DEFAULT 0 NOT NULL,
    worker_id text,
    lease_id text,
    heartbeat_at text,
    queued_at text,
    started_at text,
    ended_at text,
    failure_reason character varying(128),
    proof text,
    upload_artifact_id text,
    patch_artifact_id text,
    proof_artifact_id text,
    workspace_deleted_at text,
    deleted_at text,
    purge_after text,
    purged_at text,
    created_at text DEFAULT to_char((now() AT TIME ZONE 'UTC'::text), 'YYYY-MM-DD HH24:MI:SS'::text) NOT NULL,
    updated_at text DEFAULT to_char((now() AT TIME ZONE 'UTC'::text), 'YYYY-MM-DD HH24:MI:SS'::text) NOT NULL,
    CONSTRAINT background_tasks_status_check CHECK (((status)::text = ANY ((ARRAY['awaiting_upload'::character varying, 'queued'::character varying, 'running'::character varying, 'cancel_requested'::character varying, 'completed'::character varying, 'failed'::character varying, 'canceled'::character varying, 'purged'::character varying])::text[])))
);


--
-- Name: cache_entries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cache_entries (
    cache_key text NOT NULL,
    user_id text,
    project_id text,
    response_data text NOT NULL,
    response_bytes bigint DEFAULT 0 NOT NULL,
    expires_at text,
    created_at text DEFAULT to_char((now() AT TIME ZONE 'UTC'::text), 'YYYY-MM-DD HH24:MI:SS'::text)
);


--
-- Name: cloud_delivery_manifests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cloud_delivery_manifests (
    run_id character varying(36) NOT NULL,
    task_id character varying(256) NOT NULL,
    policy_version character varying(32) NOT NULL,
    repository_owner character varying(100) NOT NULL,
    repository_name character varying(100) NOT NULL,
    base_branch character varying(191) NOT NULL,
    head_branch character varying(191) NOT NULL,
    base_sha character varying(64) NOT NULL,
    head_sha character varying(64) NOT NULL,
    rollback_sha character varying(64) NOT NULL,
    mode character varying(32) NOT NULL,
    state character varying(32) NOT NULL,
    verification_digest character varying(64) NOT NULL,
    capability_digest character varying(64) NOT NULL,
    approval_actor character varying(160),
    approval_scope character varying(500),
    approval_at text,
    approval_receipt_digest character varying(64),
    artifact_digest character varying(64),
    artifact_attestation_digest character varying(64),
    deployment_target character varying(128),
    health_digest character varying(64),
    transitions text DEFAULT '[]'::text NOT NULL,
    created_at text DEFAULT to_char((now() AT TIME ZONE 'UTC'::text), 'YYYY-MM-DD HH24:MI:SS'::text),
    updated_at text DEFAULT to_char((now() AT TIME ZONE 'UTC'::text), 'YYYY-MM-DD HH24:MI:SS'::text)
);


--
-- Name: email_verifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.email_verifications (
    id text NOT NULL,
    user_id text NOT NULL,
    email character varying(255) NOT NULL,
    otp_hash character varying(64) NOT NULL,
    token_hash character varying(64) NOT NULL,
    otp_code character varying(10) DEFAULT ''::character varying,
    token character varying(128) DEFAULT ''::character varying,
    attempts integer DEFAULT 0 NOT NULL,
    expires_at text NOT NULL,
    created_at text DEFAULT to_char((now() AT TIME ZONE 'UTC'::text), 'YYYY-MM-DD HH24:MI:SS'::text),
    CONSTRAINT email_verifications_attempts_check CHECK (((attempts >= 0) AND (attempts <= 5)))
);


--
-- Name: error_reports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.error_reports (
    id text NOT NULL,
    user_id text,
    source character varying(32) NOT NULL,
    message text NOT NULL,
    stack text,
    client character varying(64),
    created_at text DEFAULT to_char((now() AT TIME ZONE 'UTC'::text), 'YYYY-MM-DD HH24:MI:SS'::text)
);


--
-- Name: m365_approval_uses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.m365_approval_uses (
    jti character varying(128) NOT NULL,
    plan_id character varying(100) NOT NULL,
    tenant_id character varying(128) NOT NULL,
    object_id character varying(128) NOT NULL,
    expires_at_ms bigint NOT NULL,
    consumed_at text DEFAULT to_char((now() AT TIME ZONE 'UTC'::text), 'YYYY-MM-DD HH24:MI:SS'::text),
    result_reported_at text,
    result_status character varying(32),
    source_unchanged smallint,
    action_count integer DEFAULT 0 NOT NULL,
    failure_count integer DEFAULT 0 NOT NULL,
    CONSTRAINT m365_approval_uses_source_unchanged_check CHECK ((source_unchanged = ANY (ARRAY[0, 1])))
);


--
-- Name: m365_identity_links; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.m365_identity_links (
    tenant_id character varying(128) NOT NULL,
    object_id character varying(128) NOT NULL,
    user_id text NOT NULL,
    enabled smallint DEFAULT 1 NOT NULL,
    created_at text DEFAULT to_char((now() AT TIME ZONE 'UTC'::text), 'YYYY-MM-DD HH24:MI:SS'::text),
    CONSTRAINT m365_identity_links_enabled_check CHECK ((enabled = ANY (ARRAY[0, 1])))
);


--
-- Name: m365_quota_reservations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.m365_quota_reservations (
    id character varying(36) NOT NULL,
    tenant_id character varying(128) NOT NULL,
    object_id character varying(128) NOT NULL,
    user_id text NOT NULL,
    tokens bigint NOT NULL,
    requests integer NOT NULL,
    created_at character varying(32) NOT NULL,
    period_start text,
    CONSTRAINT chk_m365_quota_reservations_nonneg CHECK (((tokens >= 0) AND (requests >= 0)))
);


--
-- Name: m365_sandbox_jobs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.m365_sandbox_jobs (
    job_id character varying(64) NOT NULL,
    tenant_id character varying(128) NOT NULL,
    object_id character varying(128) NOT NULL,
    user_id text NOT NULL,
    state character varying(24) NOT NULL,
    input_fingerprint character varying(64) NOT NULL,
    row_count integer NOT NULL,
    column_count integer NOT NULL,
    masked_cells integer DEFAULT 0 NOT NULL,
    timeout_seconds integer NOT NULL,
    error_code character varying(40),
    result_json text,
    created_at_ms bigint NOT NULL,
    updated_at_ms bigint NOT NULL,
    expires_at_ms bigint NOT NULL,
    CONSTRAINT m365_sandbox_jobs_state_check CHECK (((state)::text = ANY ((ARRAY['queued'::character varying, 'running'::character varying, 'cancel_requested'::character varying, 'cancelled'::character varying, 'succeeded'::character varying, 'failed'::character varying, 'expired'::character varying])::text[])))
);


--
-- Name: m365_tenant_usage; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.m365_tenant_usage (
    id character varying(36) NOT NULL,
    tenant_id character varying(128) NOT NULL,
    object_id character varying(128) NOT NULL,
    user_id text NOT NULL,
    plan_name character varying(64) NOT NULL,
    plan_source character varying(16) DEFAULT 'free'::character varying NOT NULL,
    max_tokens bigint NOT NULL,
    used_tokens bigint DEFAULT 0 NOT NULL,
    used_requests bigint DEFAULT 0 NOT NULL,
    bonus_tokens bigint DEFAULT 0 NOT NULL,
    bonus_requests bigint DEFAULT 0 NOT NULL,
    period_start text NOT NULL,
    period_end text NOT NULL,
    created_at text DEFAULT to_char((now() AT TIME ZONE 'UTC'::text), 'YYYY-MM-DD HH24:MI:SS'::text),
    updated_at text DEFAULT to_char((now() AT TIME ZONE 'UTC'::text), 'YYYY-MM-DD HH24:MI:SS'::text),
    CONSTRAINT chk_m365_tenant_usage_nonneg CHECK (((max_tokens >= 0) AND (used_tokens >= 0) AND (used_requests >= 0) AND (bonus_tokens >= 0) AND (bonus_requests >= 0)))
);


--
-- Name: m365_tenants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.m365_tenants (
    tenant_id character varying(128) NOT NULL,
    status character varying(16) NOT NULL,
    display_name character varying(256),
    allowed_scopes text NOT NULL,
    consented_at text,
    created_at text DEFAULT to_char((now() AT TIME ZONE 'UTC'::text), 'YYYY-MM-DD HH24:MI:SS'::text),
    updated_at text DEFAULT to_char((now() AT TIME ZONE 'UTC'::text), 'YYYY-MM-DD HH24:MI:SS'::text),
    ai_enabled smallint DEFAULT 1 NOT NULL,
    plan_id character varying(64),
    seat_limit integer DEFAULT 1 NOT NULL,
    subscription_valid_until text,
    CONSTRAINT chk_m365_tenants_seat_limit CHECK ((seat_limit >= 1)),
    CONSTRAINT m365_tenants_status_check CHECK (((status)::text = ANY ((ARRAY['enabled'::character varying, 'disabled'::character varying])::text[])))
);


--
-- Name: model_registry; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.model_registry (
    id text NOT NULL,
    openrouter_id text NOT NULL,
    display_name text NOT NULL,
    context_window integer DEFAULT 32000 NOT NULL,
    min_plan text DEFAULT 'free'::text NOT NULL,
    is_default_chat integer DEFAULT 0,
    is_default_autocomplete integer DEFAULT 0,
    enabled integer DEFAULT 1,
    created_at text DEFAULT to_char((now() AT TIME ZONE 'UTC'::text), 'YYYY-MM-DD HH24:MI:SS'::text),
    updated_at text DEFAULT to_char((now() AT TIME ZONE 'UTC'::text), 'YYYY-MM-DD HH24:MI:SS'::text)
);


--
-- Name: monthly_usage; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.monthly_usage (
    id text NOT NULL,
    user_id text NOT NULL,
    plan_name character varying(64) NOT NULL,
    max_tokens bigint NOT NULL,
    used_tokens bigint DEFAULT 0 NOT NULL,
    used_requests bigint DEFAULT 0 NOT NULL,
    bonus_tokens bigint DEFAULT 0 NOT NULL,
    bonus_requests bigint DEFAULT 0 NOT NULL,
    period_start text NOT NULL,
    period_end text NOT NULL,
    last_reset_at text DEFAULT to_char((now() AT TIME ZONE 'UTC'::text), 'YYYY-MM-DD HH24:MI:SS'::text),
    updated_at text DEFAULT to_char((now() AT TIME ZONE 'UTC'::text), 'YYYY-MM-DD HH24:MI:SS'::text)
);


--
-- Name: password_reset_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.password_reset_tokens (
    id text NOT NULL,
    user_id text NOT NULL,
    token_hash character varying(64) NOT NULL,
    expires_at text NOT NULL,
    used_at text,
    created_at text DEFAULT to_char((now() AT TIME ZONE 'UTC'::text), 'YYYY-MM-DD HH24:MI:SS'::text) NOT NULL
);


--
-- Name: plan_overrides; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.plan_overrides (
    plan_id text NOT NULL,
    display_name text,
    monthly_tokens bigint,
    monthly_requests bigint,
    price_lkr double precision,
    price_usd double precision,
    discount_pct integer DEFAULT 0,
    context_window integer,
    default_chat_model text,
    default_autocomplete_model text,
    allowed_models text,
    features text,
    payhere_item_id text,
    upgrade_url text,
    is_active integer DEFAULT 1,
    updated_at text DEFAULT to_char((now() AT TIME ZONE 'UTC'::text), 'YYYY-MM-DD HH24:MI:SS'::text),
    background_enabled smallint,
    background_tasks_per_month integer,
    background_max_concurrency integer,
    background_priority character varying(16)
);


--
-- Name: provider_api_keys; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.provider_api_keys (
    id character varying(64) NOT NULL,
    provider character varying(32) NOT NULL,
    label character varying(128) NOT NULL,
    key_encrypted text NOT NULL,
    key_masked character varying(32) NOT NULL,
    is_active smallint DEFAULT 1 NOT NULL,
    balance_usd double precision,
    balance_currency character varying(16) DEFAULT 'USD'::character varying,
    balance_details text,
    last_checked_at text,
    updated_by character varying(128),
    updated_at text DEFAULT to_char((now() AT TIME ZONE 'UTC'::text), 'YYYY-MM-DD HH24:MI:SS'::text)
);


--
-- Name: provider_credentials; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.provider_credentials (
    provider character varying(32) NOT NULL,
    key_encrypted text NOT NULL,
    key_masked character varying(32) NOT NULL,
    updated_by character varying(128),
    updated_at text DEFAULT to_char((now() AT TIME ZONE 'UTC'::text), 'YYYY-MM-DD HH24:MI:SS'::text)
);


--
-- Name: quota_reservations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.quota_reservations (
    id text NOT NULL,
    user_id text NOT NULL,
    tokens bigint NOT NULL,
    requests integer NOT NULL,
    created_at text NOT NULL,
    owner_type character varying(32),
    owner_id text,
    period_start text
);


--
-- Name: request_economics; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.request_economics (
    id text NOT NULL,
    request_id text NOT NULL,
    usage_log_id text,
    user_id text NOT NULL,
    plan_id character varying(64) NOT NULL,
    requested_model character varying(128) NOT NULL,
    resolved_model character varying(128),
    provider character varying(32),
    input_tokens bigint DEFAULT 0 NOT NULL,
    output_tokens bigint DEFAULT 0 NOT NULL,
    cached_input_tokens bigint DEFAULT 0 NOT NULL,
    provider_cost_usd double precision,
    cost_source character varying(20) NOT NULL,
    allocated_revenue_usd double precision DEFAULT 0 NOT NULL,
    gross_margin_usd double precision,
    cache_status character varying(16) DEFAULT 'bypass'::character varying NOT NULL,
    optimization_mode character varying(20) DEFAULT 'safe'::character varying NOT NULL,
    template_id character varying(128),
    estimated_tokens_saved bigint DEFAULT 0 NOT NULL,
    latency_ms integer,
    outcome character varying(16) DEFAULT 'success'::character varying NOT NULL,
    request_kind character varying(32) DEFAULT 'chat'::character varying NOT NULL,
    cache_policy character varying(16) DEFAULT 'standard'::character varying NOT NULL,
    cache_bypass_reason character varying(64),
    task_scope character varying(16),
    created_at text DEFAULT to_char((now() AT TIME ZONE 'UTC'::text), 'YYYY-MM-DD HH24:MI:SS'::text),
    estimated_cost_usd double precision,
    credits_charged bigint,
    off_peak smallint DEFAULT 0 NOT NULL,
    route_tier character varying(16),
    route_auto smallint DEFAULT 0 NOT NULL,
    prompt_fp character varying(32),
    tool_followup smallint DEFAULT 0 NOT NULL,
    CONSTRAINT request_economics_cache_status_check CHECK (((cache_status)::text = ANY ((ARRAY['hit'::character varying, 'miss'::character varying, 'bypass'::character varying])::text[]))),
    CONSTRAINT request_economics_cost_source_check CHECK (((cost_source)::text = ANY ((ARRAY['provider'::character varying, 'local-zero'::character varying, 'unknown'::character varying])::text[]))),
    CONSTRAINT request_economics_outcome_check CHECK (((outcome)::text = ANY ((ARRAY['success'::character varying, 'failed'::character varying])::text[])))
);


--
-- Name: routing_feedback; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.routing_feedback (
    id text NOT NULL,
    user_id text NOT NULL,
    prompt_fp character varying(32),
    signal character varying(16) NOT NULL,
    created_at text DEFAULT to_char((now() AT TIME ZONE 'UTC'::text), 'YYYY-MM-DD HH24:MI:SS'::text)
);


--
-- Name: schema_migrations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.schema_migrations (
    version character varying(64) NOT NULL,
    applied_at text DEFAULT to_char((now() AT TIME ZONE 'UTC'::text), 'YYYY-MM-DD HH24:MI:SS'::text)
);


--
-- Name: security_audit_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.security_audit_logs (
    id text NOT NULL,
    event_type character varying(64) NOT NULL,
    severity character varying(10) DEFAULT 'INFO'::character varying NOT NULL,
    actor character varying(128),
    target character varying(128),
    details text,
    ip_address character varying(45),
    created_at text DEFAULT to_char((now() AT TIME ZONE 'UTC'::text), 'YYYY-MM-DD HH24:MI:SS'::text),
    CONSTRAINT security_audit_logs_severity_check CHECK (((severity)::text = ANY ((ARRAY['DEBUG'::character varying, 'INFO'::character varying, 'WARN'::character varying, 'ERROR'::character varying, 'CRITICAL'::character varying])::text[])))
);


--
-- Name: subscriptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.subscriptions (
    id text NOT NULL,
    user_id text NOT NULL,
    plan_name character varying(64) NOT NULL,
    status character varying(32) NOT NULL,
    order_id character varying(128) NOT NULL,
    payment_id character varying(128),
    amount_minor integer DEFAULT 0 NOT NULL,
    amount double precision,
    currency character varying(10) NOT NULL,
    valid_until text NOT NULL,
    created_at text DEFAULT to_char((now() AT TIME ZONE 'UTC'::text), 'YYYY-MM-DD HH24:MI:SS'::text),
    CONSTRAINT subscriptions_currency_check CHECK (((currency)::text = ANY ((ARRAY['LKR'::character varying, 'USD'::character varying, 'EUR'::character varying, 'GBP'::character varying])::text[]))),
    CONSTRAINT subscriptions_status_check CHECK (((status)::text = ANY ((ARRAY['pending'::character varying, 'active'::character varying, 'cancelled'::character varying, 'expired'::character varying, 'failed'::character varying, 'credited'::character varying, 'superseded'::character varying, 'chargedback'::character varying])::text[])))
);


--
-- Name: task_outcomes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.task_outcomes (
    id character varying(36) NOT NULL,
    user_id text,
    outcome character varying(24) NOT NULL,
    mode character varying(16),
    rounds integer,
    credits integer,
    edited smallint DEFAULT 0 NOT NULL,
    verified smallint DEFAULT 0 NOT NULL,
    scope character varying(16),
    client character varying(64),
    created_at text DEFAULT to_char((now() AT TIME ZONE 'UTC'::text), 'YYYY-MM-DD HH24:MI:SS'::text),
    reason character varying(24),
    repairs integer,
    gates integer
);


--
-- Name: template_vault; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.template_vault (
    id character varying(128) NOT NULL,
    version character varying(32) NOT NULL,
    category character varying(64) NOT NULL,
    title character varying(255) NOT NULL,
    description text NOT NULL,
    languages text NOT NULL,
    keywords text NOT NULL,
    dependencies text NOT NULL,
    required_env text NOT NULL,
    security_level character varying(32) NOT NULL,
    code text NOT NULL,
    usage_snippet text NOT NULL,
    checksum character varying(64) NOT NULL,
    usage_count integer DEFAULT 0 NOT NULL,
    auto_correction_count integer DEFAULT 0 NOT NULL,
    last_corrected_at text,
    created_at text DEFAULT to_char((now() AT TIME ZONE 'UTC'::text), 'YYYY-MM-DD HH24:MI:SS'::text),
    updated_at text DEFAULT to_char((now() AT TIME ZONE 'UTC'::text), 'YYYY-MM-DD HH24:MI:SS'::text)
);


--
-- Name: usage_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.usage_logs (
    id text NOT NULL,
    user_id text NOT NULL,
    model character varying(128) NOT NULL,
    input_tokens bigint DEFAULT 0 NOT NULL,
    output_tokens bigint DEFAULT 0 NOT NULL,
    tokens_used bigint DEFAULT 0 NOT NULL,
    cached integer DEFAULT 0 NOT NULL,
    prev_hash text DEFAULT 'GENESIS'::text,
    audit_hash text DEFAULT ''::text,
    created_at text DEFAULT to_char((now() AT TIME ZONE 'UTC'::text), 'YYYY-MM-DD HH24:MI:SS'::text),
    CONSTRAINT usage_logs_cached_check CHECK ((cached = ANY (ARRAY[0, 1])))
);


--
-- Name: user_memory; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_memory (
    id text NOT NULL,
    user_id text NOT NULL,
    key text NOT NULL,
    value text NOT NULL,
    expires_at text,
    created_at text DEFAULT to_char((now() AT TIME ZONE 'UTC'::text), 'YYYY-MM-DD HH24:MI:SS'::text)
);


--
-- Name: user_rules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_rules (
    id text NOT NULL,
    user_id text NOT NULL,
    scope text DEFAULT 'global'::text NOT NULL,
    rule text NOT NULL,
    enabled integer DEFAULT 1,
    created_at text DEFAULT to_char((now() AT TIME ZONE 'UTC'::text), 'YYYY-MM-DD HH24:MI:SS'::text)
);


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id text NOT NULL,
    email character varying(255) NOT NULL,
    password_hash character varying(255) NOT NULL,
    api_key character varying(128) NOT NULL,
    api_key_hash character varying(64),
    api_key_masked character varying(32),
    api_key_encrypted text,
    name character varying(128),
    is_suspended integer DEFAULT 0 NOT NULL,
    allowed_ips text DEFAULT ''::text,
    email_verified integer DEFAULT 0 NOT NULL,
    created_at text DEFAULT to_char((now() AT TIME ZONE 'UTC'::text), 'YYYY-MM-DD HH24:MI:SS'::text),
    privacy_accepted_at timestamp with time zone,
    privacy_version character varying(16),
    CONSTRAINT users_email_verified_check CHECK ((email_verified = ANY (ARRAY[0, 1]))),
    CONSTRAINT users_is_suspended_check CHECK ((is_suspended = ANY (ARRAY[0, 1])))
);


--
-- Name: web_push_subscriptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.web_push_subscriptions (
    id text NOT NULL,
    user_id text NOT NULL,
    endpoint_digest character varying(64) NOT NULL,
    endpoint_ciphertext text NOT NULL,
    p256dh_ciphertext text NOT NULL,
    auth_ciphertext text NOT NULL,
    created_at text DEFAULT to_char((now() AT TIME ZONE 'UTC'::text), 'YYYY-MM-DD HH24:MI:SS'::text) NOT NULL,
    last_used_at text,
    revoked_at text
);


--
-- Name: zk_compliance_audit_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.zk_compliance_audit_logs (
    id character varying(64) NOT NULL,
    user_surrogate_id character varying(64) NOT NULL,
    request_type character varying(64) NOT NULL,
    action character varying(64) NOT NULL,
    diff_fingerprint character varying(64),
    prompt_fingerprint character varying(64),
    files_count integer DEFAULT 0,
    lines_added integer DEFAULT 0,
    lines_deleted integer DEFAULT 0,
    zero_retention_verified integer DEFAULT 1,
    merkle_prev_hash character varying(64) NOT NULL,
    merkle_hash character varying(64) NOT NULL,
    created_at text DEFAULT to_char((now() AT TIME ZONE 'UTC'::text), 'YYYY-MM-DD HH24:MI:SS'::text),
    seq bigint NOT NULL
);


--
-- Name: zk_compliance_audit_logs_seq_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.zk_compliance_audit_logs_seq_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: zk_compliance_audit_logs_seq_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.zk_compliance_audit_logs_seq_seq OWNED BY public.zk_compliance_audit_logs.seq;


--
-- Name: zk_compliance_audit_logs seq; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.zk_compliance_audit_logs ALTER COLUMN seq SET DEFAULT nextval('public.zk_compliance_audit_logs_seq_seq'::regclass);


--
-- Name: admin_staff admin_staff_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_staff
    ADD CONSTRAINT admin_staff_email_key UNIQUE (email);


--
-- Name: admin_staff admin_staff_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_staff
    ADD CONSTRAINT admin_staff_pkey PRIMARY KEY (id);


--
-- Name: background_artifacts background_artifacts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.background_artifacts
    ADD CONSTRAINT background_artifacts_pkey PRIMARY KEY (id);


--
-- Name: background_billing_ledger background_billing_ledger_idempotency_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.background_billing_ledger
    ADD CONSTRAINT background_billing_ledger_idempotency_key_key UNIQUE (idempotency_key);


--
-- Name: background_billing_ledger background_billing_ledger_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.background_billing_ledger
    ADD CONSTRAINT background_billing_ledger_pkey PRIMARY KEY (id);


--
-- Name: background_consent background_consent_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.background_consent
    ADD CONSTRAINT background_consent_pkey PRIMARY KEY (user_id, policy_version);


--
-- Name: background_task_events background_task_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.background_task_events
    ADD CONSTRAINT background_task_events_pkey PRIMARY KEY (id);


--
-- Name: background_task_events background_task_events_task_id_sequence_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.background_task_events
    ADD CONSTRAINT background_task_events_task_id_sequence_key UNIQUE (task_id, sequence);


--
-- Name: background_tasks background_tasks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.background_tasks
    ADD CONSTRAINT background_tasks_pkey PRIMARY KEY (id);


--
-- Name: background_tasks background_tasks_user_id_idempotency_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.background_tasks
    ADD CONSTRAINT background_tasks_user_id_idempotency_key_key UNIQUE (user_id, idempotency_key);


--
-- Name: cache_entries cache_entries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cache_entries
    ADD CONSTRAINT cache_entries_pkey PRIMARY KEY (cache_key);


--
-- Name: cloud_delivery_manifests cloud_delivery_manifests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cloud_delivery_manifests
    ADD CONSTRAINT cloud_delivery_manifests_pkey PRIMARY KEY (run_id);


--
-- Name: email_verifications email_verifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_verifications
    ADD CONSTRAINT email_verifications_pkey PRIMARY KEY (id);


--
-- Name: error_reports error_reports_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.error_reports
    ADD CONSTRAINT error_reports_pkey PRIMARY KEY (id);


--
-- Name: m365_approval_uses m365_approval_uses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.m365_approval_uses
    ADD CONSTRAINT m365_approval_uses_pkey PRIMARY KEY (jti);


--
-- Name: m365_identity_links m365_identity_links_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.m365_identity_links
    ADD CONSTRAINT m365_identity_links_pkey PRIMARY KEY (tenant_id, object_id);


--
-- Name: m365_quota_reservations m365_quota_reservations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.m365_quota_reservations
    ADD CONSTRAINT m365_quota_reservations_pkey PRIMARY KEY (id);


--
-- Name: m365_sandbox_jobs m365_sandbox_jobs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.m365_sandbox_jobs
    ADD CONSTRAINT m365_sandbox_jobs_pkey PRIMARY KEY (job_id);


--
-- Name: m365_tenant_usage m365_tenant_usage_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.m365_tenant_usage
    ADD CONSTRAINT m365_tenant_usage_pkey PRIMARY KEY (id);


--
-- Name: m365_tenant_usage m365_tenant_usage_tenant_id_object_id_period_start_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.m365_tenant_usage
    ADD CONSTRAINT m365_tenant_usage_tenant_id_object_id_period_start_key UNIQUE (tenant_id, object_id, period_start);


--
-- Name: m365_tenants m365_tenants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.m365_tenants
    ADD CONSTRAINT m365_tenants_pkey PRIMARY KEY (tenant_id);


--
-- Name: model_registry model_registry_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.model_registry
    ADD CONSTRAINT model_registry_pkey PRIMARY KEY (id);


--
-- Name: monthly_usage monthly_usage_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.monthly_usage
    ADD CONSTRAINT monthly_usage_pkey PRIMARY KEY (id);


--
-- Name: monthly_usage monthly_usage_user_id_period_start_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.monthly_usage
    ADD CONSTRAINT monthly_usage_user_id_period_start_key UNIQUE (user_id, period_start);


--
-- Name: password_reset_tokens password_reset_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.password_reset_tokens
    ADD CONSTRAINT password_reset_tokens_pkey PRIMARY KEY (id);


--
-- Name: password_reset_tokens password_reset_tokens_token_hash_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.password_reset_tokens
    ADD CONSTRAINT password_reset_tokens_token_hash_key UNIQUE (token_hash);


--
-- Name: plan_overrides plan_overrides_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.plan_overrides
    ADD CONSTRAINT plan_overrides_pkey PRIMARY KEY (plan_id);


--
-- Name: provider_api_keys provider_api_keys_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.provider_api_keys
    ADD CONSTRAINT provider_api_keys_pkey PRIMARY KEY (id);


--
-- Name: provider_credentials provider_credentials_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.provider_credentials
    ADD CONSTRAINT provider_credentials_pkey PRIMARY KEY (provider);


--
-- Name: quota_reservations quota_reservations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quota_reservations
    ADD CONSTRAINT quota_reservations_pkey PRIMARY KEY (id);


--
-- Name: request_economics request_economics_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.request_economics
    ADD CONSTRAINT request_economics_pkey PRIMARY KEY (id);


--
-- Name: request_economics request_economics_request_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.request_economics
    ADD CONSTRAINT request_economics_request_id_key UNIQUE (request_id);


--
-- Name: routing_feedback routing_feedback_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.routing_feedback
    ADD CONSTRAINT routing_feedback_pkey PRIMARY KEY (id);


--
-- Name: schema_migrations schema_migrations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schema_migrations
    ADD CONSTRAINT schema_migrations_pkey PRIMARY KEY (version);


--
-- Name: security_audit_logs security_audit_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.security_audit_logs
    ADD CONSTRAINT security_audit_logs_pkey PRIMARY KEY (id);


--
-- Name: subscriptions subscriptions_order_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscriptions
    ADD CONSTRAINT subscriptions_order_id_key UNIQUE (order_id);


--
-- Name: subscriptions subscriptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscriptions
    ADD CONSTRAINT subscriptions_pkey PRIMARY KEY (id);


--
-- Name: task_outcomes task_outcomes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_outcomes
    ADD CONSTRAINT task_outcomes_pkey PRIMARY KEY (id);


--
-- Name: template_vault template_vault_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.template_vault
    ADD CONSTRAINT template_vault_pkey PRIMARY KEY (id);


--
-- Name: usage_logs usage_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.usage_logs
    ADD CONSTRAINT usage_logs_pkey PRIMARY KEY (id);


--
-- Name: user_memory user_memory_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_memory
    ADD CONSTRAINT user_memory_pkey PRIMARY KEY (id);


--
-- Name: user_memory user_memory_user_id_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_memory
    ADD CONSTRAINT user_memory_user_id_key_key UNIQUE (user_id, key);


--
-- Name: user_rules user_rules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_rules
    ADD CONSTRAINT user_rules_pkey PRIMARY KEY (id);


--
-- Name: users users_api_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_api_key_key UNIQUE (api_key);


--
-- Name: users users_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_key UNIQUE (email);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: web_push_subscriptions web_push_subscriptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.web_push_subscriptions
    ADD CONSTRAINT web_push_subscriptions_pkey PRIMARY KEY (id);


--
-- Name: zk_compliance_audit_logs zk_compliance_audit_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.zk_compliance_audit_logs
    ADD CONSTRAINT zk_compliance_audit_logs_pkey PRIMARY KEY (id);


--
-- Name: idx_background_artifacts_expiry; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_background_artifacts_expiry ON public.background_artifacts USING btree (expires_at, deleted_at);


--
-- Name: idx_background_events_task_sequence; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_background_events_task_sequence ON public.background_task_events USING btree (task_id, sequence);


--
-- Name: idx_background_ledger_task; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_background_ledger_task ON public.background_billing_ledger USING btree (task_id, created_at);


--
-- Name: idx_background_tasks_dispatch; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_background_tasks_dispatch ON public.background_tasks USING btree (status, priority DESC, queued_at);


--
-- Name: idx_background_tasks_heartbeat; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_background_tasks_heartbeat ON public.background_tasks USING btree (heartbeat_at);


--
-- Name: idx_background_tasks_purge; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_background_tasks_purge ON public.background_tasks USING btree (purge_after);


--
-- Name: idx_background_tasks_user_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_background_tasks_user_created ON public.background_tasks USING btree (user_id, created_at DESC);


--
-- Name: idx_cache_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cache_created ON public.cache_entries USING btree (created_at);


--
-- Name: idx_cache_expiry; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cache_expiry ON public.cache_entries USING btree (expires_at);


--
-- Name: idx_cache_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cache_user ON public.cache_entries USING btree (user_id);


--
-- Name: idx_cloud_delivery_repository; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cloud_delivery_repository ON public.cloud_delivery_manifests USING btree (repository_owner, repository_name, updated_at DESC);


--
-- Name: idx_cloud_delivery_state_updated; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cloud_delivery_state_updated ON public.cloud_delivery_manifests USING btree (state, updated_at DESC);


--
-- Name: idx_email_verif_token; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_email_verif_token ON public.email_verifications USING btree (token_hash);


--
-- Name: idx_email_verif_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_email_verif_user ON public.email_verifications USING btree (user_id);


--
-- Name: idx_email_verifications_expiry; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_email_verifications_expiry ON public.email_verifications USING btree (expires_at);


--
-- Name: idx_error_reports_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_error_reports_created ON public.error_reports USING btree (created_at);


--
-- Name: idx_m365_approval_expiry; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_m365_approval_expiry ON public.m365_approval_uses USING btree (expires_at_ms);


--
-- Name: idx_m365_identity_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_m365_identity_user ON public.m365_identity_links USING btree (user_id);


--
-- Name: idx_m365_quota_reservations_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_m365_quota_reservations_created ON public.m365_quota_reservations USING btree (created_at);


--
-- Name: idx_m365_quota_reservations_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_m365_quota_reservations_user ON public.m365_quota_reservations USING btree (user_id);


--
-- Name: idx_m365_sandbox_owner; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_m365_sandbox_owner ON public.m365_sandbox_jobs USING btree (tenant_id, object_id, created_at_ms);


--
-- Name: idx_m365_sandbox_state; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_m365_sandbox_state ON public.m365_sandbox_jobs USING btree (state, expires_at_ms);


--
-- Name: idx_m365_sandbox_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_m365_sandbox_user ON public.m365_sandbox_jobs USING btree (user_id, created_at_ms);


--
-- Name: idx_m365_tenant_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_m365_tenant_status ON public.m365_tenants USING btree (status, updated_at DESC);


--
-- Name: idx_m365_tenant_usage_period; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_m365_tenant_usage_period ON public.m365_tenant_usage USING btree (tenant_id, object_id, period_end);


--
-- Name: idx_m365_tenant_usage_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_m365_tenant_usage_user ON public.m365_tenant_usage USING btree (user_id);


--
-- Name: idx_monthly_usage_period_end; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_monthly_usage_period_end ON public.monthly_usage USING btree (period_end);


--
-- Name: idx_password_reset_expiry; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_password_reset_expiry ON public.password_reset_tokens USING btree (expires_at, used_at);


--
-- Name: idx_password_reset_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_password_reset_user ON public.password_reset_tokens USING btree (user_id, created_at DESC);


--
-- Name: idx_provider_keys_provider; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_provider_keys_provider ON public.provider_api_keys USING btree (provider, is_active);


--
-- Name: idx_quota_reservations_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_quota_reservations_created ON public.quota_reservations USING btree (created_at);


--
-- Name: idx_quota_reservations_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_quota_reservations_user ON public.quota_reservations USING btree (user_id);


--
-- Name: idx_request_economics_kind_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_request_economics_kind_created ON public.request_economics USING btree (request_kind, created_at DESC);


--
-- Name: idx_request_economics_prompt_fp; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_request_economics_prompt_fp ON public.request_economics USING btree (user_id, prompt_fp) WHERE (prompt_fp IS NOT NULL);


--
-- Name: idx_request_economics_provider_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_request_economics_provider_created ON public.request_economics USING btree (provider, created_at DESC);


--
-- Name: idx_request_economics_scope_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_request_economics_scope_created ON public.request_economics USING btree (task_scope, created_at DESC);


--
-- Name: idx_request_economics_user_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_request_economics_user_created ON public.request_economics USING btree (user_id, created_at DESC);


--
-- Name: idx_routing_feedback_user_fp; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_routing_feedback_user_fp ON public.routing_feedback USING btree (user_id, prompt_fp);


--
-- Name: idx_security_audit_actor; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_security_audit_actor ON public.security_audit_logs USING btree (actor);


--
-- Name: idx_security_audit_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_security_audit_created ON public.security_audit_logs USING btree (created_at DESC);


--
-- Name: idx_security_audit_event; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_security_audit_event ON public.security_audit_logs USING btree (event_type);


--
-- Name: idx_security_audit_target; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_security_audit_target ON public.security_audit_logs USING btree (target);


--
-- Name: idx_subscriptions_user_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_subscriptions_user_status ON public.subscriptions USING btree (user_id, status);


--
-- Name: idx_task_outcomes_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_task_outcomes_created ON public.task_outcomes USING btree (created_at);


--
-- Name: idx_task_outcomes_scope_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_task_outcomes_scope_created ON public.task_outcomes USING btree (scope, created_at DESC);


--
-- Name: idx_usage_logs_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_usage_logs_created ON public.usage_logs USING btree (created_at DESC);


--
-- Name: idx_usage_logs_user_model_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_usage_logs_user_model_created ON public.usage_logs USING btree (user_id, model, created_at DESC);


--
-- Name: idx_users_api_key_hash; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_api_key_hash ON public.users USING btree (api_key_hash);


--
-- Name: idx_web_push_endpoint; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_web_push_endpoint ON public.web_push_subscriptions USING btree (user_id, endpoint_digest);


--
-- Name: idx_web_push_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_web_push_user ON public.web_push_subscriptions USING btree (user_id, revoked_at);


--
-- Name: idx_zk_audit_diff_hash; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_zk_audit_diff_hash ON public.zk_compliance_audit_logs USING btree (diff_fingerprint);


--
-- Name: idx_zk_audit_seq; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_zk_audit_seq ON public.zk_compliance_audit_logs USING btree (seq);


--
-- Name: idx_zk_audit_surrogate; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_zk_audit_surrogate ON public.zk_compliance_audit_logs USING btree (user_surrogate_id, created_at DESC);


--
-- Name: monthly_usage trg_monthly_usage_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_monthly_usage_updated_at BEFORE UPDATE ON public.monthly_usage FOR EACH ROW EXECUTE FUNCTION public.vynor_touch_updated_at();


--
-- Name: background_artifacts background_artifacts_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.background_artifacts
    ADD CONSTRAINT background_artifacts_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.background_tasks(id) ON DELETE CASCADE;


--
-- Name: background_consent background_consent_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.background_consent
    ADD CONSTRAINT background_consent_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: background_task_events background_task_events_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.background_task_events
    ADD CONSTRAINT background_task_events_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.background_tasks(id) ON DELETE CASCADE;


--
-- Name: background_tasks background_tasks_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.background_tasks
    ADD CONSTRAINT background_tasks_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: email_verifications email_verifications_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_verifications
    ADD CONSTRAINT email_verifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: error_reports error_reports_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.error_reports
    ADD CONSTRAINT error_reports_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: m365_identity_links m365_identity_links_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.m365_identity_links
    ADD CONSTRAINT m365_identity_links_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: monthly_usage monthly_usage_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.monthly_usage
    ADD CONSTRAINT monthly_usage_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: password_reset_tokens password_reset_tokens_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.password_reset_tokens
    ADD CONSTRAINT password_reset_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: request_economics request_economics_usage_log_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.request_economics
    ADD CONSTRAINT request_economics_usage_log_id_fkey FOREIGN KEY (usage_log_id) REFERENCES public.usage_logs(id) ON DELETE SET NULL;


--
-- Name: request_economics request_economics_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.request_economics
    ADD CONSTRAINT request_economics_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: routing_feedback routing_feedback_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.routing_feedback
    ADD CONSTRAINT routing_feedback_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: subscriptions subscriptions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscriptions
    ADD CONSTRAINT subscriptions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: task_outcomes task_outcomes_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_outcomes
    ADD CONSTRAINT task_outcomes_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: usage_logs usage_logs_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.usage_logs
    ADD CONSTRAINT usage_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: user_memory user_memory_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_memory
    ADD CONSTRAINT user_memory_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: user_rules user_rules_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_rules
    ADD CONSTRAINT user_rules_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: web_push_subscriptions web_push_subscriptions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.web_push_subscriptions
    ADD CONSTRAINT web_push_subscriptions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--


