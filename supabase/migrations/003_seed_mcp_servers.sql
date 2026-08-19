-- 插入两个公开 MCP 服务器作为示例

INSERT INTO mcp_servers (id, name, transport, url, enabled, created_at)
VALUES
  (
    'toolkit-mcp',
    'Toolkit MCP',
    'streamable-http',
    'https://toolkit.caseyjhand.com/mcp',
    true,
    now()
  )
ON CONFLICT (id) DO NOTHING;
