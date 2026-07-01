-- The agent reports its available host-defined hooks (custom commands) in hello,
-- so the UI can offer them as one-click actions.

ALTER TABLE machines ADD COLUMN hooks_json TEXT;
